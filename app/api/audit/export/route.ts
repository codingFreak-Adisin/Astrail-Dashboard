import { NextResponse } from "next/server";
import { z } from "zod";
import { hasServerSupabaseEnv } from "@/lib/supabase/env";
import { createAdminClient, createServerSupabaseClient, hasServiceRoleKey } from "@/lib/supabase/server";

const QuerySchema = z.object({
  server_id: z.string().uuid().optional(),
  status: z.string().min(1).max(80).optional(),
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
  format: z.enum(["csv", "json"]).default("csv"),
  limit: z.coerce.number().int().min(1).max(5000).default(1000),
  before: z.string().datetime().optional(),
  before_id: z.string().uuid().optional(),
}).superRefine((value, context) => {
  if (Boolean(value.before) !== Boolean(value.before_id)) {
    context.addIssue({ code: "custom", path: ["before"], message: "before and before_id must be provided together." });
  }
});

function csvCell(value: unknown) {
  const raw = value === null || value === undefined ? "" : String(value);
  const text = /^\s*[=+\-@]/.test(raw) ? `'${raw}` : raw;
  return `"${text.replace(/"/g, '""')}"`;
}

export async function GET(request: Request) {
  if (!hasServerSupabaseEnv() || !hasServiceRoleKey()) return NextResponse.json({ error: "Audit export requires workspace storage." }, { status: 503 });
  const { data: userData } = await createServerSupabaseClient().auth.getUser();
  if (!userData.user) return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  const url = new URL(request.url);
  const parsed = QuerySchema.safeParse(Object.fromEntries(url.searchParams.entries()));
  if (!parsed.success) return NextResponse.json({ error: "Invalid audit export query.", details: parsed.error.flatten() }, { status: 400 });
  const input = parsed.data;
  let query = createAdminClient().from("tool_call_logs")
    .select("id,server_id,tool_name,status,method,path,execution_mode,upstream_status,trace_id,attempt_count,error_code,error,latency_ms,created_at")
    .eq("user_id", userData.user.id)
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(input.limit + 1);
  if (input.server_id) query = query.eq("server_id", input.server_id);
  if (input.status) query = query.eq("status", input.status);
  if (input.from) query = query.gte("created_at", input.from);
  if (input.to) query = query.lte("created_at", input.to);
  if (input.before && input.before_id) {
    query = query.or(`created_at.lt.${input.before},and(created_at.eq.${input.before},id.lt.${input.before_id})`);
  }
  const { data, error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  const hasMore = (data ?? []).length > input.limit;
  const rows = (data ?? []).slice(0, input.limit);
  const nextRow = hasMore ? rows.at(-1) : null;
  const nextBefore = nextRow?.created_at ?? null;
  const nextBeforeId = nextRow?.id ?? null;
  const filename = `astrail-audit-${new Date().toISOString().slice(0, 10)}.${input.format}`;
  if (input.format === "json") {
    return new NextResponse(JSON.stringify({ exported_at: new Date().toISOString(), rows, has_more: hasMore, next_before: nextBefore, next_before_id: nextBeforeId }, null, 2), {
      headers: { "content-type": "application/json; charset=utf-8", "content-disposition": `attachment; filename="${filename}"` },
    });
  }
  const columns = ["created_at", "server_id", "tool_name", "status", "method", "path", "execution_mode", "upstream_status", "trace_id", "attempt_count", "error_code", "error", "latency_ms"] as const;
  const csv = [columns.join(","), ...rows.map((row) => columns.map((column) => csvCell(row[column])).join(","))].join("\n");
  return new NextResponse(csv, {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="${filename}"`,
      "x-astrail-has-more": String(hasMore),
      ...(nextBefore ? { "x-astrail-next-before": nextBefore } : {}),
      ...(nextBeforeId ? { "x-astrail-next-before-id": nextBeforeId } : {}),
    },
  });
}
