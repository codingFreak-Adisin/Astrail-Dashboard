import Link from "next/link";
import Image from "next/image";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { ArrowUpRight, Check, Copy, ExternalLink, Plus, Terminal } from "lucide-react";
import { Button } from "@/components/ui/button";
import { accountFirstName, timeGreeting, timezoneFromHeaders } from "@/lib/account-display";
import { presetServers } from "@/lib/preset-servers";
import { getRuntimeAnalytics, type RuntimeAnalytics } from "@/lib/runtime/analytics";
import { createDataClient, createServerSupabaseClient } from "@/lib/supabase/server";
import { hasServerSupabaseEnv } from "@/lib/supabase/env";
import type { McpServer } from "@/lib/types";

const appTiles = [
  { name: "OpenAPI", detail: "API docs", icon: "/app-icons/openapi.svg", iconBg: "bg-emerald-50", href: "/dashboard/generate" },
  { name: "Website to MCP", detail: "public pages", icon: "/brand/astrail-prism-icon.svg", iconBg: "bg-lime-50", href: "/dashboard/website-to-mcp" },
  { name: "GitHub", detail: "repos", icon: "/app-icons/github.svg", iconBg: "bg-neutral-50", href: "/marketplace/preset-github" },
  { name: "Linear", detail: "issues", icon: "/app-icons/linear.svg", iconBg: "bg-indigo-50", href: "/marketplace/preset-linear" },
  { name: "Notion", detail: "docs", icon: "/app-icons/notion.svg", iconBg: "bg-neutral-50", href: "/marketplace/preset-notion" },
  { name: "Slack", detail: "messages", icon: "/app-icons/slack.svg", iconBg: "bg-white", href: "/marketplace/preset-slack" },
  { name: "Airtable", detail: "tables", icon: "/app-icons/airtable.svg", iconBg: "bg-sky-50", href: "/marketplace/preset-airtable" },
  { name: "Stripe", detail: "payments", icon: "/app-icons/stripe.svg", iconBg: "bg-violet-50", href: "/marketplace/preset-stripe" },
  { name: "HubSpot", detail: "CRM", icon: "/app-icons/hubspot.svg", iconBg: "bg-orange-50", href: "/marketplace/preset-hubspot" },
  { name: "Jira", detail: "tickets", icon: "/app-icons/jira.svg", iconBg: "bg-blue-50", href: "/marketplace/preset-jira" },
  { name: "Google Drive", detail: "files", icon: "/app-icons/googledrive.svg", iconBg: "bg-blue-50", href: "/marketplace/preset-google-drive" },
  { name: "Gmail", detail: "email", icon: "/app-icons/gmail.svg", iconBg: "bg-red-50", href: "/marketplace/preset-gmail" },
  { name: "Calendar", detail: "events", icon: "/app-icons/googlecalendar.svg", iconBg: "bg-blue-50", href: "/marketplace/preset-google-calendar" },
  { name: "Sheets", detail: "spreadsheets", icon: "/app-icons/googlesheets.svg", iconBg: "bg-green-50", href: "/marketplace/preset-google-sheets" },
  { name: "Docs", detail: "documents", icon: "/app-icons/googledocs.svg", iconBg: "bg-blue-50", href: "/marketplace/preset-google-docs" },
  { name: "Discord", detail: "community", icon: "/app-icons/discord.svg", iconBg: "bg-indigo-50", href: "/marketplace/preset-discord" },
  { name: "Figma", detail: "design", icon: "/app-icons/figma.svg", iconBg: "bg-rose-50", href: "/marketplace/preset-figma" },
  { name: "Shopify", detail: "commerce", icon: "/app-icons/shopify.svg", iconBg: "bg-lime-50", href: "/marketplace/preset-shopify" },
  { name: "Zendesk", detail: "support", icon: "/app-icons/zendesk.svg", iconBg: "bg-emerald-50", href: "/marketplace/preset-zendesk" },
  { name: "Intercom", detail: "support", icon: "/app-icons/intercom.svg", iconBg: "bg-cyan-50", href: "/marketplace/preset-intercom" },
  { name: "Supabase", detail: "backend", icon: "/app-icons/supabase.svg", iconBg: "bg-emerald-50", href: "/marketplace/preset-supabase" },
  { name: "Postgres", detail: "database", icon: "/app-icons/postgresql.svg", iconBg: "bg-blue-50", href: "/marketplace/preset-postgres" },
  { name: "MongoDB", detail: "database", icon: "/app-icons/mongodb.svg", iconBg: "bg-green-50", href: "/marketplace/preset-mongodb" },
  { name: "GitLab", detail: "code", icon: "/app-icons/gitlab.svg", iconBg: "bg-orange-50", href: "/marketplace/preset-gitlab" },
  { name: "Bitbucket", detail: "code", icon: "/app-icons/bitbucket.svg", iconBg: "bg-blue-50", href: "/marketplace/preset-bitbucket" },
  { name: "Vercel", detail: "deploys", icon: "/app-icons/vercel.svg", iconBg: "bg-neutral-50", href: "/marketplace/preset-vercel" },
  { name: "Sentry", detail: "errors", icon: "/app-icons/sentry.svg", iconBg: "bg-purple-50", href: "/marketplace/preset-sentry" },
  { name: "Cloudflare", detail: "edge", icon: "/app-icons/cloudflare.svg", iconBg: "bg-orange-50", href: "/marketplace/preset-cloudflare" },
  { name: "Docker", detail: "containers", icon: "/app-icons/docker.svg", iconBg: "bg-sky-50", href: "/marketplace/preset-docker" },
  { name: "Kubernetes", detail: "clusters", icon: "/app-icons/kubernetes.svg", iconBg: "bg-blue-50", href: "/marketplace/preset-kubernetes" },
  { name: "Anthropic", detail: "models", icon: "/app-icons/anthropic.svg", iconBg: "bg-neutral-50", href: "/marketplace/preset-anthropic" },
  { name: "Mistral", detail: "models", icon: "/app-icons/mistralai.svg", iconBg: "bg-orange-50", href: "/marketplace/preset-mistral" },
  { name: "Perplexity", detail: "search", icon: "/app-icons/perplexity.svg", iconBg: "bg-cyan-50", href: "/marketplace/preset-perplexity" },
  { name: "Asana", detail: "tasks", icon: "/app-icons/asana.svg", iconBg: "bg-rose-50", href: "/marketplace/preset-asana" },
  { name: "Trello", detail: "boards", icon: "/app-icons/trello.svg", iconBg: "bg-blue-50", href: "/marketplace/preset-trello" },
  { name: "Zoom", detail: "meetings", icon: "/app-icons/zoom.svg", iconBg: "bg-blue-50", href: "/marketplace/preset-zoom" },
  { name: "Dropbox", detail: "files", icon: "/app-icons/dropbox.svg", iconBg: "bg-blue-50", href: "/marketplace/preset-dropbox" },
  { name: "Custom API", detail: "endpoint map", icon: "/brand/astrail-prism-icon.svg", iconBg: "bg-amber-50", href: "/dashboard/generate" },
];

