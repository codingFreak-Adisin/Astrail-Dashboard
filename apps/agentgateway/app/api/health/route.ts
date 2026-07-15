import { NextResponse } from "next/server";
import { validateRuntimeEnv } from "@/lib/env-validation";
import { createAdminClient, hasServiceRoleKey } from "@/lib/supabase/server";
import { hasServerSupabaseEnv } from "@/lib/supabase/env";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const startedAt = Date.now();

async function checkRuntimeTables() {
  const tables = ["tool_call_logs", "mcp_bundles", "mcp_bundle_servers", "api_credentials"];

  if (!hasServiceRoleKey()) {
    return {
      status: "degraded",
      storage: "structured_log",
      note: "Persistent runtime storage is not enabled.",
    };
  }

  let admin: ReturnType<typeof createAdminClient>;
  try {
    admin = createAdminClient();
  } catch (error) {
    return {
      status: "degraded",
      storage: "structured_fallback",
      note: error instanceof Error ? error.message : "Workspace admin storage is not configured.",
      missing_count: tables.length,
    };
  }
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
    config: { status: env.status },
    schema,
    timestamp: new Date().toISOString(),
  }, { status: ready || previewMode ? 200 : 503 });
}
