import { NextResponse } from "next/server";
import { z } from "zod";
import { hasServerSupabaseEnv } from "@/lib/supabase/env";
import { createAdminClient, createServerSupabaseClient, hasServiceRoleKey } from "@/lib/supabase/server";

const RetentionSchema = z.object({ days: z.number().int().min(7).max(3650) }).strict();
const RETENTION_BATCH_SIZE = 100;

export async function DELETE(request: Request) {
  if (!hasServerSupabaseEnv() || !hasServiceRoleKey()) return NextResponse.json({ error: "Audit retention requires workspace storage." }, { status: 503 });
  const { data: userData } = await createServerSupabaseClient().auth.getUser();
  if (!userData.user) return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  const parsed = RetentionSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid retention policy.", details: parsed.error.flatten() }, { status: 400 });
  const body = parsed.data;
  const cutoff = new Date(Date.now() - body.days * 86_400_000).toISOString();
  const admin = createAdminClient();
  const { data: candidates, error: selectError } = await admin.from("tool_call_logs")
    .select("id")
    .eq("user_id", userData.user.id)
    .lt("created_at", cutoff)
    .order("created_at", { ascending: true })
    .limit(RETENTION_BATCH_SIZE);
  if (selectError) return NextResponse.json({ error: selectError.message }, { status: 500 });

  const ids = (candidates ?? []).map((row) => row.id as string);
  if (ids.length === 0) return NextResponse.json({ deleted: 0, cutoff, has_more: false });
  const { error: deleteError } = await admin.from("tool_call_logs")
    .delete()
    .eq("user_id", userData.user.id)
    .in("id", ids);
  if (deleteError) return NextResponse.json({ error: deleteError.message }, { status: 500 });
  return NextResponse.json({ deleted: ids.length, cutoff, has_more: ids.length === RETENTION_BATCH_SIZE });
}
