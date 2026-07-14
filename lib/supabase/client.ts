"use client";

import { createBrowserClient } from "@supabase/ssr";
import { getBrowserSupabaseConfig } from "@/lib/supabase/env";

export function createClient() {
  const { url, anonKey } = getBrowserSupabaseConfig();

  if (!url || !anonKey) {
    throw new Error("Authentication is not configured.");
  }

  return createBrowserClient(url, anonKey);
}
