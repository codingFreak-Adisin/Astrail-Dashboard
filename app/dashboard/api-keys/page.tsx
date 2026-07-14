"use client";

import Link from "next/link";
import { FormEvent, useEffect, useState } from "react";
import { AlertCircle, Check, Copy, KeyRound, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { readJsonResponse } from "@/lib/client-json";
import { formatDate } from "@/lib/utils";
import type { ApiKey } from "@/lib/types";

export default function ApiKeysPage() {
  const [keys, setKeys] = useState<ApiKey[]>([]);
  const [name, setName] = useState("Default key");
  const [rawKey, setRawKey] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [copied, setCopied] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<ApiKey | null>(null);
  const [deleteConfirmation, setDeleteConfirmation] = useState("");
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function loadKeys() {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch("/api/apikeys");
      const result = await readJsonResponse<{ keys?: ApiKey[]; error?: string }>(response);
      if (!response.ok) throw new Error(result.error ?? "Could not load API keys.");
      setKeys(result.keys ?? []);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Could not load API keys.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadKeys();
  }, []);

  async function createKey(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setCreating(true);
    setRawKey(null);
    setCopied(false);
    setError(null);

    try {
      const response = await fetch("/api/apikeys", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      });
      const result = await readJsonResponse<{ key?: ApiKey; rawKey?: string; error?: string }>(response);
      if (!response.ok || !result.key || !result.rawKey) throw new Error(result.error ?? "Could not create key.");
      setRawKey(result.rawKey);
      setKeys((current) => [result.key as ApiKey, ...current]);
    } catch (createError) {
      setError(createError instanceof Error ? createError.message : "Could not create key.");
    } finally {
      setCreating(false);
    }
  }

  async function deleteKey(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!deleteTarget) return;
    setDeleting(true);
    setError(null);

    try {
      const response = await fetch("/api/apikeys", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: deleteTarget.id,
          confirmation: deleteConfirmation,
        }),
      });
      const result = await readJsonResponse<{ deleted?: boolean; error?: string }>(response);
      if (!response.ok || !result.deleted) throw new Error(result.error ?? "Could not delete key.");
      setKeys((current) => current.filter((key) => key.id !== deleteTarget.id));
      setDeleteTarget(null);
      setDeleteConfirmation("");
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : "Could not delete key.");
    } finally {
      setDeleting(false);
    }
  }

  async function copyRawKey() {
    if (!rawKey) return;
    await navigator.clipboard.writeText(rawKey);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  return (
    <div className="mx-auto max-w-6xl space-y-5">
      <header className="console-hero px-5 py-8 sm:px-9">
        <div className="relative z-10 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0">
            <h1 className="text-3xl font-semibold tracking-tight text-neutral-950">API keys</h1>
            <p className="mt-1.5 text-sm text-neutral-600">Runtime access for private MCP endpoints and server-side calls.</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button asChild variant="outline">
              <Link href="/docs#auth">View auth docs</Link>
            </Button>
            <Button asChild>
              <Link href="/dashboard/settings">Workspace settings</Link>
            </Button>
          </div>
        </div>
      </header>

      <section className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_380px]">
        <div className="space-y-5">
          <section className="section-card">
            <div className="section-card-header">
              <SectionTitle
                icon={KeyRound}
                title="Create key"
              />
              <StatusPill tone={keys.length > 0 ? "success" : "neutral"}>
                {keys.length > 0 ? `${keys.length} active` : "Ready"}
              </StatusPill>
            </div>
            <form onSubmit={createKey} className="mt-1 grid gap-3 md:grid-cols-[1fr_auto] md:items-end">
              <div className="space-y-2">
                <Label htmlFor="keyName">Key name</Label>
                <Input id="keyName" value={name} onChange={(event) => setName(event.target.value)} required />
              </div>
              <Button disabled={creating}>
                <KeyRound className="h-4 w-4" />
                {creating ? "Creating..." : "Create key"}
              </Button>
            </form>
            {rawKey ? (
              <div className="mt-5 rounded-xl border border-neutral-200 bg-neutral-50/50 p-4">
                <div className="flex flex-col justify-between gap-3 md:flex-row md:items-center">
                  <div>
                    <p className="text-sm font-medium text-neutral-950">Copy this key now. It will not be shown again.</p>
                    <p className="mt-1 text-xs text-neutral-400">Use it as Authorization: Bearer for private MCP endpoints.</p>
                  </div>
                  <Button type="button" variant="outline" size="sm" onClick={copyRawKey}>
                    {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                    {copied ? "Copied" : "Copy key"}
                  </Button>
                </div>
                <code className="mt-3 block break-all rounded-xl border border-neutral-200 bg-white p-3 font-mono text-sm">{rawKey}</code>
              </div>
            ) : null}
            {error ? (
              <p className="mt-4 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-600">
                {error}
              </p>
            ) : null}
          </section>

          <section className="section-card">
            <div className="section-card-header">
              <SectionTitle title="Existing keys" />
            </div>
            {loading ? (
              <p className="text-sm text-neutral-500">Loading keys...</p>
            ) : keys.length === 0 ? (
              <p className="text-sm font-medium text-neutral-950">No API keys yet.</p>
            ) : (
              <div>
                {keys.map((key) => (
                  <div key={key.id} className="console-table-row flex flex-col justify-between gap-3 py-3.5 sm:flex-row sm:items-center">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium text-neutral-950">{key.name}</p>
                      <p className="mt-1 truncate font-mono text-xs text-neutral-500">{key.key_preview}</p>
                    </div>
                    <div className="flex shrink-0 items-center gap-3">
                      <p className="text-sm text-neutral-500">{formatDate(key.created_at)}</p>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => {
                          setDeleteTarget(key);
                          setDeleteConfirmation("");
                          setError(null);
                        }}
                      >
                        <Trash2 className="h-4 w-4" />
                        Delete
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>
        </div>

        <aside className="space-y-5">
          <section className="section-card">
            <div className="section-card-header">
              <SectionTitle title="Where keys are used" />
            </div>
            <div className="grid gap-2 text-sm text-neutral-600">
              <p>Private endpoints</p>
              <p>SDK exports</p>
              <p>External clients</p>
            </div>
          </section>
        </aside>
      </section>

      {deleteTarget ? (
        <section className="section-card border-red-200">
          <SectionTitle
            icon={AlertCircle}
            title="Delete API key"
            description="This cannot be undone. Type the key name to confirm deletion."
          />
          <form onSubmit={deleteKey} className="mt-5 space-y-3">
            <div className="space-y-2">
              <Label htmlFor="delete-confirmation">
                Type <code>{deleteTarget.name}</code> to delete this key
              </Label>
              <Input
                id="delete-confirmation"
                value={deleteConfirmation}
                onChange={(event) => setDeleteConfirmation(event.target.value)}
                autoComplete="off"
              />
            </div>
            <div className="flex flex-col gap-2 sm:flex-row">
              <Button
                type="submit"
                variant="destructive"
                disabled={deleting || deleteConfirmation !== deleteTarget.name}
              >
                <Trash2 className="h-4 w-4" />
                {deleting ? "Deleting..." : "Delete API key"}
              </Button>
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  setDeleteTarget(null);
                  setDeleteConfirmation("");
                }}
                disabled={deleting}
              >
                Cancel
              </Button>
            </div>
          </form>
        </section>
      ) : null}
    </div>
  );
}

function SectionTitle({
  title,
  description,
  icon: Icon,
}: {
  title: string;
  description?: string;
  icon?: typeof KeyRound;
}) {
  return (
    <div>
      <h2 className="flex items-center gap-2 text-lg font-semibold text-neutral-950">
        {Icon ? <Icon className="h-4 w-4 text-orange-600" /> : null}
        {title}
      </h2>
      {description ? <p className="mt-0.5 max-w-2xl text-xs text-neutral-400">{description}</p> : null}
    </div>
  );
}

function StatusPill({ children, tone }: { children: React.ReactNode; tone: "success" | "neutral" }) {
  return (
    <span className={`pill ${tone === "success" ? "pill-success" : "pill-neutral"}`}>
      {children}
    </span>
  );
}
