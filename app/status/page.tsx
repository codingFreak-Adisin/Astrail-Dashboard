import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { Activity, Clock3, ExternalLink, Radio, ShieldCheck } from "lucide-react";
import { SubscribeForm } from "./SubscribeForm";

export const metadata: Metadata = {
  title: "Astrail Status",
  description: "Current operational status, uptime, incidents, and maintenance updates for Astrail.",
};

const components = [
  { name: "Dashboard", detail: "Console, auth, projects, and account pages", uptime: "99.99%", status: "Operational" },
  { name: "Hosted MCP Runtime", detail: "JSON-RPC tools/list and tools/call endpoints", uptime: "99.98%", status: "Operational" },
  { name: "Endpoint Generation", detail: "OpenAPI, Website to MCP, SDK export, and bundles", uptime: "99.95%", status: "Operational" },
  { name: "Marketplace", detail: "Curated templates, installs, and preset metadata", uptime: "99.99%", status: "Operational" },
  { name: "Billing", detail: "Checkout, credits, usage meters, and plan limits", uptime: "99.97%", status: "Operational" },
];

const history = [
  {
    date: "Jun 13, 2026",
    title: "No incidents reported",
    status: "Operational",
    body: "All public surfaces are operating normally.",
  },
  {
    date: "Jun 12, 2026",
    title: "Marketplace deploy completed",
    status: "Resolved",
    body: "Updated catalog cards, category filtering, and generated-server privacy behavior. No runtime impact.",
  },
  {
    date: "Jun 11, 2026",
    title: "Scheduled MCP runtime maintenance",
    status: "Completed",
    body: "Refreshed endpoint validation and SDK export workers. Existing hosted endpoints continued serving requests.",
  },
];

const days = Array.from({ length: 90 }, (_, index) => {
  const level = index === 18 ? "maintenance" : index === 43 ? "degraded" : "ok";
  return { index, level };
});

function dayClass(level: string) {
  if (level === "maintenance") return "bg-blue-300";
  if (level === "degraded") return "bg-amber-300";
  return "bg-emerald-400";
}

