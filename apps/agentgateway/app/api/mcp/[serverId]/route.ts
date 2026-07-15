import { NextResponse } from "next/server";
import { verifyApiKey } from "@/lib/api-keys";
import { defaultToolPolicy } from "@/lib/agent-tool-profile";
import { checkBillingAllowance } from "@/lib/billing/usage";
import {
  decryptCredential,
  encryptCredential,
  hasCredentialEncryptionKey,
  oauthCredentialExpired,
  refreshOAuthAccessToken,
} from "@/lib/credentials";
import { findLocalGeneratedServer, localDemoServers, localDemoUserId } from "@/lib/local-demo";
import { loadLocalPreviewServer } from "@/lib/local-preview-servers";
import { findPresetServer } from "@/lib/preset-servers";
import {
  executeToolFromEndpointMap,
  findEndpointForTool,
  hasOAuthSecurityRequirement,
  hasSecurityRequirement,
  type RuntimeCredential,
  type ToolExecutionResult,
} from "@/lib/runtime/execute-tool";
import {
  endpointRequiresAuth,
  redactSensitive,
  runtimePolicySummary,
  visibleEndpointsForRequest,
  visibleToolsForRequest,
} from "@/lib/runtime/permissions";
import { auditMcpSecurityEvent, sanitizeToolLogRecord, writeStructuredLog } from "@/lib/runtime/observability";
import { checkRuntimeRateLimit } from "@/lib/runtime/rate-limit";
import { createToolApprovalRequest, loadApprovedToolRequest, markToolApprovalExecuted, type ToolApprovalRequest } from "@/lib/runtime/tool-approvals";
import { executeSdkCodeMode, searchSdkDocs } from "@/lib/runtime/sdk-code-mode";
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
    execution_id?: string;
  };
};

type JsonRpcErrorData = {
  reason: string;
  status: number;
  trace_id: string;
};

type JsonRpcResponsePayload = {
  jsonrpc: "2.0";
  id: JsonRpcRequest["id"];
  result?: unknown;
  error?: {
    code: number;
    message: string;
    data?: JsonRpcErrorData;
  };
};

type JsonRpcHandlerResult = {
  payload: JsonRpcResponsePayload | null;
  status: number;
};

type JsonRpcEnvelopeError = {
  id: JsonRpcRequest["id"];
  code: number;
  message: string;
  status: number;
  reason: string;
  batchSize?: number;
};

type ApiKeyRow = ApiKey & {
  key_hash: string;
};

type CredentialRow = {
  id: string;
  auth_scheme: RuntimeCredential["scheme"];
  provider: string | null;
  client_id: string | null;
  client_secret_ciphertext: string | null;
  injection_name: string | null;
  scopes: unknown;
  secret_ciphertext: string;
  access_token_ciphertext: string | null;
  refresh_token_ciphertext: string | null;
  token_url: string | null;
  expires_at: string | null;
};

const MAX_JSON_RPC_BYTES = 256_000;
const MAX_JSON_RPC_BATCH = 20;
const MAX_JSON_RPC_ID_CHARS = 256;

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

function jsonRpcErrorPayload(
  id: JsonRpcRequest["id"],
  code: number,
  message: string,
  data?: JsonRpcErrorData
): JsonRpcResponsePayload {
  return { jsonrpc: "2.0", id: id ?? null, error: { code, message, ...(data ? { data } : {}) } };
}

function jsonRpcError(
  request: Request,
  id: JsonRpcRequest["id"],
  code: number,
  message: string,
  status = 400,
  data?: JsonRpcErrorData
) {
  return jsonWithCors(request, jsonRpcErrorPayload(id, code, message, data), status);
}

