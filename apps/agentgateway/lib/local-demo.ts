import type { ApiKey, McpServer, RuntimeLog } from "@/lib/types";

export const localDemoUserId = "local-preview";

declare global {
  // Shared by Next route bundles in local demo mode.
  // eslint-disable-next-line no-var
  var __astrailLocalGeneratedServers: Map<string, McpServer> | undefined;
}

function localGeneratedServers() {
  globalThis.__astrailLocalGeneratedServers ??= new Map<string, McpServer>();
  return globalThis.__astrailLocalGeneratedServers;
}

export function saveLocalGeneratedServer(server: McpServer) {
  localGeneratedServers().set(server.id, server);
  return server;
}

export function findLocalGeneratedServer(serverId: string) {
  return localGeneratedServers().get(serverId) ?? null;
}

export function updateLocalDemoServer(serverId: string, updates: Partial<McpServer>) {
  const server = localDemoServers().find((item) => item.id === serverId);
  if (!server) return null;
  return saveLocalGeneratedServer({ ...server, ...updates });
}

export function localDemoServers(): McpServer[] {
  const now = new Date().toISOString();
  const generatedServers = Array.from(localGeneratedServers().values())
    .sort((left, right) => String(right.created_at ?? "").localeCompare(String(left.created_at ?? "")));
  const demoServers: McpServer[] = [
    {
      id: "local-website-mcp",
      user_id: localDemoUserId,
      name: "Hacker News browser server",
      description: "Website-to-MCP preview generated from a public website.",
      source_url: "https://news.ycombinator.com",
      source_type: "website",
      category: "Website",
      generated_code: null,
      tools_json: [
        {
          name: "browser_open_page",
          description: "Open the page and summarize visible public content.",
          input_schema: { type: "object", properties: {} },
          method: "BROWSER",
          path: "body",
        },
      ],
      endpoint_map: [
        {
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
        },
      ],
      diagnostics: ["Local demo server. Connect persistent workspace storage to save generated endpoint details."],
      status: "live",
      validation_status: "passed",
      generation_status: "completed",
      is_public: true,
      hosted_endpoint: "/api/mcp/local-website-mcp",
      call_count: 128,
      protocol_version: "2024-11-05",
      created_at: now,
    },
    {
      id: "local-openapi",
      user_id: localDemoUserId,
      name: "Petstore OpenAPI server",
      description: "Demo endpoint map generated from the Swagger Petstore spec.",
      source_url: "https://petstore.swagger.io/v2/swagger.json",
      source_type: "openapi_url",
      category: "OpenAPI",
      generated_code: null,
      tools_json: [
        {
          name: "list_inventory",
          description: "List inventory counts from the sample Petstore API.",
          input_schema: { type: "object", properties: {} },
          method: "GET",
          path: "/store/inventory",
        },
      ],
      endpoint_map: [
        {
          method: "GET",
          path: "/store/inventory",
          base_url: "https://petstore.swagger.io/v2",
          tool_name: "list_inventory",
          operation_id: "list_inventory",
          summary: "List inventory",
          description: "List inventory counts from the sample Petstore API.",
          parameters: [],
          requires_auth: false,
        },
      ],
      diagnostics: ["Local demo server. Connect persistent workspace storage to save generated endpoint details."],
      status: "live",
      validation_status: "passed",
      generation_status: "completed",
      is_public: true,
      hosted_endpoint: "/api/mcp/local-openapi",
      call_count: 42,
      protocol_version: "2024-11-05",
      created_at: now,
    },
    {
      id: "local-code-mode",
      user_id: localDemoUserId,
      name: "Petstore Code Mode server",
      description: "Demo Code Mode MCP endpoint with search_docs and execute over a Petstore endpoint map.",
      source_url: "https://petstore.swagger.io/v2/swagger.json",
      source_type: "openapi_url",
      category: "OpenAPI",
      generated_code: null,
      tools_json: [
        {
          name: "search_docs",
          description: "Search SDK-style documentation for the generated Petstore API.",
          input_schema: {
            type: "object",
            properties: {
              query: { type: "string", description: "Search text." },
              limit: { type: "integer", description: "Maximum docs to return." },
            },
          },
          method: "ASTRAIL_CODE",
          path: "search_docs",
        },
        {
          name: "execute",
          description: "Run SDK-style TypeScript calls compiled through Astrail's no-eval endpoint map.",
          input_schema: {
            type: "object",
            properties: {
              code: {
                type: "string",
                description: "Example: async function run(client) { return await client.store.getInventory({}); }",
              },
            },
            required: ["code"],
          },
          method: "ASTRAIL_CODE",
          path: "execute",
        },
      ],
      endpoint_map: [
        {
          method: "GET",
          path: "/store/inventory",
          base_url: "https://petstore.swagger.io/v2",
          tool_name: "petstore_openapi_server_get_inventory",
          operation_id: "getInventory",
          summary: "List inventory",
          description: "Returns pet inventories by status from the sample Petstore API.",
          tags: ["store"],
          resource: "store",
          operation_kind: "read",
          parameters: [],
          input_schema: { type: "object", properties: {} },
          requires_auth: false,
        },
      ],
      diagnostics: ["Local Code Mode demo server. Connect persistent workspace storage to save generated endpoint details."],
      status: "live",
      validation_status: "passed",
      generation_status: "completed",
      is_public: true,
      hosted_endpoint: "/api/mcp/local-code-mode",
      call_count: 17,
      protocol_version: "2024-11-05",
      created_at: now,
    },
  ];

  const generatedIds = new Set(generatedServers.map((server) => server.id));
  return [
    ...generatedServers,
    ...demoServers.filter((server) => !generatedIds.has(server.id)),
  ];
}

export function localDemoApiKeys(): ApiKey[] {
  return [
    {
      id: "00000000-0000-4000-8000-000000000001",
      user_id: localDemoUserId,
      name: "Anthropic demo key",
      key_preview: "ag_demo...ready",
      last_used: new Date(Date.now() - 12 * 60 * 1000).toISOString(),
      created_at: new Date().toISOString(),
    },
  ];
}

export function localDemoLogs(): RuntimeLog[] {
  return [
    {
      id: "log_1",
      server_id: "local-website-mcp",
      user_id: localDemoUserId,
      tool_name: "browser_open_page",
      status: "success",
      method: "BROWSER",
      path: "body",
      execution_mode: "website_browser_runtime",
      upstream_status: 200,
      trace_id: "agt_demo_browser_01",
      attempt_count: 1,
      error_code: null,
      error: null,
      latency_ms: 1180,
      created_at: new Date(Date.now() - 9 * 60 * 1000).toISOString(),
    },
    {
      id: "log_2",
      server_id: "local-openapi",
      user_id: localDemoUserId,
      tool_name: "list_pets",
      status: "success",
      method: "GET",
      path: "/pets",
      execution_mode: "safe_rest_execution",
      upstream_status: 200,
      trace_id: "agt_demo_openapi_01",
      attempt_count: 1,
      error_code: null,
      error: null,
      latency_ms: 243,
      created_at: new Date(Date.now() - 38 * 60 * 1000).toISOString(),
    },
  ];
}
