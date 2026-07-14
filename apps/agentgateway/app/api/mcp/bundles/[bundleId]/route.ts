import { NextResponse } from "next/server";
import { verifyApiKey } from "@/lib/api-keys";
import { executeToolFromEndpointMap, findEndpointForTool, type ToolExecutionResult } from "@/lib/runtime/execute-tool";
import { redactSensitive, visibleToolsForRequest } from "@/lib/runtime/permissions";
import { checkRuntimeRateLimit } from "@/lib/runtime/rate-limit";
import { hasServerSupabaseEnv } from "@/lib/supabase/env";
import { createAdminClient, hasServiceRoleKey } from "@/lib/supabase/server";
import type { ApiKey, McpServer, McpTool } from "@/lib/types";

export const runtime = "nodejs";

type JsonRpcRequest = {
  id?: string | number | null;
  method?: string;
  params?: {
    name?: string;
    arguments?: Record<string, unknown>;
  };
};

type Bundle = {
  id: string;
  user_id: string;
  name: string;
  is_public: boolean;
};

type ApiKeyRow = ApiKey & {
  key_hash: string;
};

type LoadedBundle =
  | { bundle: Bundle; servers: McpServer[] }
  | { error: string };

function jsonRpc(id: JsonRpcRequest["id"], result: unknown, status = 200) {
  return NextResponse.json({ jsonrpc: "2.0", id: id ?? null, result }, { status });
}

function jsonRpcError(id: JsonRpcRequest["id"], code: number, message: string, status = 400) {
  return NextResponse.json({ jsonrpc: "2.0", id: id ?? null, error: { code, message } }, { status });
}

function bundleToolName(server: McpServer, tool: McpTool) {
  const prefix = server.name.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "") || server.id;
  return `${prefix}__${tool.name}`;
}

function visibleToolsForBundle(server: McpServer) {
  return visibleToolsForRequest(server, server.tools_json ?? [], findEndpointForTool);
}

function bundleToolListItem(server: McpServer, tool: McpTool) {
  return redactSensitive({
    name: bundleToolName(server, tool),
    description: `${server.name}: ${tool.description}`,
    inputSchema: tool.input_schema ?? { type: "object", properties: {} },
    ...(tool.annotations ? { annotations: tool.annotations } : {}),
    ...(tool.x_astrail ? { _meta: { astrail: { ...tool.x_astrail, source_server_id: server.id } } } : {}),
  });
}

function getBearerToken(request: Request) {
  const auth = request.headers.get("authorization");
  if (!auth?.startsWith("Bearer ")) return null;
  return auth.slice("Bearer ".length);
}

async function validateBundleApiKey(bundle: Bundle, rawKey: string | null) {
  if (bundle.user_id === "local-preview") return true;
  if (bundle.is_public && !rawKey) return true;
  if (!rawKey || !hasServiceRoleKey()) return false;

  const { data, error } = await createAdminClient()
    .from("api_keys")
    .select("id,user_id,name,key_hash,key_preview,last_used,created_at")
    .eq("user_id", bundle.user_id);

  if (error) return false;
  const matchingKey = ((data ?? []) as ApiKeyRow[]).find((key) => verifyApiKey(rawKey, key.key_hash));
  if (!matchingKey) return false;

  await createAdminClient()
    .from("api_keys")
    .update({ last_used: new Date().toISOString() })
    .eq("id", matchingKey.id);

  return true;
}

async function incrementServerCallCount(server: McpServer) {
  if (server.user_id === "local-preview") return;
  await createAdminClient()
    .from("mcp_servers")
    .update({ call_count: (server.call_count ?? 0) + 1 })
    .eq("id", server.id);
}

