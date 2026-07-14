import { redirect } from "next/navigation";
import { createServerSupabaseClient } from "@/lib/supabase/server";

type ClaimValue = string | number | boolean | null | undefined;

export type DashboardSessionUser = {
  id: string;
  email?: string | null;
  user_metadata?: Record<string, ClaimValue> | null;
  app_metadata?: Record<string, ClaimValue> | null;
};

function decodeBase64UrlJson(value: string) {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized.padEnd(normalized.length + ((4 - (normalized.length % 4)) % 4), "=");
  return JSON.parse(Buffer.from(padded, "base64").toString("utf8")) as Record<string, unknown>;
}

function accessTokenClaims(token?: string | null) {
  if (!token) return null;
  const [, payload] = token.split(".");
  if (!payload) return null;

  try {
    return decodeBase64UrlJson(payload);
  } catch {
    return null;
  }
}

function claimRecord(value: unknown): Record<string, ClaimValue> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, ClaimValue>;
}

function claimString(value: unknown) {
  return typeof value === "string" && value ? value : null;
}

export async function getDashboardSessionUser(): Promise<DashboardSessionUser> {
  const supabase = createServerSupabaseClient();
  const { data } = await supabase.auth.getSession();
  const session = data.session;
  const claims = accessTokenClaims(session?.access_token);
  const id = session?.user?.id ?? claimString(claims?.sub);

  if (!id) redirect("/login");

  return {
    id,
    email: session?.user?.email ?? claimString(claims?.email),
    user_metadata: session?.user?.user_metadata ?? claimRecord(claims?.user_metadata),
    app_metadata: session?.user?.app_metadata ?? claimRecord(claims?.app_metadata),
  };
}
