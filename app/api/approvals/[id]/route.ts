import { NextResponse } from "next/server";
import { z } from "zod";
import { localDemoUserId } from "@/lib/local-demo";
import { decideLocalToolApproval } from "@/lib/runtime/tool-approvals";
import { hasServerSupabaseEnv } from "@/lib/supabase/env";
import { createAdminClient, createServerSupabaseClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
const DecisionSchema = z.object({ decision: z.enum(["approved", "denied"]) }).strict();

export async function PATCH(request: Request, { params }: { params: { id: string } }) {
  const parsed = DecisionSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success || !z.string().uuid().safeParse(params.id).success) {
    return NextResponse.json({ error: "A valid approval ID and decision are required." }, { status: 400 });
  }
  const body = parsed.data;
  if (!hasServerSupabaseEnv()) {
    const approval = decideLocalToolApproval(localDemoUserId, params.id, body.decision)
      ?? decideLocalToolApproval("local-preview", params.id, body.decision)
      ?? decideLocalToolApproval("preset", params.id, body.decision);
    if (!approval) return NextResponse.json({ error: "Pending approval not found." }, { status: 404 });
    return NextResponse.json({ approval, preview: true });
  }

  const supabase = createServerSupabaseClient();
  const { data: userData } = await supabase.auth.getUser();
  if (!userData.user) return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  const now = new Date().toISOString();
  const { data, error } = await createAdminClient().from("tool_approval_requests")
    .update({ status: body.decision, decided_at: now })
    .eq("id", params.id).eq("user_id", userData.user.id).eq("status", "pending").gt("expires_at", now)
    .select("id,server_id,user_id,tool_name,arguments_redacted,status,expires_at,decided_at,executed_at,created_at").maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data) return NextResponse.json({ error: "Pending approval not found or already expired." }, { status: 404 });
  return NextResponse.json({ approval: data });
}
