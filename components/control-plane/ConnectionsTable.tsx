"use client";

import Link from "next/link";
import { useState } from "react";
import type { CredentialSummary } from "@/lib/dashboard-control-plane";

export function ConnectionsTable({ credentials, serverNames }: { credentials: CredentialSummary[]; serverNames: Record<string, string> }) {
  const [rows, setRows] = useState(credentials);
  const [removing, setRemoving] = useState<string | null>(null);
  const [message, setMessage] = useState("");

  async function remove(id: string) {
    setRemoving(id);
    setMessage("");
    const response = await fetch(`/api/credentials/${id}`, { method: "DELETE" });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) {
      setMessage(typeof body.error === "string" ? body.error : "Could not remove this connection.");
    } else {
      setRows((current) => current.filter((row) => row.id !== id));
      setMessage("Connection removed. Its encrypted secret can no longer be injected into runtime calls.");
    }
    setRemoving(null);
  }

  function connectionStatus(credential: CredentialSummary) {
    if (credential.connect_status === "reauth_required") return { label: "reconnect", tone: "border-red-200 bg-red-50 text-red-800" };
    if (credential.connect_status === "failed") return { label: "failed", tone: "border-red-200 bg-red-50 text-red-800" };
    if (credential.connect_status === "pending" || credential.connect_status === "exchanging") return { label: "connecting", tone: "border-amber-200 bg-amber-50 text-amber-800" };
    const expired = credential.expires_at ? new Date(credential.expires_at).getTime() <= Date.now() : false;
    if (credential.auth_scheme !== "oauth2" && expired) return { label: "expired", tone: "border-red-200 bg-red-50 text-red-800" };
    if (credential.auth_scheme === "oauth2") return { label: "managed", tone: "border-emerald-200 bg-emerald-50 text-emerald-800" };
    return { label: "ready", tone: "border-emerald-200 bg-emerald-50 text-emerald-800" };
  }

  return (
    <div className="overflow-hidden rounded-xl border border-neutral-200 bg-white">
      {message ? <p role="status" className="border-b border-neutral-200 bg-neutral-50 px-4 py-3 text-sm text-neutral-700">{message}</p> : null}
      <div className="overflow-x-auto">
        <table className="w-full min-w-[1120px] text-left text-sm">
          <thead className="bg-neutral-50 text-xs uppercase tracking-wide text-neutral-500"><tr><th className="px-4 py-3 font-medium">Connection</th><th className="px-4 py-3 font-medium">Integration</th><th className="px-4 py-3 font-medium">Identity</th><th className="px-4 py-3 font-medium">Authentication</th><th className="px-4 py-3 font-medium">Granted scopes</th><th className="px-4 py-3 font-medium">Secret</th><th className="px-4 py-3 font-medium">Status</th><th className="px-4 py-3" /></tr></thead>
          <tbody className="divide-y divide-neutral-100">
            {rows.map((credential) => {
              const status = connectionStatus(credential);
              const scopes = Array.isArray(credential.scopes) ? credential.scopes.filter(Boolean) : [];
              return (
                <tr key={credential.id} className="hover:bg-neutral-50/70">
                  <td className="px-4 py-4"><p className="font-semibold text-neutral-950">{credential.name}</p><p className="mt-1 text-xs text-neutral-500">{credential.provider || "Custom provider"}</p>{credential.security_scheme ? <p className="mt-1 font-mono text-[11px] text-neutral-500">scheme: {credential.security_scheme}</p> : null}</td>
                  <td className="px-4 py-4">{credential.server_id ? <Link href={`/dashboard/servers/${credential.server_id}`} className="font-medium text-neutral-800 hover:text-orange-700">{serverNames[credential.server_id] ?? "Integration"}</Link> : <span className="text-neutral-500">Workspace-wide</span>}</td>
                  <td className="px-4 py-4"><p className="max-w-[180px] truncate font-mono text-xs text-neutral-700">{credential.end_user_id || "workspace"}</p><p className="mt-1 text-xs text-neutral-500">{credential.end_user_id ? "per-user grant" : credential.auth_scheme === "oauth2" ? "workspace service grant" : "shared service credential"}</p></td>
                  <td className="px-4 py-4"><p className="font-medium text-neutral-800">{credential.auth_scheme.replaceAll("_", " ")}</p>{credential.injection_name ? <p className="mt-1 font-mono text-xs text-neutral-500">{credential.injection_name}</p> : null}</td>
                  <td className="px-4 py-4"><p className="max-w-[240px] truncate font-mono text-xs text-neutral-700">{scopes.length ? scopes.slice(0, 3).join(" ") : "none recorded"}</p>{scopes.length > 3 ? <p className="mt-1 text-xs text-neutral-500">+{scopes.length - 3} more</p> : null}</td>
                  <td className="px-4 py-4 font-mono text-xs text-neutral-600">{credential.key_preview}</td>
                  <td className="px-4 py-4"><span className={`inline-flex rounded-full border px-2.5 py-1 text-xs font-semibold ${status.tone}`}>{status.label}</span></td>
                  <td className="px-4 py-4 text-right"><button type="button" disabled={removing === credential.id} onClick={() => void remove(credential.id)} className="text-xs font-semibold text-red-700 hover:text-red-900 disabled:opacity-50">{removing === credential.id ? "Removing…" : "Remove"}</button></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {!rows.length ? <div className="px-5 py-12 text-center"><p className="font-medium text-neutral-900">No credentials attached</p><p className="mt-1 text-sm text-neutral-500">Open an integration and add a bearer token, API key, or OAuth connection.</p></div> : null}
    </div>
  );
}
