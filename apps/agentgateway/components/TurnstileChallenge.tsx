"use client";

import { useEffect, useRef } from "react";
import { ShieldCheck } from "lucide-react";
import { cn } from "@/lib/utils";

declare global {
  interface Window {
    turnstile?: {
      render: (
        container: HTMLElement,
        options: {
          sitekey: string;
          action?: string;
          theme?: "light" | "dark" | "auto";
          callback?: (token: string) => void;
          "expired-callback"?: () => void;
          "error-callback"?: () => void;
        }
      ) => string;
      remove: (widgetId: string) => void;
    };
  }
}

type TurnstileChallengeProps = {
  action: string;
  className?: string;
  resetKey?: number;
  onTokenChange: (token: string | null) => void;
};

const siteKey = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY ?? process.env.NEXT_PUBLIC_CLOUDFLARE_TURNSTILE_SITE_KEY;

function loadTurnstileScript(onLoad: () => void) {
  const existing = document.getElementById("cf-turnstile-api");
  if (existing) {
    existing.addEventListener("load", onLoad, { once: true });
    if (window.turnstile) onLoad();
    return () => existing.removeEventListener("load", onLoad);
  }

  const script = document.createElement("script");
  script.id = "cf-turnstile-api";
  script.src = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
  script.async = true;
  script.defer = true;
  script.addEventListener("load", onLoad, { once: true });
  document.head.appendChild(script);

  return () => script.removeEventListener("load", onLoad);
}

export function TurnstileChallenge({ action, className, resetKey = 0, onTokenChange }: TurnstileChallengeProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const widgetIdRef = useRef<string | null>(null);

  useEffect(() => {
    if (!siteKey) return;

    let cancelled = false;
    onTokenChange(null);

    function renderWidget() {
      if (cancelled || !siteKey || !containerRef.current || !window.turnstile) return;

      if (widgetIdRef.current) {
        window.turnstile.remove(widgetIdRef.current);
        widgetIdRef.current = null;
      }

      widgetIdRef.current = window.turnstile.render(containerRef.current, {
        sitekey: siteKey,
        action,
        theme: "light",
        callback: (token) => onTokenChange(token),
        "expired-callback": () => onTokenChange(null),
        "error-callback": () => onTokenChange(null),
      });
    }

    const cleanupScriptListener = loadTurnstileScript(renderWidget);

    return () => {
      cancelled = true;
      cleanupScriptListener();
      if (widgetIdRef.current && window.turnstile) {
        window.turnstile.remove(widgetIdRef.current);
        widgetIdRef.current = null;
      }
    };
  }, [action, onTokenChange, resetKey]);

  if (!siteKey) return null;

  return (
    <div className={cn("rounded-lg border border-neutral-200 bg-neutral-50 p-4", className)}>
      <div className="mb-3 flex items-center gap-2 text-sm font-medium text-neutral-950">
        <ShieldCheck className="h-4 w-4 text-orange-600" />
        Cloudflare verification
      </div>
      <div ref={containerRef} />
      <p className="mt-3 text-xs leading-5 text-muted-foreground">
        Required before creating or testing hosted MCP endpoints.
      </p>
    </div>
  );
}
