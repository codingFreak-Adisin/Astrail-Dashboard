import { NextResponse } from "next/server";
import { z } from "zod";
import { timingSafeEqual } from "crypto";
import { encryptCredential, hasCredentialEncryptionKey, normalizeOAuthScopes } from "@/lib/credentials";
import {
  buildAuthorizeUrl,
  CONNECT_STATE_TTL_MS,
  generateConnectState,
  generatePkcePair,
} from "@/lib/oauth-connect";
import { assertSafeUpstreamUrl } from "@/lib/runtime/network-policy";
import { oauthSecurityBinding, oauthSecurityMetadata, oauthSecuritySchemeNames } from "@/lib/runtime/oauth-security";
import { hasServerSupabaseEnv } from "@/lib/supabase/env";
import { createAdminClient, createServerSupabaseClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

const ConnectSchema = z.object({
  name: z.string().min(1).max(80),
  server_id: z.string().uuid(),
  provider: z.string().min(1).max(80),
  security_scheme: z.string().trim().min(1).max(120).optional(),
  client_id: z.string().min(1).max(240),
  client_secret: z.string().max(4096).optional(),
  token_auth_method: z.enum(["client_secret_post", "client_secret_basic"]).default("client_secret_post"),
  authorization_url: z.string().url().max(1000).optional(),
  token_url: z.string().url().max(1000).optional(),
  scopes: z.union([z.array(z.string().min(1).max(120)).max(80), z.string().max(4000)]).optional(),
  end_user_id: z.string().min(1).max(256).optional(),
  authorization_params: z.record(z.string().min(1).max(80), z.string().max(500)).optional(),
  trust_provider_origins: z.boolean().optional(),
  confirmed_security_binding: z.string().regex(/^[a-f0-9]{64}$/).optional(),
}).refine((value) => !value.authorization_params || Object.keys(value.authorization_params).length <= 16, {
  message: "Too many authorization parameters.",
  path: ["authorization_params"],
});

function appOrigin(request: Request): string {
  const requestOrigin = new URL(request.url).origin;
  const configuredOrigin = process.env.NEXT_PUBLIC_APP_URL ?? process.env.NEXT_PUBLIC_RUNTIME_BASE_URL;
  if (!configuredOrigin) return requestOrigin;
  try {
    return new URL(configuredOrigin).origin;
  } catch {
    return requestOrigin;
  }
}

const KNOWN_PROVIDER_HOSTS: Record<string, { authorization: string[]; token: string[]; resource: string[] }> = {
  github: { authorization: ["github.com"], token: ["github.com"], resource: ["github.com", "api.github.com", "uploads.github.com"] },
  google: { authorization: ["accounts.google.com"], token: ["oauth2.googleapis.com"], resource: ["www.googleapis.com", ".googleapis.com"] },
  slack: { authorization: ["slack.com"], token: ["slack.com"], resource: ["slack.com"] },
  hubspot: { authorization: ["app.hubspot.com"], token: ["api.hubapi.com"], resource: ["api.hubapi.com"] },
  salesforce: { authorization: ["login.salesforce.com"], token: ["login.salesforce.com"], resource: [".salesforce.com"] },
};

function hostnameAllowed(hostname: string, allowed: string[]) {
  return allowed.some((entry) => entry.startsWith(".") ? hostname.endsWith(entry) : hostname === entry);
}

async function assertPublicHttpsUrl(raw: string, label: string) {
  const url = new URL(raw);
  if (url.protocol !== "https:") {
    throw new Error(`${label} must use HTTPS.`);
  }
  try {
    await assertSafeUpstreamUrl(url);
  } catch {
    throw new Error(`${label} must resolve to a public HTTPS endpoint.`);
  }
}

export async function POST(request: Request) {
  if (!hasServerSupabaseEnv()) {
    return NextResponse.json({
      error: "Hosted OAuth connect requires Supabase configuration.",
    }, { status: 503 });
  }

  const supabase = createServerSupabaseClient();
  const { data: userData } = await supabase.auth.getUser();
  if (!userData.user) return NextResponse.json({ error: "Authentication required." }, { status: 401 });

  if (!hasCredentialEncryptionKey()) {
    return NextResponse.json({
      error: "Hosted OAuth connect requires CREDENTIAL_ENCRYPTION_KEY. No credential was stored.",
    }, { status: 503 });
  }

  const parsed = ConnectSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid OAuth connection request.", details: parsed.error.flatten() }, { status: 400 });
  const body = parsed.data;
  let securityScheme = body.security_scheme ?? null;
  let authorizationUrl = "";
  let tokenUrl = "";
  let securityBinding: string | null = null;
  let trustedMetadata: ReturnType<typeof oauthSecurityMetadata> = null;
  {
    const { data: server, error: serverError } = await createAdminClient()
      .from("mcp_servers")
      .select("id,endpoint_map")
      .eq("id", body.server_id)
      .eq("user_id", userData.user.id)
      .maybeSingle();
    if (serverError || !server) {
      return NextResponse.json({ error: "Selected server does not belong to this user." }, { status: 403 });
    }
    const endpointMap = Array.isArray(server.endpoint_map) ? server.endpoint_map : [];
    const schemes = Array.from(new Set(endpointMap
      .flatMap((endpoint) => oauthSecuritySchemeNames(endpoint))));
    if (schemes.length === 0) {
      return NextResponse.json({ error: "This server has no verified OAuth scheme metadata. Re-import its API contract before connecting OAuth." }, { status: 409 });
    }
    if (securityScheme && schemes.length > 0 && !schemes.includes(securityScheme)) {
      return NextResponse.json({ error: `OAuth security scheme must be one of: ${schemes.join(", ")}.` }, { status: 400 });
    }
    if (!securityScheme && schemes.length === 1) securityScheme = schemes[0];
    if (!securityScheme && schemes.length > 1) {
      return NextResponse.json({ error: `This server has multiple OAuth schemes. Choose one: ${schemes.join(", ")}.` }, { status: 400 });
    }
    trustedMetadata = securityScheme
      ? endpointMap.map((endpoint) => oauthSecurityMetadata(endpoint, securityScheme as string)).find((metadata) => metadata?.authorization_url && metadata?.token_url) ?? null
      : null;
    if (!trustedMetadata?.authorization_url || !trustedMetadata.token_url) {
      return NextResponse.json({ error: `The imported ${securityScheme ?? "OAuth"} scheme does not declare trusted authorization and token URLs. Fix and re-import the API contract.` }, { status: 409 });
    }
    authorizationUrl = trustedMetadata.authorization_url;
    tokenUrl = trustedMetadata.token_url;
    securityBinding = securityScheme
      ? endpointMap.map((endpoint) => oauthSecurityBinding(endpoint, securityScheme as string)).find(Boolean) ?? null
      : null;
    if (!securityBinding) {
      return NextResponse.json({ error: "The imported OAuth provider binding is incomplete. Re-import the API contract before connecting." }, { status: 409 });
    }
  }
  try {
    await assertPublicHttpsUrl(authorizationUrl, "OAuth authorization URL");
    await assertPublicHttpsUrl(tokenUrl, "OAuth token URL");
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Invalid OAuth URL." }, { status: 400 });
  }
  const knownHosts = KNOWN_PROVIDER_HOSTS[body.provider.trim().toLowerCase()];
  if (!trustedMetadata?.resource_origin) {
    return NextResponse.json({ error: "The imported OAuth provider has no absolute API resource origin. Fix and re-import the API contract." }, { status: 409 });
  }
  if (knownHosts) {
    const authorizationHost = new URL(authorizationUrl).hostname.toLowerCase();
    const tokenHost = new URL(tokenUrl).hostname.toLowerCase();
    const resourceHost = trustedMetadata?.resource_origin ? new URL(trustedMetadata.resource_origin).hostname.toLowerCase() : "";
    if (!hostnameAllowed(authorizationHost, knownHosts.authorization)
      || !hostnameAllowed(tokenHost, knownHosts.token)
      || !resourceHost
      || !hostnameAllowed(resourceHost, knownHosts.resource)) {
      return NextResponse.json({ error: `${body.provider} OAuth metadata does not match the verified provider hosts. Fix and re-import the API contract.` }, { status: 409 });
    }
  } else {
    const confirmedBinding = body.confirmed_security_binding ?? "";
    const bindingMatches = confirmedBinding.length === securityBinding?.length
      && timingSafeEqual(Buffer.from(confirmedBinding), Buffer.from(securityBinding ?? ""));
    if (body.trust_provider_origins !== true || !bindingMatches) {
      return NextResponse.json({ error: "Custom OAuth providers require confirmation of the current authorization, token, and resource origins. Refresh the dashboard and confirm again." }, { status: 400 });
    }
  }

  const state = generateConnectState();
  const pkce = generatePkcePair();
  const scopes = normalizeOAuthScopes(body.scopes);
  const redirectUri = `${appOrigin(request)}/api/oauth/callback`;
  const expiresAt = new Date(Date.now() + CONNECT_STATE_TTL_MS).toISOString();

  const { data, error } = await createAdminClient()
    .from("api_credentials")
    .insert({
      user_id: userData.user.id,
      server_id: body.server_id ?? null,
      name: body.name,
      provider: body.provider,
      security_scheme: securityScheme,
      security_binding: securityBinding,
      auth_scheme: "oauth2",
      client_id: body.client_id,
      client_secret_ciphertext: body.client_secret ? encryptCredential(body.client_secret) : null,
      token_auth_method: body.token_auth_method,
      injection_name: null,
      scopes,
      secret_ciphertext: encryptCredential(`astrail_pending_connect:${state}`),
      access_token_ciphertext: null,
      refresh_token_ciphertext: null,
      token_url: tokenUrl,
      expires_at: null,
      key_preview: "pending",
      authorization_url: authorizationUrl,
      connect_status: "pending",
      connect_state: state,
      connect_state_expires_at: expiresAt,
      pkce_verifier_ciphertext: encryptCredential(pkce.verifier),
      end_user_id: body.end_user_id ?? null,
      updated_at: new Date().toISOString(),
    })
    .select("id")
    .single();

  if (error) {
    const migrationHint = error.message.includes("column")
      ? " Run supabase-migration-oauth-connect.sql and supabase-migration-oauth-provider-binding.sql to enable hosted OAuth connect."
      : "";
    return NextResponse.json({ error: `${error.message}${migrationHint}` }, { status: 500 });
  }

  const authorizeUrl = buildAuthorizeUrl({
    authorizationUrl,
    clientId: body.client_id,
    redirectUri,
    state,
    scopes,
    codeChallenge: pkce.challenge,
    extraParams: body.authorization_params,
  });

  return NextResponse.json({
    credential_id: data.id,
    authorize_url: authorizeUrl.toString(),
    redirect_uri: redirectUri,
    expires_at: expiresAt,
    note: "Open authorize_url in a browser. After the provider consent screen, Astrail stores the exchanged tokens encrypted and the credential becomes active.",
  });
}
