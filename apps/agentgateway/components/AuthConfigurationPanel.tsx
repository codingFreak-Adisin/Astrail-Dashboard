"use client";

import { useCallback, useEffect, useState } from "react";
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
  type CredentialSummary = { id: string; name: string; auth_scheme: string; provider: string | null; key_preview: string; created_at: string };
  const [name, setName] = useState("Default API credential");
  const [authScheme, setAuthScheme] = useState<"bearer" | "api_key_header" | "api_key_query" | "oauth2">("api_key_header");
  const [provider, setProvider] = useState("");
  const [clientId, setClientId] = useState("");
  const [clientSecret, setClientSecret] = useState("");
  const [tokenUrl, setTokenUrl] = useState("");
  const [scopes, setScopes] = useState("");
  const [refreshToken, setRefreshToken] = useState("");
  const [expiresAt, setExpiresAt] = useState("");
  const [injectionName, setInjectionName] = useState("api_key");
  const [secret, setSecret] = useState("");
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [credentials, setCredentials] = useState<CredentialSummary[]>([]);

  const loadConnections = useCallback(async () => {
    const response = await fetch(`/api/credentials?server_id=${encodeURIComponent(serverId)}`, { cache: "no-store" });
    const result = await readJsonResponse<{ credentials?: CredentialSummary[] }>(response);
    if (response.ok) setCredentials(result.credentials ?? []);
  }, [serverId]);

  useEffect(() => { void loadConnections(); }, [loadConnections]);

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
          provider: authScheme === "oauth2" ? provider : undefined,
          auth_scheme: authScheme,
          client_id: authScheme === "oauth2" ? clientId : undefined,
          client_secret: authScheme === "oauth2" ? clientSecret : undefined,
          token_url: authScheme === "oauth2" ? tokenUrl : undefined,
          scopes: authScheme === "oauth2" ? scopes : undefined,
          refresh_token: authScheme === "oauth2" ? refreshToken : undefined,
          expires_at: authScheme === "oauth2" && expiresAt ? new Date(expiresAt).toISOString() : undefined,
          injection_name: authScheme === "bearer" || authScheme === "oauth2" ? undefined : injectionName,
          secret: authScheme === "oauth2" ? undefined : secret,
          access_token: authScheme === "oauth2" ? secret : undefined,
        }),
      });
      const result = await readJsonResponse<{ error?: string }>(response);
      if (!response.ok) throw new Error(result.error ?? "Could not save credential.");
      setSecret("");
      setClientSecret("");
      setRefreshToken("");
      setMessage("Credential saved. Future runtime calls can inject it server-side.");
      await loadConnections();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not save credential.");
    } finally {
      setSaving(false);
    }
  }

  async function removeCredential(id: string) {
    const response = await fetch(`/api/credentials/${id}`, { method: "DELETE" });
    const result = await readJsonResponse<{ error?: string }>(response);
    if (!response.ok) {
      setMessage(result.error ?? "Could not remove connection.");
      return;
    }
    setMessage("Connection removed.");
    await loadConnections();
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

      {credentials.length > 0 && (
        <div className="space-y-2 rounded-md border border-neutral-200 p-3">
          <p className="font-medium">Attached connections</p>
          <p className="text-xs text-muted-foreground">The newest compatible connection is used. Secrets remain encrypted and are never returned.</p>
          {credentials.map((credential, index) => (
            <div key={credential.id} className="flex items-center justify-between gap-3 border-t border-neutral-100 pt-2">
              <div className="min-w-0">
                <p className="truncate font-medium">{credential.name} {index === 0 ? <span className="text-xs text-emerald-700">newest</span> : null}</p>
                <p className="text-xs text-muted-foreground">{credential.auth_scheme} · {credential.key_preview}</p>
              </div>
              <Button type="button" variant="outline" size="sm" onClick={() => void removeCredential(credential.id)}>Remove</Button>
            </div>
          ))}
        </div>
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
              <option value="oauth2">OAuth 2.0 token</option>
            </select>
          </div>
          <div className={authScheme === "oauth2" ? "hidden" : "space-y-2"}>
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
        {authScheme === "oauth2" && (
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="credential-provider">Provider</Label>
              <Input id="credential-provider" value={provider} onChange={(event) => setProvider(event.target.value)} placeholder="github" required />
            </div>
            <div className="space-y-2">
              <Label htmlFor="credential-client-id">Client ID</Label>
              <Input id="credential-client-id" value={clientId} onChange={(event) => setClientId(event.target.value)} placeholder="OAuth client ID" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="credential-client-secret">Client secret</Label>
              <Input id="credential-client-secret" type="password" value={clientSecret} onChange={(event) => setClientSecret(event.target.value)} placeholder="Optional for public clients" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="credential-token-url">Token URL</Label>
              <Input id="credential-token-url" type="url" value={tokenUrl} onChange={(event) => setTokenUrl(event.target.value)} placeholder="https://provider.com/oauth/token" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="credential-scopes">Scopes</Label>
              <Input id="credential-scopes" value={scopes} onChange={(event) => setScopes(event.target.value)} placeholder="repo read:user offline_access" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="credential-expires-at">Expires at</Label>
              <Input id="credential-expires-at" type="datetime-local" value={expiresAt} onChange={(event) => setExpiresAt(event.target.value)} />
            </div>
            <div className="space-y-2 sm:col-span-2">
              <Label htmlFor="credential-refresh-token">Refresh token</Label>
              <Input id="credential-refresh-token" type="password" value={refreshToken} onChange={(event) => setRefreshToken(event.target.value)} placeholder="Optional, enables server-side refresh" />
            </div>
          </div>
        )}
        <div className="space-y-2">
          <Label htmlFor="credential-secret">{authScheme === "oauth2" ? "Access token" : "Secret"}</Label>
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
        Secrets and OAuth tokens are sent only to the server API, encrypted before storage, and never returned to the browser. Runtime
        method permissions are guardrails before Astrail execution, not a security boundary; keep provider credentials
        scoped to the least privilege needed upstream.
      </p>
    </div>
  );
}
