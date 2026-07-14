"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { FormEvent, useState } from "react";
import { AlertCircle, CreditCard, Download, ExternalLink, Loader2, Wand2 } from "lucide-react";
import { EndpointBox } from "@/components/EndpointBox";
import { TurnstileChallenge } from "@/components/TurnstileChallenge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

type LimitDetails = {
  type: "hosted_endpoint_limit";
  title: string;
  message: string;
  currentPlan: {
    id: string;
    name: string;
    status: string;
    priceLabel: string;
    endpointLimit: number | null;
    endpointsUsed: number;
    endpointRemaining: number | null;
    monthlyCredits: number | null;
    monthlyGenerations: number | null;
  };
  hostedEndpoints: Array<{
    id: string;
    name: string;
    sourceUrl: string | null;
    hostedEndpoint: string | null;
    sourceType: string | null;
    createdAt: string | null;
  }>;
  upgradePlans: Array<{
    id: string;
    name: string;
    priceLabel: string;
    hostedEndpoints: number | null;
    monthlyCredits: number | null;
    monthlyGenerations: number | null;
    monthlyToolCalls: number | null;
    href: string;
  }>;
};

export default function WebsiteToMcpPage() {
  const router = useRouter();
  const [url, setUrl] = useState("https://news.ycombinator.com");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [limitDetails, setLimitDetails] = useState<LimitDetails | null>(null);
  const [turnstileToken, setTurnstileToken] = useState<string | null>(null);
  const [turnstileResetSignal, setTurnstileResetSignal] = useState(0);
  const [preview, setPreview] = useState<{
    id: string;
    name: string;
    endpoint: string | null;
    tools: number;
    diagnostics: string[];
  } | null>(null);
  const challengeEnabled = Boolean(process.env.NEXT_PUBLIC_CLOUDFLARE_TURNSTILE_SITE_KEY);
  const challengeReady = !challengeEnabled || Boolean(turnstileToken);

  function resetTurnstile() {
    setTurnstileToken(null);
    setTurnstileResetSignal((current) => current + 1);
  }

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoading(true);
    setError(null);
    setLimitDetails(null);
    setPreview(null);

    try {
      const response = await fetch("/api/website-to-mcp", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url, turnstileToken }),
      });
      const result = (await response.json()) as {
        server?: { id: string; name?: string; hosted_endpoint?: string | null; tools_json?: unknown[] | null };
        diagnostics?: { raw?: string[] };
        preview?: boolean;
        limit?: LimitDetails;
        error?: string;
      };
      if (!response.ok) {
        if (result.limit) {
          setLimitDetails(result.limit);
          return;
        }
        throw new Error(result.error ?? "Website MCP generation failed.");
      }
      if (!result.server) throw new Error(result.error ?? "Website MCP generation failed.");
      if (result.preview) {
        setPreview({
          id: result.server.id,
          name: result.server.name ?? "Website MCP endpoint",
          endpoint: result.server.hosted_endpoint ?? null,
          tools: result.server.tools_json?.length ?? 0,
          diagnostics: result.diagnostics?.raw?.slice(0, 6) ?? [],
        });
        return;
      }
      router.push(`/dashboard/servers/${result.server.id}`);
      router.refresh();
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "Website MCP generation failed.");
    } finally {
      setLoading(false);
      resetTurnstile();
    }
  }

  return (
    <div className="mx-auto max-w-6xl space-y-5">
      <header className="console-hero px-5 py-8 sm:px-9">
        <div className="relative z-10 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0">
            <h1 className="text-3xl font-semibold tracking-tight text-neutral-950">Website-to-MCP</h1>
            <p className="mt-1.5 text-sm text-neutral-600">Turn any public website into a hosted MCP endpoint.</p>
          </div>
        </div>
      </header>

      <section className="section-card">
        <div className="section-card-header">
          <div>
            <h2 className="text-lg font-semibold text-neutral-950">Create Website MCP endpoint</h2>
            <p className="mt-0.5 text-xs text-neutral-400">Public http/https only. Local/private networks are blocked.</p>
          </div>
        </div>
        <form onSubmit={onSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="websiteUrl">Website URL</Label>
            <Input
              id="websiteUrl"
              type="url"
              value={url}
              onChange={(event) => {
                setUrl(event.target.value);
                setError(null);
                setLimitDetails(null);
              }}
              placeholder="https://news.ycombinator.com"
              required
            />
          </div>

          {limitDetails ? (
            <LimitUpgradeCard details={limitDetails} />
          ) : error ? (
            <div className="flex items-start gap-2 rounded-xl bg-red-50 p-3 text-sm text-red-600">
              <AlertCircle className="mt-0.5 h-4 w-4" />
              <p>{error}</p>
            </div>
          ) : null}

          <div className="border-t border-neutral-100 pt-4">
            <TurnstileChallenge
              action="website-to-mcp"
              resetSignal={turnstileResetSignal}
              onToken={setTurnstileToken}
              className="mb-4"
            />
            <Button
              type="submit"
              disabled={loading || !challengeReady}
              className="h-11 w-full px-4 text-sm font-semibold shadow-sm sm:w-auto"
            >
              {loading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Wand2 className="mr-2 h-4 w-4" />}
              {loading ? "Generating endpoint..." : "Generate MCP endpoint"}
            </Button>
          </div>
        </form>
      </section>

      {preview && (
        <section className="section-card">
          <div className="section-card-header">
            <h2 className="text-lg font-semibold text-neutral-950">Endpoint generated</h2>
            <span className="pill pill-success">Live</span>
          </div>
          <div className="space-y-3 text-sm">
            <div className="grid gap-2 sm:grid-cols-[140px_1fr]">
              <div className="font-medium text-neutral-950">Server</div>
              <div>{preview.name}</div>
              <div className="font-medium text-neutral-950">Tools</div>
              <div>{preview.tools} generated website tools</div>
            </div>
            {preview.endpoint && (
              <EndpointBox
                endpoint={preview.endpoint}
                label="Website MCP endpoint"
                note="Copy this URL into your MCP client to expose the generated website tools."
              />
            )}
            <div className="border-t border-neutral-100 pt-3">
              {preview.diagnostics.map((item) => (
                <p key={item} className="font-mono text-xs text-neutral-500">{item}</p>
              ))}
            </div>
            <div className="flex flex-wrap gap-2 border-t border-neutral-100 pt-3">
              <Button asChild>
                <Link href={`/dashboard/servers/${preview.id}`}>
                  Open server detail <ExternalLink className="h-4 w-4" />
                </Link>
              </Button>
              <Button asChild variant="outline">
                <a href={`/api/servers/${preview.id}/sdk`}>
                  Export SDK bundle <Download className="h-4 w-4" />
                </a>
              </Button>
            </div>
          </div>
        </section>
      )}
    </div>
  );
}

