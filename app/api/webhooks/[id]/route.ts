import { NextResponse } from "next/server";
import { decryptCredential } from "@/lib/credentials";
import { hasServerSupabaseEnv } from "@/lib/supabase/env";
import { createAdminClient, createServerSupabaseClient, hasServiceRoleKey } from "@/lib/supabase/server";
import { isSensitiveWebhookHeader, readBoundedRequestText, verifyWebhookSignature, webhookEventId } from "@/lib/webhook-security";

export const runtime = "nodejs";

const MAX_WEBHOOK_BYTES = 1_000_000;

function safeHeaders(headers: Headers, eventIdHeader: string, signatureHeader: string) {
  const allowed = ["content-type", "user-agent", "x-event-type", eventIdHeader.toLowerCase()];
  return Object.fromEntries(allowed
    .filter((name) => name !== signatureHeader.toLowerCase())
    .map((name) => [name, headers.get(name)?.slice(0, 1000) ?? null])
    .filter((entry): entry is [string, string] => Boolean(entry[1])));
}

export async function POST(request: Request, { params }: { params: { id: string } }) {
  const contentLength = Number(request.headers.get("content-length"));
  if (Number.isFinite(contentLength) && contentLength > MAX_WEBHOOK_BYTES) {
    return NextResponse.json({ error: "Webhook payload is too large." }, { status: 413 });
  }

  const admin = createAdminClient();
  const { data: endpoint } = await admin.from("webhook_endpoints")
    .select("id,user_id,secret_ciphertext,signature_header,event_id_header,is_active")
    .eq("id", params.id).maybeSingle();
  if (!endpoint || !endpoint.is_active) return NextResponse.json({ error: "Webhook endpoint not found." }, { status: 404 });
  if (endpoint.signature_header.toLowerCase() === endpoint.event_id_header.toLowerCase()
    || isSensitiveWebhookHeader(endpoint.signature_header)
    || isSensitiveWebhookHeader(endpoint.event_id_header)) {
    return NextResponse.json({ error: "Webhook endpoint configuration is unsafe. Recreate this endpoint." }, { status: 422 });
  }

  const raw = await readBoundedRequestText(request, MAX_WEBHOOK_BYTES);
  if (raw === null) return NextResponse.json({ error: "Webhook payload is too large." }, { status: 413 });
  const signature = request.headers.get(endpoint.signature_header);
  const suppliedEventId = request.headers.get(endpoint.event_id_header);
  if (!signature || !verifyWebhookSignature(raw, signature, decryptCredential(endpoint.secret_ciphertext), suppliedEventId)) {
    return NextResponse.json({ error: "Invalid webhook signature." }, { status: 401 });
  }

  const eventId = webhookEventId(raw, suppliedEventId);
  let payload: unknown;
  try { payload = raw ? JSON.parse(raw) : {}; } catch { payload = { raw }; }
  const { error } = await admin.from("webhook_events").insert({
    endpoint_id: endpoint.id,
    user_id: endpoint.user_id,
    event_id: eventId,
    event_type: request.headers.get("x-event-type")?.slice(0, 160) ?? null,
    payload,
    headers: safeHeaders(request.headers, endpoint.event_id_header, endpoint.signature_header),
  });
  if (error?.code === "23505") return NextResponse.json({ received: true, duplicate: true, event_id: eventId });
  if (error) return NextResponse.json({ error: "Webhook could not be stored." }, { status: 500 });
  return NextResponse.json({ received: true, duplicate: false, event_id: eventId });
}

export async function DELETE(_request: Request, { params }: { params: { id: string } }) {
  if (!hasServerSupabaseEnv() || !hasServiceRoleKey()) return NextResponse.json({ error: "Workspace storage is unavailable." }, { status: 503 });
  const { data } = await createServerSupabaseClient().auth.getUser();
  if (!data.user) return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  const { error, count } = await createAdminClient().from("webhook_endpoints")
    .delete({ count: "exact" }).eq("id", params.id).eq("user_id", data.user.id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!count) return NextResponse.json({ error: "Webhook endpoint not found." }, { status: 404 });
  return NextResponse.json({ deleted: true });
}