async function logBundleToolExecution(
  bundle: Bundle,
  server: McpServer,
  bundledToolName: string,
  tool: McpTool,
  execution: Awaited<ReturnType<typeof executeToolFromEndpointMap>>
) {
  if (bundle.user_id === "local-preview") return;
  const payload = {
    event: "astrail.bundle_tool_call",
    bundle_id: bundle.id,
    server_id: server.id,
    tool_name: tool.name,
    bundled_tool_name: bundledToolName,
    status: execution.status,
    execution_mode: execution.executionMode,
    latency_ms: execution.latencyMs,
    method: execution.method,
    path: execution.path,
    upstream_status: execution.upstreamStatus,
    trace_id: execution.traceId,
    attempt_count: execution.attemptCount,
    error_code: execution.errorCode,
    error: execution.error,
  };

  try {
    const { error } = await createAdminClient()
      .from("tool_call_logs")
      .insert({
        server_id: server.id,
        user_id: server.user_id,
        tool_name: tool.name,
        status: execution.status,
        latency_ms: execution.latencyMs,
        method: execution.method,
        path: execution.path,
        execution_mode: execution.executionMode,
        upstream_status: execution.upstreamStatus,
        trace_id: execution.traceId,
        attempt_count: execution.attemptCount,
        error_code: execution.errorCode,
        error: execution.error,
      });
    if (error) {
      console.info(JSON.stringify({ ...payload, storage: "structured_log", storage_error: error.message }));
      return;
    }
    console.info(JSON.stringify({ ...payload, storage: "tool_call_logs" }));
  } catch {
    console.info(JSON.stringify({ ...payload, storage: "structured_log" }));
  }
}

function presetTemplateExecution(server: McpServer, tool: McpTool): ToolExecutionResult {
  const traceId = `agt_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
  return {
    mcpResult: {
      content: [{
        type: "text",
        text: JSON.stringify({
          status: "auth_required",
          error_code: "provider_credentials_required",
          tool: tool.name,
          server: server.name,
          note: "This curated template is installed and the tool is valid. Live provider execution requires attaching provider credentials before Astrail can call the upstream API.",
          runtime: {
            execution_mode: "auth_required",
            trace_id: traceId,
          },
        }, null, 2),
      }],
    },
    status: "auth_required",
    latencyMs: 0,
    method: null,
    path: null,
    executionMode: "auth_required",
    upstreamStatus: null,
    traceId,
    attemptCount: 0,
    errorCode: "provider_credentials_required",
    error: "Provider credentials are required for curated preset execution.",
  };
}

function permissionDeniedExecutionResult(tool: McpTool): ToolExecutionResult {
  const traceId = `agt_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
  return {
    mcpResult: {
      isError: true,
      content: [{
        type: "text",
        text: JSON.stringify({
          status: "permission_denied",
          error_code: "permission_denied",
          tool: tool.name,
          note: "This bundled tool is not exposed by the public MCP policy.",
          runtime: {
            execution_mode: "permission_denied",
            trace_id: traceId,
          },
        }, null, 2),
      }],
    },
    status: "permission_denied" as ToolExecutionResult["status"],
    latencyMs: 0,
    method: tool.method ?? null,
    path: tool.path ?? null,
    executionMode: "permission_denied" as ToolExecutionResult["executionMode"],
    upstreamStatus: null,
    traceId,
    attemptCount: 0,
    errorCode: "permission_denied",
    error: "This bundled tool is not exposed by the public MCP policy.",
  };
}

