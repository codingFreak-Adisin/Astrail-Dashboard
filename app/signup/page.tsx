"use client";

import Link from "next/link";
import { FormEvent, Suspense, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { AuthShell } from "@/components/auth/auth-shell";
import { AuthPageRedirect } from "@/components/auth/auth-page-redirect";
import { SocialAuthButtons } from "@/components/auth/social-auth-buttons";
import { SupabaseSessionCompleter } from "@/components/auth/supabase-session-completer";
import { enabledOAuthProviders, hasPublicSupabaseAuthConfig, isDemoAuthAllowed, missingProductionAuthMessage } from "@/lib/auth-mode";
import { billingLaunchFreeMode, billingPlans, type BillingPlanId } from "@/lib/billing/plans";
import { readJsonResponse } from "@/lib/client-json";

const hasSupabaseAuth = hasPublicSupabaseAuthConfig();
const demoAuthAllowed = isDemoAuthAllowed();
const oauthProviders = enabledOAuthProviders();

function planFromSearch(value: string | null): BillingPlanId {
  if (value === "starter" || value === "team") return value;
  return "free";
}

function SignupForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [email, setEmail] = useState("");
  const [error, setError] = useState<string | null>(searchParams?.get("error") ?? null);
  const [message, setMessage] = useState<string | null>(null);
  const [authRecovering, setAuthRecovering] = useState(false);
  const [loading, setLoading] = useState(false);
  const selectedPlan = useMemo(() => planFromSearch(searchParams?.get("plan") ?? null), [searchParams]);
  const addingAccount = searchParams?.get("account") === "add";
  const plan = billingPlans[selectedPlan];
  const redirectTo = billingLaunchFreeMode || selectedPlan === "free" ? "/dashboard" : `/dashboard/billing?plan=${selectedPlan}`;
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
        body: JSON.stringify({
          email,
          firstName,
          lastName,
          mode: "signup",
          redirectTo,
        }),
      });
      const payload = await readJsonResponse<{ ok?: boolean; error?: string; redirectTo?: string }>(response);

      if (!response.ok) {
        setError(payload.error ?? "Could not create your Astrail account. Please try again.");
        return;
      }

      if (hasSupabaseAuth) {
        setMessage(billingLaunchFreeMode || selectedPlan === "free"
          ? "Check your email to confirm your Astrail account."
          : `Check your email to confirm your account. After sign-in, Astrail will open ${plan.name} checkout from billing.`);
      } else {
        router.push(payload.redirectTo ?? redirectTo);
      }
    } catch {
      setError("Could not create your Astrail account. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <AuthShell title={addingAccount ? "Add account" : "Sign up"}>
      <form onSubmit={onSubmit} className="space-y-4">
        <AuthPageRedirect redirectTo={redirectTo} disabled={addingAccount} />
        <SupabaseSessionCompleter
          redirectTo={redirectTo}
          onStatusChange={(status) => {
            setAuthRecovering(status === "running");
            if (status === "running") setError(null);
          }}
        />
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <label htmlFor="firstName" className="text-base font-semibold text-white/85">
              First name
            </label>
            <input
              id="firstName"
              type="text"
              autoComplete="given-name"
              placeholder="Your first name"
              value={firstName}
              onChange={(event) => setFirstName(event.target.value)}
              className="h-12 w-full border border-white/15 bg-[#111111] px-4 text-lg text-white outline-none transition placeholder:text-white/28 focus:border-[#7c6cff]"
              required
            />
          </div>
          <div className="space-y-2">
            <label htmlFor="lastName" className="text-base font-semibold text-white/85">
              Last name
            </label>
            <input
              id="lastName"
              type="text"
              autoComplete="family-name"
              placeholder="Your last name"
              value={lastName}
              onChange={(event) => setLastName(event.target.value)}
              className="h-12 w-full border border-white/15 bg-[#111111] px-4 text-lg text-white outline-none transition placeholder:text-white/28 focus:border-[#7c6cff]"
              required
            />
          </div>
        </div>
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
            Production sign-up is required here. Finish workspace auth setup to enable this screen.
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
            entry="signup"
            redirectTo={redirectTo}
          />
        </>
      ) : null}

      <p className="mt-8 text-center text-base text-white/55">
        Already have an account?{" "}
        <Link href={`/login?redirect=${encodeURIComponent(redirectTo)}`} className="inline-flex min-h-11 items-center text-[#aaa2ff] transition hover:text-white">
          Sign in
        </Link>
      </p>
    </AuthShell>
  );
}

export default function SignupPage() {
  return (
    <Suspense fallback={<main className="flex min-h-screen items-center justify-center text-sm text-muted-foreground">Loading signup...</main>}>
      <SignupForm />
    </Suspense>
  );
}
