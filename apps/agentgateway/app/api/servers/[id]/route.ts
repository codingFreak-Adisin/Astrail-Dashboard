import { NextResponse } from "next/server";
import { z } from "zod";
import { localDemoServers, updateLocalDemoServer } from "@/lib/local-demo";
import { loadLocalPreviewServer } from "@/lib/local-preview-servers";
import { hasServerSupabaseEnv } from "@/lib/supabase/env";
import { createDataClient, createServerSupabaseClient } from "@/lib/supabase/server";
import type { McpServer } from "@/lib/types";

export const runtime = "nodejs";

const UpdateServerSchema = z.object({
  is_public: z.boolean().optional(),
  tools_json: z.array(z.object({
    name: z.string().min(1),
    description: z.string().min(1),
    input_schema: z.record(z.string(), z.unknown()).optional(),
    method: z.string().optional(),
    path: z.string().optional(),
  })).optional(),
}).strict();

export async function GET(request: Request, { params }: { params: { id: string } }) {
  if (!hasServerSupabaseEnv()) {
    const server = await loadLocalPreviewServer(params.id, request.url)
      ?? localDemoServers().find((item) => item.id === params.id);
    if (!server) return NextResponse.json({ error: "Server not found." }, { status: 404 });
    return NextResponse.json({ server });
  }

  const supabase = createServerSupabaseClient();
  const { data: userData } = await supabase.auth.getUser();
  const db = createDataClient();

  const { data, error } = await db
    .from("mcp_servers")
    .select("*")
    .eq("id", params.id)
    .single();

  if (error || !data) {
    return NextResponse.json({ error: "Server not found." }, { status: 404 });
  }

  const server = data as McpServer;
  if (!server.is_public && server.user_id !== userData.user?.id) {
    return NextResponse.json({ error: "Forbidden." }, { status: 403 });
  }

  return NextResponse.json({ server });
}

export async function PATCH(request: Request, { params }: { params: { id: string } }) {
  if (!hasServerSupabaseEnv()) {
    const body = UpdateServerSchema.parse(await request.json());
    const server = updateLocalDemoServer(params.id, {
      ...(typeof body.is_public === "boolean" ? { is_public: body.is_public } : {}),
      ...(body.tools_json ? { tools_json: body.tools_json } : {}),
    });
    if (!server) return NextResponse.json({ error: "Server not found." }, { status: 404 });
    return NextResponse.json({
      server,
      preview: true,
    });
  }

  const supabase = createServerSupabaseClient();
  const { data: userData } = await supabase.auth.getUser();

  if (!userData.user) {
    return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  }

  const body = UpdateServerSchema.parse(await request.json());
  const db = createDataClient();
  const updatePayload: {
    is_public?: boolean;
    tools_json?: z.infer<typeof UpdateServerSchema>["tools_json"];
    generation_version?: number;
  } = {};

  if (typeof body.is_public === "boolean") updatePayload.is_public = body.is_public;
  if (body.tools_json) {
    updatePayload.tools_json = body.tools_json;
    updatePayload.generation_version = Date.now();
  }

  if (Object.keys(updatePayload).length === 0) {
    return NextResponse.json({ error: "No supported updates provided." }, { status: 400 });
  }

  const { data, error } = await db
    .from("mcp_servers")
    .update(updatePayload)
    .eq("id", params.id)
    .eq("user_id", userData.user.id)
    .select("*")
    .single();

  if (error || !data) {
    return NextResponse.json({ error: "Could not update server." }, { status: 400 });
  }

  return NextResponse.json({ server: data as McpServer });
}
