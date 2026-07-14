import { redirect } from "next/navigation";
import { UsageDashboard } from "@/components/UsageDashboard";
import { getBillingUsageSummary } from "@/lib/billing/usage";
import { localDemoLogs, localDemoServers, localDemoUserId } from "@/lib/local-demo";
import { hasServerSupabaseEnv } from "@/lib/supabase/env";
import { createAdminClient, createServerSupabaseClient, hasServiceRoleKey } from "@/lib/supabase/server";

type UsageLog = {
  id: string;
  server_id: string | null;
  tool_name: string | null;
  status: string | null;
  trace_id?: string | null;
  created_at: string;
};

type ServerRow = {
  id: string;
  name: string;
  call_count: number | null;
};

export default async function UsagePage() {
  if (!hasServerSupabaseEnv()) {
    const usage = await getBillingUsageSummary(localDemoUserId);
    const demoLogs = localDemoLogs();
    const demoServers = localDemoServers();
    const demoGenerations = demoServers.length;
    const demoCreditsUsed = demoLogs.length + demoGenerations * usage.meterCosts.mcp_generation;
    return (
      <UsageDashboard
        usage={{
          ...usage,
          plan: "starter",
          planName: "Launch",
          status: "preview",
          creditLimit: 25_000,
          creditsUsed: demoCreditsUsed,
          creditsRemaining: 25_000 - demoCreditsUsed,
          creditsPercentUsed: Math.round((demoCreditsUsed / 25_000) * 100),
          used: demoLogs.length,
          limit: 20_000,
          remaining: 20_000 - demoLogs.length,
          percentUsed: 0,
          generationLimit: 25,
          generationsUsed: demoGenerations,
          generationRemaining: 25 - demoGenerations,
          generationPercentUsed: Math.round((demoGenerations / 25) * 100),
          endpointLimit: 5,
          endpointsUsed: demoServers.length,
          endpointRemaining: 5 - demoServers.length,
          endpointPercentUsed: Math.round((demoServers.length / 5) * 100),
        }}
        logs={demoLogs}
        servers={demoServers.map((server) => ({
          id: server.id,
          name: server.name,
          call_count: server.call_count,
        }))}
      />
    );
  }

  const supabase = createServerSupabaseClient();
  const { data } = await supabase.auth.getUser();
  if (!data.user) redirect("/login");

  const usage = await getBillingUsageSummary(data.user.id);
  const { logs, servers } = await loadUsageData(data.user.id);
  return <UsageDashboard usage={usage} logs={logs} servers={servers} />;
}

async function loadUsageData(userId: string) {
  if (!hasServiceRoleKey()) return { logs: [] as UsageLog[], servers: [] as ServerRow[] };

  try {
    const admin = createAdminClient();
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
    const [{ data: logs }, { data: servers }] = await Promise.all([
      admin
        .from("tool_call_logs")
        .select("id,server_id,tool_name,status,trace_id,created_at")
        .eq("user_id", userId)
        .gte("created_at", thirtyDaysAgo)
        .order("created_at", { ascending: true })
        .limit(1000),
      admin
        .from("mcp_servers")
        .select("id,name,call_count")
        .eq("user_id", userId)
        .order("call_count", { ascending: false })
        .limit(10),
    ]);

    return {
      logs: (logs ?? []) as UsageLog[],
      servers: (servers ?? []) as ServerRow[],
    };
  } catch {
    return { logs: [] as UsageLog[], servers: [] as ServerRow[] };
  }
}
