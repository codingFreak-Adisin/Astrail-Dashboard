import type { McpServer, McpTool, OpenApiEndpoint } from "@/lib/types";
import { assertPublicHttpUrl, assertSafeUpstreamUrl, isBlockedRuntimeHostname, NetworkPolicyError } from "@/lib/runtime/network-policy";
import { executeWebsiteReadWithPlaywright } from "@/lib/runtime/playwright-website";
import { evaluateRuntimePermission, redactSensitive, redactText, runtimePolicySummary } from "@/lib/runtime/permissions";

export type ToolExecutionStatus =
  | "success"
  | "validation_failed"
  | "auth_required"
  | "oauth_required"
  | "mapping_required"
  | "browser_runtime_required"
  | "billing_required"
  | "permission_denied"
  | "error";

export type ToolExecutionResult = {
  mcpResult: {
    content: Array<{
      type: "text";
      text: string;
    }>;
    isError?: boolean;
  };
  status: ToolExecutionStatus;
  latencyMs: number;
  method: string | null;
  path: string | null;
  executionMode: "safe_rest_execution" | "safe_rest_execution_with_auth" | "website_browser_runtime" | "metadata_catalog" | "code_mode" | "auth_required" | "oauth_required" | "mapping_required" | "browser_runtime_required" | "billing_required" | "validation_failed" | "permission_denied";
  upstreamStatus: number | null;
  traceId: string;
  attemptCount: number;
  errorCode: string | null;
  error: string | null;
};

type RequestBuildResult =
  | { url: URL; init: RequestInit }
  | { error: string; code: string };

export type RuntimeCredential = {
  scheme: "bearer" | "api_key_header" | "api_key_query" | "oauth2";
  secret: string;
  injectionName?: string | null;
};

const MAX_ARGUMENT_BYTES = 32_000;
const MAX_UPSTREAM_RESPONSE_BYTES = 1_000_000;
const REQUEST_TIMEOUT_MS = 15_000;
const MAX_ATTEMPTS = 2;
const SENSITIVE_QUERY_KEYS = /(^|_)(api_?key|access_?token|auth|authorization|bearer|client_?secret|password|refresh_?token|secret|signature|token)($|_)/i;
const MIN_EXPLICIT_SECRET_LENGTH = 6;
const MAX_EXPLICIT_REDACTION_SECRETS = 50;

