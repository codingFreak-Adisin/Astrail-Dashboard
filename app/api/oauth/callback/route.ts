import { NextResponse } from "next/server";
import { decryptCredential, encryptCredential, hasCredentialEncryptionKey, previewSecret } from "@/lib/credentials";
import { connectStateExpired, exchangeAuthorizationCode } from "@/lib/oauth-connect";
import { hasServerSupabaseEnv } from "@/lib/supabase/env";
import { createAdminClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

const CALLBACK_STATE_PATTERN = /^[A-Za-z0-9_-]{16,128}$/;

type PendingConnectRow = {
  id: string;
  user_id: string;
  provider: string | null;
  client_id: string | null;
  client_secret_ciphertext: string | null;
  token_auth_method: "client_secret_post" | "client_secret_basic" | null;
  scopes: unknown;
  token_url: string | null;
  connect_state_expires_at: string | null;
  pkce_verifier_ciphertext: string | null;
};

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

function dashboardRedirect(request: Request, params: Record<string, string>) {
  const url = new URL("/dashboard/connections", appOrigin(request));
  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, value);
  }
  return NextResponse.redirect(url);
}

export async function GET(request: Request) {
  if (!hasServerSupabaseEnv() || !hasCredentialEncryptionKey()) {
    return dashboardRedirect(request, { connect_error: "OAuth connect is not configured on this deployment." });
  }

  const query = new URL(request.url).searchParams;
  const state = query.get("state");
  const code = query.get("code");
  const providerError = query.get("error");

  if (!state || !CALLBACK_STATE_PATTERN.test(state)) {
    return dashboardRedirect(request, { connect_error: "Missing or malformed OAuth state." });
  }

  const admin = createAdminClient();
  const { data, error } = await admin
    .from("api_credentials")
    .update({ connect_status: "exchanging", updated_at: new Date().toISOString() })
    .eq("connect_state", state)
    .eq("connect_status", "pending")
    .select("id,user_id,provider,client_id,client_secret_ciphertext,token_auth_method,scopes,token_url,connect_state_expires_at,pkce_verifier_ciphertext")
    .maybeSingle();

  if (error || !data) {
    return dashboardRedirect(request, { connect_error: "OAuth connect session not found. Start the connect flow again." });
  }
  const pending = data as PendingConnectRow;

  const invalidatePending = () => admin
    .from("api_credentials")
    .update({
      connect_state: null,
      connect_state_expires_at: null,
      pkce_verifier_ciphertext: null,
      connect_status: "failed",
      updated_at: new Date().toISOString(),
    })
    .eq("id", pending.id)
    .eq("connect_status", "exchanging");

  if (providerError) {
    await invalidatePending();
    const description = query.get("error_description");
    return dashboardRedirect(request, { connect_error: description || `Provider returned "${providerError}".` });
  }

  if (connectStateExpired(pending.connect_state_expires_at)) {
    await invalidatePending();
    return dashboardRedirect(request, { connect_error: "OAuth connect session expired. Start the connect flow again." });
  }

  if (!code || !pending.token_url || !pending.client_id || !pending.pkce_verifier_ciphertext) {
    await invalidatePending();
    return dashboardRedirect(request, { connect_error: "OAuth connect session is incomplete. Start the connect flow again." });
  }

  try {
    const fallbackScopes = Array.isArray(pending.scopes)
      ? pending.scopes.filter((item): item is string => typeof item === "string")
      : [];
    const exchanged = await exchangeAuthorizationCode({
      provider: pending.provider ?? "oauth",
      tokenUrl: pending.token_url,
      code,
      redirectUri: `${appOrigin(request)}/api/oauth/callback`,
      clientId: pending.client_id,
      clientSecret: pending.client_secret_ciphertext ? decryptCredential(pending.client_secret_ciphertext) : null,
      tokenAuthMethod: pending.token_auth_method,
      codeVerifier: decryptCredential(pending.pkce_verifier_ciphertext),
      fallbackScopes,
    });

    const encryptedAccessToken = encryptCredential(exchanged.accessToken);
    const { error: updateError } = await admin
      .from("api_credentials")
      .update({
        secret_ciphertext: encryptedAccessToken,
        access_token_ciphertext: encryptedAccessToken,
        refresh_token_ciphertext: exchanged.refreshToken ? encryptCredential(exchanged.refreshToken) : null,
        scopes: exchanged.scopes,
        expires_at: exchanged.expiresAt,
        key_preview: previewSecret(exchanged.accessToken),
        connect_status: "active",
        connect_state: null,
        connect_state_expires_at: null,
        pkce_verifier_ciphertext: null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", pending.id)
      .eq("connect_state", state)
      .eq("connect_status", "exchanging");

    if (updateError) {
      await invalidatePending();
      return dashboardRedirect(request, { connect_error: "Token exchange succeeded but the credential could not be stored." });
    }

    return dashboardRedirect(request, { connected: pending.id });
  } catch (exchangeError) {
    await invalidatePending();
    const message = exchangeError instanceof Error ? exchangeError.message : "OAuth code exchange failed.";
    return dashboardRedirect(request, { connect_error: message });
  }
}
