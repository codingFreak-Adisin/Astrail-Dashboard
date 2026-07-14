"use client";

import { useRouter } from "next/navigation";
import { FormEvent, useEffect, useState } from "react";
import { AlertCircle, ArrowRight, FileJson, Globe2, Loader2, ShieldCheck, Upload } from "lucide-react";
import { TurnstileChallenge } from "@/components/TurnstileChallenge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { readJsonResponse } from "@/lib/client-json";
import { cn } from "@/lib/utils";
import type { GenerationDiagnostics, RuntimePermissionPolicy, SpecPreview } from "@/lib/types";

const openApiLoadingSteps = ["Discovering API contract", "Validating endpoints", "Generating MCP tools"];
const websiteLoadingSteps = ["Inspecting public website", "Generating browser MCP tools", "Saving hosted MCP endpoint"];

const jsonPlaceholderSpec = JSON.stringify(
  {
    openapi: "3.0.0",
    info: {
      title: "JSONPlaceholder API",
      version: "1.0.0",
      description: "REST API for posts, comments, users, and todos.",
    },
    servers: [{ url: "https://jsonplaceholder.typicode.com" }],
    paths: {
      "/posts": {
        get: { summary: "List posts", operationId: "listPosts", responses: { "200": { description: "Posts" } } },
        post: { summary: "Create post", operationId: "createPost", responses: { "201": { description: "Created post" } } },
      },
      "/posts/{id}": {
        get: {
          summary: "Get post",
          operationId: "getPost",
          parameters: [{ name: "id", in: "path", required: true, schema: { type: "integer" } }],
          responses: { "200": { description: "Post" } },
        },
        delete: {
          summary: "Delete post",
          operationId: "deletePost",
          parameters: [{ name: "id", in: "path", required: true, schema: { type: "integer" } }],
          responses: { "200": { description: "Deleted" } },
        },
      },
      "/users": {
        get: { summary: "List users", operationId: "listUsers", responses: { "200": { description: "Users" } } },
      },
      "/todos": {
        get: { summary: "List todos", operationId: "listTodos", responses: { "200": { description: "Todos" } } },
      },
    },
  },
  null,
  2
);

const graphqlIntrospectionSpec = JSON.stringify(
  {
    endpoint: "https://graphql.example.com/graphql",
    title: "Example GraphQL API",
    data: {
      __schema: {
        queryType: { name: "Query" },
        types: [
          {
            kind: "OBJECT",
            name: "Query",
            fields: [
              {
                name: "user",
                description: "Fetch a user by ID.",
                args: [{ name: "id", type: { kind: "NON_NULL", ofType: { kind: "SCALAR", name: "ID" } } }],
                type: { kind: "OBJECT", name: "User" },
              },
            ],
          },
          {
            kind: "OBJECT",
            name: "User",
            fields: [
              { name: "id", args: [], type: { kind: "SCALAR", name: "ID" } },
              { name: "name", args: [], type: { kind: "SCALAR", name: "String" } },
            ],
          },
          { kind: "SCALAR", name: "ID" },
          { kind: "SCALAR", name: "String" },
        ],
      },
    },
  },
  null,
  2
);

const presets = [
  {
    label: "Petstore",
    sourceType: "url" as const,
    value: "https://petstore.swagger.io/v2/swagger.json",
  },
  {
    label: "Petstore Swagger UI",
    sourceType: "url" as const,
    value: "https://petstore.swagger.io/",
  },
  {
    label: "Google Calendar Discovery",
    sourceType: "url" as const,
    value: "https://www.googleapis.com/discovery/v1/apis/calendar/v3/rest",
  },
  {
    label: "JSONPlaceholder",
    sourceType: "json_paste" as const,
    value: jsonPlaceholderSpec,
  },
  {
    label: "GraphQL introspection",
    sourceType: "json_paste" as const,
    value: graphqlIntrospectionSpec,
  },
];

type SafetyPresetId = "guarded" | "read_only" | "open";

