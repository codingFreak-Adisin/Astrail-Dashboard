"use client";

import { useState } from "react";
import type { FormEvent } from "react";
import { KeyRound } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { readJsonResponse } from "@/lib/client-json";

export function AuthConfigurationPanel({
  serverId,
  hasAuthRequiredEndpoints,
}: {
  serverId: string;
  hasAuthRequiredEndpoints: boolean;
}) {
  const [name, setName] = useState("Default API credential");
  const [authScheme, setAuthScheme] = useState<"bearer" | "api_key_header" | "api_key_query">("api_key_header");
  const [injectionName, setInjectionName] = useState("api_key");
  const [secret, setSecret] = useState("");
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function saveCredential(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setMessage(null);
    try {
      const response = await fetch("/api/credentials", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          server_id: serverId,
          name,
          auth_scheme: authScheme,
          injection_name: authScheme === "bearer" ? undefined : injectionName,
          secret,
        }),
      });
      const result = await readJsonResponse<{ error?: string }>(response);
      if (!response.ok) throw new Error(result.error ?? "Could not save credential.");
      setSecret("");
      setMessage("Credential saved. Future runtime calls can inject it server-side.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not save credential.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-4 text-sm">
      {hasAuthRequiredEndpoints ? (
        <p className="border border-amber-700/40 bg-amber-950/20 p-3 text-amber-200">
          Auth configuration required for one or more mapped endpoints. Without a credential, runtime calls return
          `auth_required`.
        </p>
      ) : (
        <p className="text-muted-foreground">No auth-required endpoints were detected for this server.</p>
      )}

      <form onSubmit={saveCredential} className="space-y-3">
        <div className="space-y-2">
          <Label htmlFor="credential-name">Credential name</Label>
          <Input id="credential-name" value={name} onChange={(event) => setName(event.target.value)} required />
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="credential-scheme">Auth scheme</Label>
            <select
              id="credential-scheme"
              value={authScheme}
              onChange={(event) => setAuthScheme(event.target.value as typeof authScheme)}
              className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
            >
              <option value="bearer">Bearer token</option>
              <option value="api_key_header">API key header</option>
              <option value="api_key_query">API key query param</option>
            </select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="credential-injection">Header/query name</Label>
            <Input
              id="credential-injection"
              value={injectionName}
              onChange={(event) => setInjectionName(event.target.value)}
              disabled={authScheme === "bearer"}
              placeholder="api_key"
            />
          </div>
        </div>
        <div className="space-y-2">
          <Label htmlFor="credential-secret">Secret</Label>
          <Input
            id="credential-secret"
            type="password"
            value={secret}
            onChange={(event) => setSecret(event.target.value)}
            required
            minLength={8}
          />
        </div>
        <Button type="submit" variant="outline" disabled={saving}>
          <KeyRound className="h-4 w-4" />
          {saving ? "Saving..." : "Attach credential"}
        </Button>
      </form>
      {message && <p className="text-muted-foreground">{message}</p>}
      <p className="text-xs text-muted-foreground">
        Secrets are sent only to the server API, encrypted before storage, and never returned to the browser.
      </p>
    </div>
  );
}
