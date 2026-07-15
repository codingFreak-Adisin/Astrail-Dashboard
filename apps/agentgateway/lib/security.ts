import crypto from "node:crypto";

const attempts = new Map<string, { count: number; resetAt: number }>();

export function clientIp(request: Request) {
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0]?.trim() || "unknown";
  return request.headers.get("x-real-ip") || "unknown";
}

export function hashIp(ip: string) {
  const pepper = process.env.IP_HASH_PEPPER || process.env.SUPABASE_SERVICE_ROLE_KEY || "dev-pepper";
  return crypto.createHmac("sha256", pepper).update(ip).digest("hex");
}

export function rateLimit(key: string, limit = 5, windowMs = 60_000) {
  const now = Date.now();
  const current = attempts.get(key);

  if (!current || current.resetAt < now) {
    attempts.set(key, { count: 1, resetAt: now + windowMs });
    return { allowed: true, retryAfter: 0 };
  }

  if (current.count >= limit) {
    return { allowed: false, retryAfter: Math.ceil((current.resetAt - now) / 1000) };
  }

  current.count += 1;
  return { allowed: true, retryAfter: 0 };
}

function normalizeOrigin(value: string) {
  try {
    const url = new URL(value);
    return url.origin;
  } catch {
    return value.replace(/\/+$/, "");
  }
}

export function originAllowed(request: Request) {
  const origin = request.headers.get("origin");
  const allowed = process.env.ALLOWED_ORIGIN || "";

  if (!origin) return true;

  const normalizedOrigin = normalizeOrigin(origin);
  const originHost = new URL(normalizedOrigin).hostname;
  if (originHost === "astrail.vercel.app" || originHost.endsWith(".vercel.app")) {
    return true;
  }

  const configuredOrigins = allowed
    .split(",")
    .map((item) => normalizeOrigin(item.trim()))
    .filter(Boolean);

  const inferredOrigins = [
    process.env.NEXT_PUBLIC_SITE_URL,
    process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : "",
    process.env.NODE_ENV !== "production" ? "http://localhost:3000" : "",
    process.env.NODE_ENV !== "production" ? "http://localhost:3001" : "",
  ].filter(Boolean);

  const allowedOrigins = new Set([...configuredOrigins, ...inferredOrigins]);
  if (allowedOrigins.size === 0) return true;

  return allowedOrigins.has(normalizedOrigin);
}
