"use client";

import { AlertCircle, CheckCircle2, Loader2, Play } from "lucide-react";
import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { readJsonResponse } from "@/lib/client-json";
import type { McpTool, OpenApiEndpoint } from "@/lib/types";

type TestStep = {
  label: string;
  status: "pending" | "passed" | "failed";
  detail: string;
};

type JsonRpcResponse = {
  result?: unknown;
  error?: { code?: number; message?: string };
};

export function McpEndpointTester({
  endpoint,
  tools,
  endpointMap = [],
  isPublic,
}: {
  endpoint: string;
  tools: McpTool[];
  endpointMap?: OpenApiEndpoint[];
  isPublic: boolean;
}) {
  const [apiKey, setApiKey] = useState("");
  const [loading, setLoading] = useState(false);
  const [steps, setSteps] = useState<TestStep[]>([]);
  const [sampleResponse, setSampleResponse] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const selected = useMemo(() => selectTestTool(tools, endpointMap), [tools, endpointMap]);
  const canRun = isPublic || apiKey.trim().length > 0;

  async function rpc(id: number, method: string, params: Record<string, unknown>) {
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (apiKey.trim()) headers.Authorization = `Bearer ${apiKey.trim()}`;

    const response = await fetch(endpoint, {
      method: "POST",
      headers,
      body: JSON.stringify({ jsonrpc: "2.0", id, method, params }),
    });
    const payload = await readJsonResponse<JsonRpcResponse>(response);
    return { ok: response.ok && !payload.error, status: response.status, payload };
  }

  async function runTest() {
    setLoading(true);
    setError(null);
    setSampleResponse(null);
    setSteps([
      { label: "initialize", status: "pending", detail: "Waiting" },
      { label: "tools/list", status: "pending", detail: "Waiting" },
      { label: "tools/call", status: "pending", detail: selected.tool?.name ?? "No tool selected" },
    ]);

    try {
      if (!selected.tool) throw new Error("No generated tool is available to test.");
      if (!canRun) throw new Error("Private servers require an Astrail API key before testing.");

      const initialize = await rpc(1, "initialize", {});
      setSteps((current) => updateStep(current, 0, initialize.ok, `HTTP ${initialize.status}`));
      if (!initialize.ok) throw new Error(errorMessage(initialize.payload, "initialize failed"));

      const list = await rpc(2, "tools/list", {});
      const listResult = list.payload.result as { tools?: unknown[] } | undefined;
      setSteps((current) => updateStep(current, 1, list.ok, `${listResult?.tools?.length ?? 0} tools`));
      if (!list.ok) throw new Error(errorMessage(list.payload, "tools/list failed"));

      const call = await rpc(3, "tools/call", {
        name: selected.tool.name,
        arguments: selected.args,
      });
      setSteps((current) => updateStep(current, 2, call.ok, `HTTP ${call.status}`));
      if (!call.ok) throw new Error(errorMessage(call.payload, "tools/call failed"));

      setSampleResponse(JSON.stringify(call.payload.result ?? call.payload, null, 2));
    } catch (testError) {
      setError(testError instanceof Error ? testError.message : "MCP endpoint test failed.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="space-y-4">
      {!isPublic && (
        <div className="space-y-2">
          <Label htmlFor="mcpTestApiKey">Astrail API key</Label>
          <Input
            id="mcpTestApiKey"
            value={apiKey}
            onChange={(event) => setApiKey(event.target.value)}
            placeholder="ag_..."
            type="password"
          />
          <p className="text-xs text-muted-foreground">
            Private endpoints require a user API key. The key is sent only in this browser request and is not stored here.
          </p>
        </div>
      )}

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="text-sm text-muted-foreground">
          Test tool: <code>{selected.tool?.name ?? "none"}</code>
        </div>
        <Button type="button" onClick={runTest} disabled={loading || !selected.tool || !canRun}>
          {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
          Test MCP endpoint
        </Button>
      </div>

      {steps.length > 0 && (
        <div className="divide-y border text-sm">
          {steps.map((step) => (
            <div key={step.label} className="flex items-center justify-between gap-4 p-3">
              <div className="flex items-center gap-2">
                {step.status === "passed" ? (
                  <CheckCircle2 className="h-4 w-4 text-primary" />
                ) : step.status === "failed" ? (
                  <AlertCircle className="h-4 w-4 text-destructive" />
                ) : (
                  <Loader2 className="h-4 w-4 text-muted-foreground" />
                )}
                <span>{step.label}</span>
              </div>
              <span className="text-muted-foreground">{step.detail}</span>
            </div>
          ))}
        </div>
      )}

      {error && (
        <div className="border border-destructive/40 p-3 text-sm text-destructive">
          {error}
        </div>
      )}

      {sampleResponse && (
        <pre className="max-h-80 overflow-auto border bg-muted p-3 text-xs">
          {sampleResponse}
        </pre>
      )}
    </div>
  );
}

function updateStep(steps: TestStep[], index: number, ok: boolean, detail: string) {
  const status: TestStep["status"] = ok ? "passed" : "failed";
  return steps.map((step, stepIndex) =>
    stepIndex === index ? { ...step, status, detail } : step
  );
}

function errorMessage(response: JsonRpcResponse, fallback: string) {
  return response.error?.message ?? fallback;
}

function selectTestTool(tools: McpTool[], endpointMap: OpenApiEndpoint[]) {
  const endpoint =
    endpointMap.find((item) => ["GET", "POST"].includes(item.method.toUpperCase()) && !hasPathParams(item)) ??
    endpointMap.find((item) => item.runtime_kind === "browser" || item.method.toUpperCase() === "BROWSER") ??
    endpointMap[0];
  const tool = tools.find((item) => item.name === endpoint?.tool_name || item.name === endpoint?.operation_id) ?? tools[0];
  return {
    tool,
    args: endpoint ? sampleArgsFromEndpoint(endpoint) : sampleArgsFromSchema(tool),
  };
}

function sampleArgsFromEndpoint(endpoint: OpenApiEndpoint) {
  const args: Record<string, string | number> = {};
  for (const parameter of Array.isArray(endpoint.parameters) ? endpoint.parameters : []) {
    if (!parameter || typeof parameter !== "object") continue;
    const record = parameter as Record<string, unknown>;
    const name = typeof record.name === "string" ? record.name : null;
    if (!name) continue;
    args[name] = sampleValue(name);
  }
  if (endpoint.runtime_kind === "browser" || endpoint.method.toUpperCase() === "BROWSER") {
    args.instruction = "Verify this browser workflow.";
  }
  return args;
}

function sampleArgsFromSchema(tool: McpTool | undefined) {
  if (!tool?.input_schema?.properties || typeof tool.input_schema.properties !== "object") return {};
  return Object.fromEntries(Object.keys(tool.input_schema.properties).slice(0, 3).map((key) => [key, sampleValue(key)]));
}

function hasPathParams(endpoint: OpenApiEndpoint) {
  return (Array.isArray(endpoint.parameters) ? endpoint.parameters : []).some((parameter) => {
    if (!parameter || typeof parameter !== "object") return false;
    return (parameter as Record<string, unknown>).in === "path";
  });
}

function sampleValue(name: string) {
  const normalized = name.toLowerCase();
  if (normalized === "status") return "available";
  if (normalized.includes("id")) return 1;
  if (normalized.includes("limit")) return 10;
  return "example";
}
