import { getDashboardSessionUser } from "@/lib/dashboard-session";
import { hasServerSupabaseEnv } from "@/lib/supabase/env";
import { createAdminClient, hasServiceRoleKey } from "@/lib/supabase/server";
import { formatDate } from "@/lib/utils";

type DesignPartnerRequest = {
  id: string;
  name: string;
  email: string;
  company: string;
  role: string | null;
  persona: "buyer" | "developer" | "workflow_owner" | string | null;
  agent_kind: string;
  workflow_goal: string | null;
  needed_api: string;
  systems_involved: string | null;
  has_api_docs: "yes" | "no" | string;
  api_docs_url_or_notes: string | null;
  approval_steps: string | null;
  auth_constraints: string | null;
  runtime_preference: "hosted" | "exported_code" | "self_hosted" | string;
  urgency: "today" | "this_week" | "exploring" | string;
  status: "new" | "contacted" | "mapped" | "generated" | "tested" | "onboarded" | "success" | string;
  created_at: string;
};

const statuses = ["new", "contacted", "mapped", "generated", "tested", "onboarded", "success"];
const urgencies = ["today", "this_week", "exploring"];
const preferences = ["hosted", "exported_code", "self_hosted"];
const personas = ["buyer", "developer", "workflow_owner"];

function urgencyPillTone(urgency: string) {
  if (urgency === "today") return "pill-danger";
  if (urgency === "this_week") return "pill-info";
  return "pill-neutral";
}

function statusPillTone(status: string) {
  if (status === "success" || status === "onboarded") return "pill-success";
  if (status === "contacted" || status === "mapped" || status === "generated" || status === "tested") return "pill-info";
  return "pill-neutral";
}

export default async function DesignPartnersDashboardPage() {
  if (!hasServerSupabaseEnv()) {
    return <DesignPartnersContent requests={localDesignPartnerRequests()} />;
  }

  await getDashboardSessionUser();

  if (!hasServiceRoleKey()) {
    return (
      <div className="mx-auto max-w-6xl space-y-5">
        <PageHeader />
        <div className="section-card">
          <div className="section-card-header">
            <h2 className="text-lg font-semibold text-neutral-950">Requests unavailable</h2>
          </div>
          <p className="text-sm text-neutral-500">
            Admin access is not enabled for this workspace yet.
          </p>
        </div>
      </div>
    );
  }

  const admin = createAdminClient();
  const { data: rows, error } = await admin
    .from("design_partner_requests")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(200);

  if (error) {
    const missingTable = error.code === "42P01" || /does not exist|schema cache/i.test(error.message);
    return (
      <div className="mx-auto max-w-6xl space-y-5">
        <PageHeader />
        <div className="section-card">
          <div className="section-card-header">
            <h2 className="text-lg font-semibold text-neutral-950">
              {missingTable ? "Migration required" : "Could not load requests"}
            </h2>
          </div>
          <p className="text-sm text-neutral-500">
            {missingTable
              ? "Request storage is not enabled yet. Apply the design partner request migration before launch."
              : error.message}
          </p>
        </div>
      </div>
    );
  }

  const requests = (rows ?? []) as DesignPartnerRequest[];
  return <DesignPartnersContent requests={requests} />;
}

function localDesignPartnerRequests(): DesignPartnerRequest[] {
  return [
    {
      id: "local-request-1",
      name: "Anthropic eval team",
      email: "demo@anthropic.com",
      company: "Anthropic",
      role: "Technical evaluator",
      persona: "developer",
      agent_kind: "Hosted MCP gateway for agent tools",
      workflow_goal: "Evaluate API-to-MCP, website-to-MCP, bundling, runtime logs, and auth boundaries.",
      needed_api: "OpenAPI specs, internal APIs, public websites, and endpoint docs",
      systems_involved: "Claude, GitHub, Slack, Notion, Linear, internal REST APIs",
      has_api_docs: "yes",
      api_docs_url_or_notes: "OpenAPI specs plus website-to-MCP alpha targets",
      approval_steps: "Safe public reads execute immediately; private actions require auth and review.",
      auth_constraints: "API keys and OAuth metadata are separated from generated tool descriptions.",
      runtime_preference: "hosted",
      urgency: "today",
      status: "mapped",
      created_at: new Date().toISOString(),
    },
  ];
}

