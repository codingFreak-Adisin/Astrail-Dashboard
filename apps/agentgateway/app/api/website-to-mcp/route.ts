import { NextResponse } from "next/server";
import { z } from "zod";
import { billingPlanOrder, billingPlans } from "@/lib/billing/plans";
import { checkGenerationAllowance, checkHostedEndpointAllowance, type BillingUsageSummary } from "@/lib/billing/usage";
import { withHostedEndpoint } from "@/lib/diagnostics";
import { buildLocalWebsitePreviewServer } from "@/lib/local-preview-servers";
import { createDataClient, createServerSupabaseClient } from "@/lib/supabase/server";
import { hasServerSupabaseEnv } from "@/lib/supabase/env";
import type { McpServer } from "@/lib/types";
import { requireTurnstile } from "@/lib/turnstile";
import { buildMcpEndpoint, getRuntimeBaseUrl } from "@/lib/urls";
import { inspectWebsiteForMcp } from "@/lib/website-inspector";

export const runtime = "nodejs";

const WebsiteRequestSchema = z.object({
  url: z.string().url(),
  turnstileToken: z.string().nullish(),
});

async function buildHostedEndpointLimit(userId: string, summary: BillingUsageSummary) {
  let hostedEndpoints: Array<{
    id: string;
    name: string;
    sourceUrl: string | null;
    hostedEndpoint: string | null;
    sourceType: string | null;
    createdAt: string | null;
  }> = [];

  try {
    const { data } = await createDataClient()
      .from("mcp_servers")
      .select("id,name,source_url,hosted_endpoint,source_type,created_at")
      .eq("user_id", userId)
      .not("hosted_endpoint", "is", null)
      .order("created_at", { ascending: false })
      .limit(12);

    hostedEndpoints = (data ?? []).map((server) => ({
      id: String(server.id),
      name: typeof server.name === "string" ? server.name : "Hosted endpoint",
      sourceUrl: typeof server.source_url === "string" ? server.source_url : null,
      hostedEndpoint: typeof server.hosted_endpoint === "string" ? server.hosted_endpoint : null,
      sourceType: typeof server.source_type === "string" ? server.source_type : null,
      createdAt: typeof server.created_at === "string" ? server.created_at : null,
    }));
  } catch {
    hostedEndpoints = [];
  }

  const currentLimit = summary.endpointLimit;
  const upgradePlans = billingPlanOrder
    .map((planId) => billingPlans[planId])
    .filter((plan) => {
      if (plan.id === "free" || plan.id === summary.plan) return false;
      if (currentLimit === null) return false;
      return plan.hostedEndpoints === null || plan.hostedEndpoints > currentLimit;
    })
    .map((plan) => ({
      id: plan.id,
      name: plan.name,
      priceLabel: plan.priceLabel,
      hostedEndpoints: plan.hostedEndpoints,
      monthlyCredits: plan.monthlyCredits,
      monthlyGenerations: plan.monthlyGenerations,
      monthlyToolCalls: plan.monthlyToolCalls,
      href: `/dashboard/billing?plan=${plan.id}`,
    }));

  const endpointNoun = summary.endpointLimit === 1 ? "hosted endpoint" : "hosted endpoints";

  return {
    type: "hosted_endpoint_limit" as const,
    title: "Upgrade to host more websites",
    message: `${summary.planName} includes ${summary.endpointLimit?.toLocaleString() ?? "fair-use"} ${endpointNoun}. You are already using ${summary.endpointsUsed.toLocaleString()} of them.`,
    currentPlan: {
      id: summary.plan,
      name: summary.planName,
      status: summary.status,
      priceLabel: billingPlans[summary.plan].priceLabel,
      endpointLimit: summary.endpointLimit,
      endpointsUsed: summary.endpointsUsed,
      endpointRemaining: summary.endpointRemaining,
      monthlyCredits: summary.creditLimit,
      monthlyGenerations: summary.generationLimit,
    },
    hostedEndpoints,
    upgradePlans,
  };
}

