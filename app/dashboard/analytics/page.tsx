import Link from "next/link";
import { Suspense, type ReactNode } from "react";
import { getDashboardSessionUser } from "@/lib/dashboard-session";
import { localDemoLogs, localDemoServers } from "@/lib/local-demo";
import { hasServerSupabaseEnv } from "@/lib/supabase/env";
import { createAdminClient, hasServiceRoleKey } from "@/lib/supabase/server";
import { formatDate } from "@/lib/utils";
import type { McpServer, RuntimeLog } from "@/lib/types";

type ServerMetric = {
  id: string;
  name: string;
  status: string;
  calls: number;
  loggedCalls: number;
  success: number;
  errors: number;
  authRequired: number;
  mappingRequired: number;
  averageLatency: number | null;
};

const statusOrder = ["success", "auth_required", "oauth_required", "mapping_required", "browser_runtime_required", "error"];

export default async function AnalyticsPage() {
  if (!hasServerSupabaseEnv()) {
    return (
      <AnalyticsShell>
        <AnalyticsContent
          servers={localDemoServers().map((server) => ({
            id: server.id,
            name: server.name,
            status: server.status,
            call_count: server.call_count,
            hosted_endpoint: server.hosted_endpoint,
            created_at: server.created_at,
          }))}
          logs={localDemoLogs()}
        />
      </AnalyticsShell>
    );
  }

  const user = await getDashboardSessionUser();

  if (!hasServiceRoleKey()) {
    return (
      <AnalyticsShell>
        <section className="section-card">
          <div className="section-card-header">
            <h2 className="text-lg font-semibold text-neutral-950">Analytics unavailable</h2>
          </div>
          <p className="text-sm text-neutral-500">
            Runtime analytics are not enabled for this workspace yet.
          </p>
        </section>
      </AnalyticsShell>
    );
  }

  return (
    <AnalyticsShell>
      <Suspense fallback={<AnalyticsFallback />}>
        <UserAnalyticsContent userId={user.id} />
      </Suspense>
    </AnalyticsShell>
  );
}

async function UserAnalyticsContent({ userId }: { userId: string }) {
  const admin = createAdminClient();
  const [{ data: serverRows, error: serverError }, { data: logRows, error: logError }] = await Promise.all([
    admin
      .from("mcp_servers")
      .select("id,name,status,call_count,hosted_endpoint,created_at")
      .eq("user_id", userId)
      .order("created_at", { ascending: false }),
    admin
      .from("tool_call_logs")
      .select("id,server_id,user_id,tool_name,status,method,path,execution_mode,upstream_status,trace_id,attempt_count,error_code,error,latency_ms,created_at")
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .limit(500),
  ]);

  if (serverError) throw new Error(serverError.message);
  if (logError) throw new Error(logError.message);

  const servers = (serverRows ?? []) as Pick<McpServer, "id" | "name" | "status" | "call_count" | "hosted_endpoint" | "created_at">[];
  const logs = (logRows ?? []) as RuntimeLog[];
  return <AnalyticsContent servers={servers} logs={logs} />;
}

function AnalyticsShell({ children }: { children: ReactNode }) {
  return (
    <div className="mx-auto max-w-6xl space-y-5">
      <PageHeader />
      {children}
    </div>
  );
}

function AnalyticsFallback() {
  return (
    <div className="space-y-5">
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        {["Endpoint calls", "Success rate", "Average latency", "Action required"].map((label) => (
          <div key={label} className="console-card p-5">
            <p className="text-xs text-neutral-400">{label}</p>
            <div className="mt-3 h-9 w-20 rounded-xl bg-neutral-100" />
          </div>
        ))}
      </div>
      <section className="section-card">
        <div className="section-card-header">
          <h2 className="text-lg font-semibold text-neutral-950">Loading runtime activity</h2>
        </div>
        <p className="text-sm text-neutral-500">Fetching recent logs and endpoint metrics...</p>
      </section>
    </div>
  );
}

