import { NextResponse } from "next/server";
import { z } from "zod";
import { hasServerSupabaseEnv } from "@/lib/supabase/env";
import { createAdminClient, createServerSupabaseClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

export async function DELETE(_request: Request, { params }: { params: { id: string } }) {
  if (!z.string().uuid().safeParse(params.id).success) {
    return NextResponse.json({ error: "A valid connection ID is required." }, { status: 400 });
  }
  if (!hasServerSupabaseEnv()) return NextResponse.json({ deleted: true, preview: true });
  const supabase = createServerSupabaseClient();
  const { data: userData } = await supabase.auth.getUser();
  if (!userData.user) return NextResponse.json({ error: "Authentication required." }, { status: 401 });

  const { data, error } = await createAdminClient().from("api_credentials")
    .delete().eq("id", params.id).eq("user_id", userData.user.id).select("id").maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data) return NextResponse.json({ error: "Connection not found." }, { status: 404 });
  return NextResponse.json({ deleted: true });
}
