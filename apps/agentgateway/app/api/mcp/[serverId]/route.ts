import { NextResponse } from "next/server";
import { verifyApiKey } from "@/lib/api-keys";
import { checkBillingAllowance } from "@/lib/billing/usage";
import { decryptCredential, hasCredentialEncryptionKey } from "@/lib/credentials";
import { findLocalGeneratedServer, localDemoServers } from "@/lib/local-demo";
import { loadLocalPreviewServer } from "@/lib/local-preview-servers";
import { findPresetServer } from "@/lib/preset-servers";
import {
  executeToolFromEndpointMap,
  findEndpointForTool,
  hasSecurityRequirement,
  type RuntimeCredential,
  type ToolExecutionResult,
} from "@/lib/runtime/execute-tool";
import { redactSensitive, visibleEndpointsForRequest, visibleToolsForRequest } from "@/lib/runtime/permissions";
import { checkRuntimeRateLimit } from "@/lib/runtime/rate-limit";
import { validateToolInput, type ToolInputValidationIssue } from "@/lib/runtime/tool-input-validation";
import { hasServerSupabaseEnv } from "@/lib/supabase/env";
import { createAdminClient, createPublicClient, hasServiceRoleKey } from "@/lib/supabase/server";
import type { ApiKey, McpServer, McpTool, OpenApiEndpoint } from "@/lib/types";

export const runtime = "nodejs";

type JsonRpcRequest = {
  jsonrpc?: string;
  id?: string | number | null;
  method?: string;
  params?: {
    name?: string;
    arguments?: Record<string, unknown>;
  };
};

type JsonRpcResponsePayload = {
  jsonrpc: "2.0";
  id: JsonRpcRequest["id"];
  result?: unknown;
  error?: {
    code: number;
    message: string;
  };
};

type JsonRpcHandlerResult = {
  payload: JsonRpcResponsePayload | null;
  status: number;
};

type ApiKeyRow = ApiKey & {
  key_hash: string;
};

type CredentialRow = {
  auth_scheme: RuntimeCredential["scheme"];
  injection_name: string | null;
  secret_ciphertext: string;
};

const MAX_JSON_RPC_BYTES = 256_000;

function configuredCorsOrigins() {
  return [
    process.env.ASTRAIL_CORS_ORIGINS,
    process.env.ALLOWED_ORIGIN,
    process.env.NEXT_PUBLIC_SITE_URL,
    process.env.NEXT_PUBLIC_APP_URL,
  ]
    .filter((value): value is string => Boolean(value))
    .flatMap((value) => value.split(","))
    .map((value) => value.trim())
    .filter(Boolean);
}

function corsHeaders(request: Request) {
  const origin = request.headers.get("origin");
  const configured = configuredCorsOrigins();
  const allowAny = configured.length === 0 || configured.includes("*");
  const allowOrigin = origin && (allowAny || configured.includes(origin))
    ? origin
    : allowAny
      ? "*"
      : configured[0] ?? "*";

  return {
    "Access-Control-Allow-Origin": allowOrigin,
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "authorization, content-type, mcp-session-id, x-astrail-client",
    "Access-Control-Max-Age": "86400",
    "Vary": "Origin",
    "Cache-Control": "no-store",
  };
}

function jsonWithCors(request: Request, payload: unknown, status = 200) {
  return NextResponse.json(payload, { status, headers: corsHeaders(request) });
}

function localWebsitePreviewServer(): McpServer {
  const tools: McpTool[] = [
    {
      name: "browser_open_page",
      description: "Open the inspected website and return a safe public page summary.",
      input_schema: {
        type: "object",
        properties: {
          instruction: {
            type: "string",
            description: "Optional instruction for the browser runtime before executing this website workflow.",
          },
        },
      },
      method: "BROWSER",
      path: "body",
    },
    {
      name: "browser_follow_link_news",
      description: "Follow the Hacker News news link and return a safe public page summary.",
      input_schema: { type: "object", properties: {} },
      method: "BROWSER",
      path: "https://news.ycombinator.com/news",
    },
    {
      name: "browser_follow_link_new",
      description: "Follow the Hacker News newest link and return a safe public page summary.",
      input_schema: { type: "object", properties: {} },
      method: "BROWSER",
      path: "https://news.ycombinator.com/newest",
    },
  ];

  const endpoints: OpenApiEndpoint[] = [
    {
      method: "BROWSER",
      path: "body",
      runtime_kind: "browser",
      browser_action: "open_page",
      selector: "body",
      target_url: "https://news.ycombinator.com/",
      tool_name: tools[0].name,
      operation_id: tools[0].name,
      summary: "open page",
      description: tools[0].description,
      parameters: [],
      requires_auth: false,
    },
    {
      method: "BROWSER",
      path: "https://news.ycombinator.com/news",
      runtime_kind: "browser",
      browser_action: "follow_link",
      selector: "a[href='news']",
      target_url: "https://news.ycombinator.com/news",
      tool_name: tools[1].name,
      operation_id: tools[1].name,
      summary: "news",
      description: tools[1].description,
      parameters: [],
      requires_auth: false,
    },
    {
      method: "BROWSER",
      path: "https://news.ycombinator.com/newest",
      runtime_kind: "browser",
      browser_action: "follow_link",
      selector: "a[href='newest']",
      target_url: "https://news.ycombinator.com/newest",
      tool_name: tools[2].name,
      operation_id: tools[2].name,
      summary: "new",
      description: tools[2].description,
      parameters: [],
      requires_auth: false,
    },
  ];

  return {
    id: "local-website-preview",
    user_id: "local-preview",
    name: "hacker-news-browser-server",
    description: "Development-only Website-to-MCP preview server for safe public browser reads.",
    source_url: "https://news.ycombinator.com/",
    source_type: "website",
    category: "Website",
    generated_code: null,
    tools_json: tools,
    endpoint_map: endpoints,
    diagnostics: ["Local preview server. Connect persistent workspace storage to save generated website MCP endpoints."],
    status: "live",
    validation_status: "passed",
    generation_status: "passed",
    is_public: true,
    hosted_endpoint: "http://localhost:3000/api/mcp/local-website-preview",
    call_count: 0,
    generation_version: "local-preview",
    protocol_version: "2024-11-05",
    created_at: new Date(0).toISOString(),
  };
}

function jsonRpcPayload(id: JsonRpcRequest["id"], result: unknown): JsonRpcResponsePayload {
  return { jsonrpc: "2.0", id: id ?? null, result };
}

function jsonRpcErrorPayload(id: JsonRpcRequest["id"], code: number, message: string): JsonRpcResponsePayload {
  return { jsonrpc: "2.0", id: id ?? null, error: { code, message } };
}

