import { redirect } from "next/navigation";
import { ServerCard } from "@/components/ServerCard";
import { localDemoServers } from "@/lib/local-demo";
import { hasServerSupabaseEnv } from "@/lib/supabase/env";
import { createAdminClient, createServerSupabaseClient } from "@/lib/supabase/server";
import type { McpServer } from "@/lib/types";

export default async function ServersPage() {
  if (!hasServerSupabaseEnv()) {
    return <ServersContent items={localDemoServers()} />;
  }

  const supabase = createServerSupabaseClient();
  const { data } = await supabase.auth.getUser();
  if (!data.user) redirect("/login");

  const { data: servers, error } = await createAdminClient()
    .from("mcp_servers")
    .select("*")
    .eq("user_id", data.user.id)
    .order("created_at", { ascending: false });

  if (error) throw new Error(error.message);
  const items = (servers ?? []) as McpServer[];
  return <ServersContent items={items} />;
}

function ServersContent({ items }: { items: McpServer[] }) {
  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold">Your MCP servers</h1>
        <p className="text-muted-foreground">Open a server to copy, download, or publish it.</p>
      </div>
      {items.length === 0 ? (
        <p className="rounded-lg border bg-card p-6 text-sm text-muted-foreground">No servers generated yet.</p>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {items.map((server) => <ServerCard key={server.id} server={server} />)}
        </div>
      )}
    </div>
  );
}
