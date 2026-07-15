import { NextResponse } from "next/server";
import { localDemoServers } from "@/lib/local-demo";
import { hasServerSupabaseEnv } from "@/lib/supabase/env";
import { createDataClient, createServerSupabaseClient } from "@/lib/supabase/server";
import type { McpServer } from "@/lib/types";

export const runtime = "nodejs";

export async function GET() {
  if (!hasServerSupabaseEnv()) {
    return NextResponse.json({ servers: localDemoServers(), preview: true });
  }

  const supabase = createServerSupabaseClient();
  const { data: userData } = await supabase.auth.getUser();

  if (!userData.user) {
    return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  }

  const db = createDataClient();
  const { data, error } = await db
    .from("mcp_servers")
    .select("*")
    .eq("user_id", userData.user.id)
    .order("created_at", { ascending: false });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ servers: (data ?? []) as McpServer[] });
}