function createRuntimeTraceId() {
  return `agt_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

function auditErrorData(event: ReturnType<typeof auditMcpSecurityEvent>, status: number, reason: string) {
  return {
    reason,
    status,
    trace_id: event.trace_id,
  };
}

function jsonRpcProtocolError(
  server: McpServer,
  id: JsonRpcRequest["id"],
  code: number,
  message: string,
  status: number,
  reason: string
): JsonRpcHandlerResult {
  const audit = auditMcpSecurityEvent({
    route: "mcp_server",
    server_id: server.id,
    reason,
    status,
  });
  return { payload: jsonRpcErrorPayload(id, code, message, auditErrorData(audit, status, reason)), status };
}

function isJsonRpcRequestId(value: unknown): value is JsonRpcRequest["id"] {
  if (value === null) return true;
  if (typeof value === "number") return Number.isFinite(value);
  return typeof value === "string" && value.length <= MAX_JSON_RPC_ID_CHARS;
}

function isJsonRpcRequest(value: unknown): value is JsonRpcRequest {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function jsonRpcRequestId(value: unknown): JsonRpcRequest["id"] {
  if (!isJsonRpcRequest(value)) return null;
  const id = (value as { id?: unknown }).id;
  return isJsonRpcRequestId(id) ? id ?? null : null;
}

function hasInvalidJsonRpcId(value: unknown) {
  if (!isJsonRpcRequest(value)) return false;
  const id = (value as { id?: unknown }).id;
  return id !== undefined && !isJsonRpcRequestId(id);
}

function validateJsonRpcEnvelope(body: unknown): JsonRpcEnvelopeError | null {
  if (Array.isArray(body)) {
    if (body.length === 0) {
      return {
        id: null,
        code: -32600,
        message: "JSON-RPC batch must contain at least one request.",
        status: 400,
        reason: "empty_batch",
        batchSize: body.length,
      };
    }
    if (body.length > MAX_JSON_RPC_BATCH) {
      return {
        id: null,
        code: -32014,
        message: "JSON-RPC batch is limited to 20 requests.",
        status: 413,
        reason: "batch_too_large",
        batchSize: body.length,
      };
    }
    return null;
  }

  if (!isJsonRpcRequest(body) || hasInvalidJsonRpcId(body)) {
    return {
      id: null,
      code: -32600,
      message: "Invalid JSON-RPC request.",
      status: 400,
      reason: "invalid_json_rpc_request",
    };
  }

  return null;
}

function jsonRpcPreloadProtocolError(request: Request, serverId: string, error: JsonRpcEnvelopeError) {
  const audit = auditMcpSecurityEvent({
    route: "mcp_server",
    server_id: serverId,
    reason: error.reason,
    status: error.status,
    ...(error.batchSize !== undefined ? { batch_size: error.batchSize } : {}),
  });
  return jsonRpcError(
    request,
    error.id,
    error.code,
    error.message,
    error.status,
    auditErrorData(audit, error.status, error.reason)
  );
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
  if (server.user_id === localDemoUserId && process.env.ASTRAIL_ENABLE_LOCAL_SECURITY_FIXTURES === "1") {
    return rawKey === (process.env.ASTRAIL_LOCAL_MCP_API_KEY ?? "ag_demo_secret");
  }
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

function permissionDeniedExecutionResult(tool: McpTool, method: string | null = tool.method ?? null, path: string | null = tool.path ?? null): ToolExecutionResult {
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
          note: "This tool or endpoint is not exposed by the public MCP policy.",
          runtime: {
            execution_mode: "permission_denied",
            trace_id: traceId,
          },
        }, null, 2),
      }],
    },
    status: "permission_denied",
    latencyMs: 0,
    method,
    path,
    executionMode: "permission_denied",
    upstreamStatus: null,
    traceId,
    attemptCount: 0,
    errorCode: "permission_denied",
    error: "This tool or endpoint is not exposed by the public MCP policy.",
  };
}

function approvalRequiredExecutionResult(tool: McpTool, approval: ToolApprovalRequest): ToolExecutionResult {
  const traceId = createRuntimeTraceId();
  return {
    mcpResult: {
      isError: true,
      content: [{ type: "text", text: JSON.stringify({
        status: "approval_required",
        error_code: "human_approval_required",
        tool: tool.name,
        execution_id: approval.id,
        approval_url: "/dashboard/approvals",
        expires_at: approval.expires_at,
        resume: { method: "astrail/resume", params: { execution_id: approval.id } },
        note: "Astrail paused this call before billing, credential injection, or upstream execution. Approve it in the dashboard, then resume it once.",
        runtime: { execution_mode: "approval_required", trace_id: traceId },
      }, null, 2) }],
    },
    status: "approval_required",
    latencyMs: 0,
    method: tool.method ?? null,
    path: tool.path ?? null,
    executionMode: "approval_required",
    upstreamStatus: null,
    traceId,
    attemptCount: 0,
    errorCode: "human_approval_required",
    error: "Human approval is required before this tool can execute.",
  };
}

function approvalResumeFailure(executionId: unknown, code: string) {
  return {
    isError: true,
    content: [{ type: "text" as const, text: JSON.stringify({
      status: "error",
      error_code: code,
      execution_id: typeof executionId === "string" ? executionId : null,
      note: code === "approval_pending"
        ? "Approve or deny this execution in the Astrail dashboard before resuming."
        : "This approval cannot be resumed. It may be missing, denied, expired, already executed, or unavailable.",
    }, null, 2) }],
  };
}

async function logToolExecution(server: McpServer, toolName: string, execution: ToolExecutionResult) {
  if (server.user_id === "local-preview") return;
  if (server.user_id === "preset") return;
  const logPayload = sanitizeToolLogRecord({
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
  });

  if (!hasServiceRoleKey()) {
    writeStructuredLog({ ...logPayload, storage: "structured_log" });
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
        method: logPayload.method,
        path: logPayload.path,
        execution_mode: execution.executionMode,
        upstream_status: execution.upstreamStatus,
        trace_id: execution.traceId,
        attempt_count: execution.attemptCount,
        error_code: logPayload.error_code,
        error: logPayload.error,
      });
    if (error) {
      writeStructuredLog({ ...logPayload, storage: "structured_log", storage_error: error.message });
    }
  } catch {
    writeStructuredLog({ ...logPayload, storage: "structured_log" });
    // Runtime logging is best-effort. MCP protocol responses should not fail because observability storage is unavailable.
  }
}

async function loadCredentialForTool(server: McpServer, tool: McpTool): Promise<RuntimeCredential | null> {
  if (server.user_id === localDemoUserId && process.env.ASTRAIL_ENABLE_LOCAL_SECURITY_FIXTURES === "1") {
    const endpoint = findEndpointForTool(server, tool);
    if (!endpoint || !hasSecurityRequirement(endpoint)) return null;
    if (process.env.ASTRAIL_LOCAL_PROVIDER_CREDENTIALS_DISABLED === "1") return null;
    return {
      scheme: "api_key_query",
      injectionName: "api_key",
      secret: process.env.ASTRAIL_LOCAL_PROVIDER_SECRET ?? "local_provider_secret",
    };
  }

  if (!hasServiceRoleKey() || !hasCredentialEncryptionKey()) return null;
  const endpoint = findEndpointForTool(server, tool);
  if (!endpoint) return null;
  const isMcpProxy = endpoint.runtime_kind === "mcp_proxy" || endpoint.method.toUpperCase() === "MCP_PROXY";
  if (!isMcpProxy && !hasSecurityRequirement(endpoint)) return null;
  const requiresOAuth = hasOAuthSecurityRequirement(endpoint);

  try {
    const admin = createAdminClient();
    const { data, error } = await createAdminClient()
      .from("api_credentials")
      .select("id,auth_scheme,provider,client_id,client_secret_ciphertext,injection_name,scopes,secret_ciphertext,access_token_ciphertext,refresh_token_ciphertext,token_url,expires_at")
      .eq("user_id", server.user_id)
      .eq("server_id", server.id)
      .order("created_at", { ascending: false })
      .limit(8);

    if (error || !data || data.length === 0) return null;
    const credentials = data as CredentialRow[];
    const credential = credentials.find((item) =>
      requiresOAuth ? item.auth_scheme === "oauth2" : item.auth_scheme !== "oauth2"
    ) ?? credentials[0];

    if (credential.auth_scheme === "oauth2") {
      const accessTokenCiphertext = credential.access_token_ciphertext ?? credential.secret_ciphertext;
      if (!accessTokenCiphertext) return null;
      if (oauthCredentialExpired(credential.expires_at)) {
        if (!credential.refresh_token_ciphertext || !credential.token_url) return null;
        const refreshed = await refreshOAuthAccessToken({
          provider: credential.provider ?? "oauth",
          tokenUrl: credential.token_url,
          clientId: credential.client_id,
          clientSecret: credential.client_secret_ciphertext
            ? decryptCredential(credential.client_secret_ciphertext)
            : null,
          refreshToken: decryptCredential(credential.refresh_token_ciphertext),
          scopes: Array.isArray(credential.scopes) ? credential.scopes.filter((item): item is string => typeof item === "string") : [],
        });
        const encryptedAccessToken = encryptCredential(refreshed.accessToken);
        await admin
          .from("api_credentials")
          .update({
            secret_ciphertext: encryptedAccessToken,
            access_token_ciphertext: encryptedAccessToken,
            refresh_token_ciphertext: refreshed.refreshToken
              ? encryptCredential(refreshed.refreshToken)
              : credential.refresh_token_ciphertext,
            scopes: refreshed.scopes,
            expires_at: refreshed.expiresAt,
            updated_at: new Date().toISOString(),
          })
          .eq("id", credential.id)
          .eq("user_id", server.user_id);

        return {
          scheme: "oauth2",
          secret: refreshed.accessToken,
        };
      }

      return {
        scheme: "oauth2",
        secret: decryptCredential(accessTokenCiphertext),
      };
    }

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
    requires_auth: endpointRequiresAuth(endpoint),
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

async function executeMetaTool(server: McpServer, tool: McpTool, args: Record<string, unknown>) {
  if (tool.name === "search_docs") {
    return {
      mcpResult: {
        content: [{ type: "text", text: JSON.stringify(searchSdkDocs(server, args), null, 2) }],
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
    return executeSdkCodeMode(server, args, { loadCredentialForTool });
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
  if (process.env.ASTRAIL_ENABLE_LOCAL_SECURITY_FIXTURES === "1") {
    const securityFixture = localDemoServers().find((server) => server.id === serverId);
    if (securityFixture?.user_id === localDemoUserId) return securityFixture;
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
    tools: tools.map((tool) => toolListItem(server, tool)),
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
      supports_runtime_permissions: true,
      supports_astrail_meta: true,
      supports_json_rpc_batch: true,
      supports_cors_preflight: true,
    },
    runtime_policy: runtimePolicySummary(server.runtime_policy),
  });
}

export async function OPTIONS(request: Request) {
  return new NextResponse(null, { status: 204, headers: corsHeaders(request) });
}

function firstRequestId(value: unknown): JsonRpcRequest["id"] {
  if (Array.isArray(value)) {
    const first = value.find(isJsonRpcRequest);
    return jsonRpcRequestId(first);
  }
  return jsonRpcRequestId(value);
}

function toolsVisibleToRequest(server: McpServer) {
  return visibleToolsForRequest(server, server.tools_json ?? [], findEndpointForTool);
}

function toolListItem(server: McpServer, tool: McpTool) {
  return redactSensitive({
    name: tool.name,
    description: tool.description,
    inputSchema: tool.input_schema ?? { type: "object", properties: {} },
    ...(tool.annotations ? { annotations: tool.annotations } : {}),
    _meta: {
      astrail: {
        ...(tool.x_astrail ?? {}),
        policy: tool.policy ?? defaultToolPolicy(tool, findEndpointForTool(server, tool)),
      },
    },
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

function policyForToolCall(server: McpServer, tool: McpTool, args: Record<string, unknown>) {
  if (tool.name === "search_docs" || tool.name === "list_api_endpoints" || tool.name === "get_api_endpoint_schema") return "allow" as const;
  if (tool.name === "invoke_api_endpoint") {
    const endpoint = findCatalogEndpoint(server, args.endpoint_id);
    return endpoint?.policy ?? defaultToolPolicy(tool, endpoint ?? undefined);
  }
  return tool.policy ?? defaultToolPolicy(tool, findEndpointForTool(server, tool));
}

async function handleJsonRpcRequest(server: McpServer, body: unknown, approvedExecutionId?: string): Promise<JsonRpcHandlerResult> {
  if (!isJsonRpcRequest(body) || hasInvalidJsonRpcId(body)) {
    return jsonRpcProtocolError(server, null, -32600, "Invalid JSON-RPC request.", 400, "invalid_json_rpc_request");
  }
  if (body.jsonrpc !== "2.0") {
    return jsonRpcProtocolError(server, body.id ?? null, -32600, "JSON-RPC version must be 2.0.", 400, "invalid_json_rpc_version");
  }
  if (typeof body.method !== "string" || !body.method.trim()) {
    return jsonRpcProtocolError(server, body.id ?? null, -32600, "JSON-RPC method is required.", 400, "missing_json_rpc_method");
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
        tools: tools.map((tool) => toolListItem(server, tool)),
      }),
      status: 200,
    };
  }

  if (body.method === "astrail/resume") {
    const executionId = body.params?.execution_id;
    if (typeof executionId !== "string" || !executionId) {
      return jsonRpcProtocolError(server, body.id, -32602, "execution_id is required.", 400, "missing_execution_id");
    }
    const approved = await loadApprovedToolRequest(server, executionId);
    if (!approved.ok) {
      return { payload: jsonRpcPayload(body.id, approvalResumeFailure(executionId, approved.code)), status: 200 };
    }
    return handleJsonRpcRequest(server, {
      jsonrpc: "2.0",
      id: body.id,
      method: "tools/call",
      params: { name: approved.request.tool_name, arguments: approved.arguments },
    }, executionId);
  }

  if (body.method === "tools/call") {
    const toolName = body.params?.name;
    const { tool, denied } = findRequestedTool(server, toolName);
    if (!tool) return jsonRpcProtocolError(server, body.id, -32602, "Unknown tool.", 400, "unknown_tool");
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

    const toolPolicy = policyForToolCall(server, tool, toolArgs);
    if (toolPolicy === "block") {
      const execution = permissionDeniedExecutionResult(tool);
      await logToolExecution(server, tool.name, execution);
      return { payload: jsonRpcPayload(body.id, execution.mcpResult), status: 200 };
    }
    if (toolPolicy === "approval" && !approvedExecutionId) {
      try {
        const approval = await createToolApprovalRequest(server, tool, toolArgs);
        const execution = approvalRequiredExecutionResult(tool, approval);
        await logToolExecution(server, tool.name, execution);
        return { payload: jsonRpcPayload(body.id, execution.mcpResult), status: 200 };
      } catch {
        return { payload: jsonRpcPayload(body.id, approvalResumeFailure(null, "approval_storage_unavailable")), status: 503 };
      }
    }

    const rateLimit = checkRuntimeRateLimit(`${server.id}:${tool.name}`);
    if (!rateLimit.allowed) {
      const reason = "runtime_rate_limited";
      const audit = auditMcpSecurityEvent({
        route: "mcp_server",
        server_id: server.id,
        tool_name: tool.name,
        reason,
        status: 429,
        reset_at: new Date(rateLimit.resetAt).toISOString(),
      });
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
              runtime: {
                execution_mode: "rate_limited",
                trace_id: audit.trace_id,
                error_code: "rate_limited",
              },
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
    if (approvedExecutionId) await markToolApprovalExecuted(server, approvedExecutionId);
    return { payload: jsonRpcPayload(body.id, execution.mcpResult), status: 200 };
  }

  return jsonRpcProtocolError(server, body.id, -32601, "Method not found.", 404, "method_not_found");
}

export async function POST(request: Request, { params }: { params: { serverId: string } }) {
  if (requestPayloadTooLarge(request)) {
    const reason = "payload_too_large";
    const audit = auditMcpSecurityEvent({
      route: "mcp_server",
      server_id: params.serverId,
      reason,
      status: 413,
      content_length: request.headers.get("content-length"),
    });
    return jsonRpcError(request, null, -32013, "JSON-RPC payload is too large.", 413, auditErrorData(audit, 413, reason));
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    const reason = "invalid_json";
    const audit = auditMcpSecurityEvent({
      route: "mcp_server",
      server_id: params.serverId,
      reason,
      status: 400,
      content_length: request.headers.get("content-length"),
    });
    return jsonRpcError(request, null, -32700, "Invalid JSON-RPC payload.", 400, auditErrorData(audit, 400, reason));
  }

  const envelopeError = validateJsonRpcEnvelope(body);
  if (envelopeError) {
    return jsonRpcPreloadProtocolError(request, params.serverId, envelopeError);
  }

  const server = await loadServer(params.serverId, request.url);
  if (!server) return jsonRpcError(request, firstRequestId(body), -32004, "MCP server not found.", 404);

  const authorized = await validateOwnerApiKey(server, getBearerToken(request));
  if (!authorized) {
    const reason = "invalid_or_missing_api_key";
    const audit = auditMcpSecurityEvent({
      route: "mcp_server",
      server_id: server.id,
      reason,
      status: 401,
      is_public: server.is_public,
    });
    return jsonRpcError(request, firstRequestId(body), -32001, "Valid Astrail API key required.", 401, auditErrorData(audit, 401, reason));
  }

  if (Array.isArray(body)) {
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
