import { NextResponse } from "next/server";
import { listLocalToolApprovals } from "@/lib/runtime/tool-approvals";
import { hasServerSupabaseEnv } from "@/lib/supabase/env";
import { createAdminClient, createServerSupabaseClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

export async function GET() {
  if (!hasServerSupabaseEnv()) return NextResponse.json({ approvals: listLocalToolApprovals(), preview: true });

  const supabase = createServerSupabaseClient();
  const { data: userData } = await supabase.auth.getUser();
  if (!userData.user) return NextResponse.json({ error: "Authentication required." }, { status: 401 });

  const admin = createAdminClient();
  await admin.from("tool_approval_requests").update({ status: "expired" })
    .eq("user_id", userData.user.id).eq("status", "pending").lt("expires_at", new Date().toISOString());
  const { data, error } = await admin.from("tool_approval_requests")
    .select("id,server_id,user_id,tool_name,arguments_redacted,status,expires_at,decided_at,executed_at,created_at")
    .eq("user_id", userData.user.id).order("created_at", { ascending: false }).limit(100);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ approvals: data ?? [] });
}
