"use client";

import { useCallback, useEffect, useState } from "react";
import { Check, Clock3, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { readJsonResponse } from "@/lib/client-json";
import type { ToolApprovalRequest } from "@/lib/runtime/tool-approvals";

function statusClass(status: ToolApprovalRequest["status"]) {
  if (status === "approved") return "border-emerald-200 bg-emerald-50 text-emerald-800";
  if (status === "denied" || status === "expired") return "border-red-200 bg-red-50 text-red-800";
  if (status === "executed") return "border-blue-200 bg-blue-50 text-blue-800";
  return "border-amber-200 bg-amber-50 text-amber-800";
}

export function ApprovalQueue() {
  const [items, setItems] = useState<ToolApprovalRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [acting, setActing] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const response = await fetch("/api/approvals", { cache: "no-store" });
      const result = await readJsonResponse<{ approvals?: ToolApprovalRequest[]; error?: string }>(response);
      if (!response.ok) throw new Error(result.error ?? "Could not load approvals.");
      setItems(result.approvals ?? []);
      setError(null);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Could not load approvals.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
    const interval = window.setInterval(() => void load(), 10_000);
    return () => window.clearInterval(interval);
  }, [load]);

  async function decide(id: string, decision: "approved" | "denied") {
    setActing(id);
    try {
      const response = await fetch(`/api/approvals/${id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ decision }),
      });
      const result = await readJsonResponse<{ error?: string }>(response);
      if (!response.ok) throw new Error(result.error ?? "Could not update approval.");
      await load();
    } catch (decisionError) {
      setError(decisionError instanceof Error ? decisionError.message : "Could not update approval.");
    } finally {
      setActing(null);
    }
  }

  if (loading) return <p className="text-sm text-muted-foreground">Loading approval queue...</p>;
  return (
    <div className="space-y-4">
      {error ? <p className="border border-red-200 bg-red-50 p-3 text-sm text-red-800">{error}</p> : null}
      {items.length === 0 ? (
        <div className="rounded-lg border border-dashed border-neutral-300 bg-white p-8 text-center">
          <Clock3 className="mx-auto h-6 w-6 text-neutral-400" />
          <p className="mt-3 font-medium">No approval requests yet</p>
          <p className="mt-1 text-sm text-muted-foreground">Calls marked Require approval appear here before any upstream request is made.</p>
        </div>
      ) : items.map((item) => (
        <article key={item.id} className="rounded-lg border border-neutral-200 bg-white p-5 shadow-sm">
          <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-start">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <code className="font-semibold text-neutral-950">{item.tool_name}</code>
                <span className={`rounded-md border px-2 py-0.5 text-xs font-semibold ${statusClass(item.status)}`}>{item.status}</span>
              </div>
              <p className="mt-2 text-xs text-muted-foreground">Execution {item.id} · expires {new Date(item.expires_at).toLocaleString()}</p>
            </div>
            {item.status === "pending" ? (
              <div className="flex gap-2">
                <Button type="button" variant="outline" onClick={() => void decide(item.id, "denied")} disabled={acting === item.id}><X className="h-4 w-4" /> Deny</Button>
                <Button type="button" onClick={() => void decide(item.id, "approved")} disabled={acting === item.id}><Check className="h-4 w-4" /> Approve</Button>
              </div>
            ) : null}
          </div>
          <pre className="mt-4 max-h-64 overflow-auto rounded-md border border-neutral-200 bg-neutral-50 p-3 text-xs leading-5 text-neutral-700">{JSON.stringify(item.arguments_redacted, null, 2)}</pre>
        </article>
      ))}
    </div>
  );
}
