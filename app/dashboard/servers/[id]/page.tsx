import { notFound } from "next/navigation";
import { CodeViewer } from "@/components/CodeViewer";
import { EndpointBox } from "@/components/EndpointBox";
import { McpClientSnippets } from "@/components/McpClientSnippets";
import { McpEndpointTester } from "@/components/McpEndpointTester";
import { PublishToggle } from "@/components/PublishToggle";
import { SdkExportPanel } from "@/components/SdkExportPanel";
import { ToolList } from "@/components/ToolList";
import { WorkerExportPanel } from "@/components/WorkerExportPanel";
import { getDashboardSessionUser } from "@/lib/dashboard-session";
import { findLocalGeneratedServer, localDemoServers } from "@/lib/local-demo";
import { loadLocalPreviewServer } from "@/lib/local-preview-servers";
import { visibleEndpointsForRequest, visibleToolsForRequest } from "@/lib/runtime/permissions";
import { hasServerSupabaseEnv } from "@/lib/supabase/env";
import { createAdminClient } from "@/lib/supabase/server";
import { formatDate } from "@/lib/utils";
import type { McpServer, McpTool, OpenApiEndpoint } from "@/lib/types";

function localServerById(id: string): McpServer | null {
  const websiteEndpoints: OpenApiEndpoint[] = [
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
  ];
  const localServers: Record<string, McpServer> = {
    "local-website-mcp": {
      id: "local-website-mcp",
      user_id: "local-preview",
      name: "Hacker News browser server",
      description: "Local Website-to-MCP preview generated from a public page.",
      source_url: "https://news.ycombinator.com",
      source_type: "website",
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
      endpoint_map: websiteEndpoints,
      diagnostics: ["Local demo server. Connect persistent workspace storage to save generated endpoint details."],
      status: "live",
      validation_status: "passed",
      generation_status: "completed",
      is_public: false,
      hosted_endpoint: "/api/mcp/local-website-mcp",
      call_count: 128,
      protocol_version: "2024-11-05",
      created_at: new Date().toISOString(),
    },
    "local-openapi": {
      id: "local-openapi",
      user_id: "local-preview",
      name: "Petstore OpenAPI server",
      description: "Demo endpoint map generated from the Swagger Petstore spec.",
      source_url: "https://petstore.swagger.io/v2/swagger.json",
      source_type: "openapi_url",
      generated_code: null,
      tools_json: [
        {
          name: "list_pets",
          description: "List pets from the sample Petstore API.",
          input_schema: { type: "object", properties: {} },
          method: "GET",
          path: "/pets",
        },
      ],
      endpoint_map: [
        {
          method: "GET",
          path: "/pets",
          base_url: "https://petstore.swagger.io/v2",
          tool_name: "list_pets",
          operation_id: "list_pets",
          summary: "List pets",
          description: "List pets from the sample Petstore API.",
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
      created_at: new Date().toISOString(),
    },
  };

  return localServers[id] ?? null;
}

function endpointForTool(server: McpServer, tool: McpTool) {
  const endpoints = Array.isArray(server.endpoint_map) ? server.endpoint_map : [];
  return endpoints.find((endpoint) => endpoint.tool_name === tool.name)
    ?? endpoints.find((endpoint) => endpoint.method === tool.method && endpoint.path === tool.path)
    ?? endpoints.find((endpoint) => endpoint.operation_id === tool.name);
}

export default async function ServerDetailPage({ params }: { params: { id: string } }) {
  if (!hasServerSupabaseEnv()) {
    const localServer = findLocalGeneratedServer(params.id)
      ?? await loadLocalPreviewServer(params.id)
      ?? localDemoServers().find((server) => server.id === params.id)
      ?? localServerById(params.id);
    if (!localServer) notFound();
    return <ServerDetailContent server={localServer} />;
  }

  const user = await getDashboardSessionUser();

  const { data, error } = await createAdminClient()
    .from("mcp_servers")
    .select("*")
    .eq("id", params.id)
    .eq("user_id", user.id)
    .single();

  if (error || !data) notFound();

  const server = data as McpServer;
  return <ServerDetailContent server={server} />;
}

async function ServerDetailContent({ server }: { server: McpServer }) {
  const allTools = server.tools_json ?? [];
  const endpoint = server.hosted_endpoint ?? `/api/mcp/${server.id}`;
  const endpointMap = visibleEndpointsForRequest(server);
  const tools = visibleToolsForRequest(server, allTools, endpointForTool);

  return (
    <div className="mx-auto max-w-6xl space-y-5">
      <div className="flex flex-col justify-between gap-4 lg:flex-row lg:items-start">
        <div>
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <span className={server.is_public ? "pill pill-brand" : "pill pill-neutral"}>{server.is_public ? "Public" : "Private"}</span>
            <span className={statusPillClass(server.status ?? "live")}>{server.status ?? "live"}</span>
            <span className={statusPillClass(server.validation_status ?? "passed")}>validation {server.validation_status ?? "passed"}</span>
            <span className={statusPillClass(server.generation_status ?? "passed")}>generation {server.generation_status ?? "passed"}</span>
            <span className="pill pill-neutral">{formatDate(server.created_at)}</span>
            <span className="pill pill-neutral font-mono">{server.call_count ?? 0} calls</span>
          </div>
          <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">{server.name}</h1>
          <p className="mt-2 max-w-3xl text-sm text-neutral-500">{server.description}</p>
        </div>
        <PublishToggle serverId={server.id} isPublic={server.is_public} />
      </div>

      <EndpointBox endpoint={endpoint} />

      <div className="grid gap-4 md:grid-cols-3">
        <div className="section-card">
          <p className="text-xs font-medium text-neutral-400">Validation</p>
          <p className="mt-1.5 text-sm font-semibold text-neutral-950">{server.validation_status ?? "passed"}</p>
        </div>
        <div className="section-card">
          <p className="text-xs font-medium text-neutral-400">Generation</p>
          <p className="mt-1.5 text-sm font-semibold text-neutral-950">{server.generation_status ?? "passed"}</p>
        </div>
        <div className="section-card">
          <p className="text-xs font-medium text-neutral-400">Runtime</p>
          <p className="mt-1.5 font-mono text-sm font-semibold text-neutral-950">{server.protocol_version ?? "2024-11-05"}</p>
        </div>
      </div>

      <div className="grid min-w-0 items-start gap-5 xl:grid-cols-[minmax(300px,420px)_minmax(0,1fr)]">
        <section className="section-card min-w-0">
          <div className="section-card-header">
            <h2 className="text-lg font-semibold text-neutral-950">{server.is_public ? "Callable tools" : "Generated tools"}</h2>
            <span className="pill pill-neutral">{tools.length} tools</span>
          </div>
          <div className="max-h-[720px] overflow-y-auto pr-3">
            <ToolList tools={tools} />
          </div>
        </section>
        <CodeViewer code={server.generated_code ?? ""} />
      </div>

      <div className="grid min-w-0 items-start gap-5 xl:grid-cols-[minmax(0,0.95fr)_minmax(0,1.05fr)]">
        <section className="section-card min-w-0">
          <div className="section-card-header">
            <div>
              <h2 className="text-lg font-semibold text-neutral-950">Runtime proof</h2>
              <p className="mt-0.5 text-xs text-neutral-400">Run a live check against the hosted endpoint</p>
            </div>
          </div>
          <McpEndpointTester
            endpoint={endpoint}
            tools={tools}
            endpointMap={endpointMap}
            isPublic={server.is_public}
          />
        </section>

        <section className="section-card min-w-0">
          <div className="section-card-header">
            <div>
              <h2 className="text-lg font-semibold text-neutral-950">Connect clients</h2>
              <p className="mt-0.5 text-xs text-neutral-400">Ready-to-paste configs and cURL calls</p>
            </div>
          </div>
          <div className="min-w-0">
            <McpClientSnippets
              serverName={server.name}
              endpoint={endpoint}
              tools={tools}
              endpointMap={endpointMap}
              isPublic={server.is_public}
            />
          </div>
        </section>
      </div>

      <details className="group console-card p-5 sm:p-6">
        <summary className="cursor-pointer text-lg font-semibold text-neutral-950">
          Advanced exports
        </summary>
        <p className="mt-2 text-sm text-neutral-500">
          Generate SDK packages or export a manual Worker bundle when this endpoint needs to move into a long-lived production integration.
        </p>
        <div className="mt-4 grid min-w-0 items-start gap-5 xl:grid-cols-2">
          <SdkExportPanel serverId={server.id} serverName={server.name} />
          <WorkerExportPanel serverId={server.id} serverName={server.name} />
        </div>
      </details>
    </div>
  );
}

function statusPillClass(status: string) {
  const normalized = status.toLowerCase();
  if (["live", "passed", "completed"].includes(normalized)) return "pill pill-success";
  if (["failed", "error"].includes(normalized)) return "pill pill-danger";
  if (["processing", "pending", "running"].includes(normalized)) return "pill pill-info";
  return "pill pill-neutral";
}