const previewAppTiles = appTiles.slice(0, 12);
const ACTIVITY_YEAR = 2026;
const DAY_MS = 24 * 60 * 60 * 1000;

type ServerActivityDay = {
  date: string;
  count: number;
};

function Heatmap({ activityDays }: { activityDays: ServerActivityDay[] }) {
  const days = 7;
  const gapSize = "clamp(2px, 0.22vw, 4px)";
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const yearStart = new Date(ACTIVITY_YEAR, 0, 1);
  const yearEnd = new Date(ACTIVITY_YEAR, 11, 31);
  const visibleEnd = today.getFullYear() === ACTIVITY_YEAR
    ? today
    : today.getFullYear() > ACTIVITY_YEAR
      ? yearEnd
      : yearStart;
  const gridStart = new Date(yearStart);
  gridStart.setDate(yearStart.getDate() - yearStart.getDay());
  const gridEnd = new Date(yearEnd);
  gridEnd.setDate(yearEnd.getDate() + (days - 1 - yearEnd.getDay()));
  const cellCount = Math.floor((gridEnd.getTime() - gridStart.getTime()) / DAY_MS) + 1;
  const weeks = Math.max(1, Math.ceil(cellCount / days));

  const formatter = new Intl.DateTimeFormat("en", { month: "short", day: "numeric" });
  const monthFormatter = new Intl.DateTimeFormat("en", { month: "short" });
  const currentYearActivity = activityDays.filter((item) => item.date.startsWith(`${ACTIVITY_YEAR}-`));
  const serversByDate = new Map(currentYearActivity.map((item) => [item.date, item.count]));
  const maxDaily = Math.max(1, ...currentYearActivity.map((item) => item.count));
  const hasActivity = currentYearActivity.some((item) => item.count > 0);
  const totalGenerated = currentYearActivity.reduce((sum, item) => sum + item.count, 0);
  const activeActivityDays = currentYearActivity.filter((item) => item.count > 0);
  const recentActivity = [...activeActivityDays].sort((a, b) => b.date.localeCompare(a.date)).slice(0, 4);

  const cells = Array.from({ length: cellCount }, (_, index) => {
    const date = new Date(gridStart);
    date.setDate(gridStart.getDate() + index);
    const dateKey = localDateKey(date);
    const isCurrentYear = date.getFullYear() === ACTIVITY_YEAR;
    const isVisibleDay = isCurrentYear && date <= visibleEnd;
    const count = serversByDate.get(dateKey) ?? 0;
    const level = count === 0 ? 0 : count >= maxDaily ? 4 : Math.max(1, Math.ceil((count / maxDaily) * 4));

    return {
      count,
      date,
      dateKey,
      isCurrentYear,
      isVisibleDay,
      level,
      label: `${count} MCP ${count === 1 ? "server" : "servers"} generated on ${formatter.format(date)}`,
    };
  });

  const monthLabels = Array.from({ length: 12 }, (_, monthOffset) => {
    const date = new Date(ACTIVITY_YEAR, monthOffset, 1);
    return {
      label: monthFormatter.format(date),
      column: Math.floor((date.getTime() - gridStart.getTime()) / (DAY_MS * days)) + 1,
    };
  });

  const colorByLevel = [
    "bg-neutral-100",
    "bg-orange-100",
    "bg-orange-200",
    "bg-orange-400",
    "bg-orange-600",
  ];

  return (
    <div>
      <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-orange-600">Activity</p>
          <h2 className="mt-1 text-2xl font-semibold tracking-tight text-neutral-950">
            <span className="font-mono tabular-nums">{totalGenerated.toLocaleString()}</span> MCP {totalGenerated === 1 ? "server" : "servers"} generated in {ACTIVITY_YEAR}
          </h2>
        </div>
        <span className="w-fit rounded-md border border-neutral-200 bg-white px-3 py-1.5 font-mono text-xs text-neutral-500">{activeActivityDays.length.toLocaleString()} active days</span>
      </div>
      {recentActivity.length > 0 ? (
        <div className="mb-4 grid gap-2 sm:hidden">
          {recentActivity.map((day) => (
            <Link
              key={day.date}
              href={`/dashboard?activityDate=${day.date}`}
              className="flex items-center justify-between rounded-lg border border-neutral-200 bg-white px-3 py-3 text-sm shadow-sm"
            >
              <span className="font-medium text-neutral-950">{formatActivityDate(day.date)}</span>
              <span className="rounded-md bg-orange-50 px-2.5 py-1 text-xs font-semibold text-orange-700">
                {day.count} generated
              </span>
            </Link>
          ))}
        </div>
      ) : null}
      <div className="overflow-hidden pb-1">
        <div className="w-full min-w-0">
          <div
            className="mb-2 grid pl-9 font-mono text-[11px] leading-none text-neutral-400"
            style={{ gap: gapSize, gridTemplateColumns: `repeat(${weeks}, minmax(0, 1fr))` }}
          >
            {monthLabels.map((month) => (
              <span key={month.label} className="truncate" style={{ gridColumn: `${month.column} / span 4` }}>
                {month.label}
              </span>
            ))}
          </div>
          <div className="grid grid-cols-[28px_1fr] gap-2">
            <div
              className="grid font-mono text-[11px] leading-none text-neutral-400"
              style={{ gap: gapSize, gridTemplateRows: "repeat(7, minmax(0, 1fr))" }}
            >
              <span />
              <span className="flex items-center">Mon</span>
              <span />
              <span className="flex items-center">Wed</span>
              <span />
              <span className="flex items-center">Fri</span>
              <span />
            </div>
            <div
              className="grid grid-flow-col grid-rows-7"
              style={{
                gap: gapSize,
                gridTemplateColumns: `repeat(${weeks}, minmax(0, 1fr))`,
                gridTemplateRows: "repeat(7, minmax(0, 1fr))",
              }}
            >
              {cells.map((cell) => {
                const className = cell.isVisibleDay
                  ? `rounded-[4px] ${colorByLevel[cell.level]} shadow-sm ${cell.count > 0 ? "transition hover:ring-2 hover:ring-orange-400" : ""}`
                  : cell.isCurrentYear
                    ? "rounded-[4px] bg-neutral-50"
                  : "rounded-[4px] bg-transparent";
                const style = { aspectRatio: "1 / 1", width: "100%" };

                return cell.count > 0 && cell.isVisibleDay ? (
                  <Link
                    key={cell.date.toISOString()}
                    href={`/dashboard?activityDate=${cell.dateKey}`}
                    title={cell.label}
                    aria-label={cell.label}
                    className={className}
                    style={style}
                  />
                ) : (
                  <span
                    key={cell.date.toISOString()}
                    title={cell.label}
                    aria-label={cell.label}
                    className={className}
                    style={style}
                  />
                );
              })}
            </div>
          </div>
        </div>
      </div>
      <div className="mt-4 flex items-center justify-end gap-2 border-t border-neutral-100 pt-4 font-mono text-[11px] text-neutral-400">
        {!hasActivity ? <span className="mr-auto">No MCP servers generated yet</span> : null}
        <span>Less</span>
        {colorByLevel.map((color) => (
          <span key={color} className={`h-3 w-3 rounded-sm ${color}`} />
        ))}
        <span>More</span>
      </div>
    </div>
  );
}

