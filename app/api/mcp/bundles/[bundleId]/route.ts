import { NextResponse } from "next/server";
import { verifyApiKey } from "@/lib/api-keys";
import { checkBillingAllowance } from "@/lib/billing/usage";
import { executeToolFromEndpointMap, type ToolExecutionResult } from "@/lib/runtime/execute-tool";
import { findEndpointForTool } from "@/lib/runtime/execute-tool";
import { auditMcpSecurityEvent, sanitizeToolLogRecord, writeStructuredLog } from "@/lib/runtime/observability";
import { redactSensitive, visibleToolsForRequest } from "@/lib/runtime/permissions";
import { checkRuntimeRateLimit } from "@/lib/runtime/rate-limit";
import { validateToolInput } from "@/lib/runtime/tool-input-validation";
import { localDemoServers, localDemoUserId } from "@/lib/local-demo";
import { hasServerSupabaseEnv } from "@/lib/supabase/env";
import { createAdminClient, hasServiceRoleKey } from "@/lib/supabase/server";
import type { ApiKey, McpServer, McpTool } from "@/lib/types";

export const runtime = "nodejs";

type JsonRpcRequest = {
  jsonrpc?: string;
  id?: string | number | null;
  method?: string;
  params?: {
    name?: string;
    arguments?: unknown;
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
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "authorization, content-type, mcp-session-id, x-astrail-client",
    "Access-Control-Max-Age": "86400",
    "Vary": "Origin",
    "Cache-Control": "no-store",
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

function jsonWithCors(request: Request, payload: unknown, status = 200) {
  return NextResponse.json(payload, { status, headers: corsHeaders(request) });
}

function jsonRpc(request: Request, id: JsonRpcRequest["id"], result: unknown, status = 200) {
  return jsonWithCors(request, jsonRpcPayload(id, result), status);
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

function auditErrorData(event: ReturnType<typeof auditMcpSecurityEvent>, status: number, reason: string) {
  return {
    reason,
    status,
    trace_id: event.trace_id,
  };
}

function jsonRpcProtocolError(
  bundle: Bundle,
  id: JsonRpcRequest["id"],
  code: number,
  message: string,
  status: number,
  reason: string
): JsonRpcHandlerResult {
  const audit = auditMcpSecurityEvent({
    route: "mcp_bundle",
    bundle_id: bundle.id,
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

function jsonRpcPreloadProtocolError(request: Request, bundleId: string, error: JsonRpcEnvelopeError) {
  const audit = auditMcpSecurityEvent({
    route: "mcp_bundle",
    bundle_id: bundleId,
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

function firstRequestId(value: unknown): JsonRpcRequest["id"] {
  if (Array.isArray(value)) {
    const first = value.find(isJsonRpcRequest);
    return jsonRpcRequestId(first);
  }
  return jsonRpcRequestId(value);
}

function requestPayloadTooLarge(request: Request) {
  const length = Number(request.headers.get("content-length") ?? 0);
  return Number.isFinite(length) && length > MAX_JSON_RPC_BYTES;
}

function normalizeToolArguments(value: unknown): Record<string, unknown> {
  if (!value) return {};
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value) as unknown;
      return parsed && typeof parsed === "object" && !Array.isArray(parsed)
        ? parsed as Record<string, unknown>
        : {};
    } catch {
      return {};
    }
  }
  return typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function bundleToolName(server: McpServer, tool: McpTool) {
  const prefix = server.name.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "") || server.id;
  return `${prefix}__${tool.name}`;
}

function getBearerToken(request: Request) {
  const auth = request.headers.get("authorization");
  if (!auth?.startsWith("Bearer ")) return null;
  return auth.slice("Bearer ".length);
}

function toolsVisibleToBundle(server: McpServer) {
  return visibleToolsForRequest(server, server.tools_json ?? [], findEndpointForTool);
}

function bundledToolListItem(server: McpServer, tool: McpTool) {
  return redactSensitive({
    name: bundleToolName(server, tool),
    description: `${server.name}: ${tool.description}`,
    inputSchema: tool.input_schema ?? { type: "object", properties: {} },
    ...(tool.annotations ? { annotations: tool.annotations } : {}),
    ...(tool.x_astrail ? { _meta: { astrail: { ...tool.x_astrail, source_server_id: server.id } } } : {}),
  });
}

function createRuntimeTraceId() {
  return `agt_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

function billingRequiredResult(
  bundledToolName: string,
  tool: McpTool,
  summary: Awaited<ReturnType<typeof checkBillingAllowance>>["summary"]
): ToolExecutionResult {
  const traceId = createRuntimeTraceId();
  return {
    mcpResult: {
      isError: true,
      content: [{
        type: "text",
        text: JSON.stringify({
          status: "billing_required",
          error_code: "monthly_billing_limit_reached",
          tool: bundledToolName,
          source_tool: tool.name,
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
    method: tool.method ?? null,
    path: tool.path ?? null,
    executionMode: "billing_required",
    upstreamStatus: null,
    traceId,
    attemptCount: 0,
    errorCode: "monthly_billing_limit_reached",
    error: "Monthly billing limit reached.",
  };
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
          note: "This bundled tool is not exposed by the public MCP policy.",
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
    executionMode: "permission_denied",
    upstreamStatus: null,
    traceId,
    attemptCount: 0,
    errorCode: "permission_denied",
    error: "This bundled tool is not exposed by the public MCP policy.",
  };
}

function inputValidationFailedResult(tool: McpTool, issues: unknown[]): ToolExecutionResult {
  const traceId = createRuntimeTraceId();
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
          expected_schema: tool.input_schema ?? { type: "object", properties: {} },
          note: "The bundled tool was not executed. Fix arguments to match inputSchema, then retry tools/call.",
          runtime: {
            execution_mode: "validation_failed",
            trace_id: traceId,
          },
        }, null, 2),
      }],
    },
    status: "validation_failed",
    latencyMs: 0,
    method: tool.method ?? null,
    path: tool.path ?? null,
    executionMode: "validation_failed",
    upstreamStatus: null,
    traceId,
    attemptCount: 0,
    errorCode: "invalid_tool_arguments",
    error: "Invalid bundled tool arguments.",
  };
}

function bundleAllowsAnonymousAccess(bundle: Bundle, servers: McpServer[]) {
  return bundle.is_public && servers.every((server) => server.is_public);
}

async function validateBundleApiKey(bundle: Bundle, servers: McpServer[], rawKey: string | null) {
  if (bundle.user_id === "local-preview" && process.env.ASTRAIL_ENABLE_LOCAL_SECURITY_FIXTURES !== "1") return true;
  if (bundleAllowsAnonymousAccess(bundle, servers) && !rawKey) return true;
  if (!rawKey) return false;
  if (bundle.user_id === localDemoUserId && process.env.ASTRAIL_ENABLE_LOCAL_SECURITY_FIXTURES === "1") {
    return rawKey === (process.env.ASTRAIL_LOCAL_MCP_API_KEY ?? "ag_demo_secret");
  }
  if (bundle.user_id === "local-preview") return true;
  if (!hasServiceRoleKey()) return false;

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
  const payload = sanitizeToolLogRecord({
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
  });

  try {
    const { error } = await createAdminClient()
      .from("tool_call_logs")
      .insert({
        server_id: server.id,
        user_id: server.user_id,
        tool_name: tool.name,
        status: execution.status,
        latency_ms: execution.latencyMs,
        method: payload.method,
        path: payload.path,
        execution_mode: execution.executionMode,
        upstream_status: execution.upstreamStatus,
        trace_id: execution.traceId,
        attempt_count: execution.attemptCount,
        error_code: payload.error_code,
        error: payload.error,
      });
    if (error) {
      writeStructuredLog({ ...payload, storage: "structured_log", storage_error: error.message });
      return;
    }
    writeStructuredLog({ ...payload, storage: "tool_call_logs" });
  } catch {
    writeStructuredLog({ ...payload, storage: "structured_log" });
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

async function loadBundle(bundleId: string): Promise<LoadedBundle> {
  if (
    process.env.ASTRAIL_ENABLE_LOCAL_SECURITY_FIXTURES === "1" &&
    (bundleId === "security-public-bundle" || bundleId === "security-mixed-bundle")
  ) {
    const securityPublic = localDemoServers().find((server) => server.id === "security-public");
    const securityPrivate = localDemoServers().find((server) => server.id === "security-private");
    if (securityPublic && (bundleId === "security-public-bundle" || securityPrivate)) {
      return {
        bundle: {
          id: bundleId,
          user_id: localDemoUserId,
          name: bundleId === "security-mixed-bundle" ? "Security mixed bundle fixture" : "Security public bundle fixture",
          is_public: true,
        },
        servers: bundleId === "security-mixed-bundle" && securityPrivate
          ? [securityPublic, securityPrivate]
          : [securityPublic],
      };
    }
  }

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
    .in("id", serverIds)
    .eq("user_id", bundle.user_id);

  if (serversError) return { error: serversError.message };
  return { bundle: bundle as Bundle, servers: (servers ?? []) as McpServer[] };
}

function findBundledTool(bundle: Bundle, servers: McpServer[], name: unknown) {
  if (typeof name !== "string" || !name.trim()) return { server: null, tool: null, denied: false };

  for (const server of servers) {
    const allTool = (server.tools_json ?? []).find((item) => bundleToolName(server, item) === name);
    if (!allTool) continue;
    const visible = new Set(toolsVisibleToBundle(server).map((tool) => bundleToolName(server, tool)));
    return { server, tool: allTool, denied: !visible.has(name) };
  }

  return { server: null, tool: null, denied: false };
}

async function handleJsonRpcRequest(bundle: Bundle, servers: McpServer[], body: unknown): Promise<JsonRpcHandlerResult> {
  if (!isJsonRpcRequest(body) || hasInvalidJsonRpcId(body)) {
    return jsonRpcProtocolError(bundle, null, -32600, "Invalid JSON-RPC request.", 400, "invalid_json_rpc_request");
  }
  if (body.jsonrpc !== "2.0") {
    return jsonRpcProtocolError(bundle, body.id ?? null, -32600, "JSON-RPC version must be 2.0.", 400, "invalid_json_rpc_version");
  }
  if (typeof body.method !== "string" || !body.method.trim()) {
    return jsonRpcProtocolError(bundle, body.id ?? null, -32600, "JSON-RPC method is required.", 400, "missing_json_rpc_method");
  }

  if (body.method.startsWith("notifications/")) {
    return { payload: null, status: 204 };
  }

  if (body.method === "initialize") {
    return {
      payload: jsonRpcPayload(body.id, {
        protocolVersion: "2024-11-05",
        serverInfo: { name: bundle.name, version: "1.0.0" },
        capabilities: { tools: {} },
      }),
      status: 200,
    };
  }

  if (body.method === "ping") {
    return { payload: jsonRpcPayload(body.id, {}), status: 200 };
  }

  if (body.method === "tools/list") {
    return {
      payload: jsonRpcPayload(body.id, {
        tools: servers.flatMap((server) =>
          toolsVisibleToBundle(server).map((tool) => bundledToolListItem(server, tool))
        ),
      }),
      status: 200,
    };
  }

  if (body.method === "tools/call") {
    const { server, tool, denied } = findBundledTool(bundle, servers, body.params?.name);
    if (!tool || !server) return jsonRpcProtocolError(bundle, body.id, -32602, "Unknown bundled tool.", 400, "unknown_tool");

    const name = String(body.params?.name);
    if (denied) {
      const execution = permissionDeniedExecutionResult(tool);
      await logBundleToolExecution(bundle, server, name, tool, execution);
      return { payload: jsonRpcPayload(body.id, execution.mcpResult), status: 200 };
    }

    const args = normalizeToolArguments(body.params?.arguments);
    const inputValidation = validateToolInput(tool.input_schema ?? { type: "object", properties: {} }, args);
    if (!inputValidation.ok) {
      const execution = inputValidationFailedResult(tool, inputValidation.issues);
      await logBundleToolExecution(bundle, server, name, tool, execution);
      return { payload: jsonRpcPayload(body.id, execution.mcpResult), status: 200 };
    }

    const rateLimit = checkRuntimeRateLimit(`${bundle.id}:${name}`);
    if (!rateLimit.allowed) {
      const reason = "runtime_rate_limited";
      const audit = auditMcpSecurityEvent({
        route: "mcp_bundle",
        bundle_id: bundle.id,
        bundled_tool_name: name,
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
              tool: name,
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
      const execution = billingRequiredResult(name, tool, billing.summary);
      await logBundleToolExecution(bundle, server, name, tool, execution);
      return { payload: jsonRpcPayload(body.id, execution.mcpResult), status: 402 };
    }

    const execution = server.source_type === "preset" && (!Array.isArray(server.endpoint_map) || server.endpoint_map.length === 0)
      ? presetTemplateExecution(server, tool)
      : await executeToolFromEndpointMap(server, tool, args);
    await incrementServerCallCount(server);
    await logBundleToolExecution(bundle, server, name, tool, execution);
    return { payload: jsonRpcPayload(body.id, execution.mcpResult), status: 200 };
  }

  return jsonRpcProtocolError(bundle, body.id, -32601, "Method not found.", 404, "method_not_found");
}

export async function OPTIONS(request: Request) {
  return new NextResponse(null, { status: 204, headers: corsHeaders(request) });
}

export async function POST(request: Request, { params }: { params: { bundleId: string } }) {
  if (requestPayloadTooLarge(request)) {
    const reason = "payload_too_large";
    const audit = auditMcpSecurityEvent({
      route: "mcp_bundle",
      bundle_id: params.bundleId,
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
      route: "mcp_bundle",
      bundle_id: params.bundleId,
      reason,
      status: 400,
      content_length: request.headers.get("content-length"),
    });
    return jsonRpcError(request, null, -32700, "Invalid JSON-RPC payload.", 400, auditErrorData(audit, 400, reason));
  }

  const envelopeError = validateJsonRpcEnvelope(body);
  if (envelopeError) {
    return jsonRpcPreloadProtocolError(request, params.bundleId, envelopeError);
  }

  const loaded = await loadBundle(params.bundleId);
  if ("error" in loaded) return jsonRpcError(request, firstRequestId(body), -32004, loaded.error, 404);

  const { bundle, servers } = loaded;
  const authorized = await validateBundleApiKey(bundle, servers, getBearerToken(request));
  if (!authorized) {
    const reason = "invalid_or_missing_api_key";
    const audit = auditMcpSecurityEvent({
      route: "mcp_bundle",
      bundle_id: bundle.id,
      reason,
      status: 401,
      is_public: bundle.is_public,
    });
    return jsonRpcError(request, firstRequestId(body), -32001, "Valid Astrail API key required.", 401, auditErrorData(audit, 401, reason));
  }

  if (Array.isArray(body)) {
    const results = await Promise.all(body.map((item) => handleJsonRpcRequest(bundle, servers, item)));
    const payloads = results.map((result) => result.payload).filter((payload): payload is JsonRpcResponsePayload => Boolean(payload));
    if (payloads.length === 0) {
      return new NextResponse(null, { status: 204, headers: corsHeaders(request) });
    }
    return jsonWithCors(request, payloads);
  }

  const result = await handleJsonRpcRequest(bundle, servers, body);
  if (!result.payload) {
    return new NextResponse(null, { status: result.status, headers: corsHeaders(request) });
  }
  return jsonWithCors(request, result.payload, result.status);
}
