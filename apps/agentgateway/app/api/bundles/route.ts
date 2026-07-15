import { NextResponse } from "next/server";
import { hasServerSupabaseEnv } from "@/lib/supabase/env";
import { createAdminClient, createServerSupabaseClient } from "@/lib/supabase/server";
import { buildBundleEndpoint } from "@/lib/urls";

type CreateBundleBody = {
  name?: string;
  serverIds?: string[];
};

export async function POST(request: Request) {
  if (!hasServerSupabaseEnv()) {
    let body: CreateBundleBody;
    try {
      body = (await request.json()) as CreateBundleBody;
    } catch {
      return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
    }

    const name = body.name?.trim();
    const serverIds = Array.isArray(body.serverIds)
      ? Array.from(new Set(body.serverIds.filter((id) => typeof id === "string" && id.length > 0)))
      : [];

    if (!name) return NextResponse.json({ error: "Bundle name is required." }, { status: 400 });
    if (serverIds.length === 0) return NextResponse.json({ error: "Select at least one server." }, { status: 400 });

    return NextResponse.json({
      bundle: {
        id: "local-work-stack",
        name,
        hosted_endpoint: "/api/mcp/bundles/local-work-stack",
        is_public: false,
        created_at: new Date().toISOString(),
        preview: true,
      },
    });
  }

  const supabase = createServerSupabaseClient();
  const { data: userData } = await supabase.auth.getUser();
  if (!userData.user) return NextResponse.json({ error: "Unauthorized." }, { status: 401 });

  let body: CreateBundleBody;
  try {
    body = (await request.json()) as CreateBundleBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const name = body.name?.trim();
  const serverIds = Array.isArray(body.serverIds)
    ? Array.from(new Set(body.serverIds.filter((id) => typeof id === "string" && id.length > 0)))
    : [];

  if (!name) return NextResponse.json({ error: "Bundle name is required." }, { status: 400 });
  if (serverIds.length === 0) return NextResponse.json({ error: "Select at least one server." }, { status: 400 });

  const admin = createAdminClient();
  const { data: ownedServers, error: serverError } = await admin
    .from("mcp_servers")
    .select("id")
    .eq("user_id", userData.user.id)
    .in("id", serverIds);

  if (serverError) return NextResponse.json({ error: serverError.message }, { status: 500 });

  const ownedIds = (ownedServers ?? []).map((server) => server.id);
  if (ownedIds.length !== serverIds.length) {
    return NextResponse.json({ error: "One or more selected servers are not in your gateway." }, { status: 400 });
  }

  const { data: bundle, error: bundleError } = await admin
    .from("mcp_bundles")
    .insert({
      user_id: userData.user.id,
      name,
      is_public: false,
    })
    .select("id,name,hosted_endpoint,is_public,created_at")
    .single();

  if (bundleError || !bundle) {
    return NextResponse.json({ error: bundleError?.message ?? "Could not create bundle." }, { status: 500 });
  }

  const endpoint = buildBundleEndpoint(bundle.id, request.url);
  await admin.from("mcp_bundles").update({ hosted_endpoint: endpoint }).eq("id", bundle.id);

  const { error: linkError } = await admin
    .from("mcp_bundle_servers")
    .insert(ownedIds.map((serverId) => ({ bundle_id: bundle.id, server_id: serverId })));

  if (linkError) {
    return NextResponse.json({ error: linkError.message }, { status: 500 });
  }

  return NextResponse.json({ bundle: { ...bundle, hosted_endpoint: endpoint } });
}
