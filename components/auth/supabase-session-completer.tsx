"use client";

import { useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";

type CompletionStatus = "idle" | "running" | "error";

type SupabaseSessionCompleterProps = {
  redirectTo?: string;
  exchangeCode?: boolean;
  hideMessage?: boolean;
  onStatusChange?: (status: CompletionStatus, message: string | null) => void;
};

function safeRedirectPath(value: string | null | undefined) {
  if (!value || !value.startsWith("/") || value.startsWith("//")) {
    return "/dashboard";
  }

  return value;
}

function cleanTokenUrl() {
  const url = new URL(window.location.href);
  url.hash = "";
  url.searchParams.delete("error");
  url.searchParams.delete("error_description");
  url.searchParams.delete("reason");
  window.history.replaceState(null, "", `${url.pathname}${url.search}`);
}

function callbackUrlForCode(code: string, redirectTo: string) {
  const callbackUrl = new URL("/api/auth/callback", window.location.origin);
  callbackUrl.searchParams.set("code", code);
  callbackUrl.searchParams.set("next", safeRedirectPath(redirectTo));
  return callbackUrl.toString();
}

export function SupabaseSessionCompleter({
  redirectTo = "/dashboard",
  exchangeCode = false,
  hideMessage = false,
  onStatusChange,
}: SupabaseSessionCompleterProps) {
  const [status, setStatus] = useState<CompletionStatus>("idle");
  const [message, setMessage] = useState<string | null>(null);
  const safeRedirect = useMemo(() => safeRedirectPath(redirectTo), [redirectTo]);

  useEffect(() => {
    onStatusChange?.(status, message);
  }, [message, onStatusChange, status]);

  useEffect(() => {
    let cancelled = false;

    async function completeSession() {
      const url = new URL(window.location.href);
      const code = url.searchParams.get("code");
      const providerError = url.searchParams.get("error_description") ?? url.searchParams.get("error");

      if (exchangeCode && providerError) {
        setStatus("error");
        setMessage(providerError);
        return;
      }

      if (exchangeCode && code) {
        setStatus("running");
        setMessage("Finishing secure sign-in...");
        window.location.replace(callbackUrlForCode(code, safeRedirect));
        return;
      }

      const hash = new URLSearchParams(window.location.hash.startsWith("#")
        ? window.location.hash.slice(1)
        : window.location.hash);
      const accessToken = hash.get("access_token");
      const refreshToken = hash.get("refresh_token");

      if (!accessToken || !refreshToken) {
        if (exchangeCode) {
          setStatus("error");
          setMessage("No valid auth session was returned. Start sign-in again.");
        }
        return;
      }

      setStatus("running");
      setMessage("Finishing secure sign-in...");
      cleanTokenUrl();

      try {
        const supabase = createClient();
        const { error } = await supabase.auth.setSession({
          access_token: accessToken,
          refresh_token: refreshToken,
        });

        if (cancelled) return;

        if (error) {
          setStatus("error");
          setMessage("Could not save your session. Start sign-in again.");
          return;
        }

        window.location.replace(safeRedirect);
      } catch {
        if (cancelled) return;
        setStatus("error");
        setMessage("Authentication is not configured correctly. Contact support.");
      }
    }

    void completeSession();

    return () => {
      cancelled = true;
    };
  }, [exchangeCode, safeRedirect]);

  if (status === "idle" || hideMessage) return null;

  return (
    <p className={`mb-4 rounded-xl border p-3 text-sm leading-relaxed ${
      status === "error"
        ? "border-red-200 bg-red-50 text-red-700"
        : "border-neutral-200/80 bg-neutral-50 text-neutral-600"
    }`}>
      {message}
    </p>
  );
}