function jsonRpcError(request: Request, id: JsonRpcRequest["id"], code: number, message: string, status = 400) {
  return jsonWithCors(request, jsonRpcErrorPayload(id, code, message), status);
}

function createRuntimeTraceId() {
  return `agt_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

function isJsonRpcRequest(value: unknown): value is JsonRpcRequest {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function requestPayloadTooLarge(request: Request) {
  const length = Number(request.headers.get("content-length") ?? 0);
  return Number.isFinite(length) && length > MAX_JSON_RPC_BYTES;
}

function getBearerToken(request: Request) {
  const auth = request.headers.get("authorization");
  if (!auth?.startsWith("Bearer ")) return null;
  return auth.slice("Bearer ".length);
}

function isCodeModeServer(tools: McpTool[]) {
  const names = new Set(tools.map((tool) => tool.name));
  return names.has("search_docs") && names.has("execute");
}

function startupInstructions(server: McpServer, tools: McpTool[]) {
  if (isCodeModeServer(tools)) {
    return [
      `${server.name} is an Astrail Code Mode MCP server.`,
      "Use search_docs first to find SDK-style methods, parameters, examples, auth requirements, and response hints.",
      "Use execute with TypeScript-looking calls like await client.resource.method({ ... }) or for await (const item of client.resource.list({ ... })). Astrail statically analyzes those calls and compiles them to deterministic endpoint-map execution; arbitrary JavaScript is not evaluated.",
      "Independent read calls in one execute request can run in parallel. Invalid methods or missing required arguments return typecheck-style errors with suggestions before any upstream request.",
      "Ask for user confirmation before write or destructive operations. Private upstream APIs require credentials configured in Astrail.",
    ].join(" ");
  }

  return [
    `${server.name} is an Astrail hosted MCP server.`,
    "Use tools/list to inspect available tools and tools/call to execute mapped endpoints.",
    "Astrail returns auth_required when provider credentials are needed and includes trace IDs for runtime debugging.",
  ].join(" ");
}

async function validateOwnerApiKey(server: McpServer, rawKey: string | null) {
  if (server.is_public && !rawKey) return true;
  if (!rawKey) return false;
  if (!hasServiceRoleKey()) return false;

  const admin = createAdminClient();
  const { data, error } = await admin
    .from("api_keys")
    .select("id,user_id,name,key_hash,key_preview,last_used,created_at")
    .eq("user_id", server.user_id);

  if (error) return false;

  const matchingKey = ((data ?? []) as ApiKeyRow[]).find((key) =>
    verifyApiKey(rawKey, key.key_hash)
  );

  if (!matchingKey) return false;

  await admin
    .from("api_keys")
    .update({ last_used: new Date().toISOString() })
    .eq("id", matchingKey.id);

  return true;
}

async function incrementCallCount(server: McpServer) {
  if (server.user_id === "preset") return;
  if (!hasServiceRoleKey()) return;

  const admin = createAdminClient();
  await admin
    .from("mcp_servers")
    .update({ call_count: (server.call_count ?? 0) + 1 })
    .eq("id", server.id);
}

function billingRequiredResult(toolName: string, summary: Awaited<ReturnType<typeof checkBillingAllowance>>["summary"]): ToolExecutionResult {
  const traceId = createRuntimeTraceId();
  return {
    mcpResult: {
      isError: true,
      content: [{
        type: "text",
        text: JSON.stringify({
          status: "billing_required",
          error_code: "monthly_billing_limit_reached",
          tool: toolName,
          note: "This workspace has reached its monthly credits or tool call limit. Upgrade the billing plan or wait for the next billing period.",
          billing: {
            plan: summary.plan,
            credits_used: summary.creditsUsed,
            credit_limit: summary.creditLimit,
            credit_cost: summary.meterCosts.tool_call,
            used: summary.used,
            limit: summary.limit,
            current_period_end: summary.currentPeriodEnd,
          },
          runtime: {
            execution_mode: "billing_required",
            trace_id: traceId,
          },
        }, null, 2),
      }],
    },
    status: "billing_required",
    latencyMs: 0,
    method: null,
    path: null,
    executionMode: "billing_required",
    upstreamStatus: null,
    traceId,
    attemptCount: 0,
    errorCode: "monthly_billing_limit_reached",
    error: "Monthly billing limit reached.",
  };
}

function inputValidationFailedResult(
  tool: McpTool,
  issues: ToolInputValidationIssue[],
  inputSchema: unknown,
  method: string | null = tool.method ?? null,
  path: string | null = tool.path ?? null
): ToolExecutionResult {
  const traceId = createRuntimeTraceId();
  const message = issues.map((item) => `${item.path}: ${item.message}`).join(" ");
  return {
    mcpResult: {
      isError: true,
      content: [{
        type: "text",
        text: JSON.stringify({
          status: "validation_failed",
          error_code: "invalid_tool_arguments",
          tool: tool.name,
          issues,
          expected_schema: inputSchema ?? { type: "object", properties: {} },
          note: "The tool was not executed. Fix arguments to match inputSchema, then retry tools/call.",
          runtime: {
            execution_mode: "validation_failed",
            trace_id: traceId,
          },
        }, null, 2),
      }],
    },
    status: "validation_failed",
    latencyMs: 0,
    method,
    path,
    executionMode: "validation_failed",
    upstreamStatus: null,
    traceId,
    attemptCount: 0,
    errorCode: "invalid_tool_arguments",
    error: message || "Invalid tool arguments.",
  };
}

async function logToolExecution(server: McpServer, toolName: string, execution: ToolExecutionResult) {
  if (server.user_id === "local-preview") return;
  if (server.user_id === "preset") return;
  const logPayload = {
    event: "astrail.tool_call",
    server_id: server.id,
    tool_name: toolName,
    status: execution.status,
    execution_mode: execution.executionMode,
    method: execution.method,
    path: execution.path,
    latency_ms: execution.latencyMs,
    upstream_status: execution.upstreamStatus,
    trace_id: execution.traceId,
    attempt_count: execution.attemptCount,
    error_code: execution.errorCode,
    error: execution.error,
    timestamp: new Date().toISOString(),
  };

  if (!hasServiceRoleKey()) {
    console.info(JSON.stringify({ ...logPayload, storage: "structured_log" }));
    return;
  }

  try {
    const admin = createAdminClient();
    const { error } = await admin
      .from("tool_call_logs")
      .insert({
        server_id: server.id,
        user_id: server.user_id,
        tool_name: toolName,
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
      console.info(JSON.stringify({ ...logPayload, storage: "structured_log", storage_error: error.message }));
    }
  } catch {
    console.info(JSON.stringify({ ...logPayload, storage: "structured_log" }));
    // Runtime logging is best-effort. MCP protocol responses should not fail because observability storage is unavailable.
  }
}

async function loadCredentialForTool(server: McpServer, tool: McpTool): Promise<RuntimeCredential | null> {
  if (!hasServiceRoleKey() || !hasCredentialEncryptionKey()) return null;
  const endpoint = findEndpointForTool(server, tool);
  if (!endpoint || !hasSecurityRequirement(endpoint)) return null;

  try {
    const { data, error } = await createAdminClient()
      .from("api_credentials")
      .select("auth_scheme,injection_name,secret_ciphertext")
      .eq("user_id", server.user_id)
      .eq("server_id", server.id)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error || !data) return null;
    const credential = data as CredentialRow;
    return {
      scheme: credential.auth_scheme,
      injectionName: credential.injection_name,
      secret: decryptCredential(credential.secret_ciphertext),
    };
  } catch {
    return null;
  }
}

function presetTemplateExecution(server: McpServer, tool: McpTool): ToolExecutionResult {
  const traceId = createRuntimeTraceId();
  return {
    mcpResult: {
      isError: true,
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

function normalizeToolArguments(value: unknown): Record<string, unknown> {
  if (!value) return {};
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value) as unknown;
      return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {};
    } catch {
      return {};
    }
  }
  return typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function endpointId(endpoint: OpenApiEndpoint) {
  return endpoint.tool_name || endpoint.operation_id || `${endpoint.method} ${endpoint.path}`;
}

function endpointSearchText(endpoint: OpenApiEndpoint) {
  return [
    endpointId(endpoint),
    endpoint.method,
    endpoint.path,
    endpoint.summary,
    endpoint.description,
    endpoint.resource,
    ...(endpoint.tags ?? []),
  ].filter(Boolean).join(" ").toLowerCase();
}

function catalogEndpoints(server: McpServer) {
  return visibleEndpointsForRequest(server);
}

function findCatalogEndpoint(server: McpServer, id: unknown) {
  if (typeof id !== "string" || !id.trim()) return null;
  const normalized = id.trim().toLowerCase();
  return catalogEndpoints(server).find((endpoint) =>
    endpointId(endpoint).toLowerCase() === normalized
    || endpoint.tool_name?.toLowerCase() === normalized
    || endpoint.operation_id?.toLowerCase() === normalized
    || `${endpoint.method} ${endpoint.path}`.toLowerCase() === normalized
  ) ?? null;
}

function endpointCatalogItem(endpoint: OpenApiEndpoint) {
  return redactSensitive({
    endpoint_id: endpointId(endpoint),
    method: endpoint.method,
    path: endpoint.path,
    operation_id: endpoint.operation_id,
    summary: endpoint.summary,
    description: endpoint.description,
    resource: endpoint.resource,
    tags: endpoint.tags ?? [],
    operation: endpoint.operation_kind,
    requires_auth: Boolean(endpoint.requires_auth),
  });
}

function listApiEndpoints(server: McpServer, args: Record<string, unknown>) {
  const query = typeof args.query === "string" ? args.query.toLowerCase().trim() : "";
  const resource = typeof args.resource === "string" ? args.resource.toLowerCase().trim() : "";
  const tag = typeof args.tag === "string" ? args.tag.toLowerCase().trim() : "";
  const operation = typeof args.operation === "string" ? args.operation.toLowerCase().trim() : "";
  const method = typeof args.method === "string" ? args.method.toUpperCase().trim() : "";
  const limit = Math.max(1, Math.min(Number(args.limit ?? 20) || 20, 50));

  const matches = catalogEndpoints(server).filter((endpoint) => {
    if (query && !endpointSearchText(endpoint).includes(query)) return false;
    if (resource && (endpoint.resource ?? "default").toLowerCase() !== resource) return false;
    if (tag && !(endpoint.tags ?? []).some((item) => item.toLowerCase() === tag)) return false;
    if (operation && endpoint.operation_kind !== operation) return false;
    if (method && endpoint.method.toUpperCase() !== method) return false;
    return true;
  });

  return {
    status: "success",
    server: server.name,
    total_matches: matches.length,
    returned: Math.min(matches.length, limit),
    endpoints: matches.slice(0, limit).map(endpointCatalogItem),
    next_step: "Call get_api_endpoint_schema with endpoint_id before invoke_api_endpoint.",
  };
}

function getApiEndpointSchema(server: McpServer, args: Record<string, unknown>) {
  const endpoint = findCatalogEndpoint(server, args.endpoint_id);
  if (!endpoint) {
    return {
      status: "error",
      error_code: "endpoint_not_found",
      endpoint_id: args.endpoint_id ?? null,
      note: "Use list_api_endpoints to find a valid endpoint_id.",
    };
  }

  return {
    status: "success",
    endpoint: endpointCatalogItem(endpoint),
    input_schema: redactSensitive(endpoint.input_schema ?? { type: "object", properties: {} }),
    parameters: redactSensitive(endpoint.parameters ?? []),
    request_body: redactSensitive(endpoint.request_body ?? null),
    response_hints: redactSensitive(endpoint.response_hints ?? null),
    security: server.is_public ? null : redactSensitive(endpoint.security_requirements ?? endpoint.security ?? null),
    next_step: "Call invoke_api_endpoint with this endpoint_id and arguments matching input_schema.",
  };
}

function camelCase(value: string) {
  const cleaned = value
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[^a-zA-Z0-9]+/g, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean);

  if (cleaned.length === 0) return "api";
  return cleaned
    .map((part, index) => {
      const lower = part.toLowerCase();
      return index === 0 ? lower : lower.charAt(0).toUpperCase() + lower.slice(1);
    })
    .join("");
}

function sdkResource(endpoint: OpenApiEndpoint) {
  return camelCase(endpoint.resource || endpoint.tags?.[0] || endpoint.path.split("/").find((part) => part && !part.startsWith("{")) || "api");
}

function sdkMethod(endpoint: OpenApiEndpoint) {
  if (endpoint.operation_id) return camelCase(endpoint.operation_id);
  const verb = endpoint.operation_kind === "read"
    ? endpoint.path.includes("{") ? "get" : "list"
    : endpoint.operation_kind === "destructive"
      ? "delete"
      : endpoint.method.toUpperCase() === "POST"
        ? "create"
        : "update";
  const leaf = endpoint.path
    .split("/")
    .filter((part) => part && !part.startsWith("{"))
    .pop() || "resource";
  return camelCase(`${verb} ${leaf}`);
}

function exampleArgumentsFromSchema(schema: unknown) {
  if (!schema || typeof schema !== "object") return {};
  const record = schema as Record<string, unknown>;
  const properties = record.properties && typeof record.properties === "object"
    ? record.properties as Record<string, unknown>
    : {};
  const required = Array.isArray(record.required) ? record.required : [];
  const args: Record<string, unknown> = {};

  for (const [name, property] of Object.entries(properties).slice(0, 8)) {
    const prop = property && typeof property === "object" ? property as Record<string, unknown> : {};
    if (!required.includes(name) && Object.keys(args).length >= 3) continue;
    if (prop.example !== undefined) args[name] = prop.example;
    else if (Array.isArray(prop.enum) && prop.enum.length > 0) args[name] = prop.enum[0];
    else if (prop.type === "integer" || prop.type === "number") args[name] = 1;
    else if (prop.type === "boolean") args[name] = true;
    else if (prop.type === "array") args[name] = [];
    else if (prop.type === "object") args[name] = {};
    else args[name] = name.includes("id") ? "example_id" : "example";
  }

  return args;
}

function schemaProperties(schema: unknown) {
  if (!schema || typeof schema !== "object") return [];
  const record = schema as Record<string, unknown>;
  const properties = record.properties && typeof record.properties === "object"
    ? record.properties as Record<string, unknown>
    : {};
  const required = Array.isArray(record.required) ? record.required : [];
  return Object.entries(properties).slice(0, 16).map(([name, property]) => {
    const prop = property && typeof property === "object" ? property as Record<string, unknown> : {};
    return {
      name,
      type: typeof prop.type === "string" ? prop.type : prop.$ref ? "ref" : "unknown",
      required: required.includes(name),
      description: typeof prop.description === "string" ? prop.description.slice(0, 160) : undefined,
    };
  });
}

function sdkDocForEndpoint(endpoint: OpenApiEndpoint, detail: "compact" | "schema" = "compact") {
  const resource = sdkResource(endpoint);
  const method = sdkMethod(endpoint);
  const exampleArgs = exampleArgumentsFromSchema(endpoint.input_schema);
  const call = `client.${resource}.${method}(${JSON.stringify(exampleArgs, null, 2)})`;
  const isListLikeRead = endpoint.operation_kind === "read" && (method.toLowerCase().startsWith("list") || !endpoint.path.includes("{"));
  const compactDoc = {
    sdk_method: `client.${resource}.${method}`,
    endpoint_id: endpointId(endpoint),
    method: endpoint.method,
    path: endpoint.path,
    resource,
    operation: endpoint.operation_kind,
    summary: endpoint.summary,
    description: endpoint.description,
    requires_auth: Boolean(endpoint.requires_auth),
    tags: endpoint.tags ?? [],
    arguments: schemaProperties(endpoint.input_schema),
    response_hints: endpoint.response_hints ?? null,
    example: `const result = await ${call};`,
    iterable_example: isListLikeRead
      ? `const results = [];\nfor await (const item of ${call}) {\n  results.push(item);\n}\nreturn results;`
      : null,
    execution_notes: [
      "Call search_docs first, then execute SDK-shaped TypeScript.",
      "Astrail does not eval JavaScript. It statically compiles supported client.resource.method(...) calls to endpoint-map execution.",
      isListLikeRead ? "for await loops are accepted as an agent-friendly list pattern; the SDK call inside the loop is compiled deterministically." : null,
    ].filter(Boolean),
  };

  return detail === "schema"
    ? { ...compactDoc, input_schema: endpoint.input_schema ?? { type: "object", properties: {} } }
    : compactDoc;
}

function searchDocs(server: McpServer, args: Record<string, unknown>) {
  const query = typeof args.query === "string" ? args.query.toLowerCase().trim() : "";
  const resource = typeof args.resource === "string" ? camelCase(args.resource).toLowerCase() : "";
  const operation = typeof args.operation === "string" ? args.operation.toLowerCase().trim() : "";
  const detail = args.detail === "schema" ? "schema" : "compact";
  const limit = Math.max(1, Math.min(Number(args.limit ?? 8) || 8, 20));
  const matches = catalogEndpoints(server).filter((endpoint) => {
    const doc = sdkDocForEndpoint(endpoint);
    const search = [
      doc.sdk_method,
      doc.endpoint_id,
      doc.method,
      doc.path,
      doc.resource,
      doc.operation,
      doc.summary,
      doc.description,
      ...(doc.tags ?? []),
    ].filter(Boolean).join(" ").toLowerCase();
    if (query && !search.includes(query)) return false;
    if (resource && doc.resource.toLowerCase() !== resource) return false;
    if (operation && doc.operation !== operation) return false;
    return true;
  });

  return {
    status: "success",
    server: server.name,
    mode: "astrail_code_mode",
    detail,
    total_matches: matches.length,
    returned: Math.min(matches.length, limit),
    docs: matches.slice(0, limit).map((endpoint) => sdkDocForEndpoint(endpoint, detail)),
    execute_contract: {
      supported_call_shapes: [
        "await client.resource.method({ jsonCompatible: true })",
        "for await (const item of client.resource.list({ jsonCompatible: true })) { ... }",
      ],
      batching: "Independent read calls in one execute request are compiled and run in parallel.",
      note: "Astrail statically compiles SDK-style calls to endpoint-map execution. It does not eval arbitrary JavaScript.",
    },
  };
}

type AnalyzedClientCall = {
  resource: string;
  method: string;
  args: Record<string, unknown>;
  source: string;
  controlFlow: "direct_call" | "for_await_iteration";
};

function findMatchingParen(value: string, openIndex: number) {
  let depth = 0;
  let quote: string | null = null;
  let escaped = false;

  for (let index = openIndex; index < value.length; index += 1) {
    const char = value[index];
    if (quote) {
      if (escaped) {
        escaped = false;
      } else if (char === "\\") {
        escaped = true;
      } else if (char === quote) {
        quote = null;
      }
      continue;
    }

    if (char === "\"" || char === "'" || char === "`") {
      quote = char;
      continue;
    }
    if (char === "(") depth += 1;
    if (char === ")") {
      depth -= 1;
      if (depth === 0) return index;
    }
  }

  return -1;
}

