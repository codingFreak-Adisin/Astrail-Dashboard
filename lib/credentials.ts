import { createCipheriv, createDecipheriv, randomBytes } from "crypto";
import { assertSafeUpstreamUrl } from "@/lib/runtime/network-policy";

const ALGORITHM = "aes-256-gcm";
const OAUTH_EXPIRY_SKEW_MS = 60_000;

export type CredentialScheme = "bearer" | "api_key_header" | "api_key_query" | "oauth2";

export type OAuthCredentialInput = {
  provider: string;
  clientId?: string | null;
  clientSecret?: string | null;
  tokenUrl?: string | null;
  scopes?: string[];
  accessToken: string;
  refreshToken?: string | null;
  expiresAt?: string | null;
};

export type OAuthRefreshInput = {
  provider: string;
  tokenUrl: string;
  clientId?: string | null;
  clientSecret?: string | null;
  refreshToken: string;
  scopes?: string[];
};

export type OAuthRefreshResult = {
  accessToken: string;
  refreshToken?: string | null;
  expiresAt?: string | null;
  scopes: string[];
};

export function hasCredentialEncryptionKey() {
  return Boolean(process.env.CREDENTIAL_ENCRYPTION_KEY);
}

function encryptionKey() {
  const raw = process.env.CREDENTIAL_ENCRYPTION_KEY;
  if (!raw) {
    throw new Error("CREDENTIAL_ENCRYPTION_KEY is required for credential storage.");
  }

  const key = raw.startsWith("base64:")
    ? Buffer.from(raw.slice("base64:".length), "base64")
    : Buffer.from(raw, "hex");

  if (key.length !== 32) {
    throw new Error("CREDENTIAL_ENCRYPTION_KEY must decode to 32 bytes.");
  }

  return key;
}

export function encryptCredential(secret: string) {
  const iv = randomBytes(12);
  const cipher = createCipheriv(ALGORITHM, encryptionKey(), iv);
  const encrypted = Buffer.concat([cipher.update(secret, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString("base64")}.${tag.toString("base64")}.${encrypted.toString("base64")}`;
}

export function decryptCredential(ciphertext: string) {
  const [ivRaw, tagRaw, encryptedRaw] = ciphertext.split(".");
  if (!ivRaw || !tagRaw || !encryptedRaw) {
    throw new Error("Invalid credential ciphertext.");
  }

  const decipher = createDecipheriv(ALGORITHM, encryptionKey(), Buffer.from(ivRaw, "base64"));
  decipher.setAuthTag(Buffer.from(tagRaw, "base64"));
  const decrypted = Buffer.concat([
    decipher.update(Buffer.from(encryptedRaw, "base64")),
    decipher.final(),
  ]);
  return decrypted.toString("utf8");
}

export function oauthCredentialExpired(expiresAt?: string | null, now = Date.now()) {
  if (!expiresAt) return false;
  const expiresAtMs = Date.parse(expiresAt);
  if (!Number.isFinite(expiresAtMs)) return true;
  return expiresAtMs - OAUTH_EXPIRY_SKEW_MS <= now;
}

export function normalizeOAuthScopes(value: unknown) {
  if (Array.isArray(value)) {
    return value
      .map((item) => typeof item === "string" ? item.trim() : "")
      .filter(Boolean);
  }

  if (typeof value === "string") {
    return value
      .split(/[,\s]+/)
      .map((item) => item.trim())
      .filter(Boolean);
  }

  return [];
}

export async function refreshOAuthAccessToken(
  input: OAuthRefreshInput,
  fetcher: typeof fetch = fetch
): Promise<OAuthRefreshResult> {
  const tokenUrl = new URL(input.tokenUrl);
  if (tokenUrl.protocol !== "https:") {
    throw new Error("OAuth token URL must be an HTTPS URL.");
  }
  await assertSafeUpstreamUrl(tokenUrl);

  const body = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: input.refreshToken,
  });
  if (input.clientId) body.set("client_id", input.clientId);
  if (input.clientSecret) body.set("client_secret", input.clientSecret);
  if (input.scopes?.length) body.set("scope", input.scopes.join(" "));

  const response = await fetcher(tokenUrl, {
    method: "POST",
    headers: {
      accept: "application/json",
      "content-type": "application/x-www-form-urlencoded",
    },
    body,
    redirect: "manual",
    signal: AbortSignal.timeout(15000),
  });

  const payload = await response.json().catch(() => null) as Record<string, unknown> | null;
  if (!response.ok || !payload || typeof payload.access_token !== "string") {
    const message = typeof payload?.error_description === "string"
      ? payload.error_description
      : typeof payload?.error === "string"
        ? payload.error
        : `OAuth refresh failed for ${input.provider}.`;
    throw new Error(message);
  }

  const expiresIn = Number(payload.expires_in);
  const expiresAt = Number.isFinite(expiresIn) && expiresIn > 0
    ? new Date(Date.now() + expiresIn * 1000).toISOString()
    : null;
  const scopes = normalizeOAuthScopes(payload.scope).length > 0
    ? normalizeOAuthScopes(payload.scope)
    : input.scopes ?? [];

  return {
    accessToken: payload.access_token,
    refreshToken: typeof payload.refresh_token === "string" ? payload.refresh_token : null,
    expiresAt,
    scopes,
  };
}

export function previewSecret(secret: string) {
  if (secret.length <= 8) return "****";
  return `${secret.slice(0, 4)}...${secret.slice(-4)}`;
}
