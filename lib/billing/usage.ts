import {
  billingMeters,
  billingPlans,
  generationMeterForSourceType,
  getBillingPlan,
  getMeterCreditCost,
  type BillingMeterId,
  type BillingPlanId,
} from "@/lib/billing/plans";
import { createAdminClient, hasServiceRoleKey } from "@/lib/supabase/server";

export type BillingUsageSummary = {
  plan: BillingPlanId;
  planName: string;
  status: string;
  creditLimit: number | null;
  creditsUsed: number;
  creditsRemaining: number | null;
  creditsPercentUsed: number | null;
  limit: number | null;
  used: number;
  remaining: number | null;
  percentUsed: number | null;
  generationLimit: number | null;
  generationsUsed: number;
  generationRemaining: number | null;
  generationPercentUsed: number | null;
  endpointLimit: number | null;
  endpointsUsed: number;
  endpointRemaining: number | null;
  endpointPercentUsed: number | null;
  currentPeriodStart: string;
  currentPeriodEnd: string;
  storage: "tool_call_logs" | "mcp_servers_call_count" | "unavailable";
  enforcement: "active" | "best_effort" | "unavailable";
  meterCosts: Record<BillingMeterId, number>;
};

export async function getBillingUsageSummary(userId: string): Promise<BillingUsageSummary> {
  const defaultPeriod = getCurrentBillingPeriod();

  if (!hasServiceRoleKey()) {
    return buildSummary({
      plan: "free",
      status: "preview",
      used: 0,
      generationsUsed: 0,
      generationCreditsUsed: 0,
      additionalCreditsUsed: 0,
      endpointsUsed: 0,
      period: defaultPeriod,
      storage: "unavailable",
      enforcement: "unavailable",
    });
  }

  const subscription = await loadActiveSubscription(userId);
  const period = applyGlobalBillingReset(getSubscriptionBillingPeriod(subscription) ?? defaultPeriod);
  const plan = getBillingPlan(subscription?.plan).id;
  const [logUsage, generationUsage, endpointsUsed, additionalCreditsUsed] = await Promise.all([
    getToolCallLogUsage(userId, period.start),
    getGenerationUsageDetails(userId, period.start),
    getHostedEndpointUsage(userId),
    getAdditionalUsageCredits(userId, period.start),
  ]);

  if (logUsage.ok) {
    return buildSummary({
      plan,
      status: subscription?.status ?? "free",
      used: logUsage.count,
      generationsUsed: generationUsage.count,
      generationCreditsUsed: generationUsage.credits,
      additionalCreditsUsed,
      endpointsUsed,
      period,
      storage: "tool_call_logs",
      enforcement: "active",
    });
  }

  const fallbackUsage = await getServerCallCountUsage(userId);
  return buildSummary({
    plan,
    status: subscription?.status ?? "free",
    used: fallbackUsage,
    generationsUsed: generationUsage.count,
    generationCreditsUsed: generationUsage.credits,
    additionalCreditsUsed,
    endpointsUsed,
    period,
    storage: "mcp_servers_call_count",
    enforcement: "best_effort",
  });
}

export async function checkBillingAllowance(userId: string, meter: BillingMeterId = "tool_call") {
  const summary = await getBillingUsageSummary(userId);
  const cost = getMeterCreditCost(meter);
  const enforceable = summary.enforcement !== "unavailable";
  const hasCredits = summary.creditLimit === null
    || summary.creditsUsed + cost <= summary.creditLimit;
  const hasToolCalls = meter !== "tool_call" || summary.limit === null || summary.used < summary.limit;

  return {
    allowed: !enforceable || (hasCredits && hasToolCalls),
    summary,
    meter,
    cost,
  };
}

export async function recordBillingUsage(params: {
  userId: string;
  meter: BillingMeterId;
  serverId?: string | null;
  toolName?: string | null;
  quantity?: number;
  dedupePerPeriod?: boolean;
}) {
  if (!hasServiceRoleKey()) return false;

  const quantity = Math.max(1, Math.floor(params.quantity ?? 1));
  const period = getCurrentBillingPeriod();

  try {
    const admin = createAdminClient();

    if (params.dedupePerPeriod && params.serverId) {
      const { count, error } = await admin
        .from("billing_usage")
        .select("id", { count: "exact", head: true })
        .eq("user_id", params.userId)
        .eq("server_id", params.serverId)
        .eq("usage_type", params.meter)
        .gte("created_at", period.start);

      if (!error && typeof count === "number" && count > 0) return true;
    }

    const { error } = await admin
      .from("billing_usage")
      .insert({
        user_id: params.userId,
        server_id: params.serverId ?? null,
        tool_name: params.toolName ?? null,
        usage_type: params.meter,
        quantity,
      });

    return !error;
  } catch {
    return false;
  }
}

