import Link from "next/link";
import { Suspense, type ReactNode } from "react";
import { ChevronRight } from "lucide-react";
import { BundleCreateForm } from "@/components/BundleCreateForm";
import { EndpointBox } from "@/components/EndpointBox";
import { getDashboardSessionUser } from "@/lib/dashboard-session";
import { hasServerSupabaseEnv } from "@/lib/supabase/env";
import { createAdminClient } from "@/lib/supabase/server";

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
      <BundlesShell>
        <BundlesContent
          bundles={bundles}
          serverOptions={serverOptions}
          tableMissing={false}
          errorMessage={null}
        />
      </BundlesShell>
    );
  }

  const user = await getDashboardSessionUser();

  return (
    <BundlesShell>
      <Suspense fallback={<BundlesFallback />}>
        <UserBundlesContent userId={user.id} />
      </Suspense>
    </BundlesShell>
  );
}

async function UserBundlesContent({ userId }: { userId: string }) {
  const admin = createAdminClient();

  const { data: bundles, error } = await admin
    .from("mcp_bundles")
    .select("id,name,hosted_endpoint,is_public,created_at")
    .eq("user_id", userId)
    .order("created_at", { ascending: false });

  const tableMissing = error?.message.toLowerCase().includes("mcp_bundles");
  const { data: servers } = await admin
    .from("mcp_servers")
    .select("id,name,tools_json")
    .eq("user_id", userId)
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

function BundlesShell({ children }: { children: ReactNode }) {
  return (
    <div className="mx-auto max-w-6xl space-y-5">
      <header className="console-hero px-5 py-8 sm:px-9">
        <div className="relative z-10 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0">
            <h1 className="text-3xl font-semibold tracking-tight text-neutral-950">Bundles</h1>
            <p className="mt-1.5 text-sm text-neutral-600">Expose one MCP endpoint across your selected servers.</p>
          </div>
        </div>
      </header>

      {children}
    </div>
  );
}

function BundlesFallback() {
  return (
    <div className="grid gap-4 lg:grid-cols-[420px_1fr]">
      <section className="section-card">
        <div className="section-card-header">
          <h2 className="text-lg font-semibold text-neutral-950">Create bundle</h2>
        </div>
        <div className="space-y-3">
          <div className="h-10 rounded-xl bg-neutral-100" />
          <div className="h-28 rounded-xl bg-neutral-100" />
        </div>
      </section>
      <section className="section-card">
        <div className="section-card-header">
          <h2 className="text-lg font-semibold text-neutral-950">Loading bundles</h2>
        </div>
        <p className="text-sm text-neutral-500">
          Fetching your servers and bundle endpoints...
        </p>
      </section>
    </div>
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
    <>
      {tableMissing ? (
        <section className="section-card">
          <div className="section-card-header">
            <h2 className="text-lg font-semibold text-neutral-950">Bundle schema required</h2>
          </div>
          <p className="text-sm text-neutral-500">
            Bundle storage is not enabled yet. Apply the bundle migration before launch.
          </p>
        </section>
      ) : errorMessage ? (
        <section className="section-card">
          <div className="section-card-header">
            <h2 className="text-lg font-semibold text-neutral-950">Could not load bundles</h2>
          </div>
          <p className="text-sm text-red-600">{errorMessage}</p>
        </section>
      ) : bundles.length === 0 ? (
        <div className="grid gap-4 lg:grid-cols-[420px_1fr]">
          <section className="section-card">
            <div className="section-card-header">
              <h2 className="text-lg font-semibold text-neutral-950">Create bundle</h2>
            </div>
            <BundleCreateForm servers={serverOptions} />
          </section>
          <section className="section-card">
            <div className="section-card-header">
              <h2 className="text-lg font-semibold text-neutral-950">No bundles yet</h2>
            </div>
            <div className="space-y-2 text-sm text-neutral-500">
              <p>Bundles expose one MCP endpoint across selected servers.</p>
              <code className="block rounded-xl bg-neutral-100 p-2 font-mono">/api/mcp/bundles/&lt;bundleId&gt;</code>
            </div>
          </section>
        </div>
      ) : (
        <div className="grid gap-4 lg:grid-cols-[420px_1fr]">
          <section className="section-card">
            <div className="section-card-header">
              <h2 className="text-lg font-semibold text-neutral-950">Create bundle</h2>
            </div>
            <BundleCreateForm servers={serverOptions} />
          </section>
          <div className="grid gap-4">
            {bundles.map((bundle) => {
              const endpoint = bundle.hosted_endpoint ?? `/api/mcp/bundles/${bundle.id}`;
              return (
                <section key={bundle.id} className="section-card">
                  <div className="section-card-header">
                    <h2 className="text-lg font-semibold text-neutral-950">{bundle.name}</h2>
                    <span className={bundle.is_public ? "pill pill-brand" : "pill pill-neutral"}>
                      {bundle.is_public ? "Public" : "Private"}
                    </span>
                  </div>
                  <EndpointBox
                    endpoint={endpoint}
                    label="Bundle MCP endpoint"
                    note="Use this URL in Claude Desktop or an MCP client to expose all bundled tools through one connection."
                  />
                  <Link
                    href={`/dashboard/bundles/${bundle.id}`}
                    className="mt-3 inline-flex items-center gap-1 text-sm font-medium text-neutral-500 transition hover:text-neutral-950"
                  >
                    Open bundle detail
                    <ChevronRight className="h-3.5 w-3.5" />
                  </Link>
                </section>
              );
            })}
          </div>
        </div>
      )}
    </>
  );
}
