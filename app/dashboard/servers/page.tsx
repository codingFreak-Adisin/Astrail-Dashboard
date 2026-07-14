import { Suspense } from "react";
import { ServerCard } from "@/components/ServerCard";
import { getDashboardSessionUser } from "@/lib/dashboard-session";
import { localDemoServers } from "@/lib/local-demo";
import { hasServerSupabaseEnv } from "@/lib/supabase/env";
import { createAdminClient } from "@/lib/supabase/server";
import type { McpServer } from "@/lib/types";

export default async function ServersPage() {
  if (!hasServerSupabaseEnv()) {
    return <ServersContent items={localDemoServers()} />;
  }

  const user = await getDashboardSessionUser();

  return (
    <div className="mx-auto max-w-6xl space-y-5">
      <ServersHeader />
      <Suspense fallback={<ServersListFallback />}>
        <UserServersList userId={user.id} />
      </Suspense>
    </div>
  );
}

async function UserServersList({ userId }: { userId: string }) {
  const { data: servers, error } = await createAdminClient()
    .from("mcp_servers")
    .select("*")
    .eq("user_id", userId)
    .order("created_at", { ascending: false });

  if (error) throw new Error(error.message);
  const items = (servers ?? []) as McpServer[];
  return <ServersList items={items} />;
}

function ServersHeader() {
  return (
    <header className="console-hero px-5 py-8 sm:px-9">
      <div className="relative z-10 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <h1 className="text-3xl font-semibold tracking-tight text-neutral-950">Your MCP servers</h1>
          <p className="mt-1.5 text-sm text-neutral-600">Open a server to copy, download, or publish it.</p>
        </div>
      </div>
    </header>
  );
}

function ServersListFallback() {
  return (
    <div className="section-card text-sm text-neutral-500">
      Syncing hosted endpoints...
    </div>
  );
}

function ServersContent({ items }: { items: McpServer[] }) {
  return (
    <div className="mx-auto max-w-6xl space-y-5">
      <ServersHeader />
      <ServersList items={items} />
    </div>
  );
}

function ServersList({ items }: { items: McpServer[] }) {
  return items.length === 0 ? (
    <p className="section-card text-sm text-neutral-500">No servers generated yet.</p>
  ) : (
    <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
      {items.map((server) => <ServerCard key={server.id} server={server} />)}
    </div>
  );
}
