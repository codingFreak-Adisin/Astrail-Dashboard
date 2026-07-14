import type { McpServer, McpTool, OpenApiEndpoint, RuntimePermissionPattern, RuntimePermissionPolicy } from "../types";

export type RuntimePermissionContext = {
  sdkMethod?: string | null;
};

export type RuntimePermissionDecision =
  | { allowed: true }
  | {
      allowed: false;
      code: "runtime_permission_denied";
      reason: string;
      matched: string | null;
      matchedField: string | null;
    };

const READ_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);
const PUBLIC_META_TOOLS = new Set([
  "search_docs",
  "list_api_endpoints",
  "get_api_endpoint_schema",
  "invoke_api_endpoint",
  "execute",
]);
const SENSITIVE_KEYS = /(^|_|\b)(api_?key|access_?token|authorization|bearer|client_?secret|credential|password|refresh_?token|secret|signature|token)($|_|\b)/i;
const BEARER_PATTERN = /Bearer\s+[A-Za-z0-9._~+/=-]+/gi;
const ASSIGNMENT_PATTERN = /\b(api_?key|access_?token|authorization|bearer|client_?secret|password|refresh_?token|secret|token)=([^&\s"'`]+)/gi;

function endpointId(endpoint: OpenApiEndpoint) {
  return endpoint.tool_name || endpoint.operation_id || `${endpoint.method} ${endpoint.path}`;
}

function record(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function visibility(value: unknown) {
  return value === "public" || value === "private" ? value : null;
}

function toolVisibility(tool: McpTool) {
  return visibility(tool.visibility)
    ?? visibility(tool.x_astrail?.visibility)
    ?? visibility(record(tool.metadata).visibility);
}

function endpointMatchesTool(endpoint: OpenApiEndpoint, tool: McpTool) {
  const ids = new Set([
    endpointId(endpoint),
    endpoint.tool_name,
    endpoint.operation_id,
  ].filter((value): value is string => typeof value === "string" && value.length > 0));

  if (ids.has(tool.name)) return true;
  return Boolean(tool.method && tool.path
    && tool.method.toUpperCase() === endpoint.method.toUpperCase()
    && tool.path === endpoint.path);
}

export function endpointRequiresAuth(endpoint: OpenApiEndpoint) {
  if (endpoint.requires_auth === true) return true;
  const security = endpoint.security_requirements ?? endpoint.security;
  if (!security) return false;
  if (Array.isArray(security)) return security.length > 0;
  if (typeof security === "object") return Object.keys(security).length > 0;
  return Boolean(security);
}

export function endpointOperationKind(endpoint: OpenApiEndpoint) {
  if (endpoint.operation_kind) return endpoint.operation_kind;
  const method = endpoint.method.toUpperCase();
  if (method === "GET" || method === "HEAD" || method === "OPTIONS" || method === "BROWSER") return "read";
  if (method === "DELETE") return "destructive";
  return "write";
}

export function isPublicEndpoint(endpoint: OpenApiEndpoint) {
  const endpointVisibility = visibility(endpoint.visibility);
  if (endpointVisibility === "private") return false;
  if (endpointRequiresAuth(endpoint)) return false;

  const method = endpoint.method.toUpperCase();
  const readMethod = ["GET", "HEAD", "OPTIONS", "BROWSER"].includes(method);
  return endpointOperationKind(endpoint) === "read" && readMethod;
}

export function visibleEndpointsForRequest(server: McpServer) {
  const endpoints = Array.isArray(server.endpoint_map) ? server.endpoint_map : [];
  const visible = endpoints.filter((endpoint) => endpoint.method.toUpperCase() !== "ASTRAIL_META");
  if (!server.is_public) return visible;

  const tools = Array.isArray(server.tools_json) ? server.tools_json : [];
  return visible.filter((endpoint) => {
    if (!isPublicEndpoint(endpoint)) return false;
    return !tools.some((tool) => endpointMatchesTool(endpoint, tool) && toolVisibility(tool) === "private");
  });
}

export function isToolIntentionallyPublic(server: McpServer, tool: McpTool, endpoint?: OpenApiEndpoint | null) {
  if (toolVisibility(tool) === "private") return false;

  const method = tool.method?.toUpperCase();
  if (method === "ASTRAIL_META" || method === "ASTRAIL_CODE") {
    return PUBLIC_META_TOOLS.has(tool.name) && visibleEndpointsForRequest(server).length > 0;
  }

  if (!endpoint) return false;
  return isPublicEndpoint(endpoint);
}

export function visibleToolsForRequest(
  server: McpServer,
  tools: McpTool[],
  findEndpoint: (server: McpServer, tool: McpTool) => OpenApiEndpoint | undefined
) {
  if (!server.is_public) return tools;
  return tools.filter((tool) => isToolIntentionallyPublic(server, tool, findEndpoint(server, tool)));
}

export function redactText(input: string, explicitSecrets: string[] = []) {
  let output = input;
  for (const secret of explicitSecrets) {
    if (secret) output = output.split(secret).join("[redacted]");
  }
  return output
    .replace(BEARER_PATTERN, "Bearer [redacted]")
    .replace(ASSIGNMENT_PATTERN, (_match, key) => `${key}=[redacted]`);
}

export function redactSensitive<T>(value: T, explicitSecrets: string[] = [], seen = new WeakSet<object>()): T {
  if (typeof value === "string") return redactText(value, explicitSecrets) as T;
  if (!value || typeof value !== "object") return value;
  if (seen.has(value)) return "[redacted]" as T;
  seen.add(value);

  if (Array.isArray(value)) {
    return value.map((item) => redactSensitive(item, explicitSecrets, seen)) as T;
  }

  const output: Record<string, unknown> = {};
  for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
    output[key] = SENSITIVE_KEYS.test(key)
      ? "[redacted]"
      : redactSensitive(nested, explicitSecrets, seen);
  }
  return output as T;
}

function fieldValues(endpoint: OpenApiEndpoint, tool: McpTool, context: RuntimePermissionContext) {
  const httpMethod = endpoint.method.toUpperCase();
  const resource = endpoint.resource?.trim() || endpoint.tags?.[0]?.trim() || null;
  const sdkMethod = context.sdkMethod?.trim() || null;

  return {
    sdk_method: [sdkMethod, sdkMethod ? `client.${sdkMethod.replace(/^client\./, "")}` : null].filter(Boolean) as string[],
    endpoint_id: [endpointId(endpoint)].filter(Boolean),
    tool_name: [tool.name].filter(Boolean),
    operation_id: [endpoint.operation_id].filter(Boolean) as string[],
    method_path: [`${httpMethod} ${endpoint.path}`],
    resource: [resource].filter(Boolean) as string[],
    tag: endpoint.tags ?? [],
    path: [endpoint.path],
    http_method: [httpMethod],
  };
}

function allValues(endpoint: OpenApiEndpoint, tool: McpTool, context: RuntimePermissionContext) {
  const values = fieldValues(endpoint, tool, context);
  return Object.entries(values).flatMap(([field, entries]) =>
    entries.map((value) => ({ field, value }))
  );
}

function patternText(pattern: RuntimePermissionPattern) {
  return typeof pattern === "string" ? pattern : pattern.pattern;
}

function isRegexPattern(pattern: RuntimePermissionPattern) {
  return typeof pattern === "object" && pattern.regex === true;
}

function targetField(pattern: RuntimePermissionPattern) {
  return typeof pattern === "object" ? pattern.match : undefined;
}

function matchesPattern(pattern: RuntimePermissionPattern, candidates: Array<{ field: string; value: string }>) {
  const expected = patternText(pattern).trim();
  if (!expected) return null;
  const field = targetField(pattern);
  const scoped = field ? candidates.filter((candidate) => candidate.field === field) : candidates;
  const regex = isRegexPattern(pattern);

  for (const candidate of scoped) {
    if (regex) {
      try {
        if (new RegExp(expected, "i").test(candidate.value)) return candidate;
      } catch {
        return null;
      }
      continue;
    }

    if (candidate.value.toLowerCase() === expected.toLowerCase()) return candidate;
  }

  return null;
}

function firstMatch(patterns: RuntimePermissionPattern[] | undefined, candidates: Array<{ field: string; value: string }>) {
  for (const pattern of patterns ?? []) {
    const match = matchesPattern(pattern, candidates);
    if (match) {
      return {
        pattern: patternText(pattern),
        field: match.field,
      };
    }
  }
  return null;
}

function isRead(endpoint: OpenApiEndpoint, policy: RuntimePermissionPolicy) {
  if (endpoint.operation_kind === "read") return true;
  if (policy.allow_http_gets !== false && READ_METHODS.has(endpoint.method.toUpperCase())) return true;
  return false;
}

function denied(reason: string, match: { pattern: string; field: string } | null): RuntimePermissionDecision {
  return {
    allowed: false,
    code: "runtime_permission_denied",
    reason,
    matched: match?.pattern ?? null,
    matchedField: match?.field ?? null,
  };
}

export function evaluateRuntimePermission(
  policy: RuntimePermissionPolicy | null | undefined,
  endpoint: OpenApiEndpoint,
  tool: McpTool,
  context: RuntimePermissionContext = {}
): RuntimePermissionDecision {
  if (!policy) return { allowed: true };

  const values = allValues(endpoint, tool, context);
  const methodBlock = firstMatch(policy.blocked_methods, values);
  if (methodBlock) return denied("blocked_methods matched this SDK method or endpoint.", methodBlock);

  const resourceValues = fieldValues(endpoint, tool, context);
  const resourceCandidates = [
    ...resourceValues.resource.map((value) => ({ field: "resource", value })),
    ...resourceValues.tag.map((value) => ({ field: "tag", value })),
    ...resourceValues.path.map((value) => ({ field: "path", value })),
  ];
  const resourceBlock = firstMatch(policy.blocked_resources, resourceCandidates);
  if (resourceBlock) return denied("blocked_resources matched this endpoint resource.", resourceBlock);

  if (policy.read_only && !isRead(endpoint, policy)) {
    return denied("read_only runtime policy blocks non-read endpoint execution.", null);
  }

  const allowedResources = policy.allowed_resources ?? [];
  if (allowedResources.length > 0 && !firstMatch(allowedResources, resourceCandidates)) {
    return denied("allowed_resources did not match this endpoint resource.", null);
  }

  const allowedMethods = policy.allowed_methods ?? [];
  if (allowedMethods.length > 0 && !firstMatch(allowedMethods, values)) {
    if (policy.allow_http_gets === true && READ_METHODS.has(endpoint.method.toUpperCase())) {
      return { allowed: true };
    }
    return denied("allowed_methods did not match this SDK method or endpoint.", null);
  }

  if (policy.allow_http_gets === false && READ_METHODS.has(endpoint.method.toUpperCase()) && allowedMethods.length === 0) {
    return denied("allow_http_gets is false and no allowed_methods override matched.", null);
  }

  return { allowed: true };
}

export function runtimePolicySummary(policy: RuntimePermissionPolicy | null | undefined) {
  if (!policy) return null;
  return {
    allow_http_gets: policy.allow_http_gets ?? true,
    read_only: Boolean(policy.read_only),
    allowed_methods: policy.allowed_methods ?? [],
    blocked_methods: policy.blocked_methods ?? [],
    allowed_resources: policy.allowed_resources ?? [],
    blocked_resources: policy.blocked_resources ?? [],
    note: "Astrail runtime policy is an operational guardrail, not a security boundary. Use least-privilege provider credentials and upstream scopes for real authorization.",
  };
}