async function loadBundle(bundleId: string): Promise<LoadedBundle> {
  if (!hasServerSupabaseEnv() && bundleId === "local-work-stack") {
    return {
      bundle: {
        id: "local-work-stack",
        user_id: "local-preview",
        name: "Local work stack",
        is_public: false,
      },
      servers: [
        {
          id: "local-website-mcp",
          user_id: "local-preview",
          name: "Hacker News browser server",
          description: "Local Website-to-MCP preview generated from a public page.",
          source_url: "https://news.ycombinator.com",
          source_type: "website",
          generated_code: null,
          tools_json: [{
            name: "browser_open_page",
            description: "Open the page and summarize visible public content.",
            input_schema: { type: "object", properties: {} },
            method: "BROWSER",
            path: "body",
          }],
          endpoint_map: [{
            method: "BROWSER",
            path: "body",
            runtime_kind: "browser",
            browser_action: "open_page",
            selector: "body",
            target_url: "https://news.ycombinator.com/",
            tool_name: "browser_open_page",
            operation_id: "browser_open_page",
            summary: "Open page",
            description: "Open the inspected website and return a public page summary.",
            parameters: [],
            requires_auth: false,
          }],
          is_public: false,
          hosted_endpoint: "/api/mcp/local-website-mcp",
          call_count: 128,
          created_at: new Date().toISOString(),
        },
      ],
    };
  }

  if (!hasServiceRoleKey()) {
    return { error: "Bundle runtime storage is not enabled." };
  }

  const admin = createAdminClient();
  const { data: bundle, error: bundleError } = await admin
    .from("mcp_bundles")
    .select("id,user_id,name,is_public")
    .eq("id", bundleId)
    .single();

  if (bundleError || !bundle) return { error: "MCP bundle not found." };

  const { data: links, error: linksError } = await admin
    .from("mcp_bundle_servers")
    .select("server_id")
    .eq("bundle_id", bundleId);

  if (linksError) return { error: linksError.message };

  const serverIds = (links ?? []).map((link) => link.server_id).filter((id): id is string => typeof id === "string");
  if (serverIds.length === 0) return { bundle: bundle as Bundle, servers: [] as McpServer[] };

  const { data: servers, error: serversError } = await admin
    .from("mcp_servers")
    .select("*")
    .in("id", serverIds);

  if (serversError) return { error: serversError.message };
  return { bundle: bundle as Bundle, servers: (servers ?? []) as McpServer[] };
}

export async function POST(request: Request, { params }: { params: { bundleId: string } }) {
  let body: JsonRpcRequest;
  try {
    body = (await request.json()) as JsonRpcRequest;
  } catch {
    return jsonRpcError(null, -32700, "Invalid JSON-RPC payload.", 400);
  }

  const loaded = await loadBundle(params.bundleId);
  if ("error" in loaded) return jsonRpcError(body.id, -32004, loaded.error, 404);

  const { bundle, servers } = loaded;
  const authorized = await validateBundleApiKey(bundle, getBearerToken(request));
  if (!authorized) {
    return jsonRpcError(body.id, -32001, "Valid Astrail API key required.", 401);
  }

  if (body.method === "initialize") {
    return jsonRpc(body.id, {
      protocolVersion: "2024-11-05",
      serverInfo: { name: bundle.name, version: "1.0.0" },
      capabilities: { tools: {} },
    });
  }

  if (body.method === "tools/list") {
    return jsonRpc(body.id, {
      tools: servers.flatMap((server) =>
        visibleToolsForBundle(server).map((tool) => bundleToolListItem(server, tool))
      ),
    });
  }

  if (body.method === "tools/call") {
    const name = body.params?.name;
    if (!name) return jsonRpcError(body.id, -32602, "Tool name is required.", 400);
    for (const server of servers) {
      const allTool = (server.tools_json ?? []).find((item) => bundleToolName(server, item) === name);
      if (allTool && !visibleToolsForBundle(server).some((item) => item.name === allTool.name)) {
        const execution = permissionDeniedExecutionResult(allTool);
        await logBundleToolExecution(bundle, server, name, allTool, execution);
        return jsonRpc(body.id, execution.mcpResult);
      }
      const tool = allTool;
      if (!tool) continue;
      const rateLimit = checkRuntimeRateLimit(`${bundle.id}:${name}`);
      if (!rateLimit.allowed) {
        return jsonRpc(body.id, {
          content: [{
            type: "text",
            text: JSON.stringify({
              status: "error",
              error_code: "rate_limited",
              tool: name,
              reset_at: new Date(rateLimit.resetAt).toISOString(),
            }, null, 2),
          }],
        }, 429);
      }
      const execution = server.source_type === "preset" && (!Array.isArray(server.endpoint_map) || server.endpoint_map.length === 0)
        ? presetTemplateExecution(server, tool)
        : await executeToolFromEndpointMap(server, tool, body.params?.arguments ?? {});
      await incrementServerCallCount(server);
      await logBundleToolExecution(bundle, server, name, tool, execution);
      return jsonRpc(body.id, execution.mcpResult);
    }
    return jsonRpcError(body.id, -32602, "Unknown bundled tool.", 400);
  }

  return jsonRpcError(body.id, -32601, "Method not found.", 404);
}
