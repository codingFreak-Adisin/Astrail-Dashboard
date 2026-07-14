import { NextResponse } from "next/server";
import type { Provider } from "@supabase/supabase-js";
import { createPublicClient } from "@/lib/supabase/server";
import { isOAuthProviderEnabled, oauthProviderDisabledMessage, type OAuthProviderId } from "@/lib/auth-mode";

const SUPPORTED_PROVIDERS = new Set<OAuthProviderId>(["github", "google"]);

type OAuthProviderOptions = {
  scopes?: string;
  queryParams?: Record<string, string>;
};

function safeRedirectPath(value: string | null): string {
  if (!value || !value.startsWith("/") || value.startsWith("//")) {
    return "/dashboard";
  }
  return value;
}

function safeOrigin(request: Request): string {
  const requestOrigin = new URL(request.url).origin;
  const configuredOrigin = process.env.NEXT_PUBLIC_APP_URL ?? process.env.NEXT_PUBLIC_RUNTIME_BASE_URL;
  if (!configuredOrigin) {
    return requestOrigin;
  }

  try {
    return new URL(configuredOrigin).origin;
  } catch {
    return requestOrigin;
  }
}

function authErrorRedirect(request: Request, message: string, entry: string | null): NextResponse {
  const path = entry === "signup" ? "/signup" : "/login";
  const authUrl = new URL(path, safeOrigin(request));
  authUrl.searchParams.set("error", message);
  return NextResponse.redirect(authUrl);
}

function providerOptions(provider: string): OAuthProviderOptions {
  if (provider === "github") {
    return {
      queryParams: {
        prompt: "select_account",
      },
    };
  }

  if (provider !== "google") return {};

  return {
    scopes: "openid email profile",
    queryParams: {
      prompt: "select_account",
      access_type: "offline",
    },
  };
}

async function validateSupabaseOAuthUrl(provider: OAuthProviderId, authUrl: string) {
  try {
    const response = await fetch(authUrl, {
      cache: "no-store",
      redirect: "manual",
    });

    if (response.status < 400) {
      return { ok: true as const };
    }

    const body = await response.text().catch(() => "");
    console.error("[auth/oauth] provider preflight failed", {
      provider,
      status: response.status,
      body: body.slice(0, 240),
    });
    return {
      ok: false as const,
      message: oauthProviderDisabledMessage(provider),
    };
  } catch (error) {
    console.error("[auth/oauth] provider preflight errored", {
      provider,
      name: error instanceof Error ? error.name : "unknown",
    });
    return {
      ok: false as const,
      message: "Social sign-in could not start. Use email or contact support.",
    };
  }
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const provider = url.searchParams.get("provider") ?? "";
  const entry = url.searchParams.get("entry");

  if (!SUPPORTED_PROVIDERS.has(provider as OAuthProviderId)) {
    return authErrorRedirect(request, "This sign-in provider is not enabled.", entry);
  }

  const enabledProvider = provider as OAuthProviderId;
  if (!isOAuthProviderEnabled(enabledProvider)) {
    return authErrorRedirect(request, oauthProviderDisabledMessage(enabledProvider), entry);
  }

  try {
    const origin = safeOrigin(request);
    const next = safeRedirectPath(url.searchParams.get("redirectTo"));
    const callbackUrl = new URL("/auth/complete", origin);
    callbackUrl.searchParams.set("next", next);

    const supabase = createPublicClient();
    const { data, error } = await supabase.auth.signInWithOAuth({
      provider: provider as Provider,
      options: {
        redirectTo: callbackUrl.toString(),
        skipBrowserRedirect: true,
        ...providerOptions(provider),
      },
    });

    if (error || !data.url) {
      console.error("[auth/oauth] provider redirect failed", {
        provider: enabledProvider,
        status: error?.status,
        code: error?.code,
        name: error?.name,
      });
      return authErrorRedirect(request, "Social sign-in is not ready for this workspace yet. Use email or contact support.", entry);
    }

    const providerReady = await validateSupabaseOAuthUrl(enabledProvider, data.url);
    if (!providerReady.ok) {
      return authErrorRedirect(request, providerReady.message, entry);
    }

    return NextResponse.redirect(data.url);
  } catch (error) {
    console.error("[auth/oauth] unexpected failure", {
      provider: enabledProvider,
      name: error instanceof Error ? error.name : "unknown",
    });
    return authErrorRedirect(request, "Social sign-in could not start. Use email or contact support.", entry);
  }
}
