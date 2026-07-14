import Link from "next/link";
import { Suspense, type ReactNode } from "react";
import {
  BookOpen,
  ChevronRight,
  Code2,
  FileText,
  GitBranch,
  Package,
  Rocket,
  ShieldCheck,
  Terminal,
} from "lucide-react";
import { SdkExportPanel } from "@/components/SdkExportPanel";
import { SdkGeneratorActions } from "@/components/SdkGeneratorActions";
import { Button } from "@/components/ui/button";
import { getDashboardSessionUser } from "@/lib/dashboard-session";
import { localDemoServers } from "@/lib/local-demo";
import { visibleEndpointsForRequest } from "@/lib/runtime/permissions";
import { hasServerSupabaseEnv } from "@/lib/supabase/env";
import { createAdminClient } from "@/lib/supabase/server";
import type { McpServer } from "@/lib/types";

const sdkCapabilities = [
  {
    id: "targets",
    icon: Package,
    tile: "tile-pastel-amber",
    title: "Language targets",
    description: "Typed clients for TypeScript, Python, Go, Java, Ruby, PHP, and CLI.",
    points: ["request helpers", "auth env wiring", "examples per operation"],
  },
  {
    id: "docs",
    icon: FileText,
    tile: "tile-pastel-blue",
    title: "Docs + examples",
    description: "Reference pages, quickstarts, copyable snippets, and an llms.txt export.",
    points: ["search-ready docs", "usage examples", "install instructions"],
  },
  {
    id: "cli",
    icon: Terminal,
    tile: "tile-pastel-orange",
    title: "CLI + manifests",
    description: "Command wrappers, MCP manifests, install files, and endpoint catalogs.",
    points: ["mcp.json", "tool catalog", "local smoke command"],
  },
  {
    id: "ci",
    icon: ShieldCheck,
    tile: "tile-pastel-green",
    title: "Tests + CI",
    description: "Generated smoke tests plus GitHub Actions to verify every shipped client.",
    points: ["schema checks", "sample calls", "publish guards"],
  },
  {
    id: "publish",
    icon: GitBranch,
    tile: "tile-pastel-violet",
    title: "Publish workflow",
    description: "Pull, verify, open PR, and release SDK packages from the same bundle.",
    points: ["release scripts", "package metadata", "reviewable diffs"],
  },
  {
    id: "versioning",
    icon: Rocket,
    tile: "tile-pastel-rose",
    title: "Versioning",
    description: "Semver notes, endpoint diff summaries, and changelog-ready output.",
    points: ["breaking changes", "new endpoints", "migration notes"],
  },
] as const;

const sdkFlow = [
  ["1", "Pick endpoint", "Use any generated MCP or Website to MCP endpoint as source."],
  ["2", "Generate bundle", "Download clients, docs, tests, manifests, and workflows."],
  ["3", "Ship package", "Run smoke tests, open a PR, then publish when ready."],
];

export default async function SdkGeneratorPage() {
  if (!hasServerSupabaseEnv()) {
    return <SdkGeneratorContent items={localDemoServers()} />;
  }

  const user = await getDashboardSessionUser();

  return (
    <SdkGeneratorContent
      items={[]}
      endpointCountLabel="..."
      endpointList={
        <Suspense fallback={<SdkEndpointListFallback />}>
          <UserSdkEndpointList userId={user.id} />
        </Suspense>
      }
    />
  );
}

async function UserSdkEndpointList({ userId }: { userId: string }) {
  const { data: servers, error } = await createAdminClient()
    .from("mcp_servers")
    .select("*")
    .eq("user_id", userId)
    .order("created_at", { ascending: false });

  if (error) throw new Error(error.message);
  return <SdkEndpointList items={(servers ?? []) as McpServer[]} />;
}

