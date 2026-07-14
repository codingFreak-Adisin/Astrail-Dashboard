const TURNSTILE_VERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify";

type TurnstileResult = {
  success?: boolean;
  "error-codes"?: string[];
  action?: string;
};

function getClientIp(request: Request) {
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0]?.trim();
  return request.headers.get("x-real-ip") ?? undefined;
}

export function turnstileConfigured() {
  return Boolean(process.env.TURNSTILE_SECRET_KEY || process.env.CLOUDFLARE_TURNSTILE_SECRET_KEY);
}

function turnstileRequired() {
  return process.env.CLOUDFLARE_TURNSTILE_REQUIRED === "true" || turnstileConfigured();
}

export async function requireTurnstileChallenge(request: Request, token: string | null | undefined, expectedAction?: string) {
  const secret = process.env.TURNSTILE_SECRET_KEY || process.env.CLOUDFLARE_TURNSTILE_SECRET_KEY;

  if (!turnstileRequired()) {
    return { ok: true, configured: false };
  }

  if (!secret) {
    return { ok: false, configured: false, status: 503, error: "Cloudflare Turnstile is required but not configured." };
  }

  if (!token) {
    return { ok: false, configured: true, status: 403, error: "Complete the Cloudflare challenge before continuing." };
  }

  const formData = new FormData();
  formData.set("secret", secret);
  formData.set("response", token);

  const remoteIp = getClientIp(request);
  if (remoteIp) {
    formData.set("remoteip", remoteIp);
  }

  try {
    const response = await fetch(TURNSTILE_VERIFY_URL, {
      method: "POST",
      body: formData,
    });
    const result = (await response.json()) as TurnstileResult;

    if (!response.ok || !result.success || (expectedAction && result.action !== expectedAction)) {
      return {
        ok: false,
        configured: true,
        status: 403,
        error: expectedAction && result.success
          ? "Cloudflare challenge action did not match this request."
          : "Cloudflare challenge failed. Refresh it and try again.",
        codes: expectedAction && result.success ? ["action-mismatch"] : result["error-codes"] ?? [],
      };
    }

    return { ok: true, configured: true };
  } catch {
    return {
      ok: false,
      configured: true,
      status: 502,
      error: "Cloudflare challenge could not be verified. Try again.",
    };
  }
}
