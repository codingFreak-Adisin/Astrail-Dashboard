type EnvCheck = {
  name: string;
  configured: boolean;
  required: boolean;
  status: "ready" | "missing" | "invalid";
  note?: string;
};

function credentialKeyStatus(): Pick<EnvCheck, "status" | "note"> {
  const raw = process.env.CREDENTIAL_ENCRYPTION_KEY;
  if (!raw) return { status: "missing", note: "Required for encrypted provider credential storage." };

  try {
    const key = raw.startsWith("base64:")
      ? Buffer.from(raw.slice("base64:".length), "base64")
      : Buffer.from(raw, "hex");
    if (key.length !== 32) {
      return { status: "invalid", note: "Must decode to exactly 32 bytes." };
    }
  } catch {
    return { status: "invalid", note: "Must be hex or base64: encoded bytes." };
  }

  return { status: "ready" };
}

function optionalIsoDateStatus(name: string): Pick<EnvCheck, "configured" | "status" | "note"> {
  const raw = process.env[name]?.trim();
  if (!raw) return { configured: false, status: "ready" };

  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) {
    return { configured: true, status: "invalid", note: "Must be an ISO timestamp, for example 2026-06-13T17:30:00.000Z." };
  }

  return { configured: true, status: "ready", note: parsed.toISOString() };
}

function hasAnyEnv(keys: string[]) {
  return keys.some((key) => Boolean(process.env[key]));
}

export function validateRuntimeEnv() {
  const credentialStatus = credentialKeyStatus();
  const billingResetStatus = optionalIsoDateStatus("ASTRAIL_BILLING_RESET_AT");
  const hasSupabaseUrl = Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL);
  const hasSupabaseAnonKey = Boolean(process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? process.env.SUPABASE_ANON_KEY);
  const hasTurnstileSecret = hasAnyEnv(["TURNSTILE_SECRET_KEY", "CLOUDFLARE_TURNSTILE_SECRET_KEY"]);
  const hasTurnstileSiteKey = hasAnyEnv(["NEXT_PUBLIC_TURNSTILE_SITE_KEY", "NEXT_PUBLIC_CLOUDFLARE_TURNSTILE_SITE_KEY"]);
  const checks: EnvCheck[] = [
    {
      name: "NEXT_PUBLIC_SUPABASE_URL or SUPABASE_URL",
      configured: hasSupabaseUrl,
      required: true,
      status: hasSupabaseUrl ? "ready" : "missing",
    },
    {
      name: "NEXT_PUBLIC_SUPABASE_ANON_KEY or SUPABASE_ANON_KEY",
      configured: hasSupabaseAnonKey,
      required: true,
      status: hasSupabaseAnonKey ? "ready" : "missing",
    },
    {
      name: "SUPABASE_SERVICE_ROLE_KEY",
      configured: Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY),
      required: true,
      status: process.env.SUPABASE_SERVICE_ROLE_KEY ? "ready" : "missing",
      note: "Required for private endpoint auth, logs, bundles, and runtime admin reads.",
    },
    {
      name: "ANTHROPIC_API_KEY",
      configured: Boolean(process.env.ANTHROPIC_API_KEY),
      required: true,
      status: process.env.ANTHROPIC_API_KEY ? "ready" : "missing",
      note: "Required for full Claude generation. Local fallback can run without it.",
    },
    {
      name: "CREDENTIAL_ENCRYPTION_KEY",
      configured: Boolean(process.env.CREDENTIAL_ENCRYPTION_KEY),
      required: true,
      status: credentialStatus.status,
      note: credentialStatus.note,
    },
    {
      name: "NEXT_PUBLIC_TURNSTILE_SITE_KEY or NEXT_PUBLIC_CLOUDFLARE_TURNSTILE_SITE_KEY",
      configured: hasTurnstileSiteKey,
      required: true,
      status: hasTurnstileSiteKey ? "ready" : "missing",
      note: "Required to show the Cloudflare challenge before MCP creation.",
    },
    {
      name: "TURNSTILE_SECRET_KEY or CLOUDFLARE_TURNSTILE_SECRET_KEY",
      configured: hasTurnstileSecret,
      required: true,
      status: hasTurnstileSecret ? "ready" : "missing",
      note: "Required to verify the Cloudflare challenge server-side.",
    },
    {
      name: "CLOUDFLARE_TURNSTILE_REQUIRED",
      configured: Boolean(process.env.CLOUDFLARE_TURNSTILE_REQUIRED),
      required: false,
      status: !process.env.CLOUDFLARE_TURNSTILE_REQUIRED || process.env.CLOUDFLARE_TURNSTILE_REQUIRED === "true" || process.env.CLOUDFLARE_TURNSTILE_REQUIRED === "false" ? "ready" : "invalid",
      note: process.env.CLOUDFLARE_TURNSTILE_REQUIRED ?? "default",
    },
    {
      name: "RATE_LIMIT_MODE",
      configured: Boolean(process.env.RATE_LIMIT_MODE),
      required: false,
      status: "ready",
      note: process.env.RATE_LIMIT_MODE ?? "in_memory",
    },
    {
      name: "ASTRAIL_BILLING_RESET_AT",
      configured: billingResetStatus.configured,
      required: false,
      status: billingResetStatus.status,
      note: billingResetStatus.note ?? "unset",
    },
  ];

  const requiredReady = checks
    .filter((check) => check.required)
    .every((check) => check.status === "ready");

  return {
    status: requiredReady ? "ready" : "degraded",
    checks,
  };
}
