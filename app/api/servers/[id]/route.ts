import { NextResponse } from "next/server";
import { z } from "zod";
import { localDemoServers, updateLocalDemoServer } from "@/lib/local-demo";
import { loadLocalPreviewServer } from "@/lib/local-preview-servers";
import { findEndpointForTool } from "@/lib/runtime/execute-tool";
import { normalizeFieldMappings } from "@/lib/runtime/field-mapping";
import { redactSensitive, visibleEndpointsForRequest, visibleToolsForRequest } from "@/lib/runtime/permissions";
import { hasServerSupabaseEnv } from "@/lib/supabase/env";
import { createDataClient, createServerSupabaseClient } from "@/lib/supabase/server";
import type { McpServer } from "@/lib/types";

export const runtime = "nodejs";

const RuntimePermissionPatternSchema = z.union([
  z.string().min(1).max(240),
  z.object({
    pattern: z.string().min(1).max(240),
    regex: z.boolean().optional(),
    match: z.enum(["sdk_method", "endpoint_id", "tool_name", "operation_id", "method_path", "resource", "tag", "path", "http_method"]).optional(),
    note: z.string().max(1000).optional(),
  }).strict(),
]);

const UpdateServerSchema = z.object({
  is_public: z.boolean().optional(),
  tools_json: z.array(z.object({
    name: z.string().min(1),
    description: z.string().min(1),
    input_schema: z.record(z.string(), z.unknown()).optional(),
    method: z.string().optional(),
    path: z.string().optional(),
    policy: z.enum(["allow", "approval", "block"]).optional(),
  }).passthrough()).max(1000).optional(),
  field_mappings: z.unknown().optional(),
  execution_policy: z.object({
    max_attempts: z.number().int().min(1).max(4).optional(),
    timeout_ms: z.number().int().min(1000).max(30000).optional(),
    base_delay_ms: z.number().int().min(0).max(2000).optional(),
    retry_statuses: z.array(z.number().int().refine((status) => status === 408 || status === 425 || status === 429 || (status >= 500 && status <= 599), "Only timeout, rate-limit, and server-error statuses can be retried.")).max(30).optional(),
    retry_writes: z.boolean().optional(),
    idempotency_header: z.string().min(1).max(80).regex(/^[a-z0-9-]+$/i).optional(),
  }).strict().optional(),
  runtime_policy: z.object({
    allow_http_gets: z.boolean().optional(),
    read_only: z.boolean().optional(),
    allowed_actions: z.array(z.enum(["read", "draft", "write", "send", "destructive"])).max(5).optional(),
    blocked_actions: z.array(z.enum(["read", "draft", "write", "send", "destructive"])).max(5).optional(),
    allowed_methods: z.array(RuntimePermissionPatternSchema).max(200).optional(),
    blocked_methods: z.array(RuntimePermissionPatternSchema).max(200).optional(),
    allowed_resources: z.array(RuntimePermissionPatternSchema).max(200).optional(),
    blocked_resources: z.array(RuntimePermissionPatternSchema).max(200).optional(),
    roles: z.record(z.string().min(1).max(64), z.object({
      max_action_level: z.enum(["read", "draft", "write", "send", "destructive"]).optional(),
      allowed_tools: z.array(z.string().min(1).max(240)).max(500).optional(),
      blocked_tools: z.array(z.string().min(1).max(240)).max(500).optional(),
      note: z.string().max(1000).optional(),
    }).strict()).optional(),
  }).strict().optional(),
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
    const parsed = UpdateServerSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) return NextResponse.json({ error: "Invalid server update.", details: parsed.error.flatten() }, { status: 400 });
    const body = parsed.data;
    const server = updateLocalDemoServer(params.id, {
      ...(typeof body.is_public === "boolean" ? { is_public: body.is_public } : {}),
      ...(body.tools_json ? { tools_json: body.tools_json } : {}),
      ...("field_mappings" in body ? { field_mappings: body.field_mappings === null ? null : normalizeFieldMappings(body.field_mappings) } : {}),
      ...(body.execution_policy ? { execution_policy: body.execution_policy } : {}),
      ...(body.runtime_policy ? { runtime_policy: body.runtime_policy } : {}),
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

  const parsed = UpdateServerSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid server update.", details: parsed.error.flatten() }, { status: 400 });
  const body = parsed.data;
  const db = createDataClient();
  const updatePayload: Record<string, unknown> = {};

  if (typeof body.is_public === "boolean") updatePayload.is_public = body.is_public;
  if (body.tools_json) {
    updatePayload.tools_json = body.tools_json;
    updatePayload.generation_version = Date.now();
  }
  if ("field_mappings" in body) {
    if (body.field_mappings === null) {
      updatePayload.field_mappings = null;
    } else {
      const normalized = normalizeFieldMappings(body.field_mappings);
      if (!normalized) {
        return NextResponse.json({
          error: "field_mappings must contain at least one valid rule. Argument rules need an \"argument\" name; response rules need a \"field\" path.",
        }, { status: 400 });
      }
      updatePayload.field_mappings = normalized;
    }
  }
  if (body.execution_policy) updatePayload.execution_policy = body.execution_policy;
  if (body.runtime_policy) updatePayload.runtime_policy = body.runtime_policy;

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
