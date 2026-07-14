import { NextResponse } from "next/server";
import { buildWorkerBundle } from "@/lib/worker-export";
import { localDemoServers } from "@/lib/local-demo";
import { loadLocalPreviewServer } from "@/lib/local-preview-servers";
import { hasServerSupabaseEnv } from "@/lib/supabase/env";
import { createAdminClient, createServerSupabaseClient } from "@/lib/supabase/server";
import type { McpServer } from "@/lib/types";

export async function GET(request: Request, { params }: { params: { id: string } }) {
  if (!hasServerSupabaseEnv()) {
    const server = await loadLocalPreviewServer(params.id, request.url)
      ?? localDemoServers().find((item) => item.id === params.id);
    if (!server) return NextResponse.json({ error: "Server not found." }, { status: 404 });
    return NextResponse.json(buildWorkerBundle(server));
  }

  const supabase = createServerSupabaseClient();
  const { data: userData } = await supabase.auth.getUser();
  if (!userData.user) return NextResponse.json({ error: "Unauthorized." }, { status: 401 });

  const { data, error } = await createAdminClient()
    .from("mcp_servers")
    .select("*")
    .eq("id", params.id)
    .eq("user_id", userData.user.id)
    .single();

  if (error || !data) {
    return NextResponse.json({ error: "Server not found." }, { status: 404 });
  }

  return NextResponse.json(buildWorkerBundle(data as McpServer));
}
