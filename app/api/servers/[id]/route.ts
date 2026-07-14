import { NextResponse } from "next/server";
import { z } from "zod";
import { localDemoServers, updateLocalDemoServer } from "@/lib/local-demo";
import { loadLocalPreviewServer } from "@/lib/local-preview-servers";
import { findEndpointForTool } from "@/lib/runtime/execute-tool";
import { redactSensitive, visibleEndpointsForRequest, visibleToolsForRequest } from "@/lib/runtime/permissions";
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

function publicServerDto(server: McpServer) {
  const tools = visibleToolsForRequest(server, server.tools_json ?? [], findEndpointForTool);
  return redactSensitive({
    id: server.id,
    name: server.name,
    description: server.description,
    source_url: server.source_url,
    source_type: server.source_type,
    category: server.category ?? null,
    tools_json: tools,
    endpoint_map: visibleEndpointsForRequest(server),
    status: server.status ?? null,
    validation_status: server.validation_status ?? null,
    generation_status: server.generation_status ?? null,
    is_public: server.is_public,
    hosted_endpoint: server.hosted_endpoint,
    call_count: server.call_count,
    generation_version: server.generation_version ?? null,
    protocol_version: server.protocol_version ?? null,
    created_at: server.created_at,
  });
}

export async function GET(request: Request, { params }: { params: { id: string } }) {
  if (!hasServerSupabaseEnv()) {
    const server = await loadLocalPreviewServer(params.id, request.url)
      ?? localDemoServers().find((item) => item.id === params.id);
    if (!server) return NextResponse.json({ error: "Server not found." }, { status: 404 });
    return NextResponse.json({ server: server.is_public ? publicServerDto(server) : server });
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
  const isOwner = server.user_id === userData.user?.id;
  if (!server.is_public && !isOwner) {
    return NextResponse.json({ error: "Forbidden." }, { status: 403 });
  }

  return NextResponse.json({ server: isOwner ? server : publicServerDto(server) });
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
