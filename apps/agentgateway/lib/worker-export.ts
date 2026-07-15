import type { McpServer } from "@/lib/types";

type WorkerBundleFile = {
  path: string;
  content: string;
};

export type WorkerBundle = {
  serverId: string;
  serverName: string;
  runtime: "cloudflare-worker-template";
  deploymentMode: "manual_export";
  files: WorkerBundleFile[];
};

function workerName(name: string) {
  return name.toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 48) || "astrail-mcp";
}

function json(value: unknown) {
  return JSON.stringify(value, null, 2);
}

export function buildWorkerBundle(server: McpServer): WorkerBundle {
  const name = workerName(server.name);
  const tools = server.tools_json ?? [];
  const endpointMap = server.endpoint_map ?? [];

  const workerSource = `type JsonRpcRequest = {
  id?: string | number | null;
  method?: string;
  params?: {
    name?: string;
    arguments?: Record<string, unknown>;
  };
};

const SERVER = ${json({
  id: server.id,
  name: server.name,
  description: server.description,
  protocolVersion: server.protocol_version ?? "2024-11-05",
})};

const TOOLS = ${json(tools)};
const ENDPOINT_MAP = ${json(endpointMap)};

function traceId() {
  return \`agt_\${Date.now().toString(36)}_\${crypto.randomUUID().slice(0, 8)}\`;
}

function jsonRpc(id: JsonRpcRequest["id"], result: unknown, status = 200) {
  return Response.json({ jsonrpc: "2.0", id: id ?? null, result }, { status });
}

function jsonRpcError(id: JsonRpcRequest["id"], code: number, message: string, status = 400) {
  return Response.json({ jsonrpc: "2.0", id: id ?? null, error: { code, message } }, { status });
}

function hasSecurityRequirement(endpoint: Record<string, unknown>) {
  if (endpoint.requires_auth === true) return true;
  const security = endpoint.security_requirements ?? endpoint.security;
  if (!security) return false;
  if (Array.isArray(security)) return security.length > 0;
  if (typeof security === "object") return Object.keys(security).length > 0;
  return Boolean(security);
}

function endpointId(endpoint: Record<string, unknown>) {
  return String(endpoint.tool_name || endpoint.operation_id || \`\${endpoint.method} \${endpoint.path}\`);
}

function catalogEndpoints() {
  return ENDPOINT_MAP.filter((endpoint: Record<string, unknown>) => String(endpoint.method).toUpperCase() !== "ASTRAIL_META");
}

function endpointCatalogItem(endpoint: Record<string, unknown>) {
  return {
    endpoint_id: endpointId(endpoint),
    method: endpoint.method,
    path: endpoint.path,
    operation_id: endpoint.operation_id ?? null,
    summary: endpoint.summary ?? null,
    description: endpoint.description ?? null,
    resource: endpoint.resource ?? null,
    tags: endpoint.tags ?? [],
    operation: endpoint.operation_kind ?? null,
    requires_auth: hasSecurityRequirement(endpoint),
  };
}

function findCatalogEndpoint(id: unknown) {
  if (typeof id !== "string" || !id.trim()) return null;
  const normalized = id.trim().toLowerCase();
  return catalogEndpoints().find((endpoint: Record<string, unknown>) =>
    endpointId(endpoint).toLowerCase() === normalized
    || String(endpoint.tool_name ?? "").toLowerCase() === normalized
    || String(endpoint.operation_id ?? "").toLowerCase() === normalized
    || \`\${endpoint.method} \${endpoint.path}\`.toLowerCase() === normalized
  ) ?? null;
}

function listApiEndpoints(args: Record<string, unknown>) {
  const query = typeof args.query === "string" ? args.query.toLowerCase().trim() : "";
  const resource = typeof args.resource === "string" ? args.resource.toLowerCase().trim() : "";
  const tag = typeof args.tag === "string" ? args.tag.toLowerCase().trim() : "";
  const operation = typeof args.operation === "string" ? args.operation.toLowerCase().trim() : "";
  const method = typeof args.method === "string" ? args.method.toUpperCase().trim() : "";
  const limit = Math.max(1, Math.min(Number(args.limit ?? 20) || 20, 50));
  const matches = catalogEndpoints().filter((endpoint: Record<string, unknown>) => {
    const search = [
      endpointId(endpoint),
      endpoint.method,
      endpoint.path,
      endpoint.summary,
      endpoint.description,
      endpoint.resource,
      ...(Array.isArray(endpoint.tags) ? endpoint.tags : []),
    ].filter(Boolean).join(" ").toLowerCase();
    if (query && !search.includes(query)) return false;
    if (resource && String(endpoint.resource ?? "default").toLowerCase() !== resource) return false;
    if (tag && !(Array.isArray(endpoint.tags) ? endpoint.tags : []).some((item) => String(item).toLowerCase() === tag)) return false;
    if (operation && endpoint.operation_kind !== operation) return false;
    if (method && String(endpoint.method).toUpperCase() !== method) return false;
    return true;
  });

  return {
    status: "success",
    total_matches: matches.length,
    returned: Math.min(matches.length, limit),
    endpoints: matches.slice(0, limit).map(endpointCatalogItem),
    next_step: "Call get_api_endpoint_schema with endpoint_id before invoke_api_endpoint.",
  };
}

function getApiEndpointSchema(args: Record<string, unknown>) {
  const endpoint = findCatalogEndpoint(args.endpoint_id);
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
    input_schema: endpoint.input_schema ?? { type: "object", properties: {} },
    parameters: endpoint.parameters ?? [],
    request_body: endpoint.request_body ?? null,
    response_hints: endpoint.response_hints ?? null,
    security: endpoint.security_requirements ?? endpoint.security ?? null,
  };
}

function camelCase(value: string) {
  const parts = value.replace(/([a-z0-9])([A-Z])/g, "$1 $2").replace(/[^a-zA-Z0-9]+/g, " ").trim().split(/\\s+/).filter(Boolean);
  if (parts.length === 0) return "api";
  return parts.map((part, index) => {
    const lower = part.toLowerCase();
    return index === 0 ? lower : lower.charAt(0).toUpperCase() + lower.slice(1);
  }).join("");
}

function sdkResource(endpoint: Record<string, unknown>) {
  const tags = Array.isArray(endpoint.tags) ? endpoint.tags : [];
  const firstPath = String(endpoint.path ?? "").split("/").find((part) => part && !part.startsWith("{"));
  return camelCase(String(endpoint.resource || tags[0] || firstPath || "api"));
}

function sdkMethod(endpoint: Record<string, unknown>) {
  if (endpoint.operation_id) return camelCase(String(endpoint.operation_id));
  const method = String(endpoint.method ?? "GET").toUpperCase();
  const operation = endpoint.operation_kind;
  const leaf = String(endpoint.path ?? "resource").split("/").filter((part) => part && !part.startsWith("{")).pop() || "resource";
  const verb = operation === "read" ? String(endpoint.path ?? "").includes("{") ? "get" : "list" : operation === "destructive" ? "delete" : method === "POST" ? "create" : "update";
  return camelCase(verb + " " + leaf);
}

function exampleArgumentsFromSchema(schema: unknown) {
  if (!schema || typeof schema !== "object") return {};
  const record = schema as Record<string, unknown>;
  const properties = record.properties && typeof record.properties === "object" ? record.properties as Record<string, unknown> : {};
  const args: Record<string, unknown> = {};
  for (const [name, property] of Object.entries(properties).slice(0, 5)) {
    const prop = property && typeof property === "object" ? property as Record<string, unknown> : {};
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

function sdkDocForEndpoint(endpoint: Record<string, unknown>) {
  const resource = sdkResource(endpoint);
  const method = sdkMethod(endpoint);
  const exampleArgs = exampleArgumentsFromSchema(endpoint.input_schema);
  return {
    sdk_method: "client." + resource + "." + method,
    endpoint_id: endpointId(endpoint),
    method: endpoint.method,
    path: endpoint.path,
    resource,
    operation: endpoint.operation_kind ?? null,
    summary: endpoint.summary ?? null,
    description: endpoint.description ?? null,
    requires_auth: hasSecurityRequirement(endpoint),
    tags: endpoint.tags ?? [],
    input_schema: endpoint.input_schema ?? { type: "object", properties: {} },
    response_hints: endpoint.response_hints ?? null,
    example: "const result = await client." + resource + "." + method + "(" + JSON.stringify(exampleArgs, null, 2) + ");",
  };
}

function searchDocs(args: Record<string, unknown>) {
  const query = typeof args.query === "string" ? args.query.toLowerCase().trim() : "";
  const resource = typeof args.resource === "string" ? camelCase(args.resource).toLowerCase() : "";
  const operation = typeof args.operation === "string" ? args.operation.toLowerCase().trim() : "";
  const limit = Math.max(1, Math.min(Number(args.limit ?? 8) || 8, 20));
  const matches = catalogEndpoints().filter((endpoint: Record<string, unknown>) => {
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
      ...(Array.isArray(doc.tags) ? doc.tags : []),
    ].filter(Boolean).join(" ").toLowerCase();
    if (query && !search.includes(query)) return false;
    if (resource && doc.resource.toLowerCase() !== resource) return false;
    if (operation && doc.operation !== operation) return false;
    return true;
  });

  return {
    status: "success",
    mode: "astrail_code_mode",
    total_matches: matches.length,
    returned: Math.min(matches.length, limit),
    docs: matches.slice(0, limit).map(sdkDocForEndpoint),
    execute_contract: {
      supported_call_shapes: [
        "await client.resource.method({ jsonCompatible: true })",
        "for await (const item of client.resource.list({ jsonCompatible: true })) { ... }",
      ],
      batching: "Hosted Astrail can compile independent read calls in one execute request and run them in parallel.",
      note: "Exported template does not eval arbitrary JavaScript. Wire reviewed execution policy before enabling upstream execute.",
    },
  };
}

async function executeTool(name: string, args: Record<string, unknown>) {
  const trace_id = traceId();
  if (name === "search_docs") {
    return { content: [{ type: "text", text: JSON.stringify({ ...searchDocs(args), trace_id }, null, 2) }] };
  }
  if (name === "execute") {
    return { content: [{ type: "text", text: JSON.stringify({
      status: "mapping_required",
      mode: "astrail_code_mode",
      trace_id,
      error_code: "worker_code_execution_review_required",
      note: "Code Mode docs are exported. Enable execute only after reviewing credentials, sandbox policy, and deterministic endpoint execution in this Worker."
    }, null, 2) }] };
  }
  if (name === "list_api_endpoints") {
    return { content: [{ type: "text", text: JSON.stringify({ ...listApiEndpoints(args), trace_id }, null, 2) }] };
  }
  if (name === "get_api_endpoint_schema") {
    return { content: [{ type: "text", text: JSON.stringify({ ...getApiEndpointSchema(args), trace_id }, null, 2) }] };
  }
  if (name === "invoke_api_endpoint") {
    const endpoint = findCatalogEndpoint(args.endpoint_id);
    if (!endpoint) {
      return { content: [{ type: "text", text: JSON.stringify({
        status: "mapping_required",
        trace_id,
        error_code: "endpoint_not_found",
        endpoint_id: args.endpoint_id ?? null,
        note: "Use list_api_endpoints to find a valid endpoint_id."
      }, null, 2) }] };
    }
    return { content: [{ type: "text", text: JSON.stringify({
      status: "mapping_required",
      trace_id,
      error_code: "worker_execution_review_required",
      endpoint: endpointCatalogItem(endpoint),
      note: "Dynamic endpoint identified. Review credentials and deterministic execution before enabling upstream calls in this exported Worker."
    }, null, 2) }] };
  }
  const endpoint = ENDPOINT_MAP.find((item: Record<string, unknown>) => item.tool_name === name || item.operation_id === name);
  if (!endpoint) {
    return { content: [{ type: "text", text: JSON.stringify({ status: "mapping_required", tool: name, trace_id, error_code: "mapping_missing_endpoint" }, null, 2) }] };
  }
  if (hasSecurityRequirement(endpoint)) {
    return { content: [{ type: "text", text: JSON.stringify({
      status: "auth_required",
      tool: name,
      trace_id,
      error_code: "auth_required",
      method: endpoint.method,
      path: endpoint.path,
      note: "Tool validated, but live execution requires auth configuration."
    }, null, 2) }] };
  }

  // Worker export v1 is intentionally conservative. It exposes MCP discovery and
  // safe auth/mapping states. Deterministic REST execution should be enabled only
  // after reviewing the exported endpoint map and credential model.
  return { content: [{ type: "text", text: JSON.stringify({
    status: "mapping_required",
    tool: name,
    trace_id,
    error_code: "worker_execution_review_required",
    method: endpoint.method,
    path: endpoint.path,
    note: "Exported Worker template is ready for deterministic execution review."
  }, null, 2) }] };
}

export default {
  async fetch(request: Request): Promise<Response> {
    if (request.method === "GET") {
      return Response.json({
        name: SERVER.name,
        description: SERVER.description,
        tools: TOOLS,
        runtime: "cloudflare-worker-template"
      });
    }

    if (request.method !== "POST") {
      return new Response("Method not allowed", { status: 405 });
    }

    let body: JsonRpcRequest;
    try {
      body = await request.json();
    } catch {
      return jsonRpcError(null, -32700, "Invalid JSON-RPC payload.", 400);
    }

    if (body.method === "initialize") {
      return jsonRpc(body.id, {
        protocolVersion: SERVER.protocolVersion,
        serverInfo: { name: SERVER.name, version: "1.0.0" },
        capabilities: { tools: {} },
      });
    }

    if (body.method === "tools/list") {
      return jsonRpc(body.id, {
        tools: TOOLS.map((tool: Record<string, unknown>) => ({
          name: tool.name,
          description: tool.description,
          inputSchema: tool.input_schema ?? { type: "object", properties: {} },
        })),
      });
    }

    if (body.method === "tools/call") {
      const toolName = body.params?.name;
      if (!toolName || !TOOLS.some((tool: Record<string, unknown>) => tool.name === toolName)) {
        return jsonRpcError(body.id, -32602, "Unknown tool.", 400);
      }
      return jsonRpc(body.id, await executeTool(toolName, body.params?.arguments ?? {}));
    }

    return jsonRpcError(body.id, -32601, "Method not found.", 404);
  },
};
`;

  const wrangler = `name = "${name}"
main = "src/worker.ts"
compatibility_date = "2026-05-24"

[vars]
ASTRAIL_RUNTIME = "cloudflare-worker-template"

[observability]
enabled = true
`;

  const packageJson = json({
    name,
    version: "0.1.0",
    private: true,
    scripts: {
      dev: "wrangler dev",
      deploy: "wrangler deploy",
    },
    devDependencies: {
      wrangler: "^4.0.0",
      typescript: "^5.0.0",
    },
  });

  const envExample = `# Optional bearer key for private exported deployments.
# Do not commit real secrets.
ASTRAIL_API_KEY=
`;

  const readme = `# ${server.name} Cloudflare Worker Export

This is a manual export for the Astrail hosted MCP runtime.

## What this includes

- MCP JSON-RPC surface: \`initialize\`, \`tools/list\`, \`tools/call\`
- Generated tool metadata
- Stored endpoint map
- Conservative auth/mapping responses

## What this does not do yet

- It does not eval generated TypeScript.
- It does not execute arbitrary generated code.
- It does not automatically deploy to Cloudflare.
- It does not inject provider credentials.
- It does not bypass Astrail's no-eval rule.
- It should run as an isolated runtime boundary once reviewed and deployed.

## Deploy manually

\`\`\`bash
npm create cloudflare@latest ${name}
cp src/worker.ts ${name}/src/worker.ts
cp wrangler.toml ${name}/wrangler.toml
cd ${name}
npx wrangler deploy
\`\`\`

## Operational assumptions

- Keep generated source reviewable.
- Treat provider credentials as Worker secrets.
- Keep runtime logs enabled.
- Preserve MCP JSON-RPC response shapes.
`;

  return {
    serverId: server.id,
    serverName: server.name,
    runtime: "cloudflare-worker-template",
    deploymentMode: "manual_export",
    files: [
      { path: "src/worker.ts", content: workerSource },
      { path: "wrangler.toml", content: wrangler },
      { path: "package.json", content: packageJson },
      { path: ".env.example", content: envExample },
      { path: "README.md", content: readme },
    ],
  };
}
