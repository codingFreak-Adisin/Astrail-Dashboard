import { NextResponse } from "next/server";
import type { EmailOtpType } from "@supabase/supabase-js";
import { createServerSupabaseClient } from "@/lib/supabase/server";

function safeRedirectPath(path: string | null) {
  if (!path || !path.startsWith("/") || path.startsWith("//")) {
    return "/dashboard";
  }

  return path;
}

function loginRedirect(url: URL, message: string, reason?: string) {
  const redirectUrl = new URL("/login", url.origin);
  redirectUrl.searchParams.set("error", message);
  redirectUrl.hash = "auth-error";

  if (reason) {
    redirectUrl.searchParams.set("reason", reason);
  }

  return NextResponse.redirect(redirectUrl);
}

function clientCompletionRedirect(url: URL, next: string) {
  const redirectUrl = new URL("/auth/complete", url.origin);
  redirectUrl.searchParams.set("next", next);
  return NextResponse.redirect(redirectUrl);
}

function logAuthCallbackFailure(stage: string, error: unknown) {
  if (!(error instanceof Error)) {
    console.warn("Astrail auth callback failed", { stage });
    return;
  }

  const metadata = error as Error & { code?: string; status?: number };

  console.warn("Astrail auth callback failed", {
    stage,
    name: error.name,
    code: metadata.code,
    status: metadata.status,
    message: error.message,
  });
}

async function verifyEmailToken(
  supabase: ReturnType<typeof createServerSupabaseClient>,
  tokenHash: string,
  requestedType: EmailOtpType | null,
) {
  const fallbackTypes: EmailOtpType[] = ["magiclink", "signup", "email"];
  const candidateTypes = Array.from(new Set([requestedType, ...fallbackTypes].filter(Boolean))) as EmailOtpType[];

  for (const candidateType of candidateTypes) {
    const { error } = await supabase.auth.verifyOtp({
      token_hash: tokenHash,
      type: candidateType,
    });

    if (!error) return null;

    logAuthCallbackFailure(`verify_otp_${candidateType}`, error);
  }

  return new Error("Email token could not be verified.");
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const tokenHash = url.searchParams.get("token_hash");
  const type = url.searchParams.get("type") as EmailOtpType | null;
  const next = safeRedirectPath(url.searchParams.get("next"));
  const error = url.searchParams.get("error_description") ?? url.searchParams.get("error");

  if (error) {
    return loginRedirect(url, error, "provider_error");
  }

  if (!code && !tokenHash) {
    return clientCompletionRedirect(url, next);
  }

  try {
    const supabase = createServerSupabaseClient();

    if (tokenHash) {
      const verifyError = await verifyEmailToken(supabase, tokenHash, type);

      if (!verifyError) {
        return NextResponse.redirect(`${url.origin}${next}`);
      }
    }

    if (code) {
      const { error: exchangeError } = await supabase.auth.exchangeCodeForSession(code);

      if (!exchangeError) {
        return NextResponse.redirect(`${url.origin}${next}`);
      }

      logAuthCallbackFailure("exchange_code", exchangeError);
    }
  } catch (callbackError) {
    logAuthCallbackFailure("callback_setup", callbackError);
  }

  return loginRedirect(
    url,
    "Could not confirm your account. Request one fresh Astrail sign-in link and open the newest email.",
    "auth_callback_failed",
  );
}