export async function POST(request: Request) {
  if (!hasServerSupabaseEnv()) {
    try {
      const body = WebsiteRequestSchema.parse(await request.json());
      const turnstileError = await requireTurnstile(request, body.turnstileToken, "website-to-mcp");
      if (turnstileError) return turnstileError;
      const result = await buildLocalWebsitePreviewServer(body.url, request.url);

      return NextResponse.json({
        server: result.server,
        generated: result.generated,
        diagnostics: result.diagnostics,
        preview: true,
      });
    } catch (error) {
      return NextResponse.json({
        error: error instanceof Error ? error.message : "Website-to-MCP inspection failed.",
      }, { status: 400 });
    }
  }

  const supabase = createServerSupabaseClient();
  const { data: userData, error: userError } = await supabase.auth.getUser();

  if (userError || !userData.user) {
    return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  }

  try {
    const body = WebsiteRequestSchema.parse(await request.json());
    const turnstileError = await requireTurnstile(request, body.turnstileToken, "website-to-mcp");
    if (turnstileError) return turnstileError;
    const generationAllowance = await checkGenerationAllowance(userData.user.id, "website");
    if (!generationAllowance.allowed) {
      return NextResponse.json({
        error: "Monthly Website-to-MCP credits or generation limit reached.",
        billing: generationAllowance.summary,
        billingAction: {
          meter: generationAllowance.meter,
          creditCost: generationAllowance.cost,
        },
      }, { status: 402 });
    }

    const endpointAllowance = await checkHostedEndpointAllowance(userData.user.id);
    if (!endpointAllowance.allowed) {
      const limit = await buildHostedEndpointLimit(userData.user.id, endpointAllowance.summary);
      return NextResponse.json({
        error: "Hosted endpoint limit reached. Upgrade to host another website.",
        limit,
        billing: endpointAllowance.summary,
        billingAction: {
          meter: "hosted_endpoint_slot",
          creditCost: 0,
        },
      }, { status: 402 });
    }

    const inspected = await inspectWebsiteForMcp(body.url);
    const requestUrl = new URL(request.url);
    const runtimeBaseUrl = getRuntimeBaseUrl(requestUrl);
    const db = createDataClient();

    await db.from("profiles").upsert({
      id: userData.user.id,
      email: userData.user.email ?? "",
    });

    const { data, error } = await db
      .from("mcp_servers")
      .insert({
        user_id: userData.user.id,
        name: inspected.generated.name,
        description: inspected.generated.description,
        source_url: inspected.sourceUrl,
        source_type: "website",
        generated_code: inspected.generated.generated_code,
        tools_json: inspected.generated.tools,
        endpoint_map: inspected.endpointMap,
        diagnostics: inspected.diagnostics,
        status: "live",
        validation_status: "passed",
        generation_status: "completed",
        hosted_endpoint: `${runtimeBaseUrl}/api/mcp/pending`,
        is_public: false,
        generation_version: 1,
        protocol_version: "2024-11-05",
      })
      .select("*")
      .single();

    if (error || !data) throw new Error(error?.message ?? "Could not save website MCP server.");

    const hostedEndpoint = buildMcpEndpoint(data.id, requestUrl);
    const diagnostics = withHostedEndpoint(inspected.diagnostics, hostedEndpoint);
    const { data: updated, error: updateError } = await db
      .from("mcp_servers")
      .update({ hosted_endpoint: hostedEndpoint, diagnostics })
      .eq("id", data.id)
      .select("*")
      .single();

    if (updateError || !updated) throw new Error(updateError?.message ?? "Could not finalize hosted endpoint.");

    return NextResponse.json({
      server: updated as McpServer,
      generated: inspected.generated,
      diagnostics,
    });
  } catch (error) {
    return NextResponse.json({
      error: error instanceof Error ? error.message : "Website-to-MCP inspection failed.",
    }, { status: 400 });
  }
}