function parseCodeArgumentObject(raw: string) {
  const trimmed = raw.trim();
  if (!trimmed) return {};

  try {
    const parsed = JSON.parse(trimmed) as unknown;
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) return parsed as Record<string, unknown>;
  } catch {
    // Fall through to JSON-ish object-literal parsing.
  }

  const jsonish = trimmed
    .replace(/([{,]\s*)([a-zA-Z_$][\w$]*)\s*:/g, "$1\"$2\":")
    .replace(/'/g, "\"")
    .replace(/,\s*([}\]])/g, "$1");

  try {
    const parsed = JSON.parse(jsonish) as unknown;
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) return parsed as Record<string, unknown>;
  } catch {
    // Return a typecheck-style error below.
  }

  throw new Error("Arguments must be a JSON-compatible object literal. Example: client.customers.list({ \"limit\": 10 })");
}

function analyzeCodeModeSnippet(code: unknown): AnalyzedClientCall[] | { error: string; code: string } {
  if (typeof code !== "string" || !code.trim()) {
    return { error: "execute requires a non-empty TypeScript code string.", code: "code_missing" };
  }
  if (code.length > 8000) {
    return { error: "Code snippet is too large for no-eval Code Mode. Keep it under 8KB.", code: "code_too_large" };
  }
  if (/\b(import|require|process|globalThis|Function|eval|fetch|XMLHttpRequest)\b/.test(code)) {
    return { error: "Unsupported runtime access. Code Mode only accepts SDK-style client.resource.method(...) calls.", code: "unsupported_runtime_access" };
  }

  const calls: AnalyzedClientCall[] = [];
  const callPattern = /client\.([a-zA-Z_$][\w$]*)\.([a-zA-Z_$][\w$]*)\s*\(/g;
  let match: RegExpExecArray | null;

  while ((match = callPattern.exec(code)) !== null) {
    const openIndex = callPattern.lastIndex - 1;
    const closeIndex = findMatchingParen(code, openIndex);
    if (closeIndex === -1) {
      return { error: `Could not parse SDK call client.${match[1]}.${match[2]}(...).`, code: "typecheck_parse_error" };
    }
    const rawArgs = code.slice(openIndex + 1, closeIndex);
    try {
      calls.push({
        resource: match[1],
        method: match[2],
        args: parseCodeArgumentObject(rawArgs),
        source: code.slice(match.index, closeIndex + 1),
        controlFlow: isForAwaitClientCall(code, match.index) ? "for_await_iteration" : "direct_call",
      });
    } catch (error) {
      return {
        error: error instanceof Error ? error.message : "Could not parse SDK call arguments.",
        code: "typecheck_argument_error",
      };
    }
    callPattern.lastIndex = closeIndex + 1;
  }

  if (calls.length === 0) {
    return {
      error: "No supported SDK calls found. Use search_docs, then call execute with code like `await client.customers.list({})`.",
      code: "no_sdk_calls",
    };
  }

  if (calls.length > 8) {
    return { error: "Code Mode supports up to 8 SDK calls per execution.", code: "too_many_sdk_calls" };
  }

  return calls;
}

function isForAwaitClientCall(code: string, callIndex: number) {
  const prefix = code.slice(Math.max(0, callIndex - 120), callIndex);
  return /for\s+await\s*\([^)]*\bof\s*$/.test(prefix);
}

function findEndpointForSdkCall(server: McpServer, call: AnalyzedClientCall) {
  const resource = call.resource.toLowerCase();
  const method = call.method.toLowerCase();
  return catalogEndpoints(server).find((endpoint) =>
    sdkResource(endpoint).toLowerCase() === resource && sdkMethod(endpoint).toLowerCase() === method
  ) ?? null;
}

function validateSdkCallArguments(endpoint: OpenApiEndpoint, args: Record<string, unknown>) {
  const validation = validateToolInput(endpoint.input_schema ?? { type: "object", properties: {} }, args);
  if (validation.ok) return null;
  const missing = validation.issues
    .filter((item) => item.code === "missing_required")
    .map((item) => item.path);

  return {
    error_code: missing.length > 0 ? "typecheck_missing_required_arguments" : "typecheck_invalid_arguments",
    error: validation.summary,
    issues: validation.issues,
    ...(missing.length > 0 ? { missing } : {}),
  };
}

function sdkMethodSuggestions(server: McpServer, call: AnalyzedClientCall) {
  const resource = call.resource.toLowerCase();
  const resourceMatches = catalogEndpoints(server)
    .filter((endpoint) => sdkResource(endpoint).toLowerCase() === resource)
    .map((endpoint) => `client.${sdkResource(endpoint)}.${sdkMethod(endpoint)}`);
  if (resourceMatches.length > 0) return resourceMatches.slice(0, 8);

  return catalogEndpoints(server)
    .map((endpoint) => `client.${sdkResource(endpoint)}.${sdkMethod(endpoint)}`)
    .slice(0, 8);
}

function endpointToolForCodeCall(endpoint: OpenApiEndpoint): McpTool {
  return {
    name: endpointId(endpoint),
    description: endpoint.description || endpoint.summary || `${endpoint.method} ${endpoint.path}`,
    input_schema: endpoint.input_schema ?? { type: "object", properties: {} },
    method: endpoint.method,
    path: endpoint.path,
  };
}

function parsedExecutionOutput(execution: ToolExecutionResult) {
  const text = execution.mcpResult.content[0]?.text ?? "";
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return text;
  }
}

