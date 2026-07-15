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
            <label htmlFor="firstName" className="text-sm font-medium text-neutral-700">
              First name
            </label>
            <input
              id="firstName"
              type="text"
              autoComplete="given-name"
              placeholder="Your first name"
              value={firstName}
              onChange={(event) => setFirstName(event.target.value)}
              className="h-11 w-full rounded-xl border border-neutral-200/80 bg-white px-4 text-sm text-neutral-950 outline-none transition placeholder:text-neutral-400 focus:border-orange-300 focus:ring-2 focus:ring-orange-100"
              required
            />
          </div>
          <div className="space-y-2">
            <label htmlFor="lastName" className="text-sm font-medium text-neutral-700">
              Last name
            </label>
            <input
              id="lastName"
              type="text"
              autoComplete="family-name"
              placeholder="Your last name"
              value={lastName}
              onChange={(event) => setLastName(event.target.value)}
              className="h-11 w-full rounded-xl border border-neutral-200/80 bg-white px-4 text-sm text-neutral-950 outline-none transition placeholder:text-neutral-400 focus:border-orange-300 focus:ring-2 focus:ring-orange-100"
              required
            />
          </div>
        </div>
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
            Production sign-up is required here. Finish workspace auth setup to enable this screen.
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
            entry="signup"
            redirectTo={redirectTo}
          />
        </>
      ) : null}

      <p className="mt-7 text-center text-sm text-neutral-500">
        Already have an account?{" "}
        <Link href={`/login?redirect=${encodeURIComponent(redirectTo)}`} className="inline-flex min-h-11 items-center font-medium text-orange-600 transition hover:text-orange-700">
          Sign in
        </Link>
      </p>
    </AuthShell>
  );
}

export default function SignupPage() {
  return (
    <Suspense fallback={<main className="dash-shell flex min-h-screen items-center justify-center bg-[#f8f6f1] text-sm text-neutral-500">Loading signup...</main>}>
      <SignupForm />
    </Suspense>
  );
}