function AnalyticsContent({
  servers,
  logs,
}: {
  servers: Pick<McpServer, "id" | "name" | "status" | "call_count" | "hosted_endpoint" | "created_at">[];
  logs: RuntimeLog[];
}) {
  const serverNameById = new Map(servers.map((server) => [server.id, server.name]));
  const totalEndpointCalls = servers.reduce((sum, server) => sum + (server.call_count ?? 0), 0);
  const loggedCalls = logs.length;
  const successCount = countBy(logs, "status", "success");
  const authRequiredCount = countBy(logs, "status", "auth_required") + countBy(logs, "status", "oauth_required");
  const mappingRequiredCount = countBy(logs, "status", "mapping_required");
  const browserRequiredCount = countBy(logs, "status", "browser_runtime_required");
  const errorCount = logs.filter((log) => log.status === "error" || Boolean(log.error_code && log.status !== "auth_required" && log.status !== "oauth_required" && log.status !== "mapping_required")).length;
  const latencies = logs.map((log) => log.latency_ms).filter((value): value is number => typeof value === "number" && value > 0);
  const averageLatency = average(latencies);
  const p95Latency = percentile(latencies, 0.95);
  const successRate = loggedCalls > 0 ? Math.round((successCount / loggedCalls) * 100) : 0;

  const topTools = topCounts(logs.map((log) => log.tool_name).filter((name): name is string => Boolean(name)), 8);
  const statusCounts = statusOrder.map((status) => ({ label: status, count: countBy(logs, "status", status) }));
  const executionModes = topCounts(logs.map((log) => log.execution_mode).filter((mode): mode is string => Boolean(mode)), 8);
  const upstreamStatuses = topCounts(logs.map((log) => typeof log.upstream_status === "number" ? String(log.upstream_status) : null).filter((status): status is string => Boolean(status)), 8);
  const daily = dailyBuckets(logs, 14);
  const serverMetrics = servers.map((server): ServerMetric => {
    const serverLogs = logs.filter((log) => log.server_id === server.id);
    const serverLatencies = serverLogs.map((log) => log.latency_ms).filter((value): value is number => typeof value === "number" && value > 0);
    return {
      id: server.id,
      name: server.name,
      status: server.status ?? "live",
      calls: server.call_count ?? 0,
      loggedCalls: serverLogs.length,
      success: countBy(serverLogs, "status", "success"),
      errors: serverLogs.filter((log) => log.status === "error").length,
      authRequired: countBy(serverLogs, "status", "auth_required") + countBy(serverLogs, "status", "oauth_required"),
      mappingRequired: countBy(serverLogs, "status", "mapping_required"),
      averageLatency: average(serverLatencies),
    };
  }).sort((a, b) => b.calls - a.calls);

  return (
    <>

      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        <MetricCard label="Endpoint calls" value={totalEndpointCalls} detail={`${loggedCalls} persisted log rows`} />
        <MetricCard label="Success rate" value={`${successRate}%`} detail={`${successCount} successful calls`} />
        <MetricCard label="Average latency" value={averageLatency === null ? "n/a" : `${averageLatency}ms`} detail={p95Latency === null ? "p95 not recorded" : `p95 ${p95Latency}ms`} />
        <MetricCard label="Action required" value={authRequiredCount + mappingRequiredCount + browserRequiredCount} detail={`${errorCount} runtime errors recorded`} />
      </div>

      <div className="grid gap-4 xl:grid-cols-[1.4fr_1fr]">
        <section className="section-card">
          <div className="section-card-header">
            <h2 className="text-lg font-semibold text-neutral-950">Calls by day</h2>
          </div>
          {daily.every((item) => item.count === 0) ? (
            <EmptyAnalyticsState />
          ) : (
            <div className="space-y-2.5">
              {daily.map((item) => (
                <div key={item.date} className="grid grid-cols-[92px_1fr_48px] items-center gap-3 text-sm">
                  <span className="text-neutral-500">{item.label}</span>
                  <div className="h-1.5 w-full rounded-full bg-neutral-100">
                    <div
                      className="h-full rounded-full bg-orange-400"
                      style={{ width: `${item.width}%` }}
                    />
                  </div>
                  <span className="text-right font-mono font-medium tabular-nums text-neutral-950">{item.count}</span>
                </div>
              ))}
            </div>
          )}
        </section>

        <section className="section-card">
          <div className="section-card-header">
            <h2 className="text-lg font-semibold text-neutral-950">Statuses</h2>
          </div>
          <div>
            {statusCounts.map((item) => (
              <StatRow key={item.label} label={item.label} value={item.count} />
            ))}
          </div>
        </section>
      </div>

      <div className="grid gap-4 xl:grid-cols-3">
        <RankedList title="Top tools" items={topTools} empty="No tool calls recorded yet." />
        <RankedList title="Execution modes" items={executionModes} empty="No execution modes recorded yet." />
        <RankedList title="Upstream statuses" items={upstreamStatuses} empty="No upstream statuses recorded yet." />
      </div>

      <section className="section-card">
        <div className="section-card-header">
          <h2 className="text-lg font-semibold text-neutral-950">Servers</h2>
        </div>
        {serverMetrics.length === 0 ? (
          <p className="text-sm text-neutral-500">No generated servers yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] text-left text-sm">
              <thead>
                <tr>
                  <th className="border-b border-neutral-100 pb-2.5 pr-3 text-left text-xs font-medium text-neutral-400">Server</th>
                  <th className="border-b border-neutral-100 pb-2.5 pr-3 text-left text-xs font-medium text-neutral-400">Status</th>
                  <th className="border-b border-neutral-100 pb-2.5 pr-3 text-left text-xs font-medium text-neutral-400">Calls</th>
                  <th className="border-b border-neutral-100 pb-2.5 pr-3 text-left text-xs font-medium text-neutral-400">Logged</th>
                  <th className="border-b border-neutral-100 pb-2.5 pr-3 text-left text-xs font-medium text-neutral-400">Success</th>
                  <th className="border-b border-neutral-100 pb-2.5 pr-3 text-left text-xs font-medium text-neutral-400">Auth required</th>
                  <th className="border-b border-neutral-100 pb-2.5 pr-3 text-left text-xs font-medium text-neutral-400">Mapping required</th>
                  <th className="border-b border-neutral-100 pb-2.5 pr-3 text-left text-xs font-medium text-neutral-400">Avg latency</th>
                </tr>
              </thead>
              <tbody>
                {serverMetrics.map((server) => (
                  <tr key={server.id} className="border-b border-neutral-100 last:border-b-0">
                    <td className="py-3.5 pr-3">
                      <Link href={`/dashboard/servers/${server.id}`} className="font-medium text-neutral-950 transition hover:text-orange-600">
                        {server.name}
                      </Link>
                    </td>
                    <td className="py-3.5 pr-3"><StatusPill status={server.status} /></td>
                    <td className="py-3.5 pr-3 font-mono tabular-nums">{server.calls}</td>
                    <td className="py-3.5 pr-3 font-mono tabular-nums">{server.loggedCalls}</td>
                    <td className="py-3.5 pr-3 font-mono tabular-nums">{server.success}</td>
                    <td className="py-3.5 pr-3 font-mono tabular-nums">{server.authRequired}</td>
                    <td className="py-3.5 pr-3 font-mono tabular-nums">{server.mappingRequired}</td>
                    <td className="py-3.5 pr-3 font-mono text-xs text-neutral-500">{server.averageLatency === null ? "n/a" : `${server.averageLatency}ms`}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="section-card">
        <div className="section-card-header">
          <h2 className="text-lg font-semibold text-neutral-950">Recent activity</h2>
        </div>
        {logs.length === 0 ? (
          <EmptyAnalyticsState />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[900px] text-left text-sm">
              <thead>
                <tr>
                  <th className="border-b border-neutral-100 pb-2.5 pr-3 text-left text-xs font-medium text-neutral-400">Time</th>
                  <th className="border-b border-neutral-100 pb-2.5 pr-3 text-left text-xs font-medium text-neutral-400">Server</th>
                  <th className="border-b border-neutral-100 pb-2.5 pr-3 text-left text-xs font-medium text-neutral-400">Tool</th>
                  <th className="border-b border-neutral-100 pb-2.5 pr-3 text-left text-xs font-medium text-neutral-400">Status</th>
                  <th className="border-b border-neutral-100 pb-2.5 pr-3 text-left text-xs font-medium text-neutral-400">Mode</th>
                  <th className="border-b border-neutral-100 pb-2.5 pr-3 text-left text-xs font-medium text-neutral-400">Upstream</th>
                  <th className="border-b border-neutral-100 pb-2.5 pr-3 text-left text-xs font-medium text-neutral-400">Latency</th>
                  <th className="border-b border-neutral-100 pb-2.5 pr-3 text-left text-xs font-medium text-neutral-400">Trace</th>
                </tr>
              </thead>
              <tbody>
                {logs.slice(0, 25).map((log) => (
                  <tr key={log.id} className="border-b border-neutral-100 last:border-b-0">
                    <td className="py-3.5 pr-3 text-neutral-500">{formatDate(log.created_at)}</td>
                    <td className="py-3.5 pr-3 text-neutral-950">{serverNameById.get(log.server_id) ?? "Unknown server"}</td>
                    <td className="py-3.5 pr-3"><code className="font-mono text-xs">{log.tool_name ?? "unknown_tool"}</code></td>
                    <td className="py-3.5 pr-3"><StatusPill status={log.status ?? "unknown"} /></td>
                    <td className="py-3.5 pr-3"><code className="font-mono text-xs">{log.execution_mode ?? "unknown"}</code></td>
                    <td className="py-3.5 pr-3 font-mono text-xs tabular-nums">{typeof log.upstream_status === "number" ? log.upstream_status : "n/a"}</td>
                    <td className="py-3.5 pr-3 font-mono text-xs tabular-nums">{typeof log.latency_ms === "number" ? `${log.latency_ms}ms` : "n/a"}</td>
                    <td className="py-3.5 pr-3"><code className="font-mono text-xs text-neutral-500">{log.trace_id ?? "no_trace"}</code></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </>
  );
}

function PageHeader() {
  return (
    <header className="console-hero px-5 py-8 sm:px-9">
      <div className="relative z-10 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <h1 className="text-3xl font-semibold tracking-tight text-neutral-950">Analytics</h1>
          <p className="mt-1.5 text-sm text-neutral-600">
            Runtime usage, latency, errors, and tool activity from hosted MCP calls.
          </p>
        </div>
        <span className="pill pill-brand">Runtime logs</span>
      </div>
    </header>
  );
}

function MetricCard({ label, value, detail }: { label: string; value: string | number; detail: string }) {
  return (
    <div className="console-card p-5">
      <p className="text-xs text-neutral-400">{label}</p>
      <p className="mt-2 font-mono text-3xl font-semibold tabular-nums tracking-tight text-neutral-950">{value}</p>
      <span className="pill pill-neutral mt-3">{detail}</span>
    </div>
  );
}

function StatRow({ label, value }: { label: string; value: number }) {
  return (
    <div className="console-table-row flex items-center justify-between gap-4 py-3 text-sm">
      <StatusPill status={label} />
      <span className="font-mono font-medium tabular-nums text-neutral-950">{value}</span>
    </div>
  );
}

const statusPillTones: Record<string, string> = {
  success: "pill-success",
  live: "pill-success",
  error: "pill-danger",
  auth_required: "pill-danger",
  oauth_required: "pill-danger",
  mapping_required: "pill-danger",
  browser_runtime_required: "pill-danger",
  processing: "pill-info",
};

function StatusPill({ status }: { status: string }) {
  const tone = statusPillTones[status] ?? "pill-neutral";
  return <span className={`pill ${tone}`}>{status}</span>;
}

function RankedList({ title, items, empty }: { title: string; items: Array<{ name: string; count: number }>; empty: string }) {
  return (
    <section className="section-card">
      <div className="section-card-header">
        <h2 className="text-lg font-semibold text-neutral-950">{title}</h2>
      </div>
      {items.length === 0 ? (
        <p className="text-sm text-neutral-500">{empty}</p>
      ) : (
        <div>
          {items.map((item) => (
            <div key={item.name} className="console-table-row flex items-center justify-between gap-4 py-3 text-sm">
              <code className="break-all font-mono text-xs text-neutral-600">{item.name}</code>
              <span className="font-mono font-medium tabular-nums text-neutral-950">{item.count}</span>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

function EmptyAnalyticsState() {
  return (
    <p className="text-sm text-neutral-500">
      No runtime logs yet. Test a hosted MCP endpoint to populate analytics.
    </p>
  );
}

function countBy<T extends Record<string, unknown>>(items: T[], key: keyof T, value: unknown) {
  return items.filter((item) => item[key] === value).length;
}

function average(values: number[]) {
  if (values.length === 0) return null;
  return Math.round(values.reduce((sum, value) => sum + value, 0) / values.length);
}

function percentile(values: number[], ratio: number) {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * ratio) - 1)];
}

function topCounts(values: string[], limit: number) {
  const counts = new Map<string, number>();
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
  return Array.from(counts.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([name, count]) => ({ name, count }));
}

function dailyBuckets(logs: RuntimeLog[], days: number) {
  const formatter = new Intl.DateTimeFormat("en", { month: "short", day: "numeric" });
  const buckets = Array.from({ length: days }).map((_, index) => {
    const date = new Date();
    date.setHours(0, 0, 0, 0);
    date.setDate(date.getDate() - (days - index - 1));
    const key = localDateKey(date);
    return {
      date: key,
      label: formatter.format(date),
      count: 0,
      width: 0,
    };
  });
  const bucketByDate = new Map(buckets.map((bucket) => [bucket.date, bucket]));
  for (const log of logs) {
    const key = localDateKey(new Date(log.created_at));
    const bucket = bucketByDate.get(key);
    if (bucket) bucket.count += 1;
  }
  const max = Math.max(1, ...buckets.map((bucket) => bucket.count));
  return buckets.map((bucket) => ({
    ...bucket,
    width: Math.round((bucket.count / max) * 100),
  }));
}

function localDateKey(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}
