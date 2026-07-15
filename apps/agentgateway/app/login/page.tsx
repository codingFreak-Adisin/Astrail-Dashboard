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
          <label htmlFor="email" className="text-base font-semibold text-white/85">
            Email
          </label>
          <input
            id="email"
            type="email"
            autoComplete="email"
            placeholder="Your email address"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            className="h-12 w-full border border-white/15 bg-[#111111] px-4 text-xl text-white outline-none transition placeholder:text-white/28 focus:border-[#7c6cff]"
            required
          />
        </div>
        {!hasSupabaseAuth && !demoAuthAllowed ? (
          <p className="border border-amber-300/40 bg-amber-400/10 p-3 text-sm leading-relaxed text-amber-100">
            Production sign-in is required here. Finish workspace auth setup to enable this screen.
          </p>
        ) : null}
        {!authRecovering && error && <p className="border border-red-400/40 bg-red-500/10 p-3 text-sm leading-relaxed text-red-100">{error}</p>}
        {message && <p className="border border-white/15 bg-white/[0.04] p-3 text-sm leading-relaxed text-white/80">{message}</p>}
        <button
          type="submit"
          className="h-12 w-full bg-white px-4 text-xl font-medium text-black transition hover:bg-white/90 disabled:cursor-not-allowed disabled:opacity-60"
          disabled={loading}
        >
          {loading ? "Sending..." : "Continue"}
        </button>
      </form>

      {hasSocialAuth ? (
        <>
          <div className="my-8 flex items-center gap-4">
            <div className="h-px flex-1 bg-white/12" />
            <span className="text-sm uppercase text-white/45">or</span>
            <div className="h-px flex-1 bg-white/12" />
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

      <p className="mt-8 text-center text-base text-white/55">
        Don&apos;t have an account?{" "}
        <Link href="/signup" className="inline-flex min-h-11 items-center text-[#aaa2ff] transition hover:text-white">
          Sign up
        </Link>
      </p>
    </AuthShell>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={<main className="flex min-h-screen items-center justify-center text-sm text-muted-foreground">Loading login...</main>}>
      <LoginForm />
    </Suspense>
  );
}