export async function checkGenerationAllowance(userId: string, sourceType?: string | null) {
  const summary = await getBillingUsageSummary(userId);
  const meter = generationMeterForSourceType(sourceType);
  const cost = getMeterCreditCost(meter);
  const enforceable = summary.enforcement !== "unavailable";
  const hasCredits = summary.creditLimit === null
    || summary.creditsUsed + cost <= summary.creditLimit;
  const hasGenerationSlots = summary.generationLimit === null
    || summary.generationsUsed < summary.generationLimit;

  return {
    allowed: !enforceable || (hasCredits && hasGenerationSlots),
    summary,
    meter,
    cost,
  };
}

export async function checkHostedEndpointAllowance(userId: string) {
  const summary = await getBillingUsageSummary(userId);
  const enforceable = summary.enforcement !== "unavailable";
  return {
    allowed: !enforceable
      || summary.endpointLimit === null
      || summary.endpointsUsed < summary.endpointLimit,
    summary,
  };
}

async function loadActiveSubscription(userId: string) {
  try {
    const { data, error } = await createAdminClient()
      .from("billing_subscriptions")
      .select("plan,status,current_period_start,current_period_end,entitlement_status,paid_confirmed_at,updated_at")
      .eq("user_id", userId)
      .eq("entitlement_status", "active")
      .not("paid_confirmed_at", "is", null)
      .in("status", ["active", "paid", "succeeded"])
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error || !data) return null;
    const periodEnd = typeof data.current_period_end === "string" ? data.current_period_end : null;
    if (periodEnd) {
      const end = new Date(periodEnd);
      if (!Number.isNaN(end.getTime()) && end <= new Date()) return null;
    }

    return {
      plan: typeof data.plan === "string" ? data.plan : "free",
      status: typeof data.status === "string" ? data.status : "unknown",
      currentPeriodStart: typeof data.current_period_start === "string" ? data.current_period_start : null,
      currentPeriodEnd: periodEnd,
    };
  } catch {
    return null;
  }
}

function getSubscriptionBillingPeriod(subscription: Awaited<ReturnType<typeof loadActiveSubscription>>) {
  if (!subscription?.currentPeriodStart || !subscription.currentPeriodEnd) return null;
  const start = new Date(subscription.currentPeriodStart);
  const end = new Date(subscription.currentPeriodEnd);

  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end <= start) return null;

  return {
    start: start.toISOString(),
    end: end.toISOString(),
  };
}

async function getToolCallLogUsage(userId: string, periodStart: string) {
  try {
    const { count, error } = await createAdminClient()
      .from("tool_call_logs")
      .select("id", { count: "exact", head: true })
      .eq("user_id", userId)
      .gte("created_at", periodStart);

    if (error || typeof count !== "number") {
      return { ok: false as const, count: 0 };
    }

    return { ok: true as const, count };
  } catch {
    return { ok: false as const, count: 0 };
  }
}

async function getServerCallCountUsage(userId: string) {
  try {
    const { data, error } = await createAdminClient()
      .from("mcp_servers")
      .select("call_count")
      .eq("user_id", userId);

    if (error || !data) return 0;
    return data.reduce((sum, row) => sum + (typeof row.call_count === "number" ? row.call_count : 0), 0);
  } catch {
    return 0;
  }
}

async function getGenerationUsageDetails(userId: string, periodStart: string) {
  try {
    const { data, error } = await createAdminClient()
      .from("mcp_servers")
      .select("source_type,status,generation_status")
      .eq("user_id", userId)
      .gte("created_at", periodStart);

    if (error || !Array.isArray(data)) return { count: 0, credits: 0 };

    const successful = data.filter((row) => {
      const status = typeof row.status === "string" ? row.status : "";
      const generationStatus = typeof row.generation_status === "string" ? row.generation_status : "";
      return status !== "error" && generationStatus !== "failed";
    });

    return {
      count: successful.length,
      credits: successful.reduce((sum, row) => {
        const sourceType = typeof row.source_type === "string" ? row.source_type : null;
        return sum + getMeterCreditCost(generationMeterForSourceType(sourceType));
      }, 0),
    };
  } catch {
    return { count: 0, credits: 0 };
  }
}