function DesignPartnersContent({ requests }: { requests: DesignPartnerRequest[] }) {
  const todayCount = requests.filter((request) => request.urgency === "today").length;
  const docsCount = requests.filter((request) => request.has_api_docs === "yes").length;
  const workflowOwnerCount = requests.filter((request) => request.persona === "workflow_owner").length;
  const latest = requests.slice(0, 25);

  return (
    <div className="mx-auto max-w-6xl space-y-5">
      <PageHeader />

      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        <MetricCard label="Total requests" value={requests.length} detail={`${latest.length} shown below`} />
        <MetricCard label="Urgent" value={todayCount} detail="Need it today" />
        <MetricCard label="Has docs" value={docsCount} detail="API docs or OpenAPI available" />
        <MetricCard label="Workflow owners" value={workflowOwnerCount} detail="Business process owners" />
      </div>

      <div className="grid gap-4 xl:grid-cols-4">
        <CountCard title="Persona" labels={personas} requests={requests} field="persona" />
        <CountCard title="Urgency" labels={urgencies} requests={requests} field="urgency" />
        <CountCard title="Runtime preference" labels={preferences} requests={requests} field="runtime_preference" />
        <CountCard title="Status" labels={statuses} requests={requests} field="status" />
      </div>

      <div className="section-card">
        <div className="section-card-header">
          <div>
            <h2 className="text-lg font-semibold text-neutral-950">Latest requests</h2>
            <p className="mt-0.5 text-xs text-neutral-400">Most recent design partner intake</p>
          </div>
        </div>
        {latest.length === 0 ? (
          <p className="text-sm text-neutral-500">No design partner requests yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[1180px] text-left text-sm">
              <thead>
                <tr>
                  <th className="border-b border-neutral-100 pb-2.5 pr-3 text-left text-xs font-medium text-neutral-400">Created</th>
                  <th className="border-b border-neutral-100 pb-2.5 pr-3 text-left text-xs font-medium text-neutral-400">Person</th>
                  <th className="border-b border-neutral-100 pb-2.5 pr-3 text-left text-xs font-medium text-neutral-400">Company</th>
                  <th className="border-b border-neutral-100 pb-2.5 pr-3 text-left text-xs font-medium text-neutral-400">Workflow</th>
                  <th className="border-b border-neutral-100 pb-2.5 pr-3 text-left text-xs font-medium text-neutral-400">Systems / API</th>
                  <th className="border-b border-neutral-100 pb-2.5 pr-3 text-left text-xs font-medium text-neutral-400">Approvals / auth</th>
                  <th className="border-b border-neutral-100 pb-2.5 pr-3 text-left text-xs font-medium text-neutral-400">Urgency</th>
                  <th className="border-b border-neutral-100 pb-2.5 pr-3 text-left text-xs font-medium text-neutral-400">Runtime</th>
                  <th className="border-b border-neutral-100 pb-2.5 pr-3 text-left text-xs font-medium text-neutral-400">Docs</th>
                  <th className="border-b border-neutral-100 pb-2.5 pr-3 text-left text-xs font-medium text-neutral-400">Status</th>
                </tr>
              </thead>
              <tbody>
                {latest.map((request) => (
                  <tr key={request.id} className="border-b border-neutral-100 align-top last:border-b-0">
                    <td className="py-3.5 pr-3 text-sm text-neutral-500">{formatDate(request.created_at)}</td>
                    <td className="py-3.5 pr-3 text-sm">
                      <div className="font-medium text-neutral-900">{request.name}</div>
                      <a className="text-xs text-neutral-500 transition hover:text-neutral-950" href={`mailto:${request.email}`}>{request.email}</a>
                      {request.role ? <div className="text-xs text-neutral-400">{request.role}</div> : null}
                      {request.persona ? <div className="mt-1"><span className="pill pill-brand">{request.persona}</span></div> : null}
                    </td>
                    <td className="py-3.5 pr-3 text-sm text-neutral-900">{request.company}</td>
                    <td className="max-w-[280px] py-3.5 pr-3 text-sm">
                      <div className="line-clamp-3 text-neutral-900">{request.workflow_goal ?? request.agent_kind}</div>
                      <div className="mt-1 text-xs text-neutral-400 line-clamp-2">{request.agent_kind}</div>
                    </td>
                    <td className="max-w-[260px] py-3.5 pr-3 text-sm">
                      <div className="line-clamp-2 text-neutral-900">{request.systems_involved ?? "Not specified"}</div>
                      <div className="mt-1 text-xs text-neutral-400 line-clamp-2">{request.needed_api}</div>
                    </td>
                    <td className="max-w-[260px] py-3.5 pr-3 text-sm">
                      <div className="line-clamp-2 text-neutral-900">{request.approval_steps ?? "No approval notes"}</div>
                      <div className="mt-1 text-xs text-neutral-400 line-clamp-2">{request.auth_constraints ?? "No auth notes"}</div>
                    </td>
                    <td className="py-3.5 pr-3 text-sm">
                      <span className={`pill ${urgencyPillTone(request.urgency)}`}>{request.urgency}</span>
                    </td>
                    <td className="py-3.5 pr-3 text-sm">
                      <span className="pill pill-neutral">{request.runtime_preference}</span>
                    </td>
                    <td className="py-3.5 pr-3 text-sm">
                      <span className={`pill ${request.has_api_docs === "yes" ? "pill-success" : "pill-neutral"}`}>
                        {request.has_api_docs}
                      </span>
                      {request.api_docs_url_or_notes ? (
                        <div className="mt-1 max-w-[220px] truncate text-xs text-neutral-400">
                          {request.api_docs_url_or_notes}
                        </div>
                      ) : null}
                    </td>
                    <td className="py-3.5 pr-3 text-sm">
                      <span className={`pill ${statusPillTone(request.status)}`}>{request.status}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

function PageHeader() {
  return (
    <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-center">
      <div>
        <h1 className="text-3xl font-semibold tracking-tight text-neutral-950">Design partners</h1>
        <p className="mt-1.5 text-sm text-neutral-600">
          Real workflow and API demand from teams that need safe hosted agent actions.
        </p>
      </div>
      <span className="pill pill-brand">private admin</span>
    </div>
  );
}

function MetricCard({ label, value, detail }: { label: string; value: string | number; detail: string }) {
  return (
    <div className="console-card p-4">
      <p className="text-xs text-neutral-400">{label}</p>
      <p className="mt-2 font-mono text-3xl font-semibold tabular-nums tracking-tight text-neutral-950">{value}</p>
      <p className="mt-1 text-xs text-neutral-400">{detail}</p>
    </div>
  );
}

function CountCard({
  title,
  labels,
  requests,
  field,
}: {
  title: string;
  labels: string[];
  requests: DesignPartnerRequest[];
  field: "persona" | "urgency" | "runtime_preference" | "status";
}) {
  return (
    <div className="section-card">
      <div className="section-card-header">
        <h2 className="text-lg font-semibold text-neutral-950">{title}</h2>
      </div>
      <div>
        {labels.map((label) => (
          <div key={label} className="console-table-row flex items-center justify-between py-2 text-sm">
            <span className="text-neutral-500">{label}</span>
            <span className="font-mono font-medium tabular-nums text-neutral-950">
              {requests.filter((request) => request[field] === label).length}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
