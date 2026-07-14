import { NextResponse } from "next/server";
import { validateRuntimeEnv } from "@/lib/env-validation";
import { createAdminClient, hasServiceRoleKey } from "@/lib/supabase/server";
import { hasServerSupabaseEnv } from "@/lib/supabase/env";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const startedAt = Date.now();

async function checkRuntimeTables() {
  if (!hasServiceRoleKey()) {
    return {
      status: "degraded",
      storage: "structured_log",
      note: "Persistent runtime storage is not enabled.",
    };
  }

  const admin = createAdminClient();
  const tables = ["tool_call_logs", "mcp_bundles", "mcp_bundle_servers", "api_credentials"];
  let missingCount = 0;

  for (const table of tables) {
    const { error } = await admin.from(table).select("*").limit(1);
    if (error) missingCount += 1;
  }

  return {
    status: missingCount === 0 ? "ready" : "degraded",
    storage: missingCount === 0 ? "database_logs" : "structured_fallback",
    missing_count: missingCount,
  };
}

function checkStatus(env: ReturnType<typeof validateRuntimeEnv>, name: string) {
  return env.checks.find((check) => check.name === name)?.status ?? "missing";
}

function checkNote(env: ReturnType<typeof validateRuntimeEnv>, name: string) {
  return env.checks.find((check) => check.name === name)?.note;
}

function mcpEdgeRateLimitStatus(env: ReturnType<typeof validateRuntimeEnv>) {
  const disabled = process.env.ASTRAIL_MCP_EDGE_RATE_LIMIT_DISABLED === "true";
  const redisReady = checkStatus(env, "ASTRAIL_RATE_LIMIT_REDIS_REST_URL or UPSTASH_REDIS_REST_URL") === "ready"
    && checkStatus(env, "ASTRAIL_RATE_LIMIT_REDIS_REST_TOKEN or UPSTASH_REDIS_REST_TOKEN") === "ready";

  return {
    status: disabled ? "disabled" : redisReady ? "distributed" : "memory_fallback",
    distributed: redisReady,
    mode: process.env.RATE_LIMIT_MODE ?? "unset",
    max_body_bytes: process.env.ASTRAIL_MCP_EDGE_MAX_BODY_BYTES ?? "256000",
  };
}

function edgeProtectionStatus(env: ReturnType<typeof validateRuntimeEnv>) {
  const checks = {
    provider: checkStatus(env, "ASTRAIL_EDGE_PROVIDER"),
    ddos: checkStatus(env, "ASTRAIL_EDGE_DDOS_PROTECTION_CONFIRMED"),
    waf: checkStatus(env, "ASTRAIL_EDGE_WAF_CONFIRMED"),
    bot_protection: checkStatus(env, "ASTRAIL_EDGE_BOT_PROTECTION_CONFIRMED"),
    body_size_limit: checkStatus(env, "ASTRAIL_EDGE_BODY_SIZE_LIMIT_CONFIRMED"),
  };
  const ready = Object.values(checks).every((status) => status === "ready");

  return {
    status: ready ? "ready" : "degraded",
    ...checks,
    provider_name: checkNote(env, "ASTRAIL_EDGE_PROVIDER"),
  };
}

export async function GET() {
  const env = validateRuntimeEnv();
  const schema = await checkRuntimeTables();
  const previewMode = !hasServerSupabaseEnv();
  const ready = env.status === "ready" && schema.status === "ready";

  return NextResponse.json({
    status: ready ? "ready" : previewMode ? "preview" : "degraded",
    runtime: "nextjs-hosted-mcp-gateway",
    protocol_version: "2024-11-05",
    uptime_seconds: Math.floor((Date.now() - startedAt) / 1000),
    rate_limit_mode: process.env.RATE_LIMIT_MODE ? "configured" : "standard",
    mcp_edge_rate_limit: mcpEdgeRateLimitStatus(env),
    edge_protection: edgeProtectionStatus(env),
    config: { status: env.status },
    schema,
    timestamp: new Date().toISOString(),
  }, { status: ready || previewMode ? 200 : 503 });
}