async function getHostedEndpointUsage(userId: string) {
  try {
    const { count, error } = await createAdminClient()
      .from("mcp_servers")
      .select("id", { count: "exact", head: true })
      .eq("user_id", userId)
      .not("hosted_endpoint", "is", null);

    if (error || typeof count !== "number") return 0;
    return count;
  } catch {
    return 0;
  }
}

async function getAdditionalUsageCredits(userId: string, periodStart: string) {
  try {
    const { data, error } = await createAdminClient()
      .from("billing_usage")
      .select("usage_type,quantity")
      .eq("user_id", userId)
      .gte("created_at", periodStart);

    if (error || !Array.isArray(data)) return 0;

    return data.reduce((sum, row) => {
      const usageType = typeof row.usage_type === "string" ? row.usage_type : "";
      const quantity = typeof row.quantity === "number" ? row.quantity : 1;
      if (usageType !== "sdk_export") return sum;
      return sum + quantity * getMeterCreditCost("sdk_export");
    }, 0);
  } catch {
    return 0;
  }
}

function buildSummary(params: {
  plan: BillingPlanId;
  status: string;
  used: number;
  generationsUsed: number;
  generationCreditsUsed: number;
  additionalCreditsUsed: number;
  endpointsUsed: number;
  period: { start: string; end: string };
  storage: BillingUsageSummary["storage"];
  enforcement: BillingUsageSummary["enforcement"];
}): BillingUsageSummary {
  const plan = billingPlans[params.plan];
  const remaining = plan.monthlyToolCalls === null
    ? null
    : Math.max(0, plan.monthlyToolCalls - params.used);
  const generationRemaining = plan.monthlyGenerations === null
    ? null
    : Math.max(0, plan.monthlyGenerations - params.generationsUsed);
  const endpointRemaining = plan.hostedEndpoints === null
    ? null
    : Math.max(0, plan.hostedEndpoints - params.endpointsUsed);
  const creditsUsed = params.used + params.generationCreditsUsed + params.additionalCreditsUsed;
  const creditsRemaining = plan.monthlyCredits === null
    ? null
    : Math.max(0, plan.monthlyCredits - creditsUsed);

  return {
    plan: plan.id,
    planName: plan.name,
    status: params.status,
    creditLimit: plan.monthlyCredits,
    creditsUsed,
    creditsRemaining,
    creditsPercentUsed: plan.monthlyCredits === null
      ? null
      : Math.min(100, Math.round((creditsUsed / plan.monthlyCredits) * 100)),
    limit: plan.monthlyToolCalls,
    used: params.used,
    remaining,
    percentUsed: plan.monthlyToolCalls === null
      ? null
      : Math.min(100, Math.round((params.used / plan.monthlyToolCalls) * 100)),
    generationLimit: plan.monthlyGenerations,
    generationsUsed: params.generationsUsed,
    generationRemaining,
    generationPercentUsed: plan.monthlyGenerations === null
      ? null
      : Math.min(100, Math.round((params.generationsUsed / plan.monthlyGenerations) * 100)),
    endpointLimit: plan.hostedEndpoints,
    endpointsUsed: params.endpointsUsed,
    endpointRemaining,
    endpointPercentUsed: plan.hostedEndpoints === null
      ? null
      : Math.min(100, Math.round((params.endpointsUsed / plan.hostedEndpoints) * 100)),
    currentPeriodStart: params.period.start,
    currentPeriodEnd: params.period.end,
    storage: params.storage,
    enforcement: params.enforcement,
    meterCosts: Object.fromEntries(
      Object.entries(billingMeters).map(([key, meter]) => [key, meter.creditCost]),
    ) as Record<BillingMeterId, number>,
  };
}

function getCurrentBillingPeriod() {
  const now = new Date();
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1, 0, 0, 0, 0));
  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1, 0, 0, 0, 0));

  return {
    start: start.toISOString(),
    end: end.toISOString(),
  };
}

function applyGlobalBillingReset(period: { start: string; end: string }) {
  const reset = getGlobalBillingResetAt();
  if (!reset) return period;

  const start = new Date(period.start);
  if (Number.isNaN(start.getTime()) || reset <= start) return period;

  return {
    start: reset.toISOString(),
    end: period.end,
  };
}

function getGlobalBillingResetAt() {
  const raw = process.env.ASTRAIL_BILLING_RESET_AT?.trim();
  if (!raw) return null;

  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) return null;

  return parsed;
}
