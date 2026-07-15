import { NextResponse } from "next/server";
import { z } from "zod";
import { createRawApiKey, hashApiKey, previewApiKey } from "@/lib/api-keys";
import { localDemoApiKeys, localDemoUserId } from "@/lib/local-demo";
import { hasServerSupabaseEnv } from "@/lib/supabase/env";
import { createDataClient, createServerSupabaseClient } from "@/lib/supabase/server";
import type { ApiKey } from "@/lib/types";

export const runtime = "nodejs";

const CreateKeySchema = z.object({
  name: z.string().min(1).max(80),
});

const DeleteKeySchema = z.object({
  id: z.string().uuid(),
  confirmation: z.string().min(1),
});

export async function GET() {
  if (!hasServerSupabaseEnv()) {
    return NextResponse.json({ keys: localDemoApiKeys() });
  }

  const supabase = createServerSupabaseClient();
  const { data: userData } = await supabase.auth.getUser();

  if (!userData.user) {
    return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  }

  const db = createDataClient();
  const { data, error } = await db
    .from("api_keys")
    .select("id,user_id,name,key_preview,last_used,created_at")
    .eq("user_id", userData.user.id)
    .order("created_at", { ascending: false });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ keys: (data ?? []) as ApiKey[] });
}

export async function POST(request: Request) {
  if (!hasServerSupabaseEnv()) {
    const body = CreateKeySchema.parse(await request.json());
    const rawKey = `ag_demo_${Math.random().toString(36).slice(2, 18)}`;
    return NextResponse.json({
      key: {
        id: "00000000-0000-4000-8000-000000000002",
        user_id: localDemoUserId,
        name: body.name.trim(),
        key_preview: previewApiKey(rawKey),
        last_used: null,
        created_at: new Date().toISOString(),
      } satisfies ApiKey,
      rawKey,
    });
  }

  const supabase = createServerSupabaseClient();
  const { data: userData } = await supabase.auth.getUser();

  if (!userData.user) {
    return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  }

  const body = CreateKeySchema.parse(await request.json());
  const keyName = body.name.trim();
  const rawKey = createRawApiKey();
  const db = createDataClient();

  const { data: existing, error: existingError } = await db
    .from("api_keys")
    .select("id")
    .eq("user_id", userData.user.id)
    .eq("name", keyName)
    .maybeSingle();

  if (existingError) {
    return NextResponse.json({ error: existingError.message }, { status: 500 });
  }

  if (existing) {
    return NextResponse.json({ error: "An API key with this name already exists." }, { status: 409 });
  }

  const { data, error } = await db
    .from("api_keys")
    .insert({
      user_id: userData.user.id,
      name: keyName,
      key_hash: hashApiKey(rawKey),
      key_preview: previewApiKey(rawKey),
    })
    .select("id,user_id,name,key_preview,last_used,created_at")
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ key: data as ApiKey, rawKey });
}

export async function DELETE(request: Request) {
  if (!hasServerSupabaseEnv()) {
    return NextResponse.json({ deleted: true });
  }

  const supabase = createServerSupabaseClient();
  const { data: userData } = await supabase.auth.getUser();

  if (!userData.user) {
    return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  }

  const body = DeleteKeySchema.parse(await request.json());
  const db = createDataClient();

  const { data: key, error: keyError } = await db
    .from("api_keys")
    .select("id,name")
    .eq("id", body.id)
    .eq("user_id", userData.user.id)
    .single();

  if (keyError || !key) {
    return NextResponse.json({ error: "API key not found." }, { status: 404 });
  }

  if (body.confirmation !== key.name) {
    return NextResponse.json({ error: `Type ${JSON.stringify(key.name)} to delete this key.` }, { status: 400 });
  }

  const { error } = await db
    .from("api_keys")
    .delete()
    .eq("id", body.id)
    .eq("user_id", userData.user.id);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ deleted: true });
}