function createTraceId() {
  return `agt_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

function textResult(value: unknown, isError = false): ToolExecutionResult["mcpResult"] {
  return {
    ...(isError ? { isError: true } : {}),
    content: [
      {
        type: "text",
        text: typeof value === "string" ? value : JSON.stringify(value, null, 2),
      },
    ],
  };
}

async function readResponseBody(response: Response) {
  if (!response.body) {
    const text = await response.text();
    return {
      text: text.slice(0, MAX_UPSTREAM_RESPONSE_BYTES),
      bytes: Buffer.byteLength(text),
      truncated: Buffer.byteLength(text) > MAX_UPSTREAM_RESPONSE_BYTES,
    };
  }

  const reader = response.body.getReader();
  const chunks: Buffer[] = [];
  let bytes = 0;
  let truncated = false;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;

      const chunk = Buffer.from(value);
      const remaining = MAX_UPSTREAM_RESPONSE_BYTES - bytes;
      if (chunk.byteLength > remaining) {
        if (remaining > 0) {
          chunks.push(chunk.subarray(0, remaining));
          bytes += remaining;
        }
        truncated = true;
        await reader.cancel();
        break;
      }

      chunks.push(chunk);
      bytes += chunk.byteLength;
    }
  } finally {
    reader.releaseLock();
  }

  return {
    text: Buffer.concat(chunks).toString("utf8"),
    bytes,
    truncated,
  };
}

function redactUrl(url: URL, credential: RuntimeCredential | null) {
  const redacted = new URL(url.toString());
  for (const key of Array.from(redacted.searchParams.keys())) {
    if (SENSITIVE_QUERY_KEYS.test(key)) {
      redacted.searchParams.set(key, "[redacted]");
    }
  }

  if (credential?.scheme === "api_key_query") {
    redacted.searchParams.set(credential.injectionName?.trim() || "api_key", "[redacted]");
  }

  return redacted.toString();
}

function isLocalSecuritySmokeUrl(url: URL) {
  if (process.env.ASTRAIL_ENABLE_LOCAL_SECURITY_FIXTURES !== "1") return false;
  if (!url.pathname.startsWith("/api/security-smoke/")) return false;
  const hostname = url.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1";
}

function collectSensitiveArgumentSecrets(value: unknown, inheritedSensitive = false, seen = new WeakSet<object>()): string[] {
  const secrets = new Set<string>();

  function visit(nested: unknown, sensitive: boolean) {
    if (secrets.size >= MAX_EXPLICIT_REDACTION_SECRETS) return;

    if (typeof nested === "string") {
      if (sensitive && nested.trim().length >= MIN_EXPLICIT_SECRET_LENGTH) {
        secrets.add(nested);
      }
      return;
    }

    if (!nested || typeof nested !== "object") return;
    if (seen.has(nested)) return;
    seen.add(nested);

    if (Array.isArray(nested)) {
      for (const item of nested) visit(item, sensitive);
      return;
    }

    for (const [key, item] of Object.entries(nested as Record<string, unknown>)) {
      visit(item, sensitive || SENSITIVE_QUERY_KEYS.test(key));
    }
  }

  visit(value, inheritedSensitive);
  return Array.from(secrets);
}

function parameterName(parameter: unknown) {
  if (!parameter || typeof parameter !== "object") return null;
  const name = (parameter as Record<string, unknown>).name;
  return typeof name === "string" ? name : null;
}

function parameterLocation(parameter: unknown) {
  if (!parameter || typeof parameter !== "object") return null;
  const location = (parameter as Record<string, unknown>).in;
  return typeof location === "string" ? location : null;
}

function parameterRequired(parameter: unknown) {
  return Boolean(parameter && typeof parameter === "object" && (parameter as Record<string, unknown>).required === true);
}

function toolSchemaProperties(tool: McpTool) {
  const schema = tool.input_schema;
  if (!schema || typeof schema !== "object") return {};
  const properties = schema.properties;
  return properties && typeof properties === "object" ? properties as Record<string, unknown> : {};
}

function schemaRecord(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function argumentNameForParameter(tool: McpTool, parameter: unknown) {
  const name = parameterName(parameter);
  const location = parameterLocation(parameter);
  if (!name || !location) return name;

  for (const [argumentName, schema] of Object.entries(toolSchemaProperties(tool))) {
    const record = schemaRecord(schema);
    if (record["x-astrail-name"] === name && record["x-astrail-in"] === location) {
      return argumentName;
    }
  }

  return name;
}

function coerceClientJsonValue(value: unknown, schema: unknown) {
  if (typeof value !== "string") return value;
  const record = schemaRecord(schema);
  if (!["object", "array"].includes(String(record.type ?? ""))) return value;

  try {
    return JSON.parse(value) as unknown;
  } catch {
    return value;
  }
}

function argumentValue(args: Record<string, unknown>, tool: McpTool, argumentName: string | null) {
  if (!argumentName) return undefined;
  const schema = toolSchemaProperties(tool)[argumentName];
  return coerceClientJsonValue(args[argumentName], schema);
}

export function hasSecurityRequirement(endpoint: OpenApiEndpoint) {
  if (endpoint.requires_auth === true) return true;
  const security = endpoint.security_requirements ?? endpoint.security;
  if (!security) return false;
  if (Array.isArray(security)) return security.length > 0;
  if (typeof security === "object") return Object.keys(security).length > 0;
  return Boolean(security);
}

function securityRecords(security: unknown): Array<Record<string, unknown>> {
  if (!security) return [];
  if (Array.isArray(security)) {
    return security.filter((item): item is Record<string, unknown> =>
      Boolean(item && typeof item === "object" && !Array.isArray(item))
    );
  }
  return security && typeof security === "object" && !Array.isArray(security)
    ? [security as Record<string, unknown>]
    : [];
}

export function hasOAuthSecurityRequirement(endpoint: OpenApiEndpoint) {
  const security = endpoint.security_requirements ?? endpoint.security;
  return securityRecords(security).some((record) =>
    Object.keys(record).some((name) => /oauth|openid|oidc/i.test(name))
      || Object.values(record).some((value) =>
        Array.isArray(value) && value.some((scope) => typeof scope === "string" && /oauth|openid|profile|email|offline_access/i.test(scope))
      )
  );
}

export function findEndpointForTool(server: McpServer, tool: McpTool) {
  const endpoints = Array.isArray(server.endpoint_map) ? server.endpoint_map : [];
  return endpoints.find((endpoint) => endpoint.tool_name === tool.name)
    ?? endpoints.find((endpoint) => endpoint.method === tool.method && endpoint.path === tool.path)
    ?? endpoints.find((endpoint) => endpoint.operation_id === tool.name);
}

function endpointId(endpoint: OpenApiEndpoint) {
  return endpoint.tool_name || endpoint.operation_id || `${endpoint.method} ${endpoint.path}`;
}

function buildUrl(endpoint: OpenApiEndpoint, path: string): URL | { error: string; code: string } {
  if (!endpoint.base_url) {
    return { error: "Tool validated, but live execution requires endpoint mapping.", code: "mapping_missing_base_url" };
  }

  let baseUrl: URL;
  try {
    baseUrl = new URL(endpoint.base_url);
  } catch {
    return { error: "Endpoint mapping has an invalid upstream base URL.", code: "mapping_invalid_base_url" };
  }

  const url = new URL(path.replace(/^\//, ""), baseUrl.href.endsWith("/") ? baseUrl.href : `${baseUrl.href}/`);
  if (isLocalSecuritySmokeUrl(url)) return url;

  try {
    assertPublicHttpUrl(url);
  } catch {
    return { error: "Endpoint mapping points to a blocked or unsupported upstream URL.", code: "mapping_blocked_upstream" };
  }

  return url;
}

function appendQueryValue(url: URL, name: string, value: unknown) {
  if (Array.isArray(value)) {
    for (const item of value) {
      if (item !== undefined && item !== null && item !== "") {
        url.searchParams.append(name, String(item));
      }
    }
    return;
  }

  if (value !== undefined && value !== null && value !== "") {
    url.searchParams.set(name, String(value));
  }
}

function buildBodyFromToolSchema(tool: McpTool, args: Record<string, unknown>, consumed: Set<string>) {
  const bodyEntries = Object.entries(toolSchemaProperties(tool)).filter(([, schema]) => {
    const record = schemaRecord(schema);
    return record["x-astrail-in"] === "body";
  });

  if (bodyEntries.length === 0) {
    return "body" in args
      ? args.body
      : Object.fromEntries(Object.entries(args).filter(([key]) => !consumed.has(key)));
  }

  if (bodyEntries.length === 1) {
    const [argumentName, schema] = bodyEntries[0];
    const record = schemaRecord(schema);
    if (record["x-astrail-name"] === "body") {
      consumed.add(argumentName);
      return coerceClientJsonValue(args[argumentName], schema);
    }
  }

  const body: Record<string, unknown> = {};
  for (const [argumentName, schema] of bodyEntries) {
    const record = schemaRecord(schema);
    const bodyName = typeof record["x-astrail-name"] === "string" ? record["x-astrail-name"] : argumentName;
    const value = coerceClientJsonValue(args[argumentName], schema);
    consumed.add(argumentName);
    if (value !== undefined) body[bodyName] = value;
  }

  return body;
}

function endpointRequestBodySchema(endpoint: OpenApiEndpoint) {
  const schema = endpoint.request_body_schema;
  return schema && typeof schema === "object" && !Array.isArray(schema)
    ? schema as Record<string, unknown>
    : {};
}

function buildGraphqlBody(endpoint: OpenApiEndpoint, tool: McpTool, args: Record<string, unknown>, consumed: Set<string>) {
  const schema = endpointRequestBodySchema(endpoint);
  const query = typeof schema["x-astrail-graphql-query"] === "string" ? schema["x-astrail-graphql-query"] : "";
  const operationName = typeof schema["x-astrail-graphql-operation-name"] === "string" ? schema["x-astrail-graphql-operation-name"] : endpoint.operation_id;
  const variables: Record<string, unknown> = {};

  for (const [argumentName, propertySchema] of Object.entries(toolSchemaProperties(tool))) {
    const record = schemaRecord(propertySchema);
    if (record["x-astrail-in"] !== "body") continue;
    const variableName = typeof record["x-astrail-name"] === "string" ? record["x-astrail-name"] : argumentName;
    const value = coerceClientJsonValue(args[argumentName], propertySchema);
    consumed.add(argumentName);
    if (value !== undefined) variables[variableName] = value;
  }

  return {
    query,
    operationName,
    variables,
  };
}

function buildRequest(endpoint: OpenApiEndpoint, tool: McpTool, args: Record<string, unknown>): RequestBuildResult {
  const method = endpoint.method.toUpperCase();
  if (!["GET", "POST", "PUT", "PATCH", "DELETE"].includes(method)) {
    return { error: `Live deterministic execution does not support ${method}.`, code: "method_not_supported" };
  }

  if (JSON.stringify(args).length > MAX_ARGUMENT_BYTES) {
    return { error: "Tool arguments exceed the safe runtime size limit.", code: "arguments_too_large" };
  }

  let path = endpoint.path;
  const consumed = new Set<string>();
  const params = Array.isArray(endpoint.parameters) ? endpoint.parameters : [];

  for (const parameter of params) {
    if (parameterLocation(parameter) !== "path") continue;
    const name = parameterName(parameter);
    if (!name) continue;
    const argumentName = argumentNameForParameter(tool, parameter);
    const value = argumentValue(args, tool, argumentName);
    if ((value === undefined || value === null || value === "") && parameterRequired(parameter)) {
      return { error: `Missing required path parameter: ${name}.`, code: "missing_path_parameter" };
    }
    if (argumentName) consumed.add(argumentName);
    path = path.replace(new RegExp(`\\{${name}\\}`, "g"), encodeURIComponent(String(value ?? "")));
  }

  if (path.includes("{") || path.includes("}")) {
    return { error: "Missing required path parameter for mapped endpoint.", code: "missing_path_parameter" };
  }

  const urlResult = endpoint.runtime_kind === "graphql" ? buildUrl(endpoint, "") : buildUrl(endpoint, path);
  if ("error" in urlResult) return urlResult;

  for (const parameter of params) {
    if (parameterLocation(parameter) !== "query") continue;
    const name = parameterName(parameter);
    if (!name) continue;
    const argumentName = argumentNameForParameter(tool, parameter);
    const value = argumentValue(args, tool, argumentName);
    if ((value === undefined || value === null || value === "") && parameterRequired(parameter)) {
      return { error: `Missing required query parameter: ${name}.`, code: "missing_query_parameter" };
    }
    if (argumentName) consumed.add(argumentName);
    appendQueryValue(urlResult, name, value);
  }

  const headerValues: Record<string, string> = {};
  for (const parameter of params) {
    if (parameterLocation(parameter) !== "header") continue;
    const name = parameterName(parameter);
    if (!name) continue;
    const argumentName = argumentNameForParameter(tool, parameter);
    const value = argumentValue(args, tool, argumentName);
    if ((value === undefined || value === null || value === "") && parameterRequired(parameter)) {
      return { error: `Missing required header parameter: ${name}.`, code: "missing_header_parameter" };
    }
    if (argumentName) consumed.add(argumentName);
    if (value !== undefined && value !== null && value !== "") {
      headerValues[name] = String(value);
    }
  }

  if (method === "GET") {
    for (const [name, value] of Object.entries(args)) {
      if (!consumed.has(name)) {
        appendQueryValue(urlResult, name, value);
      }
    }
  }

  const init: RequestInit = {
    method,
    headers: {
      accept: "application/json, text/plain, */*",
      ...headerValues,
    },
    redirect: "manual",
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  };

  if (["POST", "PUT", "PATCH", "DELETE"].includes(method)) {
    const body = endpoint.runtime_kind === "graphql"
      ? buildGraphqlBody(endpoint, tool, args, consumed)
      : buildBodyFromToolSchema(tool, args, consumed);
    init.body = JSON.stringify(body);
    init.headers = {
      ...init.headers,
      "content-type": "application/json",
    };
  }

  return { url: urlResult, init };
}

function buildBrowserUrl(endpoint: OpenApiEndpoint, tool: McpTool, args: Record<string, unknown>) {
  const target = endpoint.target_url;
  if (!target) {
    return { error: "This browser workflow needs an isolated browser runtime because no static target URL is mapped.", code: "browser_target_missing" };
  }

  let url: URL;
  try {
    url = new URL(target);
  } catch {
    return { error: "Browser workflow has an invalid target URL.", code: "browser_target_invalid" };
  }

  if (!["http:", "https:"].includes(url.protocol) || isBlockedRuntimeHostname(url.hostname)) {
    return { error: "Browser workflow points to a blocked or unsupported target URL.", code: "browser_target_blocked" };
  }

  if (endpoint.browser_action === "submit_form") {
    const formMethod = typeof endpoint.request_body === "object" && endpoint.request_body
      ? String((endpoint.request_body as Record<string, unknown>).method ?? "GET").toUpperCase()
      : "GET";
    if (formMethod !== "GET") {
      return { error: "POST form execution requires an isolated browser runtime and user review.", code: "browser_post_form_requires_runtime" };
    }
    for (const parameter of Array.isArray(endpoint.parameters) ? endpoint.parameters : []) {
      const name = parameterName(parameter);
      if (!name || name === "instruction") continue;
      const argumentName = argumentNameForParameter(tool, parameter);
      const value = argumentValue(args, tool, argumentName);
      if (value !== undefined && value !== null && value !== "") {
        url.searchParams.set(name, String(value));
      }
    }
  }

  return { url };
}

async function executeBrowserWorkflow(
  endpoint: OpenApiEndpoint,
  tool: McpTool,
  args: Record<string, unknown>,
  startedAt: number,
  traceId: string
): Promise<ToolExecutionResult> {
  if (!["open_page", "follow_link", "submit_form"].includes(endpoint.browser_action ?? "")) {
    return executionResult({
      status: "browser_runtime_required",
      tool: tool.name,
      trace_id: traceId,
      error_code: "browser_runtime_required",
      action: endpoint.browser_action ?? "unknown",
      selector: endpoint.selector ?? null,
      target_url: endpoint.target_url ?? null,
      note: "This website workflow needs an isolated Playwright runtime because it depends on an interactive browser action.",
    }, "browser_runtime_required", endpoint, startedAt, traceId, "browser_runtime_required", null, null, 0, "browser_runtime_required");
  }

  const target = buildBrowserUrl(endpoint, tool, args);
  if ("error" in target) {
    return executionResult({
      status: "browser_runtime_required",
      tool: tool.name,
      trace_id: traceId,
      error_code: target.code,
      action: endpoint.browser_action,
      selector: endpoint.selector ?? null,
      target_url: endpoint.target_url ?? null,
      note: target.error,
    }, "browser_runtime_required", endpoint, startedAt, traceId, "browser_runtime_required", target.error, null, 0, target.code);
  }

  try {
    const execution = await executeWebsiteReadWithPlaywright(target.url.toString(), traceId, [
      `tool:${tool.name}`,
      `action:${endpoint.browser_action ?? "unknown"}`,
      endpoint.selector ? `selector:${endpoint.selector}` : "selector:none",
    ]);
    return executionResult({
      status: "success",
      tool: tool.name,
      trace_id: traceId,
      action: endpoint.browser_action,
      selector: endpoint.selector ?? null,
      request: {
        method: "PLAYWRIGHT",
        url: target.url.toString(),
        attempt: 1,
      },
      response: {
        status: execution.status,
        final_url: execution.finalUrl,
        title: execution.title,
        text_preview: execution.visibleTextPreview,
        screenshot: execution.screenshotPath,
      },
      action_history: execution.actionHistory,
      note: "Executed with Astrail's Playwright-backed website runtime. Auth, sessions, and complex workflows still require sandbox review.",
    }, "success", endpoint, startedAt, traceId, "website_browser_runtime", null, execution.status, 1, null);
  } catch (error) {
    const message = redactText(error instanceof Error ? error.message : "Unknown website runtime error");
    return executionResult({
      status: "error",
      tool: tool.name,
      trace_id: traceId,
      error_code: message.toLowerCase().includes("timeout") ? "browser_runtime_timeout" : "browser_runtime_fetch_error",
      error: message,
    }, "error", endpoint, startedAt, traceId, "website_browser_runtime", message, null, 1, message.toLowerCase().includes("timeout") ? "browser_runtime_timeout" : "browser_runtime_fetch_error");
  }
}

function injectCredential(request: { url: URL; init: RequestInit }, credential: RuntimeCredential | null) {
  if (!credential) return;

  if (credential.scheme === "bearer" || credential.scheme === "oauth2") {
    request.init.headers = {
      ...request.init.headers,
      authorization: `Bearer ${credential.secret}`,
    };
    return;
  }

  const name = credential.injectionName?.trim() || "api_key";
  if (credential.scheme === "api_key_header") {
    request.init.headers = {
      ...request.init.headers,
      [name]: credential.secret,
    };
    return;
  }

  request.url.searchParams.set(name, credential.secret);
}

function executionResult(
  value: unknown,
  status: ToolExecutionStatus,
  endpoint: OpenApiEndpoint | null,
  startedAt: number,
  traceId: string,
  executionModeOverride: ToolExecutionResult["executionMode"] | null = null,
  error: string | null = null,
  upstreamStatus: number | null = null,
  attemptCount = 0,
  errorCode: string | null = null
): ToolExecutionResult {
  const latencyMs = Date.now() - startedAt;
  const executionMode = executionModeOverride ?? (status === "success" || status === "error" ? "safe_rest_execution" : status);
  const responseValue = normalizeExecutionPayload(value, {
    execution_mode: executionMode,
    latency_ms: latencyMs,
    timestamp: new Date().toISOString(),
    trace_id: traceId,
    attempt_count: attemptCount,
    error_code: errorCode,
  });

  return {
    mcpResult: textResult(responseValue, status !== "success"),
    status,
    latencyMs,
    method: endpoint?.method ?? null,
    path: endpoint?.path ?? null,
    executionMode,
    upstreamStatus,
    traceId,
    attemptCount,
    errorCode,
    error,
  };
}

function permissionDeniedResult(
  server: McpServer,
  tool: McpTool,
  endpoint: OpenApiEndpoint,
  decision: Exclude<ReturnType<typeof evaluateRuntimePermission>, { allowed: true }>,
  startedAt: number,
  traceId: string,
  sdkMethod: string | null = null
): ToolExecutionResult {
  return executionResult({
    status: "permission_denied",
    error_code: decision.code,
    trace_id: traceId,
    tool: tool.name,
    endpoint_id: endpointId(endpoint),
    sdk_method: sdkMethod,
    method: endpoint.method,
    path: endpoint.path,
    reason: decision.reason,
    matched: decision.matched
      ? {
          pattern: decision.matched,
          field: decision.matchedField,
        }
      : null,
    policy: runtimePolicySummary(server.runtime_policy),
    note: "Astrail denied this call before upstream execution. Runtime permissions are operational guardrails, not a security boundary; keep provider credentials scoped to the least privilege needed.",
  }, "permission_denied", endpoint, startedAt, traceId, "permission_denied", decision.reason, null, 0, decision.code);
}

function normalizeExecutionPayload(
  value: unknown,
  runtime: {
    execution_mode: ToolExecutionResult["executionMode"];
    latency_ms: number;
    timestamp: string;
    trace_id: string;
    attempt_count: number;
    error_code: string | null;
  }
) {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return {
      ...(value as Record<string, unknown>),
      runtime,
    };
  }

  return {
    status: "success",
    value,
    runtime,
  };
}

export async function executeToolFromEndpointMap(
  server: McpServer,
  tool: McpTool,
  args: Record<string, unknown>,
  options: { credential?: RuntimeCredential | null; sdkMethod?: string | null; traceId?: string | null } = {}
): Promise<ToolExecutionResult> {
  const startedAt = Date.now();
  const traceId = options.traceId ?? createTraceId();
  const endpoint = findEndpointForTool(server, tool);

  if (!endpoint) {
    return executionResult({
      status: "mapping_required",
      tool: tool.name,
      trace_id: traceId,
      error_code: "mapping_missing_endpoint",
      note: "Tool validated, but live execution requires endpoint mapping.",
    }, "mapping_required", null, startedAt, traceId, "mapping_required", null, null, 0, "mapping_missing_endpoint");
  }

  if (endpoint.runtime_kind === "browser" || endpoint.method.toUpperCase() === "BROWSER") {
    return executeBrowserWorkflow(endpoint, tool, args, startedAt, traceId);
  }

  const permission = evaluateRuntimePermission(server.runtime_policy, endpoint, tool, {
    sdkMethod: options.sdkMethod ?? null,
  });
  if (!permission.allowed) {
    return permissionDeniedResult(server, tool, endpoint, permission, startedAt, traceId, options.sdkMethod ?? null);
  }

  const requiresAuth = hasSecurityRequirement(endpoint);
  const requiresOAuth = hasOAuthSecurityRequirement(endpoint);
  if (requiresAuth && !options.credential) {
    if (requiresOAuth) {
      return executionResult({
        status: "oauth_required",
        tool: tool.name,
        trace_id: traceId,
        error_code: "oauth_required",
        method: endpoint.method,
        path: endpoint.path,
        setup: {
          credential_type: "oauth2",
          attach_endpoint: "/api/credentials",
          required_fields: ["server_id", "provider", "auth_scheme=oauth2", "access_token"],
          optional_fields: ["client_id", "client_secret", "refresh_token", "token_url", "expires_at", "scopes"],
        },
        note: "Tool validated, but live execution requires an OAuth token vault entry. Attach an OAuth credential with an access token and refresh token before retrying tools/call.",
      }, "oauth_required", endpoint, startedAt, traceId, "oauth_required", null, null, 0, "oauth_required");
    }

    return executionResult({
      status: "auth_required",
      tool: tool.name,
      trace_id: traceId,
      error_code: "auth_required",
      method: endpoint.method,
      path: endpoint.path,
      note: "Tool validated, but live execution requires auth configuration.",
    }, "auth_required", endpoint, startedAt, traceId, "auth_required", null, null, 0, "auth_required");
  }

  const request = buildRequest(endpoint, tool, args);
  if ("error" in request) {
    const blocked = request.code.includes("blocked");
    return executionResult({
      status: blocked ? "permission_denied" : "mapping_required",
      tool: tool.name,
      trace_id: traceId,
      error_code: blocked ? "upstream_url_blocked" : request.code,
      method: endpoint.method,
      path: endpoint.path,
      note: request.error,
    }, blocked ? "permission_denied" : "mapping_required", endpoint, startedAt, traceId, blocked ? "permission_denied" : "mapping_required", request.error, null, 0, blocked ? "upstream_url_blocked" : request.code);
  }

  injectCredential(request, options.credential ?? null);
  if (!isLocalSecuritySmokeUrl(request.url)) {
    try {
      await assertSafeUpstreamUrl(request.url);
    } catch (error) {
      const policyError = error instanceof NetworkPolicyError ? error : new NetworkPolicyError("Upstream URL is blocked by runtime network policy.");
      return executionResult({
        status: "permission_denied",
        error_code: policyError.code,
        trace_id: traceId,
        tool: tool.name,
        endpoint_id: endpointId(endpoint),
        method: endpoint.method,
        path: endpoint.path,
        reason: policyError.message,
        note: "Astrail denied this call before upstream execution because the target URL is not a public HTTP(S) endpoint.",
      }, "permission_denied", endpoint, startedAt, traceId, "permission_denied", policyError.message, null, 0, policyError.code);
    }
  }

  const executionMode = requiresAuth ? "safe_rest_execution_with_auth" : "safe_rest_execution";
  const attempts = endpoint.method.toUpperCase() === "GET" ? MAX_ATTEMPTS : 1;
  const redactionSecrets = Array.from(new Set([
    ...(options.credential?.secret ? [options.credential.secret] : []),
    ...collectSensitiveArgumentSecrets(args),
  ]));
  let lastError: string | null = null;
  let lastErrorCode: string | null = null;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const response = await fetch(request.url, {
        ...request.init,
        headers: {
          ...request.init.headers,
          "x-astrail-trace-id": traceId,
        },
      });
      const responseBody = await readResponseBody(response);
      let parsedBody: unknown = responseBody.text;
      try {
        parsedBody = responseBody.text ? JSON.parse(responseBody.text) : null;
      } catch {
        parsedBody = responseBody.text;
      }
      parsedBody = redactSensitive(parsedBody, redactionSecrets);

      return executionResult({
        status: response.ok ? "success" : "error",
        tool: tool.name,
        trace_id: traceId,
        request: {
          method: endpoint.method,
          url: redactUrl(request.url, options.credential ?? null),
          attempt,
        },
        response: {
          status: response.status,
          headers: {
            content_type: response.headers.get("content-type"),
          },
          body: parsedBody,
          body_bytes: responseBody.bytes,
          body_truncated: responseBody.truncated,
        },
      }, response.ok ? "success" : "error", endpoint, startedAt, traceId, executionMode, response.ok ? null : `HTTP ${response.status}`, response.status, attempt, response.ok ? null : "upstream_http_error");
    } catch (error) {
      const message = redactText(error instanceof Error ? error.message : "Unknown upstream request error", redactionSecrets);
      lastError = message;
      lastErrorCode = message.toLowerCase().includes("timeout") ? "upstream_timeout" : "upstream_fetch_error";
      if (attempt === attempts) {
        return executionResult({
          status: "error",
          tool: tool.name,
          trace_id: traceId,
          error_code: lastErrorCode,
          request: {
            method: endpoint.method,
            path: endpoint.path,
            attempt,
          },
          error: message,
        }, "error", endpoint, startedAt, traceId, executionMode, message, null, attempt, lastErrorCode);
      }
    }
  }

  return executionResult({
    status: "error",
    tool: tool.name,
    trace_id: traceId,
    error_code: lastErrorCode ?? "upstream_fetch_error",
    error: lastError ?? "Unknown upstream request error",
  }, "error", endpoint, startedAt, traceId, executionMode, lastError, null, attempts, lastErrorCode ?? "upstream_fetch_error");
}