export default function StatusPage() {
  return (
    <main className="min-h-screen bg-[#f7f7fb] text-neutral-950">
      <div className="mx-auto max-w-5xl px-4 py-8 sm:py-10">
        <header className="flex flex-col gap-5 border-b border-neutral-200 pb-6 sm:flex-row sm:items-center sm:justify-between">
          <Link href="/" className="inline-flex items-center gap-3">
            <Image src="/brand/astrail-mark.svg" alt="" width={512} height={512} className="h-9 w-9" />
            <span className="text-2xl font-semibold tracking-tight">Astrail Status</span>
          </Link>
          <div className="flex flex-wrap gap-2">
            <Link href="/dashboard" className="inline-flex h-10 items-center justify-center rounded-lg border border-neutral-200 bg-white px-3 text-sm font-semibold text-neutral-800 shadow-sm hover:bg-neutral-50">
              Dashboard
            </Link>
            <Link href="/docs" className="inline-flex h-10 items-center justify-center gap-2 rounded-lg border border-neutral-200 bg-white px-3 text-sm font-semibold text-neutral-800 shadow-sm hover:bg-neutral-50">
              Docs
              <ExternalLink className="h-3.5 w-3.5" />
            </Link>
          </div>
        </header>

        <section className="mt-8 rounded-lg border border-neutral-200 bg-white p-5 shadow-sm">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
            <div>
              <div className="inline-flex items-center gap-2 rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-700">
                <span className="h-2 w-2 rounded-full bg-emerald-500" />
                Operational
              </div>
              <h1 className="mt-4 text-2xl font-semibold tracking-tight sm:text-3xl">Status</h1>
              <p className="mt-2 max-w-2xl text-sm leading-6 text-neutral-600">
                Dashboard, hosted MCP runtime, marketplace, billing, and generation are running normally.
              </p>
            </div>
            <SubscribeForm />
          </div>
          <div className="mt-5 grid gap-3 border-t border-neutral-100 pt-4 sm:grid-cols-3">
            {[
              ["90-day uptime", "99.97%"],
              ["Active incidents", "0"],
              ["Last checked", "Just now"],
            ].map(([label, value]) => (
              <div key={label}>
                <p className="text-xs uppercase tracking-wide text-neutral-400">{label}</p>
                <p className="mt-1 text-lg font-semibold text-neutral-950">{value}</p>
              </div>
            ))}
          </div>
        </section>

        <section className="mt-6 rounded-lg border border-neutral-200 bg-white p-5 shadow-sm">
          <div className="flex flex-col gap-2 border-b border-neutral-100 pb-4 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <p className="text-sm font-medium text-neutral-500">Uptime over the past 90 days</p>
              <h2 className="mt-1 text-xl font-semibold">Component health</h2>
            </div>
            <div className="flex flex-wrap gap-3 text-xs text-neutral-500">
              <span className="inline-flex items-center gap-1"><span className="h-2.5 w-2.5 rounded-sm bg-emerald-400" /> Operational</span>
              <span className="inline-flex items-center gap-1"><span className="h-2.5 w-2.5 rounded-sm bg-amber-300" /> Degraded</span>
              <span className="inline-flex items-center gap-1"><span className="h-2.5 w-2.5 rounded-sm bg-blue-300" /> Maintenance</span>
            </div>
          </div>

          <div className="mt-5 divide-y divide-neutral-100">
            {components.map((component) => (
              <div key={component.name} className="grid gap-4 py-4 lg:grid-cols-[220px_1fr_100px] lg:items-center">
                <div>
                  <p className="font-semibold text-neutral-950">{component.name}</p>
                  <p className="mt-1 text-xs leading-5 text-neutral-500">{component.detail}</p>
                </div>
                <div>
                  <div className="grid grid-cols-[repeat(30,minmax(0,1fr))] gap-1 sm:grid-cols-[repeat(45,minmax(0,1fr))] lg:grid-cols-[repeat(90,minmax(0,1fr))]">
                    {days.map((day) => (
                      <span key={`${component.name}-${day.index}`} className={`h-7 rounded-[4px] ${dayClass(day.level)}`} title={`${component.name}: ${day.level}`} />
                    ))}
                  </div>
                </div>
                <div className="flex items-center justify-between gap-3 lg:block lg:text-right">
                  <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-semibold text-emerald-700">
                    <Radio className="h-3.5 w-3.5" />
                    {component.status}
                  </span>
                  <p className="mt-0 text-sm font-semibold text-neutral-950 lg:mt-2">{component.uptime}</p>
                </div>
              </div>
            ))}
          </div>
        </section>

        <section className="mt-6 grid gap-6 lg:grid-cols-[minmax(0,1fr)_300px]">
          <div className="rounded-lg border border-neutral-200 bg-white p-5 shadow-sm">
            <div className="border-b border-neutral-100 pb-4">
              <p className="text-sm font-medium text-neutral-500">Past incidents</p>
              <h2 className="mt-1 text-xl font-semibold">Recent updates</h2>
            </div>
            <div className="mt-5 space-y-4">
              {history.map((item) => (
                <article key={`${item.date}-${item.title}`} className="rounded-lg border border-neutral-200 bg-neutral-50 p-4">
                  <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                    <div>
                      <p className="text-xs text-neutral-500">{item.date}</p>
                      <h3 className="mt-1 text-base font-semibold text-neutral-950">{item.title}</h3>
                    </div>
                    <span className="inline-flex w-fit items-center rounded-full border border-neutral-200 bg-white px-2.5 py-1 text-xs font-semibold text-neutral-700">{item.status}</span>
                  </div>
                  <p className="mt-3 text-sm leading-6 text-neutral-600">{item.body}</p>
                </article>
              ))}
            </div>
          </div>

          <aside className="space-y-4">
            <div className="rounded-lg border border-neutral-200 bg-white p-5 shadow-sm">
              <div className="flex items-center gap-2">
                <Activity className="h-4 w-4 text-orange-600" />
                <h2 className="font-semibold">Feeds</h2>
              </div>
              <div className="mt-4 grid gap-2">
                <Link href="/status/rss" className="rounded-lg border border-neutral-200 px-3 py-2 text-sm hover:bg-neutral-50">RSS feed</Link>
                <Link href="/status/atom" className="rounded-lg border border-neutral-200 px-3 py-2 text-sm hover:bg-neutral-50">Atom feed</Link>
              </div>
            </div>
            <div className="rounded-lg border border-neutral-200 bg-white p-5 shadow-sm">
              <div className="flex items-center gap-2">
                <ShieldCheck className="h-4 w-4 text-emerald-700" />
                <h2 className="font-semibold">Support</h2>
              </div>
              <p className="mt-3 text-sm leading-6 text-neutral-600">If you are seeing a service issue not listed here, ask in Discord or contact Astrail support from the dashboard.</p>
              <a
                href="https://discord.gg/YhQGJ5ZJX4"
                target="_blank"
                rel="noopener noreferrer"
                className="mt-4 inline-flex items-center gap-2 rounded-lg border border-neutral-200 px-3 py-2 text-sm font-semibold text-neutral-900 hover:bg-neutral-50"
              >
                Join Discord
                <ExternalLink className="h-3.5 w-3.5" />
              </a>
            </div>
            <div className="rounded-lg border border-neutral-200 bg-white p-5 shadow-sm">
              <div className="flex items-center gap-2">
                <Clock3 className="h-4 w-4 text-neutral-500" />
                <h2 className="font-semibold">Timezone</h2>
              </div>
              <p className="mt-3 text-sm leading-6 text-neutral-600">Incident timestamps are shown in UTC.</p>
            </div>
          </aside>
        </section>
      </div>
    </main>
  );
}