function SdkGeneratorContent({
  items,
  endpointCountLabel,
  endpointList,
}: {
  items: McpServer[];
  endpointCountLabel?: ReactNode;
  endpointList?: ReactNode;
}) {
  return (
    <div className="mx-auto max-w-6xl space-y-5">
      <header className="console-hero px-5 py-8 sm:px-9">
        <div className="relative z-10 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0">
            <h1 className="text-3xl font-semibold tracking-tight text-neutral-950">SDK Factory</h1>
            <p className="mt-1.5 text-sm text-neutral-600">
              Generate typed clients, docs, tests, and manifests from your hosted endpoints.
            </p>
          </div>
          <SdkGeneratorActions />
        </div>
      </header>

      <section id="generator" className="grid scroll-mt-6 gap-4 lg:grid-cols-[minmax(0,1.1fr)_360px]">
        <div className="section-card">
          <div className="section-card-header">
            <div>
              <h2 className="text-lg font-semibold text-neutral-950">Pick an endpoint, ship an SDK</h2>
              <p className="mt-0.5 text-xs text-neutral-400">Generate bundle</p>
            </div>
            <SdkGeneratorActions />
          </div>
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="rounded-xl border border-neutral-100 bg-neutral-50/80 p-4">
              <p className="text-xs text-neutral-400">Endpoints</p>
              <p className="mt-2 font-mono text-3xl font-semibold tabular-nums tracking-tight text-neutral-950">
                {endpointCountLabel ?? items.length}
              </p>
            </div>
            <div className="rounded-xl border border-neutral-100 bg-neutral-50/80 p-4">
              <p className="text-xs text-neutral-400">Languages</p>
              <p className="mt-2 font-mono text-3xl font-semibold tabular-nums tracking-tight text-neutral-950">7</p>
            </div>
            <div className="rounded-xl border border-neutral-100 bg-neutral-50/80 p-4">
              <p className="text-xs text-neutral-400">Artifacts</p>
              <p className="mt-2 text-3xl font-semibold tracking-tight text-neutral-950">Docs + CI</p>
            </div>
          </div>
        </div>

        <div className="section-card">
          <div className="section-card-header">
            <h2 className="text-lg font-semibold text-neutral-950">SDK workflow</h2>
          </div>
          <div className="grid gap-3">
            {sdkFlow.map(([step, title, description]) => (
              <div key={step} className="flex gap-3 rounded-xl border border-neutral-100 bg-neutral-50/60 p-3">
                <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-amber-100/80 font-mono text-sm font-semibold text-amber-800">
                  {step}
                </span>
                <span>
                  <span className="block text-sm font-semibold text-neutral-900">{title}</span>
                  <span className="mt-1 block text-xs leading-5 text-neutral-500">{description}</span>
                </span>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {sdkCapabilities.map((feature) => {
          const Icon = feature.icon;

          return (
            <div key={feature.id} id={feature.id} className={`tile-pastel ${feature.tile} scroll-mt-6`}>
              <div>
                <div className="flex items-start justify-between gap-2">
                  <span className="text-sm font-semibold leading-5 text-neutral-900">{feature.title}</span>
                  <Icon className="h-4 w-4 shrink-0 text-neutral-600" />
                </div>
                <p className="mt-1.5 text-xs leading-5 text-neutral-600">{feature.description}</p>
              </div>
              <div className="mt-3 flex flex-wrap gap-1.5">
                {feature.points.map((point) => (
                  <span key={point} className="pill w-fit bg-white/70 text-neutral-600">
                    {point}
                  </span>
                ))}
              </div>
            </div>
          );
        })}
      </section>

      <section className="space-y-4">
        <div>
          <p className="console-kicker">Available endpoints</p>
          <h2 className="mt-1 text-xl font-semibold text-neutral-950">Generate from your hosted endpoints</h2>
        </div>

        {endpointList ?? <SdkEndpointList items={items} />}
      </section>

      <div className="section-card flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-start gap-3">
          <span className="icon-btn">
            <BookOpen className="h-4 w-4" />
          </span>
          <div>
            <h2 className="text-base font-semibold text-neutral-950">Docs-first output</h2>
            <p className="mt-1 text-sm leading-6 text-neutral-500">
              Every SDK bundle includes reference docs, copyable examples, and install notes for the selected endpoint.
            </p>
          </div>
        </div>
        <Button asChild variant="outline">
          <Link href="/docs" className="inline-flex items-center gap-2">
            Open docs <Code2 className="h-4 w-4" />
          </Link>
        </Button>
      </div>
    </div>
  );
}

function SdkEndpointList({ items }: { items: McpServer[] }) {
  return items.length === 0 ? (
    <div className="section-card space-y-4">
      <p className="text-sm text-neutral-500">
        No servers yet. Generate one first, then come back for SDKs.
      </p>
      <div className="flex flex-wrap gap-2">
        <Button asChild>
          <Link href="/dashboard/generate">Generate from OpenAPI</Link>
        </Button>
        <Button asChild variant="outline">
          <Link href="/dashboard/website-to-mcp">Generate from website</Link>
        </Button>
      </div>
    </div>
  ) : (
    <div className="space-y-5">
      {items.map((server) => (
        <section key={server.id} className="grid gap-4 xl:grid-cols-[320px_minmax(0,1fr)]">
          <div className="section-card space-y-3">
            <div>
              <h2 className="text-lg font-semibold text-neutral-950">{server.name}</h2>
              <p className="mt-1.5 text-sm leading-6 text-neutral-500">
                {visibleEndpointsForRequest(server).length.toLocaleString()} endpoints ready for export.
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <span className="pill pill-neutral">{server.source_type ?? "mcp"}</span>
              <span className="pill pill-success">{server.status ?? "live"}</span>
            </div>
            <Link
              href={`/dashboard/servers/${server.id}`}
              className="inline-flex items-center gap-1 text-sm font-medium text-neutral-500 transition hover:text-neutral-950"
            >
              Open server detail <ChevronRight className="h-3.5 w-3.5" />
            </Link>
          </div>
          <div className="min-w-0">
            <SdkExportPanel serverId={server.id} serverName={server.name} />
          </div>
        </section>
      ))}
    </div>
  );
}

function SdkEndpointListFallback() {
  return (
    <div className="section-card space-y-3 text-sm text-neutral-500">
      <p className="font-medium text-neutral-900">Loading hosted endpoints</p>
      <div className="h-3 w-2/3 rounded-full bg-neutral-100" />
      <div className="h-3 w-1/2 rounded-full bg-neutral-100" />
    </div>
  );
}