function LimitUpgradeCard({ details }: { details: LimitDetails }) {
  return (
    <div className="space-y-4 rounded-2xl border border-amber-200/70 bg-amber-50/60 p-4 text-sm">
      <div className="flex items-start gap-3">
        <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-amber-700" />
        <div>
          <p className="font-semibold text-neutral-950">{details.title}</p>
          <p className="mt-1 leading-6 text-neutral-600">{details.message}</p>
        </div>
      </div>

      <div className="grid gap-2 sm:grid-cols-3">
        <LimitStat label="Current plan" value={`${details.currentPlan.name} · ${details.currentPlan.priceLabel}`} />
        <LimitStat label="Hosted endpoints" value={`${details.currentPlan.endpointsUsed.toLocaleString()} / ${formatLimit(details.currentPlan.endpointLimit)}`} />
        <LimitStat label="Monthly credits" value={formatLimit(details.currentPlan.monthlyCredits)} />
      </div>

      <div className="rounded-xl border border-amber-200/70 bg-white/70 p-3">
        <p className="font-medium text-neutral-950">Hosted endpoints using your plan</p>
        <div className="mt-3 grid gap-2">
          {details.hostedEndpoints.length > 0 ? (
            details.hostedEndpoints.map((server) => (
              <Link
                key={server.id}
                href={`/dashboard/servers/${server.id}`}
                className="flex flex-col justify-between gap-2 rounded-xl border border-neutral-200 bg-white px-3 py-2 transition hover:border-amber-300 sm:flex-row sm:items-center"
              >
                <span className="min-w-0">
                  <span className="block truncate font-medium text-neutral-950">{server.name}</span>
                  <span className="block truncate font-mono text-xs text-neutral-500">{server.sourceUrl ?? server.hostedEndpoint ?? "Hosted endpoint"}</span>
                </span>
                <span className="pill pill-neutral shrink-0">{server.sourceType ?? "mcp"}</span>
              </Link>
            ))
          ) : (
            <p className="text-neutral-500">No hosted endpoints could be loaded for this workspace.</p>
          )}
        </div>
      </div>

      <div className="grid gap-3 lg:grid-cols-2">
        {details.upgradePlans.length > 0 ? (
          details.upgradePlans.map((plan) => (
            <div key={plan.id} className="rounded-xl border border-amber-200/70 bg-white p-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="font-semibold text-neutral-950">{plan.name}</p>
                  <p className="mt-1 text-2xl font-semibold text-neutral-950">{plan.priceLabel}</p>
                </div>
                <Button asChild size="sm">
                  <Link href={plan.href}>
                    <CreditCard className="h-4 w-4" />
                    Upgrade
                  </Link>
                </Button>
              </div>
              <div className="mt-4 grid gap-2 text-neutral-500 sm:grid-cols-3">
                <LimitStat label="Endpoints" value={formatLimit(plan.hostedEndpoints)} compact />
                <LimitStat label="Credits" value={formatLimit(plan.monthlyCredits)} compact />
                <LimitStat label="Generations" value={formatLimit(plan.monthlyGenerations)} compact />
              </div>
            </div>
          ))
        ) : (
          <div className="rounded-xl border border-amber-200/70 bg-white p-4">
            <p className="font-medium text-neutral-950">Need more than this?</p>
            <p className="mt-1 text-neutral-500">You are already on the largest listed plan. Open billing to review your workspace plan.</p>
            <Button asChild className="mt-3" size="sm">
              <Link href="/dashboard/billing">Open billing</Link>
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}

function LimitStat({ label, value, compact = false }: { label: string; value: string; compact?: boolean }) {
  return (
    <div className={compact ? "" : "rounded-xl border border-amber-200/70 bg-white/70 px-3 py-2"}>
      <p className="text-[11px] font-medium text-neutral-400">{label}</p>
      <p className="mt-1 font-mono text-sm font-semibold text-neutral-950">{value}</p>
    </div>
  );
}

function formatLimit(value: number | null) {
  return value === null ? "Fair use" : value.toLocaleString();
}