const safetyPresets: Array<{
  id: SafetyPresetId;
  label: string;
  detail: string;
  policy?: RuntimePermissionPolicy;
}> = [
  {
    id: "guarded",
    label: "Guarded",
    detail: "Blocks destructive calls",
    policy: {
      allow_http_gets: true,
      blocked_methods: [
        { match: "http_method", pattern: "DELETE" },
        { match: "operation_id", pattern: "delete|remove|destroy|purge|erase|void|refund", regex: true },
        { match: "tool_name", pattern: "delete|remove|destroy|purge|erase|void|refund", regex: true },
      ],
    },
  },
  {
    id: "read_only",
    label: "Read-only",
    detail: "Only safe reads",
    policy: {
      allow_http_gets: true,
      read_only: true,
    },
  },
  {
    id: "open",
    label: "Open",
    detail: "No tool blocks",
  },
];

function diagnosticsToLines(value: unknown) {
  if (Array.isArray(value)) return value.filter((item): item is string => typeof item === "string");
  if (!value || typeof value !== "object") return [];

  const diagnostics = value as Partial<GenerationDiagnostics>;
  return [
    ...(diagnostics.errors ?? []).map((item) => `Error: ${item}`),
    ...(diagnostics.warnings ?? []).map((item) => `Warning: ${item}`),
    ...(diagnostics.raw ?? []),
  ];
}

function isNoOpenApiError(message: string) {
  return message.includes("No OpenAPI/Swagger") || message.includes("No OpenAPI spec found");
}

