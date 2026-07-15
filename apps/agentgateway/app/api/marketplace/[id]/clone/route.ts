import { NextResponse } from "next/server";
import { findPresetServer } from "@/lib/preset-servers";
import { hasServerSupabaseEnv } from "@/lib/supabase/env";
import { createAdminClient, createServerSupabaseClient } from "@/lib/supabase/server";
import { buildMcpEndpoint } from "@/lib/urls";

export const runtime = "nodejs";

export async function POST(request: Request, { params }: { params: { id: string } }) {
  if (!hasServerSupabaseEnv()) {
    const source = findPresetServer(params.id);
    if (!source) return NextResponse.json({ error: "Public MCP server not found." }, { status: 404 });
    return NextResponse.json({
      id: source.id,
      hosted_endpoint: `/api/mcp/${source.id}`,
      preview: true,
    });
  }

  const supabase = createServerSupabaseClient();
  const { data: userData } = await supabase.auth.getUser();

  if (!userData.user) {
    return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  }

  const admin = createAdminClient();
  const source = findPresetServer(params.id);
  if (!source) return NextResponse.json({ error: "Public MCP server not found." }, { status: 404 });

  const { data: inserted, error: insertError } = await admin
    .from("mcp_servers")
    .insert({
      user_id: userData.user.id,
      name: source.name,
      description: source.description,
      source_url: source.source_url,
      source_type: "preset",
      generated_code: source.generated_code,
      tools_json: source.tools_json ?? [],
      endpoint_map: source.endpoint_map ?? [],
      diagnostics: source.diagnostics ?? {
        warnings: ["Cloned from Astrail endpoint catalog."],
      },
      status: source.status === "preset" ? "preset" : "live",
      validation_status: source.validation_status ?? "passed",
      generation_status: source.generation_status ?? "completed",
      is_public: false,
      call_count: 0,
      generation_version: typeof source.generation_version === "number" ? source.generation_version : 1,
      protocol_version: source.protocol_version ?? "2024-11-05",
    })
    .select("id")
    .single();

  if (insertError || !inserted) {
    return NextResponse.json({ error: insertError?.message ?? "Could not add server." }, { status: 500 });
  }

  const hostedEndpoint = buildMcpEndpoint(inserted.id, request.url);
  await admin
    .from("mcp_servers")
    .update({ hosted_endpoint: hostedEndpoint })
    .eq("id", inserted.id);

  return NextResponse.json({ id: inserted.id, hosted_endpoint: hostedEndpoint });
}