function localDateKey(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function normalizeActivityDate(value?: string) {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return undefined;
  const date = new Date(`${value}T00:00:00`);
  if (Number.isNaN(date.getTime())) return undefined;
  return localDateKey(date) === value ? value : undefined;
}

function formatActivityDate(value: string) {
  const date = new Date(`${value}T00:00:00`);
  return new Intl.DateTimeFormat("en", { month: "short", day: "numeric", year: "numeric" }).format(date);
}

function buildServerActivity(items: McpServer[]): ServerActivityDay[] {
  const counts = new Map<string, number>();

  for (const item of items) {
    const date = new Date(item.created_at);
    if (Number.isNaN(date.getTime())) continue;
    const key = localDateKey(date);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }

  return Array.from(counts, ([date, count]) => ({ date, count })).sort((a, b) => a.date.localeCompare(b.date));
}

function AppCard({ tile, connected }: { tile: (typeof appTiles)[number]; connected?: boolean }) {
  return (
    <Link href={tile.href} className="group flex items-center justify-between rounded-lg border border-neutral-200 bg-white p-5 shadow-sm transition hover:border-neutral-300">
      <div className="flex items-center gap-4">
        <span className={`grid h-10 w-10 place-items-center rounded-lg border border-neutral-200 ${tile.iconBg}`}>
          <Image src={tile.icon} alt="" width={28} height={28} className="h-6 w-6 object-contain" />
        </span>
        <div>
          <p className="font-medium text-neutral-950">{tile.name}</p>
          <p className="mt-0.5 text-xs text-neutral-500">{tile.detail}</p>
        </div>
      </div>
      {connected ? (
        <span className="inline-flex items-center gap-1 rounded-md bg-emerald-50 px-3 py-1 text-sm font-medium text-emerald-700">
          <Check className="h-3.5 w-3.5" />
          Live
        </span>
      ) : (
        <span className="inline-flex items-center gap-1 text-sm text-neutral-500 group-hover:text-neutral-950">
          <Plus className="h-3.5 w-3.5" />
          Add
        </span>
      )}
    </Link>
  );
}

function InstallPanel({ firstServer }: { firstServer?: McpServer }) {
  const endpoint = firstServer?.hosted_endpoint ?? "/api/mcp/:serverId";

  return (
    <div className="console-card p-6">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">Use Astrail with any MCP client</h2>
        </div>
        <Terminal className="h-5 w-5 text-neutral-400" />
      </div>
      <div className="mt-5 min-w-0 rounded-lg border border-orange-100 bg-[#f4f4ff] p-4 font-mono text-sm font-medium text-orange-700">
        <div className="flex min-w-0 items-start justify-between gap-4">
          <pre className="min-w-0 whitespace-pre-wrap break-words">{`curl -X POST ${endpoint}
  -H "Content-Type: application/json"
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'`}</pre>
          <Copy className="h-4 w-4 shrink-0" />
        </div>
      </div>
      <div className="mt-5 overflow-hidden rounded-lg border border-neutral-200 bg-neutral-50 text-sm">
        <div className="flex gap-1 border-b bg-neutral-100 px-4 py-3">
          <span className="h-3 w-3 rounded-full bg-red-400" />
          <span className="h-3 w-3 rounded-full bg-yellow-400" />
          <span className="h-3 w-3 rounded-full bg-green-400" />
        </div>
        <div className="space-y-3 p-4 text-neutral-500">
          <p>$ astrail generate https://petstore.swagger.io/v2/swagger.json</p>
          <p className="text-neutral-950">Found endpoint_map and tools_json</p>
          <p>$ astrail call {firstServer?.name ?? "petstore"} tools/list</p>
          <p className="text-emerald-700">safe_rest_execution ready</p>
        </div>
      </div>
    </div>
  );
}

async function loadUserServers(userId: string): Promise<McpServer[]> {
  try {
    const dataClient = createDataClient();
    const { data: servers, error } = await dataClient
      .from("mcp_servers")
      .select("*")
      .eq("user_id", userId)
      .order("created_at", { ascending: false });

    if (error) {
      console.warn("[dashboard] server list unavailable", {
        code: error.code,
        message: error.message,
      });
      return [];
    }

    return (servers ?? []) as McpServer[];
  } catch (error) {
    console.warn("[dashboard] server list unavailable", {
      name: error instanceof Error ? error.name : "unknown",
    });
    return [];
  }
}

export default async function DashboardPage({ searchParams }: { searchParams?: { activityDate?: string } }) {
  const selectedActivityDate = normalizeActivityDate(searchParams?.activityDate);
  const greeting = timeGreeting(new Date(), timezoneFromHeaders(headers()));

  if (!hasServerSupabaseEnv()) {
    const items: McpServer[] = [
      {
        id: "local-website-mcp",
        user_id: "local-preview",
        name: "Hacker News browser server",
        description: "Local Website-to-MCP preview generated from a public page.",
        source_url: "https://news.ycombinator.com",
        source_type: "website",
        generated_code: null,
        tools_json: [
          { name: "browser_open_page", description: "Open the page and summarize visible content." },
          { name: "browser_follow_link_top_story", description: "Follow a public story link." },
        ],
        status: "live",
        validation_status: "passed",
        generation_status: "completed",
        is_public: true,
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
        tools_json: presetServers[0]?.tools_json ?? [],
        status: "live",
        validation_status: "passed",
        generation_status: "completed",
        is_public: true,
        hosted_endpoint: "/api/mcp/local-openapi",
        call_count: 42,
        created_at: new Date().toISOString(),
      },
    ];
    const liveCount = items.filter((server) => server.status === "live").length;
    const publicCount = items.filter((server) => server.is_public).length;
    const analytics: Pick<RuntimeAnalytics, "dailyCalls" | "successCount" | "totalLoggedCalls"> = {
      dailyCalls: [],
      successCount: 0,
      totalLoggedCalls: 0,
    };
    const successRate = 0;
    const name = "Riza";
    const firstServer = items[0];

    return (
      <DashboardContent
        items={items}
        liveCount={liveCount}
        publicCount={publicCount}
        successRate={successRate}
        totalLoggedCalls={analytics.totalLoggedCalls}
        selectedActivityDate={selectedActivityDate}
        greeting={greeting}
        name={name}
        firstServer={firstServer}
      />
    );
  }

  const supabase = createServerSupabaseClient();
  const { data } = await supabase.auth.getUser();
  if (!data.user) redirect("/login");

  const items = await loadUserServers(data.user.id);
  const liveCount = items.filter((server) => server.status === "live").length;
  const publicCount = items.filter((server) => server.is_public).length;
  const analytics = await getRuntimeAnalytics(data.user.id);
  const successRate = analytics.totalLoggedCalls > 0 ? Math.round((analytics.successCount / analytics.totalLoggedCalls) * 100) : 0;
  const name = accountFirstName(data.user);
  const firstServer = items[0];

  return (
    <DashboardContent
      items={items}
      liveCount={liveCount}
      publicCount={publicCount}
      successRate={successRate}
      totalLoggedCalls={analytics.totalLoggedCalls}
      selectedActivityDate={selectedActivityDate}
      greeting={greeting}
      name={name}
      firstServer={firstServer}
    />
  );
}

function DashboardContent({
  items,
  liveCount,
  publicCount,
  successRate,
  totalLoggedCalls,
  selectedActivityDate,
  greeting,
  name,
  firstServer,
}: {
  items: McpServer[];
  liveCount: number;
  publicCount: number;
  successRate: number;
  totalLoggedCalls: number;
  selectedActivityDate?: string;
  greeting: string;
  name: string;
  firstServer?: McpServer;
}) {
  const activityDays = buildServerActivity(items);
  const selectedItems = selectedActivityDate
    ? items.filter((server) => localDateKey(new Date(server.created_at)) === selectedActivityDate)
    : [];
  const selectedDateLabel = selectedActivityDate ? formatActivityDate(selectedActivityDate) : null;

  return (
    <div className="mx-auto max-w-7xl space-y-8 md:space-y-10">
      <div className="rounded-lg border border-neutral-200 bg-white p-5 shadow-sm sm:p-6 md:border-0 md:bg-transparent md:p-0 md:shadow-none">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="text-sm font-medium text-neutral-500">Astrail console</p>
          <h1 className="mt-1 text-[2rem] font-semibold leading-[1.05] tracking-tight text-neutral-950 sm:text-3xl">{greeting}, {name}</h1>
        </div>
        <div className="grid gap-2 sm:flex sm:flex-wrap">
          <Button asChild variant="outline" className="h-12 w-full bg-white sm:h-10 sm:w-auto">
            <Link href="/marketplace">
              Browse catalog
              <ExternalLink className="ml-2 h-4 w-4" />
            </Link>
          </Button>
          <Button asChild className="h-12 w-full sm:h-10 sm:w-auto">
            <Link href="/dashboard/generate">Generate endpoint</Link>
          </Button>
        </div>
        </div>
      </div>

      <section className="console-card p-4 sm:p-6">
        <Heatmap activityDays={activityDays} />
        {selectedActivityDate && (
          <div className="mt-5 rounded-lg border border-orange-100 bg-orange-50/60 p-4">
            <div className="flex flex-col justify-between gap-2 sm:flex-row sm:items-center">
              <div>
                <p className="text-xs font-semibold uppercase tracking-wide text-orange-600">Generated on {selectedDateLabel}</p>
                <h2 className="mt-1 text-lg font-semibold text-neutral-950">
                  {selectedItems.length} MCP {selectedItems.length === 1 ? "server" : "servers"}
                </h2>
              </div>
              <Link href="/dashboard" className="text-sm font-medium text-neutral-500 hover:text-neutral-950">
                Clear day
              </Link>
            </div>
            {selectedItems.length === 0 ? (
              <p className="mt-3 text-sm text-neutral-500">No generated servers were found for this day.</p>
            ) : (
              <div className="mt-4 grid gap-3 md:grid-cols-2">
                {selectedItems.map((server) => (
                  <Link
                    key={server.id}
                    href={`/dashboard/servers/${server.id}`}
                    className="group flex items-center justify-between rounded-lg border border-neutral-200 bg-white p-4 shadow-sm transition hover:border-orange-200"
                  >
                    <div className="min-w-0">
                      <p className="truncate font-medium text-neutral-950">{server.name}</p>
                      <p className="mt-1 line-clamp-1 text-sm text-neutral-500">{server.description ?? "Generated MCP endpoint"}</p>
                    </div>
                    <ArrowUpRight className="ml-4 h-4 w-4 shrink-0 text-neutral-400 group-hover:text-orange-600" />
                  </Link>
                ))}
              </div>
            )}
          </div>
        )}
        <div className="mt-5 grid grid-cols-2 gap-3 border-t border-neutral-100 pt-5 sm:grid-cols-4 sm:gap-5">
          {[
            ["MCP generated", items.length],
            ["Hosted endpoints", items.length],
            ["Live endpoints", liveCount],
            ["Success rate", totalLoggedCalls > 0 ? `${successRate}%` : "n/a"],
          ].map(([label, value]) => (
            <div key={label} className="rounded-lg border border-neutral-100 bg-white p-4 sm:border-0 sm:bg-transparent sm:p-0">
              <p className="text-sm text-neutral-500">{label}</p>
              <p className="mt-1 text-2xl font-semibold tracking-tight text-neutral-950">{value}</p>
            </div>
          ))}
        </div>
      </section>

      <section>
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-xl font-semibold">Explore what is possible</h2>
          <Link href="/marketplace" className="text-sm text-neutral-500 hover:text-neutral-950">
            See all tools
          </Link>
        </div>
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          {previewAppTiles.map((tile, index) => (
            <AppCard key={tile.name} tile={tile} connected={index === 0 && liveCount > 0} />
          ))}
        </div>
      </section>

      <section className="grid min-w-0 gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
        <div className="min-w-0 space-y-6">
          <div className="console-card p-6">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h2 className="text-xl font-semibold">New endpoint</h2>
              </div>
            </div>
            <div className="mt-6 grid gap-3">
              {[
                { label: "OpenAPI / Swagger", href: "/dashboard/generate", icon: "/app-icons/openapi.svg", iconBg: "bg-emerald-50" },
                { label: "Website to MCP", href: "/dashboard/website-to-mcp", icon: "/brand/astrail-prism-icon.svg", iconBg: "bg-lime-50" },
                { label: "SDK bundle", href: "/dashboard/sdk", icon: "/brand/astrail-prism-icon.svg", iconBg: "bg-neutral-50" },
              ].map((item) => (
                <div key={item.label} className="flex items-center gap-3 rounded-lg border border-neutral-200 bg-white p-4">
                  <span className={`grid h-10 w-10 shrink-0 place-items-center rounded-lg border border-neutral-200 ${item.iconBg}`}>
                    <Image src={item.icon} alt="" width={28} height={28} className="h-6 w-6 object-contain" />
                  </span>
                  <p className="min-w-0 flex-1 font-medium">{item.label}</p>
                  <Button asChild variant="outline" className="bg-white">
                    <Link href={item.href}>
                      Start
                      <ArrowUpRight className="ml-2 h-4 w-4" />
                    </Link>
                  </Button>
                </div>
              ))}
            </div>
          </div>

          <div className="console-card p-6">
            <h2 className="text-xl font-semibold">Recent endpoints</h2>
            <div className="mt-4 divide-y overflow-hidden rounded-lg border border-neutral-200 bg-white">
              {items.length === 0 ? (
                <div className="p-4 text-sm text-neutral-500">No hosted endpoints yet. Generate Petstore or paste your first API spec.</div>
              ) : (
                items.slice(0, 4).map((server) => (
                  <Link
                    key={server.id}
                    href={`/dashboard/servers/${server.id}`}
                    className="flex items-center justify-between gap-4 p-4 text-sm transition hover:bg-neutral-50"
                  >
                    <div className="min-w-0">
                      <p className="truncate font-medium text-neutral-950">{server.name}</p>
                      <p className="truncate text-neutral-500">{server.hosted_endpoint}</p>
                    </div>
                    <span className="shrink-0 text-neutral-500">{server.call_count ?? 0} calls</span>
                  </Link>
                ))
              )}
            </div>
          </div>
        </div>

        <div className="min-w-0">
          <InstallPanel firstServer={firstServer} />
        </div>
      </section>

      <section className="grid gap-4 md:grid-cols-3">
        {[
          ["Templates", presetServers.length],
          ["Published", publicCount],
          ["Runtime", "No eval"],
        ].map(([title, value]) => (
          <div key={title} className="console-card p-5">
            <p className="text-sm text-neutral-500">{title}</p>
            <p className="mt-2 text-2xl font-semibold">{value}</p>
          </div>
        ))}
      </section>
    </div>
  );
}