export default function GeneratePage() {
  const router = useRouter();
  const [mode, setMode] = useState<"url" | "json_paste">("url");
  const [sourceUrl, setSourceUrl] = useState("");
  const [rawJson, setRawJson] = useState("");
  const [loading, setLoading] = useState(false);
  const [activeLoadingSteps, setActiveLoadingSteps] = useState(openApiLoadingSteps);
  const [stepIndex, setStepIndex] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [diagnostics, setDiagnostics] = useState<string[]>([]);
  const [websiteFallbackUrl, setWebsiteFallbackUrl] = useState<string | null>(null);
  const [preview, setPreview] = useState<SpecPreview | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [selectedGroup, setSelectedGroup] = useState("All");
  const [generationMode, setGenerationMode] = useState<"auto" | "static" | "dynamic" | "code">("auto");
  const [clientPreset, setClientPreset] = useState<"default" | "claude" | "claude-code" | "cursor" | "openai">("default");
  const [safetyPreset, setSafetyPreset] = useState<SafetyPresetId>("guarded");
  const [fileName, setFileName] = useState<string | null>(null);
  const [turnstileToken, setTurnstileToken] = useState<string | null>(null);
  const [turnstileResetSignal, setTurnstileResetSignal] = useState(0);
  const challengeEnabled = Boolean(process.env.NEXT_PUBLIC_CLOUDFLARE_TURNSTILE_SITE_KEY);
  const challengeReady = !challengeEnabled || Boolean(turnstileToken);

  function resetTurnstile() {
    setTurnstileToken(null);
    setTurnstileResetSignal((current) => current + 1);
  }

  function clearPreviousRun() {
    setError(null);
    setDiagnostics([]);
    setPreview(null);
    setWebsiteFallbackUrl(null);
    setSelectedGroup("All");
  }

  async function loadSpecFile(file: File | null) {
    if (!file) return;
    clearPreviousRun();
    setMode("json_paste");
    setFileName(file.name);
    try {
      setRawJson(await file.text());
    } catch {
      setError("Could not read that API contract file.");
      setFileName(null);
    }
  }

  useEffect(() => {
    if (!loading) return;
    const interval = setInterval(() => {
      setStepIndex((current) => Math.min(current + 1, activeLoadingSteps.length - 1));
    }, 1800);
    return () => clearInterval(interval);
  }, [activeLoadingSteps.length, loading]);

  function requestPayload() {
    return {
      sourceType: mode,
      sourceUrl: mode === "url" ? sourceUrl : undefined,
      rawJson: mode === "json_paste" ? rawJson : undefined,
    };
  }

  function runtimePolicyForPreset() {
    return safetyPresets.find((preset) => preset.id === safetyPreset)?.policy;
  }

  async function inspectSpec(): Promise<SpecPreview | "website_fallback" | null> {
    setError(null);
    setDiagnostics([]);
    setWebsiteFallbackUrl(null);
    setPreviewLoading(true);

    try {
      const response = await fetch("/api/spec-preview", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...requestPayload(), turnstileToken }),
      });
      const result = await readJsonResponse<{ preview?: SpecPreview; error?: string; diagnostics?: string[] }>(response);
      if (!response.ok || !result.preview) {
        setDiagnostics(result.diagnostics ?? []);
        throw new Error(result.error ?? "Could not inspect spec.");
      }

      setPreview(result.preview);
      setDiagnostics(result.preview.diagnostics);
      setSelectedGroup(result.preview.groups[0]?.name ?? "All");
      setGenerationMode(result.preview.recommended_mode ?? "auto");
      return result.preview;
    } catch (previewError) {
      const message = previewError instanceof Error ? previewError.message : "Could not inspect spec.";
      setError(message);
      if (mode === "url" && sourceUrl && isNoOpenApiError(message)) {
        setWebsiteFallbackUrl(sourceUrl);
        return "website_fallback";
      }
      return null;
    } finally {
      setPreviewLoading(false);
      resetTurnstile();
    }
  }

  async function generateWebsiteMcp(targetUrl = sourceUrl) {
    setError(null);
    setDiagnostics([]);
    setLoading(true);
    setActiveLoadingSteps(websiteLoadingSteps);
    setStepIndex(0);

    try {
      const response = await fetch("/api/website-to-mcp", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: targetUrl, turnstileToken }),
      });
      const result = await readJsonResponse<{ server?: { id: string }; error?: string }>(response);
      if (!response.ok || !result.server?.id) {
        throw new Error(result.error ?? "Website-to-MCP generation failed.");
      }

      router.push(`/dashboard/servers/${result.server.id}`);
      router.refresh();
    } catch (websiteError) {
      setError(websiteError instanceof Error ? websiteError.message : "Website-to-MCP generation failed.");
      setWebsiteFallbackUrl(targetUrl);
      setLoading(false);
    } finally {
      resetTurnstile();
    }
  }

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setDiagnostics([]);

    if (!preview) {
      const inspected = await inspectSpec();
      if (inspected === "website_fallback") {
        if (challengeEnabled) return;
        await generateWebsiteMcp();
        return;
      }
      if (!inspected) {
        return;
      }
      if (challengeEnabled) return;
    }

    setLoading(true);
    setActiveLoadingSteps(openApiLoadingSteps);
    setStepIndex(0);
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 180000);

    try {
      const response = await fetch("/api/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: controller.signal,
        body: JSON.stringify({
          ...requestPayload(),
          selectedGroup,
          endpointLimit: preview?.endpoint_limit ?? 30,
          generationMode,
          clientPreset,
          runtimePolicy: runtimePolicyForPreset(),
          turnstileToken,
        }),
      });
      clearTimeout(timeoutId);

      const result = await readJsonResponse<{ server?: { id: string }; error?: string; diagnostics?: unknown }>(response);
      if (!response.ok || !result.server) {
        setDiagnostics(diagnosticsToLines(result.diagnostics));
        throw new Error(result.error ?? "Generation failed.");
      }

      router.push(`/dashboard/servers/${result.server.id}`);
      router.refresh();
    } catch (generateError) {
      clearTimeout(timeoutId);
      if (generateError instanceof Error && generateError.name === "AbortError") {
        setError("Generation timed out. Try a smaller spec, paste JSON directly, or retry in a moment.");
      } else {
        setError(generateError instanceof Error ? generateError.message : "Generation failed.");
      }
      setLoading(false);
    } finally {
      resetTurnstile();
    }
  }

  return (
    <div className="mx-auto max-w-6xl space-y-5">
      <header className="console-hero px-5 py-8 sm:px-9">
        <div className="relative z-10 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0">
            <h1 className="text-3xl font-semibold tracking-tight text-neutral-950">Generate an MCP server</h1>
            <p className="mt-1.5 text-sm text-neutral-600">Turn an API contract or docs URL into a hosted MCP endpoint.</p>
          </div>
        </div>
      </header>

      <form onSubmit={onSubmit} className="min-w-0 space-y-5">
        <section className="section-card">
          <div className="section-card-header">
            <div>
              <h2 className="text-lg font-semibold text-neutral-950">Source</h2>
              <p className="mt-0.5 text-xs text-neutral-400">Pick where the API contract comes from</p>
            </div>
            <span className="pill pill-brand hidden sm:inline-flex">Auto-routed</span>
          </div>
          <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_260px]">
            <div>
              <Label>Source type</Label>
              <div className="mt-3 grid gap-3 sm:grid-cols-2">
                {[
                  { id: "url", label: "URL", icon: Globe2, detail: "Docs, OpenAPI, Swagger, Google Discovery" },
                  { id: "json_paste", label: "JSON/YAML", icon: FileJson, detail: "OpenAPI, Swagger, Discovery, GraphQL introspection" },
                ].map((item) => {
                  const Icon = item.icon;
                  return (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => {
                        clearPreviousRun();
                        setMode(item.id as typeof mode);
                      }}
                      className={cn(
                        "flex min-h-[92px] items-start gap-3 rounded-xl border px-4 py-4 text-left transition-colors",
                        mode === item.id
                          ? "border-amber-300 bg-amber-50/70 text-neutral-950 shadow-sm"
                          : "border-neutral-200 bg-neutral-50/60 text-neutral-500 hover:border-neutral-300 hover:bg-white hover:text-neutral-950"
                      )}
                    >
                      <span className={cn("grid h-10 w-10 shrink-0 place-items-center rounded-xl border", mode === item.id ? "border-amber-200 bg-white text-amber-700" : "border-neutral-200 bg-white text-neutral-500")}>
                        <Icon className="h-4 w-4" />
                      </span>
                      <span className="min-w-0">
                        <span className="block font-semibold">{item.label}</span>
                        <span className="mt-1 block text-xs leading-5 text-neutral-400">{item.detail}</span>
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>

            <div>
              <Label>Quick starts</Label>
              <div className="mt-3 grid gap-2">
                {presets.map((preset) => (
                  <Button
                    key={preset.label}
                    type="button"
                    variant="outline"
                    size="sm"
                    className="h-11 justify-between bg-white"
                    onClick={() => {
                      clearPreviousRun();
                      setMode(preset.sourceType);
                      if (preset.sourceType === "url") {
                        setSourceUrl(preset.value);
                      } else {
                        setRawJson(preset.value);
                      }
                    }}
                  >
                    <span>{preset.label}</span>
                    <ArrowRight className="h-3.5 w-3.5 text-neutral-400" />
                  </Button>
                ))}
              </div>
            </div>
          </div>
        </section>

        <section className="section-card">
          <div className="section-card-header">
            <div>
              <h2 className="text-lg font-semibold text-neutral-950">API source</h2>
              <p className="mt-0.5 text-xs text-neutral-400">Paste a URL or the contract itself</p>
            </div>
          </div>
          {mode === "url" ? (
            <div className="space-y-2">
              <Label htmlFor="sourceUrl">API docs, OpenAPI, Swagger, or Google Discovery URL</Label>
              <Input
                id="sourceUrl"
                type="url"
                placeholder="https://www.googleapis.com/discovery/v1/apis/calendar/v3/rest"
                value={sourceUrl}
                onChange={(event) => {
                  clearPreviousRun();
                  setSourceUrl(event.target.value);
                }}
                required
                className="h-14 rounded-xl border-neutral-200 bg-neutral-50 px-4 text-base"
              />
            </div>
          ) : (
            <div className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="specFile">Upload API contract</Label>
                <label
                  htmlFor="specFile"
                  className="flex cursor-pointer items-center justify-between gap-3 rounded-xl border border-neutral-200 bg-neutral-50 px-4 py-4 text-sm hover:bg-neutral-100"
                >
                  <span className="flex min-w-0 items-center gap-2">
                    <Upload className="h-4 w-4 text-neutral-400" />
                    <span className="truncate">{fileName ?? "Choose JSON or YAML file"}</span>
                  </span>
                  <span className="shrink-0 text-neutral-500">Browse</span>
                </label>
                <input
                  id="specFile"
                  type="file"
                  accept=".json,.yaml,.yml,application/json,application/yaml,text/yaml,text/x-yaml"
                  className="sr-only"
                  onChange={(event) => void loadSpecFile(event.target.files?.[0] ?? null)}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="rawJson">OpenAPI, Swagger, Google Discovery, or GraphQL introspection JSON/YAML</Label>
                <Textarea
                  id="rawJson"
                  className="min-h-80 rounded-xl bg-neutral-50 font-mono"
                  placeholder={'{ "openapi": "3.0.0", "info": { "title": "Example API" }, "paths": {} }'}
                  value={rawJson}
                  onChange={(event) => {
                    clearPreviousRun();
                    setRawJson(event.target.value);
                  }}
                  required
                />
              </div>
            </div>
          )}
        </section>

        <section className="section-card">
          <div className="section-card-header">
            <div>
              <h2 className="text-lg font-semibold text-neutral-950">Endpoint selection</h2>
              <p className="mt-0.5 text-xs text-neutral-400">Inspect the spec to pick groups and tool loading</p>
            </div>
            <Button type="button" variant="outline" className="h-10 bg-white" onClick={inspectSpec} disabled={previewLoading || loading || !challengeReady}>
              {previewLoading ? "Inspecting" : "Inspect endpoints"}
            </Button>
          </div>

          {preview && (
            <div className="space-y-5">
              {preview.warning && (
                <p className="rounded-xl bg-amber-50 p-3 text-sm text-amber-800">
                  {preview.warning}
                </p>
              )}
              <div className="grid gap-3 text-sm sm:grid-cols-3">
                <PreviewStat label="Spec size" value={`${preview.spec_size_bytes.toLocaleString()} bytes`} />
                <PreviewStat label="Endpoints found" value={String(preview.endpoint_count)} />
                <PreviewStat label="Endpoint limit" value={String(preview.endpoint_limit)} />
              </div>
              <div className="grid gap-3 lg:grid-cols-[1.2fr_0.9fr_0.9fr]">
                <div className="space-y-2">
                  <Label htmlFor="endpointGroup">Endpoint group</Label>
                  <select
                    id="endpointGroup"
                    value={selectedGroup}
                    onChange={(event) => setSelectedGroup(event.target.value)}
                    className="h-10 w-full rounded-xl border border-neutral-200 bg-white px-3 text-sm outline-none focus-visible:border-neutral-400"
                  >
                    {preview.groups.map((group) => (
                      <option key={group.name} value={group.name}>
                        {group.name} ({Math.min(group.count, preview.endpoint_limit)} of {group.count})
                      </option>
                    ))}
                  </select>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="generationMode">Tool loading</Label>
                  <select
                    id="generationMode"
                    value={generationMode}
                    onChange={(event) => setGenerationMode(event.target.value as typeof generationMode)}
                    className="h-10 w-full rounded-xl border border-neutral-200 bg-white px-3 text-sm outline-none focus-visible:border-neutral-400"
                  >
                    <option value="auto">Auto</option>
                    <option value="code">Code Mode</option>
                    <option value="static">Static tools</option>
                    <option value="dynamic">Dynamic catalog</option>
                  </select>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="clientPreset">MCP client</Label>
                  <select
                    id="clientPreset"
                    value={clientPreset}
                    onChange={(event) => setClientPreset(event.target.value as typeof clientPreset)}
                    className="h-10 w-full rounded-xl border border-neutral-200 bg-white px-3 text-sm outline-none focus-visible:border-neutral-400"
                  >
                    <option value="default">Default</option>
                    <option value="claude">Claude Desktop</option>
                    <option value="claude-code">Claude Code</option>
                    <option value="cursor">Cursor</option>
                    <option value="openai">OpenAI Agents</option>
                  </select>
                </div>
              </div>
              <div className="grid gap-3 text-sm sm:grid-cols-2">
                <PreviewStat label="Resources" value={preview.resources?.slice(0, 4).map((item) => `${item.name} (${item.count})`).join(", ") || "None"} />
                <PreviewStat label="Operations" value={preview.operations?.map((item) => `${item.name} (${item.count})`).join(", ") || "None"} />
              </div>
            </div>
          )}
        </section>

        <section className="section-card">
          <div className="section-card-header">
            <div className="flex items-center gap-3">
              <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-amber-50 text-amber-700">
                <ShieldCheck className="h-4 w-4" />
              </span>
              <div>
                <h2 className="text-lg font-semibold text-neutral-950">Safety preset</h2>
                <p className="mt-0.5 text-xs text-neutral-400">Hosted endpoint policy</p>
              </div>
            </div>
          </div>
          <div className="grid gap-2 sm:grid-cols-3">
            {safetyPresets.map((preset) => (
              <button
                key={preset.id}
                type="button"
                onClick={() => setSafetyPreset(preset.id)}
                className={cn(
                  "min-h-[72px] rounded-xl border px-4 py-3 text-left transition-colors",
                  safetyPreset === preset.id
                    ? "border-amber-300 bg-amber-50/70 text-neutral-950 shadow-sm"
                    : "border-neutral-200 bg-white text-neutral-500 hover:border-neutral-300 hover:text-neutral-950"
                )}
              >
                <span className="block text-sm font-semibold">{preset.label}</span>
                <span className="mt-1 block text-xs leading-5">{preset.detail}</span>
              </button>
            ))}
          </div>
        </section>

        {error && (
          <div className={cn("console-card p-4", websiteFallbackUrl ? "border-amber-300/60" : "border-red-200")}>
            <div className={cn("flex items-start gap-2 text-sm", websiteFallbackUrl ? "text-neutral-950" : "text-red-600")}>
              <AlertCircle className="mt-0.5 h-4 w-4" />
              <p>{websiteFallbackUrl ? "This looks like a public website, not an API contract." : error}</p>
            </div>
            {websiteFallbackUrl && (
              <div className="mt-3 space-y-3">
                <div className="flex flex-col gap-2 sm:flex-row">
                  <Button type="button" onClick={() => void generateWebsiteMcp(websiteFallbackUrl)} disabled={loading || !challengeReady}>
                    {loading ? "Generating Website to MCP" : "Generate Website to MCP instead"}
                  </Button>
                  <Button type="button" variant="outline" onClick={() => router.push("/dashboard/website-to-mcp")}>
                    Open Website to MCP
                  </Button>
                </div>
              </div>
            )}
            {diagnostics.length > 0 && (
              <details className="mt-3 border-t border-neutral-100 pt-3">
                <summary className="cursor-pointer text-sm font-medium">Discovery diagnostics</summary>
                <ul className="mt-2 space-y-1 text-sm text-neutral-500">
                  {diagnostics.map((item) => (
                    <li key={item}>{item}</li>
                  ))}
                </ul>
              </details>
            )}
          </div>
        )}

        {loading && (
          <div className="flex items-center gap-2 rounded-xl bg-amber-50 px-4 py-3 text-sm text-amber-800">
            <Loader2 className="h-4 w-4 animate-spin text-amber-600" />
            {activeLoadingSteps[stepIndex]}
          </div>
        )}

        <section className="section-card">
          <TurnstileChallenge
            action="mcp-generate"
            resetSignal={turnstileResetSignal}
            onToken={setTurnstileToken}
            className="mb-4"
          />
          <Button type="submit" disabled={loading || !challengeReady} className="h-12 w-full min-w-[190px] px-5 text-sm font-semibold shadow-sm sm:w-auto">
            {loading ? "Generating..." : generationMode === "code" ? "Generate code server" : generationMode === "dynamic" ? "Generate dynamic server" : "Generate server"}
          </Button>
        </section>
      </form>
    </div>
  );
}

function PreviewStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0 rounded-xl border border-neutral-200/70 bg-neutral-50/60 p-4">
      <p className="text-xs font-medium text-neutral-400">{label}</p>
      <p className="mt-1 truncate text-sm font-semibold text-neutral-950">{value}</p>
    </div>
  );
}
