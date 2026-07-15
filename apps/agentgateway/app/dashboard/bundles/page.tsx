import { redirect } from "next/navigation";
import Link from "next/link";
import { BundleCreateForm } from "@/components/BundleCreateForm";
import { EndpointBox } from "@/components/EndpointBox";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { hasServerSupabaseEnv } from "@/lib/supabase/env";
import { createAdminClient, createServerSupabaseClient } from "@/lib/supabase/server";

type BundleRow = {
  id: string;
  name: string;
  hosted_endpoint: string | null;
  is_public: boolean;
  created_at: string;
};

export default async function BundlesPage() {
  if (!hasServerSupabaseEnv()) {
    const bundles: BundleRow[] = [
      {
        id: "local-work-stack",
        name: "Local work stack",
        hosted_endpoint: "/api/mcp/bundles/local-work-stack",
        is_public: false,
        created_at: new Date().toISOString(),
      },
    ];
    const serverOptions = [
      { id: "local-website-mcp", name: "Hacker News browser server", toolCount: 1 },
      { id: "local-openapi", name: "Petstore OpenAPI server", toolCount: 1 },
    ];

    return (
      <BundlesContent
        bundles={bundles}
        serverOptions={serverOptions}
        tableMissing={false}
        errorMessage={null}
      />
    );
  }

  const supabase = createServerSupabaseClient();
  const { data } = await supabase.auth.getUser();
  if (!data.user) redirect("/login");

  const { data: bundles, error } = await createAdminClient()
    .from("mcp_bundles")
    .select("id,name,hosted_endpoint,is_public,created_at")
    .eq("user_id", data.user.id)
    .order("created_at", { ascending: false });

  const tableMissing = error?.message.toLowerCase().includes("mcp_bundles");
  const { data: servers } = await createAdminClient()
    .from("mcp_servers")
    .select("id,name,tools_json")
    .eq("user_id", data.user.id)
    .order("created_at", { ascending: false });
  const serverOptions = (servers ?? []).map((server) => ({
    id: server.id as string,
    name: server.name as string,
    toolCount: Array.isArray(server.tools_json) ? server.tools_json.length : 0,
  }));

  return (
    <BundlesContent
      bundles={(bundles ?? []) as BundleRow[]}
      serverOptions={serverOptions}
      tableMissing={Boolean(tableMissing)}
      errorMessage={error?.message ?? null}
    />
  );
}

function BundlesContent({
  bundles,
  serverOptions,
  tableMissing,
  errorMessage,
}: {
  bundles: BundleRow[];
  serverOptions: Array<{ id: string; name: string; toolCount: number }>;
  tableMissing: boolean;
  errorMessage: string | null;
}) {
  return (
    <div className="space-y-6">
      <div className="border-b pb-4">
        <h1 className="text-xl font-semibold">Bundles</h1>
      </div>

      {tableMissing ? (
        <Card>
          <CardHeader><CardTitle>Bundle schema required</CardTitle></CardHeader>
          <CardContent className="text-sm text-muted-foreground">
            Bundle storage is not enabled yet. Apply the bundle migration before launch.
          </CardContent>
        </Card>
      ) : errorMessage ? (
        <Card>
          <CardHeader><CardTitle>Could not load bundles</CardTitle></CardHeader>
          <CardContent className="text-sm text-destructive">{errorMessage}</CardContent>
        </Card>
      ) : bundles.length === 0 ? (
        <div className="grid gap-4 lg:grid-cols-[420px_1fr]">
          <Card>
            <CardHeader><CardTitle>Create bundle</CardTitle></CardHeader>
            <CardContent><BundleCreateForm servers={serverOptions} /></CardContent>
          </Card>
          <Card>
            <CardHeader><CardTitle>No bundles yet</CardTitle></CardHeader>
            <CardContent className="space-y-2 text-sm text-muted-foreground">
              <p>Bundles expose one MCP endpoint across selected servers.</p>
              <code className="block border bg-background p-2">/api/mcp/bundles/&lt;bundleId&gt;</code>
            </CardContent>
          </Card>
        </div>
      ) : (
        <div className="grid gap-4 lg:grid-cols-[420px_1fr]">
          <Card>
            <CardHeader><CardTitle>Create bundle</CardTitle></CardHeader>
            <CardContent><BundleCreateForm servers={serverOptions} /></CardContent>
          </Card>
          <div className="grid gap-4">
            {bundles.map((bundle) => {
              const endpoint = bundle.hosted_endpoint ?? `/api/mcp/bundles/${bundle.id}`;
              return (
                <Card key={bundle.id}>
                  <CardHeader>
                    <div className="flex items-start justify-between gap-3">
                      <CardTitle>{bundle.name}</CardTitle>
                      <Badge>{bundle.is_public ? "public" : "private"}</Badge>
                    </div>
                  </CardHeader>
                <CardContent>
                  <EndpointBox
                    endpoint={endpoint}
                    label="Bundle MCP endpoint"
                    note="Use this URL in Claude Desktop or an MCP client to expose all bundled tools through one connection."
                  />
                  <Link href={`/dashboard/bundles/${bundle.id}`} className="mt-3 inline-block text-sm text-primary">
                    Open bundle detail
                  </Link>
                </CardContent>
                </Card>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
