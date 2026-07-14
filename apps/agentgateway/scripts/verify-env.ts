const { existsSync: envExistsSync, readFileSync: envReadFileSync } = require("node:fs");
const { resolve: envResolve } = require("node:path");

type EnvStatus = "ready" | "missing" | "invalid";
type EnvCheck = [name: string, required: boolean, status: EnvStatus];

function loadEnvVerifierFile() {
  const path = envResolve(process.cwd(), ".env.local");
  if (!envExistsSync(path)) return;
  const lines = envReadFileSync(path, "utf8").split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const index = trimmed.indexOf("=");
    if (index === -1) continue;
    const key = trimmed.slice(0, index);
    const value = trimmed.slice(index + 1);
    process.env[key] ||= value;
  }
}

function credentialEnvKeyStatus(): { status: EnvStatus; note?: string } {
  const raw = process.env.CREDENTIAL_ENCRYPTION_KEY;
  if (!raw) return { status: "missing", note: "Required for encrypted provider credential storage." };
  try {
    const key = raw.startsWith("base64:")
      ? Buffer.from(raw.slice("base64:".length), "base64")
      : Buffer.from(raw, "hex");
    if (key.length !== 32) return { status: "invalid", note: "Must decode to exactly 32 bytes." };
  } catch {
    return { status: "invalid", note: "Must be hex or base64: encoded bytes." };
  }
  return { status: "ready" };
}

function hasAnyEnv(keys: string[]) {
  return keys.some((key) => Boolean(process.env[key]));
}

function optionalIsoDateEnvStatus(name: string): EnvStatus {
  const raw = process.env[name]?.trim();
  if (!raw) return "ready";
  return Number.isNaN(new Date(raw).getTime()) ? "invalid" : "ready";
}

function optionalBooleanEnvStatus(name: string): EnvStatus {
  const raw = process.env[name]?.trim();
  if (!raw) return "ready";
  return raw === "true" || raw === "false" ? "ready" : "invalid";
}

loadEnvVerifierFile();

const envCredential = credentialEnvKeyStatus();
const billingEnvironment = process.env.DODO_PAYMENTS_ENVIRONMENT;
const hasTurnstileSecret = hasAnyEnv(["TURNSTILE_SECRET_KEY", "CLOUDFLARE_TURNSTILE_SECRET_KEY"]);
const hasTurnstileSiteKey = hasAnyEnv(["NEXT_PUBLIC_TURNSTILE_SITE_KEY", "NEXT_PUBLIC_CLOUDFLARE_TURNSTILE_SITE_KEY"]);
const checks: EnvCheck[] = [
  ["NEXT_PUBLIC_SUPABASE_URL", true, process.env.NEXT_PUBLIC_SUPABASE_URL ? "ready" : "missing"],
  ["NEXT_PUBLIC_SUPABASE_ANON_KEY", true, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ? "ready" : "missing"],
  ["SUPABASE_SERVICE_ROLE_KEY", true, process.env.SUPABASE_SERVICE_ROLE_KEY ? "ready" : "missing"],
  ["NEXT_PUBLIC_APP_URL", true, process.env.NEXT_PUBLIC_APP_URL ? "ready" : "missing"],
  ["NEXT_PUBLIC_RUNTIME_BASE_URL", true, process.env.NEXT_PUBLIC_RUNTIME_BASE_URL ? "ready" : "missing"],
  ["ASTRAIL_REQUIRE_AUTH", true, process.env.ASTRAIL_REQUIRE_AUTH === "true" ? "ready" : "invalid"],
  ["ANTHROPIC_API_KEY", true, process.env.ANTHROPIC_API_KEY ? "ready" : "missing"],
  ["CREDENTIAL_ENCRYPTION_KEY", true, envCredential.status],
  ["NEXT_PUBLIC_TURNSTILE_SITE_KEY or NEXT_PUBLIC_CLOUDFLARE_TURNSTILE_SITE_KEY", true, hasTurnstileSiteKey ? "ready" : "missing"],
  ["TURNSTILE_SECRET_KEY or CLOUDFLARE_TURNSTILE_SECRET_KEY", true, hasTurnstileSecret ? "ready" : "missing"],
  ["CLOUDFLARE_TURNSTILE_REQUIRED", false, optionalBooleanEnvStatus("CLOUDFLARE_TURNSTILE_REQUIRED")],
  ["DODO_PAYMENTS_API_KEY", true, process.env.DODO_PAYMENTS_API_KEY || process.env.DODO_API_KEY ? "ready" : "missing"],
  ["DODO_PRODUCT_LAUNCH", true, hasAnyEnv(["DODO_PRODUCT_LAUNCH", "DODO_PRODUCT_BUILDER", "DODO_PRODUCT_STARTER", "DODO_PRODUCT_PRO", "DODO_PAYMENTS_PRODUCT_LAUNCH", "DODO_PAYMENTS_PRODUCT_BUILDER", "DODO_PAYMENTS_PRODUCT_STARTER", "DODO_PAYMENTS_PRODUCT_PRO"]) ? "ready" : "missing"],
  ["DODO_PRODUCT_SCALE", true, hasAnyEnv(["DODO_PRODUCT_SCALE", "DODO_PRODUCT_TEAM", "DODO_PAYMENTS_PRODUCT_SCALE", "DODO_PAYMENTS_PRODUCT_TEAM"]) ? "ready" : "missing"],
  ["DODO_PAYMENTS_WEBHOOK_KEY", true, hasAnyEnv(["DODO_PAYMENTS_WEBHOOK_KEY", "DODO_WEBHOOK_SECRET", "DODO_PAYMENTS_WEBHOOK_SECRET"]) ? "ready" : "missing"],
  ["DODO_PAYMENTS_ENVIRONMENT", true, billingEnvironment === "test_mode" || billingEnvironment === "live_mode" ? "ready" : "invalid"],
  ["RATE_LIMIT_MODE", false, "ready"],
  ["ASTRAIL_BILLING_RESET_AT", false, optionalIsoDateEnvStatus("ASTRAIL_BILLING_RESET_AT")],
];

let ready = true;
for (const [name, required, status] of checks) {
  console.log(`${status} ${name}${required ? " required" : " optional"}`);
  if (required && status !== "ready") ready = false;
}

if (!ready) {
  console.log("env_status degraded");
  process.exit(1);
}

console.log("env_status ready");
