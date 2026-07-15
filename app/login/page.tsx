"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { FormEvent, Suspense, useState } from "react";
import { AuthShell } from "@/components/auth/auth-shell";
import { AuthPageRedirect } from "@/components/auth/auth-page-redirect";
import { SocialAuthButtons } from "@/components/auth/social-auth-buttons";
import { SupabaseSessionCompleter } from "@/components/auth/supabase-session-completer";
import { enabledOAuthProviders, hasPublicSupabaseAuthConfig, isDemoAuthAllowed, missingProductionAuthMessage } from "@/lib/auth-mode";
import { readJsonResponse } from "@/lib/client-json";

const hasSupabaseAuth = hasPublicSupabaseAuthConfig();
const demoAuthAllowed = isDemoAuthAllowed();
const oauthProviders = enabledOAuthProviders();

function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [email, setEmail] = useState("");
  const [error, setError] = useState<string | null>(searchParams?.get("error") ?? null);
  const [message, setMessage] = useState<string | null>(null);
  const [authRecovering, setAuthRecovering] = useState(false);
  const [loading, setLoading] = useState(false);
  const redirectTo = searchParams?.get("redirect") ?? "/dashboard";
  const directDemoAuth = !hasSupabaseAuth && demoAuthAllowed;
  const hasSocialAuth = directDemoAuth || (hasSupabaseAuth && (oauthProviders.google || oauthProviders.github));

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoading(true);
    setError(null);
    setMessage(null);

    try {
      const endpoint = hasSupabaseAuth ? "/api/auth/otp" : demoAuthAllowed ? "/api/auth/demo" : null;
      if (!endpoint) {
        setError(missingProductionAuthMessage());
        return;
      }

      const response = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, mode: "login", redirectTo }),
      });
      const payload = await readJsonResponse<{ ok?: boolean; error?: string; redirectTo?: string }>(response);

      if (!response.ok) {
        setError(payload.error ?? "Could not start sign-in. Please try again.");
        return;
      }

      if (hasSupabaseAuth) {
        setMessage("Check your email for a secure Astrail sign-in link.");
      } else {
        router.push(payload.redirectTo ?? redirectTo);
      }
    } catch {
      setError("Could not start sign-in. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <AuthShell title="Sign in" description="Sign in to generate endpoints, run hosted MCP tools, and manage workspace credits.">
      <form onSubmit={onSubmit} className="space-y-4">
        <AuthPageRedirect redirectTo={redirectTo} />
        <SupabaseSessionCompleter
          redirectTo={redirectTo}
          onStatusChange={(status) => {
            setAuthRecovering(status === "running");
            if (status === "running") setError(null);
          }}
        />
        <div className="space-y-2">
          <label htmlFor="email" className="text-sm font-medium text-neutral-700">
            Email
          </label>
          <input
            id="email"
            type="email"
            autoComplete="email"
            placeholder="Your email address"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            className="h-11 w-full rounded-xl border border-neutral-200/80 bg-white px-4 text-sm text-neutral-950 outline-none transition placeholder:text-neutral-400 focus:border-orange-300 focus:ring-2 focus:ring-orange-100"
            required
          />
        </div>
        {!hasSupabaseAuth && !demoAuthAllowed ? (
          <p className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm leading-relaxed text-amber-800">
            Production sign-in is required here. Finish workspace auth setup to enable this screen.
          </p>
        ) : null}
        {!authRecovering && error && <p className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm leading-relaxed text-red-700">{error}</p>}
        {message && <p className="rounded-xl border border-neutral-200/80 bg-neutral-50 p-3 text-sm leading-relaxed text-neutral-600">{message}</p>}
        <button
          type="submit"
          className="h-11 w-full rounded-xl bg-neutral-950 px-4 text-sm font-medium text-white transition hover:bg-neutral-800 disabled:cursor-not-allowed disabled:opacity-60"
          disabled={loading}
        >
          {loading ? "Sending..." : "Continue"}
        </button>
      </form>

      {hasSocialAuth ? (
        <>
          <div className="my-7 flex items-center gap-4">
            <div className="h-px flex-1 bg-neutral-200/80" />
            <span className="text-xs font-medium uppercase tracking-[0.14em] text-neutral-400">or</span>
            <div className="h-px flex-1 bg-neutral-200/80" />
          </div>

          <SocialAuthButtons
            authConfigured={hasSupabaseAuth}
            directDemo={directDemoAuth}
            enabledProviders={oauthProviders}
            entry="login"
            redirectTo={redirectTo}
          />
        </>
      ) : null}

      <p className="mt-7 text-center text-sm text-neutral-500">
        Don&apos;t have an account?{" "}
        <Link href="/signup" className="inline-flex min-h-11 items-center font-medium text-orange-600 transition hover:text-orange-700">
          Sign up
        </Link>
      </p>
    </AuthShell>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={<main className="dash-shell flex min-h-screen items-center justify-center bg-[#f8f6f1] text-sm text-neutral-500">Loading login...</main>}>
      <LoginForm />
    </Suspense>
  );
}
