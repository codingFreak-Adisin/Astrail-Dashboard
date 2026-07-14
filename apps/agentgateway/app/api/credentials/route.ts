import { NextResponse } from "next/server";
import { z } from "zod";
import { encryptCredential, hasCredentialEncryptionKey, previewSecret } from "@/lib/credentials";
import { localDemoUserId } from "@/lib/local-demo";
import { hasServerSupabaseEnv } from "@/lib/supabase/env";
import { createAdminClient, createServerSupabaseClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

const CreateCredentialSchema = z.object({
  name: z.string().min(1).max(80),
  server_id: z.string().uuid().optional(),
  provider: z.string().min(1).max(80).optional(),
  auth_scheme: z.enum(["bearer", "api_key_header", "api_key_query"]),
  injection_name: z.string().min(1).max(80).optional(),
  scopes: z.array(z.string().min(1).max(80)).max(50).optional(),
  secret: z.string().min(8).max(4096),
});

export async function GET() {
  if (!hasServerSupabaseEnv()) {
    return NextResponse.json({ credentials: [] });
  }

  const supabase = createServerSupabaseClient();
  const { data: userData } = await supabase.auth.getUser();
  if (!userData.user) return NextResponse.json({ error: "Authentication required." }, { status: 401 });

  const { data, error } = await createAdminClient()
    .from("api_credentials")
    .select("id,user_id,server_id,name,provider,auth_scheme,injection_name,scopes,key_preview,created_at,updated_at")
    .eq("user_id", userData.user.id)
    .order("created_at", { ascending: false });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ credentials: data ?? [] });
}

export async function POST(request: Request) {
  if (!hasServerSupabaseEnv()) {
    const body = await request.json() as {
      name?: string;
      server_id?: string;
      provider?: string;
      auth_scheme?: "bearer" | "api_key_header" | "api_key_query";
      injection_name?: string;
      scopes?: string[];
      secret?: string;
    };
    if (!body.name?.trim() || !body.auth_scheme || !body.secret || body.secret.length < 8) {
      return NextResponse.json({ error: "Credential name, auth scheme, and an 8+ character secret are required." }, { status: 400 });
    }
    return NextResponse.json({
      credential: {
        id: "local-credential",
        user_id: localDemoUserId,
        server_id: body.server_id ?? null,
        name: body.name.trim(),
        provider: body.provider ?? null,
        auth_scheme: body.auth_scheme,
        injection_name: body.injection_name ?? null,
        scopes: body.scopes ?? [],
        key_preview: previewSecret(body.secret),
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
      preview: true,
    });
  }

  const supabase = createServerSupabaseClient();
  const { data: userData } = await supabase.auth.getUser();
  if (!userData.user) return NextResponse.json({ error: "Authentication required." }, { status: 401 });

  if (!hasCredentialEncryptionKey()) {
    return NextResponse.json({
      error: "Credential storage requires CREDENTIAL_ENCRYPTION_KEY. No plaintext credential was stored.",
    }, { status: 503 });
  }

  const body = CreateCredentialSchema.parse(await request.json());
  if (body.server_id) {
    const { data: server, error: serverError } = await createAdminClient()
      .from("mcp_servers")
      .select("id")
      .eq("id", body.server_id)
      .eq("user_id", userData.user.id)
      .maybeSingle();
    if (serverError || !server) {
      return NextResponse.json({ error: "Selected server does not belong to this user." }, { status: 403 });
    }
  }

  const { data, error } = await createAdminClient()
    .from("api_credentials")
    .insert({
      user_id: userData.user.id,
      server_id: body.server_id ?? null,
      name: body.name,
      provider: body.provider ?? null,
      auth_scheme: body.auth_scheme,
      injection_name: body.injection_name ?? null,
      scopes: body.scopes ?? [],
      secret_ciphertext: encryptCredential(body.secret),
      key_preview: previewSecret(body.secret),
      updated_at: new Date().toISOString(),
    })
    .select("id,user_id,server_id,name,provider,auth_scheme,injection_name,scopes,key_preview,created_at,updated_at")
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ credential: data });
}
