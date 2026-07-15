"use client";

import Link from "next/link";
import { Suspense, useState } from "react";
import { useSearchParams } from "next/navigation";
import { ArrowRight, Loader2, ShieldCheck } from "lucide-react";
import { AuthLogo } from "@/components/auth/auth-shell";
import { SupabaseSessionCompleter } from "@/components/auth/supabase-session-completer";

type CompletionStatus = "idle" | "running" | "error";

function safeRedirectPath(value: string | null) {
  if (!value || !value.startsWith("/") || value.startsWith("//")) {
    return "/dashboard";
  }

  return value;
}

function AuthCompleteContent() {
  const searchParams = useSearchParams();
  const redirectTo = safeRedirectPath(searchParams?.get("next") ?? null);
  const [status, setStatus] = useState<CompletionStatus>("running");
  const [message, setMessage] = useState("Securing your Astrail session.");
  const isError = status === "error";

  return (
    <main className="dash-shell grid min-h-screen place-items-center bg-[#f8f6f1] px-5 py-10 text-neutral-950">
      <section className="w-full max-w-[420px]">
        <div className="flex flex-col items-center text-center">
          <span className="grid h-14 w-14 place-items-center rounded-2xl border border-neutral-200/80 bg-white shadow-[0_1px_2px_rgba(70,45,0,0.03)]">
            <AuthLogo className="h-8 w-8" />
          </span>
          <div className="mt-5 inline-flex items-center gap-2 rounded-md bg-orange-100/80 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-orange-700">
            {isError ? "Action needed" : "Secure sign-in"}
          </div>
          <h1 className="mt-5 text-3xl font-semibold tracking-tight text-neutral-950">
            {isError ? "Sign-in needs a fresh link" : "Opening your workspace"}
          </h1>
          <p className="mt-3 max-w-sm text-sm leading-6 text-neutral-500">
            {isError
              ? message
              : "Astrail is confirming your session and taking you to the dashboard."}
          </p>
        </div>

        <div className="mt-8 rounded-2xl border border-neutral-200/70 bg-white p-5 shadow-[0_1px_2px_rgba(70,45,0,0.03)]">
          <SupabaseSessionCompleter
            redirectTo={redirectTo}
            exchangeCode
            hideMessage
            onStatusChange={(nextStatus, nextMessage) => {
              if (nextStatus !== "idle") setStatus(nextStatus);
              if (nextMessage) setMessage(nextMessage);
            }}
          />

          {isError ? (
            <div className="space-y-4">
              <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm leading-6 text-red-700">
                Request a new Astrail sign-in link, then open the newest email.
              </div>
              <Link
                href="/login"
                className="flex h-11 items-center justify-center rounded-xl bg-neutral-950 px-4 text-sm font-medium text-white transition hover:bg-neutral-800"
              >
                Back to login
              </Link>
            </div>
          ) : (
            <div className="space-y-5">
              <div className="flex items-center gap-3 rounded-xl border border-neutral-200/80 bg-neutral-50 px-4 py-3">
                <Loader2 className="h-4 w-4 animate-spin text-orange-500" />
                <span className="text-sm text-neutral-700">{message}</span>
              </div>

              <div className="h-1.5 overflow-hidden rounded-full bg-neutral-100">
                <div className="h-full w-2/3 animate-pulse rounded-full bg-orange-500" />
              </div>

              <div className="grid gap-2 text-sm">
                <CompletionStep active label="Verify secure callback" />
                <CompletionStep active label="Create browser session" />
                <CompletionStep label="Open dashboard" />
              </div>

              <div className="flex items-center justify-between border-t border-neutral-100 pt-4 text-xs text-neutral-400">
                <span>No password stored here</span>
                <ArrowRight className="h-3.5 w-3.5 text-orange-500" />
              </div>
            </div>
          )}
        </div>
      </section>
    </main>
  );
}

export default function AuthCompletePage() {
  return (
    <Suspense fallback={<AuthCompleteFallback />}>
      <AuthCompleteContent />
    </Suspense>
  );
}

function AuthCompleteFallback() {
  return (
    <main className="dash-shell grid min-h-screen place-items-center bg-[#f8f6f1] px-5 text-neutral-950">
      <div className="flex items-center gap-3 rounded-2xl border border-neutral-200/70 bg-white px-5 py-4 text-sm text-neutral-600 shadow-[0_1px_2px_rgba(70,45,0,0.03)]">
        <Loader2 className="h-4 w-4 animate-spin text-orange-500" />
        Opening your workspace...
      </div>
    </main>
  );
}

function CompletionStep({ label, active = false }: { label: string; active?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-xl border border-neutral-200/70 bg-white px-3 py-2.5">
      <span className={active ? "text-neutral-700" : "text-neutral-400"}>{label}</span>
      {active ? <ShieldCheck className="h-4 w-4 text-orange-500" /> : <span className="h-1.5 w-1.5 rounded-full bg-neutral-300" />}
    </div>
  );
}
