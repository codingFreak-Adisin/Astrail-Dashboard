import { notFound } from "next/navigation";
import { EndpointBox } from "@/components/EndpointBox";
import { McpClientSnippets } from "@/components/McpClientSnippets";
import { CopySnippet } from "@/components/CopySnippet";
import { getDashboardSessionUser } from "@/lib/dashboard-session";
import { hasServerSupabaseEnv } from "@/lib/supabase/env";
import { createAdminClient } from "@/lib/supabase/server";
import type { McpServer, McpTool } from "@/lib/types";

type BundleRow = {
  id: string;
  name: string;
  hosted_endpoint: string | null;
  is_public: boolean;
};

type BundleLink = {
  server_id: string;
};

function bundleToolName(server: McpServer, tool: McpTool) {
  const prefix = server.name.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "") || server.id;
  return `${prefix}__${tool.name}`;
}

export default async function BundleDetailPage({ params }: { params: { id: string } }) {
  if (!hasServerSupabaseEnv() && params.id === "local-work-stack") {
    const typedBundle: BundleRow = {
      id: "local-work-stack",
      name: "Local work stack",
      hosted_endpoint: "/api/mcp/bundles/local-work-stack",
      is_public: false,
    };
    const typedServers: McpServer[] = [
      {
        id: "local-website-mcp",
        user_id: "local-preview",
        name: "Hacker News browser server",
        description: "Local Website-to-MCP preview generated from a public page.",
        source_url: "https://news.ycombinator.com",
        source_type: "website",
        generated_code: null,
        tools_json: [{ name: "browser_open_page", description: "Open the page and summarize visible public content." }],
        is_public: false,
        hosted_endpoint: "/api/mcp/local-website-mcp",
        call_count: 128,
        created_at: new Date().toISOString(),
      },
      {
        id: "local-openapi",
        user_id: "local-preview",
        name: "Petstore OpenAPI server",
        description: "Demo endpoint map generated from the Swagger Petstore spec.",
        source_url: "https://petstore.swagger.io/v2/swagger.json",
        source_type: "openapi_url",
        generated_code: null,
        tools_json: [{ name: "list_pets", description: "List pets from the sample Petstore API." }],
        is_public: true,
        hosted_endpoint: "/api/mcp/local-openapi",
        call_count: 42,
        created_at: new Date().toISOString(),
      },
    ];

    return <BundleDetailContent typedBundle={typedBundle} typedServers={typedServers} />;
  }

  const user = await getDashboardSessionUser();

  const admin = createAdminClient();
  const { data: bundle, error: bundleError } = await admin
    .from("mcp_bundles")
    .select("id,name,hosted_endpoint,is_public")
    .eq("id", params.id)
    .eq("user_id", user.id)
    .single();

  if (bundleError || !bundle) notFound();

  const { data: links } = await admin
    .from("mcp_bundle_servers")
    .select("server_id")
    .eq("bundle_id", params.id);
  const serverIds = ((links ?? []) as BundleLink[]).map((link) => link.server_id);
  const { data: servers } = serverIds.length > 0
    ? await admin.from("mcp_servers").select("*").in("id", serverIds)
    : { data: [] };

  const typedBundle = bundle as BundleRow;
  const typedServers = (servers ?? []) as McpServer[];
  return <BundleDetailContent typedBundle={typedBundle} typedServers={typedServers} />;
}

function BundleDetailContent({
  typedBundle,
  typedServers,
}: {
  typedBundle: BundleRow;
  typedServers: McpServer[];
}) {
  const endpoint = typedBundle.hosted_endpoint ?? `/api/mcp/bundles/${typedBundle.id}`;
  const tools = typedServers.flatMap((server) =>
    (server.tools_json ?? []).map((tool) => ({
      ...tool,
      name: bundleToolName(server, tool),
      description: `${server.name}: ${tool.description}`,
    }))
  );

  return (
    <div className="mx-auto max-w-6xl space-y-5">
      <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-start">
        <div>
          <div className="mb-2 flex flex-wrap gap-2">
            <span className={typedBundle.is_public ? "pill pill-brand" : "pill pill-neutral"}>{typedBundle.is_public ? "Public" : "Private"}</span>
            <span className="pill pill-neutral font-mono">{typedServers.length} servers</span>
            <span className="pill pill-neutral font-mono">{tools.length} tools</span>
          </div>
          <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">{typedBundle.name}</h1>
          <p className="mt-1 text-sm text-neutral-500">Aggregated MCP endpoint across selected servers.</p>
        </div>
      </div>

      <EndpointBox endpoint={endpoint} />

      <section className="section-card">
        <div className="section-card-header">
          <h2 className="text-lg font-semibold text-neutral-950">How this bundle works</h2>
        </div>
        <div className="grid gap-3 text-sm text-neutral-500 md:grid-cols-3">
          <p><span className="font-medium text-neutral-950">Initialize</span> returns the bundle as one MCP server.</p>
          <p><span className="font-medium text-neutral-950">tools/list</span> combines tools from {typedServers.length} linked server{typedServers.length === 1 ? "" : "s"}.</p>
          <p><span className="font-medium text-neutral-950">tools/call</span> routes the prefixed tool name to the correct underlying runtime.</p>
        </div>
      </section>

      <div className="grid gap-5 xl:grid-cols-[380px_1fr]">
        <section className="section-card">
          <div className="section-card-header">
            <h2 className="text-lg font-semibold text-neutral-950">Servers</h2>
            <span className="pill pill-neutral">{typedServers.length} linked</span>
          </div>
          <div>
            {typedServers.map((server) => (
              <div key={server.id} className="console-table-row py-3.5 text-sm">
                <p className="font-medium text-neutral-950">{server.name}</p>
                <p className="text-neutral-500">{server.tools_json?.length ?? 0} tools</p>
              </div>
            ))}
            {typedServers.length === 0 && <p className="text-sm text-neutral-500">No servers linked.</p>}
          </div>
        </section>
        <section className="section-card">
          <div className="section-card-header">
            <h2 className="text-lg font-semibold text-neutral-950">MCP client snippets</h2>
          </div>
          <McpClientSnippets
            serverName={typedBundle.name}
            endpoint={endpoint}
            tools={tools}
            endpointMap={[]}
            isPublic={typedBundle.is_public}
          />
        </section>
      </div>

      <section className="section-card">
        <div className="section-card-header">
          <h2 className="text-lg font-semibold text-neutral-950">Bundle API endpoint</h2>
        </div>
        <CopySnippet
          title="MCP bundle URL"
          code={endpoint}
        />
      </section>
    </div>
  );
}