function compactBody(value: unknown): unknown {
  if (Array.isArray(value)) {
    return {
      type: "array",
      count: value.length,
      sample: value.slice(0, 3),
    };
  }

  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>);
    return {
      type: "object",
      key_count: entries.length,
      sample: Object.fromEntries(entries.slice(0, 12)),
    };
  }

  if (typeof value === "string" && value.length > 1200) {
    return {
      type: "string",
      chars: value.length,
      preview: value.slice(0, 1200),
      truncated: true,
    };
  }

  return value;
}

function codeModeOutput(execution: ToolExecutionResult, resultMode: "compact" | "full") {
  const parsed = parsedExecutionOutput(execution);
  if (resultMode === "full" || !parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return parsed;
  }

  const record = parsed as Record<string, unknown>;
  const response = record.response && typeof record.response === "object" && !Array.isArray(record.response)
    ? record.response as Record<string, unknown>
    : null;

  if (!response) return parsed;

  return {
    ...record,
    response: {
      status: response.status,
      headers: response.headers,
      body_preview: compactBody(response.body),
    },
  };
}

async function executeCodeMode(server: McpServer, args: Record<string, unknown>) {
  const traceId = `agt_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
  const analysis = analyzeCodeModeSnippet(args.code);
  if (!Array.isArray(analysis)) {
    return {
      mcpResult: {
        isError: true,
        content: [{ type: "text", text: JSON.stringify({
          status: "typecheck_failed",
          mode: "astrail_code_mode",
          error_code: analysis.code,
          error: analysis.error,
          trace_id: traceId,
        }, null, 2) }],
      },
      status: "mapping_required",
      latencyMs: 0,
      method: "ASTRAIL_CODE",
      path: "execute",
      executionMode: "code_mode",
      upstreamStatus: null,
      traceId,
      attemptCount: 0,
      errorCode: analysis.code,
      error: analysis.error,
    } satisfies ToolExecutionResult;
  }

  const resultMode = args.result_mode === "full" ? "full" : "compact";
  const prepared: Array<{
    call: AnalyzedClientCall;
    endpoint: OpenApiEndpoint;
    endpointTool: McpTool;
    credential: RuntimeCredential | null;
  }> = [];
  let finalStatus: ToolExecutionResult["status"] = "success";
  let finalError: string | null = null;
  let finalErrorCode: string | null = null;
  let attempts = 0;
  const startedAt = Date.now();
  const results: Array<Record<string, unknown>> = [];

  for (const call of analysis) {
    const endpoint = findEndpointForSdkCall(server, call);
    if (!endpoint) {
      finalStatus = "mapping_required";
      finalError = `Unknown SDK method client.${call.resource}.${call.method}.`;
      finalErrorCode = "sdk_method_not_found";
      results.push({
        status: "typecheck_failed",
        error_code: finalErrorCode,
        error: finalError,
        sdk_call: call.source,
        suggestions: sdkMethodSuggestions(server, call),
      });
      return {
        mcpResult: {
          isError: true,
          content: [{ type: "text", text: JSON.stringify({
            status: finalStatus,
            mode: "astrail_code_mode",
            trace_id: traceId,
            result_mode: resultMode,
            analysis: {
              sdk_calls_found: analysis.length,
              execution_model: "static-analysis-no-eval",
            },
            results,
          }, null, 2) }],
        },
        status: finalStatus,
        latencyMs: Date.now() - startedAt,
        method: "ASTRAIL_CODE",
        path: "execute",
        executionMode: "code_mode",
        upstreamStatus: null,
        traceId,
        attemptCount: attempts,
        errorCode: finalErrorCode,
        error: finalError,
      } satisfies ToolExecutionResult;
    }

    const argumentError = validateSdkCallArguments(endpoint, call.args);
    if (argumentError) {
      finalStatus = "mapping_required";
      finalError = argumentError.error;
      finalErrorCode = argumentError.error_code;
      results.push({
        status: "typecheck_failed",
        ...argumentError,
        sdk_call: call.source,
        sdk_method: `client.${call.resource}.${call.method}`,
        expected_arguments: schemaProperties(endpoint.input_schema),
      });
      return {
        mcpResult: {
          isError: true,
          content: [{ type: "text", text: JSON.stringify({
            status: finalStatus,
            mode: "astrail_code_mode",
            trace_id: traceId,
            result_mode: resultMode,
            analysis: {
              sdk_calls_found: analysis.length,
              execution_model: "static-analysis-no-eval",
            },
            results,
          }, null, 2) }],
        },
        status: finalStatus,
        latencyMs: Date.now() - startedAt,
        method: "ASTRAIL_CODE",
        path: "execute",
        executionMode: "code_mode",
        upstreamStatus: null,
        traceId,
        attemptCount: attempts,
        errorCode: finalErrorCode,
        error: finalError,
      } satisfies ToolExecutionResult;
    }

    const endpointTool = endpointToolForCodeCall(endpoint);
    const credential = await loadCredentialForTool(server, endpointTool);
    prepared.push({ call, endpoint, endpointTool, credential });
  }

  const allSafeReads = prepared.every(({ endpoint }) => endpoint.operation_kind === "read");
  const executions = allSafeReads
    ? await Promise.all(prepared.map(({ endpointTool, call, credential }) =>
        executeToolFromEndpointMap(server, endpointTool, call.args, { credential })
      ))
    : [];

  for (let index = 0; index < prepared.length; index += 1) {
    const { call, endpoint, endpointTool, credential } = prepared[index];
    const execution = allSafeReads
      ? executions[index]
      : await executeToolFromEndpointMap(server, endpointTool, call.args, { credential });
    attempts += execution.attemptCount;
    if (execution.status !== "success") {
      finalStatus = execution.status;
      finalError = execution.error;
      finalErrorCode = execution.errorCode;
    }

    results.push({
      status: execution.status,
      sdk_method: `client.${call.resource}.${call.method}`,
      control_flow: call.controlFlow,
      endpoint: endpointCatalogItem(endpoint),
      arguments: call.args,
      output: codeModeOutput(execution, resultMode),
    });

    if (execution.status !== "success") break;
  }

  return {
    mcpResult: {
      ...(finalStatus === "success" ? {} : { isError: true }),
      content: [{ type: "text", text: JSON.stringify({
        status: finalStatus === "success" ? "success" : finalStatus,
        mode: "astrail_code_mode",
        trace_id: traceId,
        result_mode: resultMode,
        analysis: {
          sdk_calls_found: analysis.length,
          execution_model: "static-analysis-no-eval",
          execution_strategy: allSafeReads ? "parallel_safe_reads" : "ordered_calls",
          control_flow: Array.from(new Set(analysis.map((call) => call.controlFlow))),
        },
        results,
      }, null, 2) }],
    },
    status: finalStatus,
    latencyMs: Date.now() - startedAt,
    method: "ASTRAIL_CODE",
    path: "execute",
    executionMode: "code_mode",
    upstreamStatus: null,
    traceId,
    attemptCount: attempts,
    errorCode: finalErrorCode,
    error: finalError,
  } satisfies ToolExecutionResult;
}

async function executeMetaTool(server: McpServer, tool: McpTool, args: Record<string, unknown>) {
  if (tool.name === "search_docs") {
    return {
      mcpResult: {
        content: [{ type: "text", text: JSON.stringify(searchDocs(server, args), null, 2) }],
      },
      status: "success",
      latencyMs: 0,
      method: "ASTRAIL_CODE",
      path: "search_docs",
      executionMode: "code_mode",
      upstreamStatus: null,
      traceId: `agt_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`,
      attemptCount: 0,
      errorCode: null,
      error: null,
    } satisfies ToolExecutionResult;
  }

  if (tool.name === "execute") {
    return executeCodeMode(server, args);
  }

  if (tool.name === "list_api_endpoints") {
    return {
      mcpResult: {
        content: [{ type: "text", text: JSON.stringify(listApiEndpoints(server, args), null, 2) }],
      },
      status: "success",
      latencyMs: 0,
      method: "ASTRAIL_META",
      path: "list_api_endpoints",
      executionMode: "metadata_catalog",
      upstreamStatus: null,
      traceId: `agt_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`,
      attemptCount: 0,
      errorCode: null,
      error: null,
    } satisfies ToolExecutionResult;
  }

  if (tool.name === "get_api_endpoint_schema") {
    const schemaResult = getApiEndpointSchema(server, args);
    const failed = schemaResult.status === "error";
    return {
      mcpResult: {
        ...(failed ? { isError: true } : {}),
        content: [{ type: "text", text: JSON.stringify(schemaResult, null, 2) }],
      },
      status: failed ? "mapping_required" : "success",
      latencyMs: 0,
      method: "ASTRAIL_META",
      path: "get_api_endpoint_schema",
      executionMode: failed ? "mapping_required" : "metadata_catalog",
      upstreamStatus: null,
      traceId: createRuntimeTraceId(),
      attemptCount: 0,
      errorCode: failed ? "endpoint_not_found" : null,
      error: failed ? "Endpoint not found." : null,
    } satisfies ToolExecutionResult;
  }

  if (tool.name === "invoke_api_endpoint") {
    const endpoint = findCatalogEndpoint(server, args.endpoint_id);
    if (!endpoint) {
      return {
        mcpResult: {
          isError: true,
          content: [{ type: "text", text: JSON.stringify({
            status: "error",
            error_code: "endpoint_not_found",
            endpoint_id: args.endpoint_id ?? null,
            note: "Use list_api_endpoints to find a valid endpoint_id.",
          }, null, 2) }],
        },
        status: "mapping_required",
        latencyMs: 0,
        method: "ASTRAIL_META",
        path: "invoke_api_endpoint",
        executionMode: "mapping_required",
        upstreamStatus: null,
        traceId: createRuntimeTraceId(),
        attemptCount: 0,
        errorCode: "endpoint_not_found",
        error: "Endpoint not found.",
      } satisfies ToolExecutionResult;
    }

    const endpointTool: McpTool = {
      name: endpointId(endpoint),
      description: endpoint.description || endpoint.summary || `${endpoint.method} ${endpoint.path}`,
      input_schema: endpoint.input_schema ?? { type: "object", properties: {} },
      method: endpoint.method,
      path: endpoint.path,
    };
    const endpointArgs = normalizeToolArguments(args.arguments);
    const validation = validateToolInput(endpointTool.input_schema, endpointArgs);
    if (!validation.ok) {
      return inputValidationFailedResult(endpointTool, validation.issues, endpointTool.input_schema, endpoint.method, endpoint.path);
    }

    const credential = await loadCredentialForTool(server, endpointTool);
    return executeToolFromEndpointMap(server, endpointTool, endpointArgs, { credential });
  }

  return {
    mcpResult: {
      isError: true,
      content: [{ type: "text", text: JSON.stringify({ status: "error", error_code: "unknown_meta_tool", tool: tool.name }, null, 2) }],
    },
    status: "mapping_required",
    latencyMs: 0,
    method: "ASTRAIL_META",
    path: tool.name,
	    executionMode: "mapping_required",
	    upstreamStatus: null,
	    traceId: createRuntimeTraceId(),
    attemptCount: 0,
    errorCode: "unknown_meta_tool",
    error: "Unknown meta tool.",
  } satisfies ToolExecutionResult;
}

async function loadServer(serverId: string, requestUrl?: string | URL) {
  const localGenerated = findLocalGeneratedServer(serverId);
  if (localGenerated) return localGenerated;

  const preset = findPresetServer(serverId);
  if (preset) return preset;
  if (serverId === "petstore-openapi") {
    const demo = localDemoServers().find((server) => server.id === "local-openapi");
    if (demo) {
      return {
        ...demo,
        id: "petstore-openapi",
        name: "Public Petstore MCP endpoint",
        description: "Public hosted MCP demo endpoint generated from the Swagger Petstore OpenAPI spec.",
        hosted_endpoint: "/api/mcp/petstore-openapi",
        is_public: true,
      };
    }
  }
  if (serverId === "petstore-code-mode") {
    const demo = localDemoServers().find((server) => server.id === "local-code-mode");
    if (demo) {
      return {
        ...demo,
        id: "petstore-code-mode",
        name: "Public Petstore Code Mode endpoint",
        description: "Public hosted MCP demo endpoint exposing search_docs and execute over the Swagger Petstore endpoint map.",
        hosted_endpoint: "/api/mcp/petstore-code-mode",
        is_public: true,
      };
    }
  }
  if (!hasServerSupabaseEnv()) {
    const preview = await loadLocalPreviewServer(serverId, requestUrl);
    if (preview) return preview;
    const demo = localDemoServers().find((server) => server.id === serverId);
    if (demo) return demo;
    if (serverId === "local-website-preview") {
      return localWebsitePreviewServer();
    }
    return null;
  }

  const db = hasServiceRoleKey() ? createAdminClient() : createPublicClient();
  let query = db
    .from("mcp_servers")
    .select("*")
    .eq("id", serverId);

  if (!hasServiceRoleKey()) {
    query = query.eq("is_public", true);
  }

  const { data, error } = await query.single();

  if (error || !data) return null;
  return data as McpServer;
}

export async function GET(request: Request, { params }: { params: { serverId: string } }) {
  const server = await loadServer(params.serverId, request.url);
  if (!server) return jsonWithCors(request, { error: "MCP server not found." }, 404);

  const authorized = await validateOwnerApiKey(server, getBearerToken(request));
  if (!authorized) {
    return jsonWithCors(request, { error: "Valid Astrail API key required." }, 401);
  }

  const endpointUrl = new URL(request.url);
  const tools = toolsVisibleToRequest(server);
  return jsonWithCors(request, {
    name: server.name,
    description: server.description,
    tools: tools.map(toolListItem),
    endpoint: server.hosted_endpoint ?? `${endpointUrl.origin}/api/mcp/${server.id}`,
    runtime: "metadata-gateway-v1",
    status: server.status ?? "live",
    protocol_version: server.protocol_version ?? "2024-11-05",
    instructions: startupInstructions(server, tools),
    agent_profile: {
      hosted: true,
      deterministic_runtime: true,
      supports_code_mode: isCodeModeServer(tools),
      supports_tool_annotations: true,
      supports_astrail_meta: true,
      supports_json_rpc_batch: true,
      supports_cors_preflight: true,
    },
  });
}

export async function OPTIONS(request: Request) {
  return new NextResponse(null, { status: 204, headers: corsHeaders(request) });
}

function firstRequestId(value: unknown): JsonRpcRequest["id"] {
  if (Array.isArray(value)) {
    const first = value.find(isJsonRpcRequest);
    return first?.id ?? null;
  }
  return isJsonRpcRequest(value) ? value.id ?? null : null;
}

function toolsVisibleToRequest(server: McpServer) {
  return visibleToolsForRequest(server, server.tools_json ?? [], findEndpointForTool);
}

function toolListItem(tool: McpTool) {
  return redactSensitive({
    name: tool.name,
    description: tool.description,
    inputSchema: tool.input_schema ?? { type: "object", properties: {} },
    ...(tool.annotations ? { annotations: tool.annotations } : {}),
    ...(tool.x_astrail ? {
      _meta: {
        astrail: tool.x_astrail,
      },
    } : {}),
  });
}

function findRequestedTool(server: McpServer, toolName: unknown) {
  if (typeof toolName !== "string") return { tool: null, denied: false };
  const allTools = server.tools_json ?? [];
  const tool = allTools.find((item) => item.name === toolName) ?? null;
  if (!tool) return { tool: null, denied: false };
  const visible = new Set(toolsVisibleToRequest(server).map((item) => item.name));
  return { tool, denied: !visible.has(tool.name) };
}

function permissionDeniedExecutionResult(tool: McpTool): ToolExecutionResult {
  const traceId = createRuntimeTraceId();
  return {
    mcpResult: {
      isError: true,
      content: [{
        type: "text",
        text: JSON.stringify({
          status: "permission_denied",
          error_code: "permission_denied",
          tool: tool.name,
          note: "This tool is not exposed by the public MCP policy.",
          runtime: {
            execution_mode: "permission_denied",
            trace_id: traceId,
          },
        }, null, 2),
      }],
    },
    status: "permission_denied",
    latencyMs: 0,
    method: tool.method ?? null,
    path: tool.path ?? null,
    executionMode: "permission_denied" as ToolExecutionResult["executionMode"],
    upstreamStatus: null,
    traceId,
    attemptCount: 0,
    errorCode: "permission_denied",
    error: "This tool is not exposed by the public MCP policy.",
  };
}

async function handleJsonRpcRequest(server: McpServer, body: unknown): Promise<JsonRpcHandlerResult> {
  if (!isJsonRpcRequest(body)) {
    return { payload: jsonRpcErrorPayload(null, -32600, "Invalid JSON-RPC request."), status: 400 };
  }
  if (body.jsonrpc !== "2.0") {
    return { payload: jsonRpcErrorPayload(body.id ?? null, -32600, "JSON-RPC version must be 2.0."), status: 400 };
  }
  if (typeof body.method !== "string" || !body.method.trim()) {
    return { payload: jsonRpcErrorPayload(body.id ?? null, -32600, "JSON-RPC method is required."), status: 400 };
  }

  const tools = toolsVisibleToRequest(server);

  if (body.method.startsWith("notifications/")) {
    return { payload: null, status: 204 };
  }

  if (body.method === "initialize") {
    return {
      payload: jsonRpcPayload(body.id, {
        protocolVersion: "2024-11-05",
        serverInfo: { name: server.name, version: "1.0.0" },
        capabilities: { tools: {} },
        instructions: startupInstructions(server, tools),
      }),
      status: 200,
    };
  }

  if (body.method === "ping") {
    return {
      payload: jsonRpcPayload(body.id, {}),
      status: 200,
    };
  }

  if (body.method === "tools/list") {
    return {
      payload: jsonRpcPayload(body.id, {
        tools: tools.map(toolListItem),
      }),
      status: 200,
    };
  }

  if (body.method === "tools/call") {
    const toolName = body.params?.name;
    const { tool, denied } = findRequestedTool(server, toolName);
    if (!tool) return { payload: jsonRpcErrorPayload(body.id, -32602, "Unknown tool."), status: 400 };
    if (denied) {
      const execution = permissionDeniedExecutionResult(tool);
      await logToolExecution(server, tool.name, execution);
      return { payload: jsonRpcPayload(body.id, execution.mcpResult), status: 200 };
    }
    const toolArgs = normalizeToolArguments(body.params?.arguments);
    const inputValidation = validateToolInput(tool.input_schema ?? { type: "object", properties: {} }, toolArgs);
    if (!inputValidation.ok) {
      const execution = inputValidationFailedResult(tool, inputValidation.issues, tool.input_schema ?? { type: "object", properties: {} });
      await logToolExecution(server, tool.name, execution);
      return { payload: jsonRpcPayload(body.id, execution.mcpResult), status: 200 };
    }

    const rateLimit = checkRuntimeRateLimit(`${server.id}:${tool.name}`);
    if (!rateLimit.allowed) {
      return {
        payload: jsonRpcPayload(body.id, {
          isError: true,
          content: [{
            type: "text",
            text: JSON.stringify({
              status: "error",
              error_code: "rate_limited",
              tool: tool.name,
              note: "Runtime rate limit exceeded. Retry after the reset time.",
              reset_at: new Date(rateLimit.resetAt).toISOString(),
            }, null, 2),
          }],
        }),
        status: 429,
      };
    }

    const billing = await checkBillingAllowance(server.user_id);
    if (!billing.allowed) {
      const execution = billingRequiredResult(tool.name, billing.summary);
      await logToolExecution(server, tool.name, execution);
      return { payload: jsonRpcPayload(body.id, execution.mcpResult), status: 402 };
    }

    await incrementCallCount(server);
    const execution = tool.method === "ASTRAIL_META" || tool.method === "ASTRAIL_CODE"
      ? await executeMetaTool(server, tool, toolArgs)
      : server.source_type === "preset" && (!Array.isArray(server.endpoint_map) || server.endpoint_map.length === 0)
      ? presetTemplateExecution(server, tool)
      : await executeToolFromEndpointMap(server, tool, toolArgs, { credential: await loadCredentialForTool(server, tool) });
    await logToolExecution(server, tool.name, execution);
    return { payload: jsonRpcPayload(body.id, execution.mcpResult), status: 200 };
  }

  return { payload: jsonRpcErrorPayload(body.id, -32601, "Method not found."), status: 404 };
}

export async function POST(request: Request, { params }: { params: { serverId: string } }) {
  if (requestPayloadTooLarge(request)) {
    return jsonRpcError(request, null, -32013, "JSON-RPC payload is too large.", 413);
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonRpcError(request, null, -32700, "Invalid JSON-RPC payload.", 400);
  }

  const server = await loadServer(params.serverId, request.url);
  if (!server) return jsonRpcError(request, firstRequestId(body), -32004, "MCP server not found.", 404);

  const authorized = await validateOwnerApiKey(server, getBearerToken(request));
  if (!authorized) {
    return jsonRpcError(request, firstRequestId(body), -32001, "Valid Astrail API key required.", 401);
  }

  if (Array.isArray(body)) {
    if (body.length === 0) {
      return jsonRpcError(request, null, -32600, "JSON-RPC batch must contain at least one request.", 400);
    }
    if (body.length > 20) {
      return jsonRpcError(request, null, -32014, "JSON-RPC batch is limited to 20 requests.", 413);
    }
    const results = await Promise.all(body.map((item) => handleJsonRpcRequest(server, item)));
    const payloads = results.map((result) => result.payload).filter((payload): payload is JsonRpcResponsePayload => Boolean(payload));
    if (payloads.length === 0) {
      return new NextResponse(null, { status: 204, headers: corsHeaders(request) });
    }
    return jsonWithCors(request, payloads);
  }

  const result = await handleJsonRpcRequest(server, body);
  if (!result.payload) {
    return new NextResponse(null, { status: result.status, headers: corsHeaders(request) });
  }
  return jsonWithCors(request, result.payload, result.status);
}
