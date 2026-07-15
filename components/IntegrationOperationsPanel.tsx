"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { readJsonResponse } from "@/lib/client-json";
import type { ExecutionPolicy, FieldMappingRule, McpActionLevel, ResponseFieldRule, RuntimePermissionPolicy, ServerFieldMappings } from "@/lib/types";

const ACTIONS: McpActionLevel[] = ["read", "draft", "write", "send", "destructive"];

type WebhookEndpoint = {
  id: string;
  name: string;
  secret_preview: string;
  signature_header: string;
  event_id_header: string;
  created_at: string;
};

type CostTotals = {
  minutes: number;
  amount: number;
  by_category: Record<string, { minutes: number; amount: number; events: number }>;
};

function newArgumentMapping(): FieldMappingRule {
  return { argument: "", upstream_name: "" };
}

function newResponseMapping(): ResponseFieldRule {
  return { field: "", rename: "" };
}

export function IntegrationOperationsPanel({
  serverId,
  initialMappings,
  initialExecutionPolicy,
  initialRuntimePolicy,
  canCheckSchema,
}: {
  serverId: string;
  initialMappings: ServerFieldMappings;
  initialExecutionPolicy: ExecutionPolicy;
  initialRuntimePolicy: RuntimePermissionPolicy;
  canCheckSchema: boolean;
}) {
  const [argumentMappings, setArgumentMappings] = useState<FieldMappingRule[]>(initialMappings.arguments ?? []);
  const [responseMappings, setResponseMappings] = useState<ResponseFieldRule[]>(initialMappings.response ?? []);
  const [valueMapDrafts, setValueMapDrafts] = useState<string[]>(() => (initialMappings.arguments ?? []).map((mapping) => JSON.stringify(mapping.value_map ?? {})));
  const [execution, setExecution] = useState<Required<ExecutionPolicy>>({
    max_attempts: initialExecutionPolicy.max_attempts ?? 3,
    timeout_ms: initialExecutionPolicy.timeout_ms ?? 15000,
    base_delay_ms: initialExecutionPolicy.base_delay_ms ?? 300,
    retry_statuses: initialExecutionPolicy.retry_statuses ?? [408, 425, 429, 500, 502, 503, 504],
    retry_writes: initialExecutionPolicy.retry_writes ?? true,
    idempotency_header: initialExecutionPolicy.idempotency_header ?? "idempotency-key",
  });
  const [actions, setActions] = useState<McpActionLevel[]>(initialRuntimePolicy.allowed_actions?.length ? initialRuntimePolicy.allowed_actions : ACTIONS);
  const [message, setMessage] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [schemaResult, setSchemaResult] = useState<string | null>(null);
  const [webhookName, setWebhookName] = useState("Production events");
  const [webhooks, setWebhooks] = useState<WebhookEndpoint[]>([]);
  const [webhookSecret, setWebhookSecret] = useState<{ secret: string; url: string } | null>(null);
  const [costCategory, setCostCategory] = useState("setup");
  const [costMinutes, setCostMinutes] = useState("60");
  const [costAmount, setCostAmount] = useState("0");
  const [costNote, setCostNote] = useState("");
  const [costTotals, setCostTotals] = useState<CostTotals>({ minutes: 0, amount: 0, by_category: {} });

  const retryStatusesText = useMemo(() => execution.retry_statuses.join(", "), [execution.retry_statuses]);

  const loadWebhooks = useCallback(async () => {
    const response = await fetch(`/api/webhooks?server_id=${encodeURIComponent(serverId)}`, { cache: "no-store" });
    const result = await readJsonResponse<{ endpoints?: WebhookEndpoint[]; error?: string }>(response);
    if (response.ok) setWebhooks(result.endpoints ?? []);
    else setMessage(result.error ?? "Could not load webhook endpoints.");
  }, [serverId]);

  const loadCosts = useCallback(async () => {
    const response = await fetch(`/api/integration-costs?server_id=${encodeURIComponent(serverId)}`, { cache: "no-store" });
    const result = await readJsonResponse<{ totals?: CostTotals; error?: string }>(response);
    if (response.ok && result.totals) setCostTotals(result.totals);
    else if (!response.ok) setMessage(result.error ?? "Could not load integration costs.");
  }, [serverId]);

  useEffect(() => {
    void loadWebhooks();
    void loadCosts();
  }, [loadCosts, loadWebhooks]);

  async function saveOperations() {
    setSaving(true);
    setMessage(null);
    try {
      if (argumentMappings.some((mapping) => !mapping.argument.trim())) throw new Error("Every request mapping needs a tool argument name.");
      if (responseMappings.some((mapping) => !mapping.field.trim())) throw new Error("Every response mapping needs a provider field path.");
      const mappingsWithValues = argumentMappings.map((mapping, index) => {
        let value: unknown;
        try {
          value = JSON.parse(valueMapDrafts[index] || "{}") as unknown;
        } catch {
          throw new Error(`Value map ${index + 1} must be valid JSON.`);
        }
        if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`Value map ${index + 1} must be a JSON object.`);
        return { ...mapping, value_map: value as Record<string, unknown> };
      });
      const runtimePolicy: RuntimePermissionPolicy = {
        ...initialRuntimePolicy,
        allowed_actions: actions.length === ACTIONS.length ? [] : actions,
      };
      const response = await fetch(`/api/servers/${serverId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          field_mappings: mappingsWithValues.length > 0 || responseMappings.length > 0
            ? { arguments: mappingsWithValues, response: responseMappings }
            : null,
          execution_policy: execution,
          runtime_policy: runtimePolicy,
        }),
      });
      const result = await readJsonResponse<{ error?: string }>(response);
      if (!response.ok) throw new Error(result.error ?? "Could not save integration operations.");
      setMessage("Mappings, reliability, and action permissions saved.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not save integration operations.");
    } finally {
      setSaving(false);
    }
  }

  async function checkSchema(applyChanges: boolean) {
    setSchemaResult(applyChanges ? "Updating generated tools..." : "Checking source schema...");
    const response = await fetch(`/api/servers/${serverId}/reimport`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ dry_run: !applyChanges }),
    });
    const result = await readJsonResponse<{ error?: string; diff?: { summary: string; breaking: boolean } }>(response);
    if (!response.ok) {
      setSchemaResult(result.error ?? "Schema check failed.");
      return;
    }
    const summary = result.diff?.summary ?? "Schema comparison completed.";
    setSchemaResult(applyChanges ? `Schema migrated. ${summary} Refresh to see regenerated tools.` : summary);
  }

  async function createWebhook() {
    setMessage(null);
    const response = await fetch("/api/webhooks", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ server_id: serverId, name: webhookName, signature_header: "x-astrail-signature", event_id_header: "x-event-id" }),
    });
    const result = await readJsonResponse<{ error?: string; secret?: string; ingest_path?: string }>(response);
    if (!response.ok || !result.secret || !result.ingest_path) {
      setMessage(result.error ?? "Could not create webhook endpoint.");
      return;
    }
    setWebhookSecret({ secret: result.secret, url: `${window.location.origin}${result.ingest_path}` });
    await loadWebhooks();
  }

  async function removeWebhook(id: string) {
    const response = await fetch(`/api/webhooks/${id}`, { method: "DELETE" });
    const result = await readJsonResponse<{ error?: string }>(response);
    if (response.ok) await loadWebhooks();
    else setMessage(result.error ?? "Could not remove webhook endpoint.");
  }

  async function recordCost() {
    setMessage(null);
    const response = await fetch("/api/integration-costs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        server_id: serverId,
        category: costCategory,
        minutes: Number(costMinutes),
        amount: Number(costAmount),
        note: costNote || undefined,
      }),
    });
    const result = await readJsonResponse<{ error?: string }>(response);
    if (!response.ok) {
      setMessage(result.error ?? "Could not record integration cost.");
      return;
    }
    setCostNote("");
    setMessage("Integration cost recorded.");
    await loadCosts();
  }

  return (
    <div className="space-y-8 text-base">
      <section className="space-y-3">
        <div>
          <h3 className="font-semibold">Customer field mappings</h3>
          <p className="text-muted-foreground">Translate tool inputs to provider fields and normalize provider responses without custom code. Dot paths such as <code>customer.id</code> are supported.</p>
        </div>
        <p className="font-medium">Request mappings</p>
        {argumentMappings.map((mapping, index) => (
          <div key={`argument-${index}`} className="grid gap-2 border p-3 md:grid-cols-[1fr_1fr_1fr_auto]">
            <Input aria-label="Tool scope" value={mapping.tool ?? ""} onChange={(event) => setArgumentMappings((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, tool: event.target.value || undefined } : item))} placeholder="Tool (optional)" />
            <Input aria-label="Tool argument" value={mapping.argument} onChange={(event) => setArgumentMappings((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, argument: event.target.value } : item))} placeholder="customer_email" />
            <Input aria-label="Upstream field" value={mapping.upstream_name ?? ""} onChange={(event) => setArgumentMappings((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, upstream_name: event.target.value || undefined } : item))} placeholder="email" />
            <Button type="button" variant="outline" onClick={() => {
              setArgumentMappings((current) => current.filter((_, itemIndex) => itemIndex !== index));
              setValueMapDrafts((current) => current.filter((_, itemIndex) => itemIndex !== index));
            }}>Remove</Button>
            <Input className="md:col-span-2" value={valueMapDrafts[index] ?? "{}"} onChange={(event) => {
              const raw = event.target.value;
              setValueMapDrafts((current) => current.map((item, itemIndex) => itemIndex === index ? raw : item));
              try { setArgumentMappings((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, value_map: JSON.parse(raw) as Record<string, unknown> } : item)); } catch { /* show draft until it becomes valid JSON */ }
            }} placeholder='Value map, e.g. {"qualified":"05_QUALIFIED"}' />
            <Input value={typeof mapping.default === "string" || typeof mapping.default === "number" ? String(mapping.default) : ""} onChange={(event) => setArgumentMappings((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, default: event.target.value || undefined } : item))} placeholder="Default value (optional)" />
            <label className="flex items-center gap-2"><input type="checkbox" checked={Boolean(mapping.drop)} onChange={(event) => setArgumentMappings((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, drop: event.target.checked } : item))} /> Drop field</label>
          </div>
        ))}
        <Button type="button" variant="outline" onClick={() => {
          setArgumentMappings((current) => [...current, newArgumentMapping()]);
          setValueMapDrafts((current) => [...current, "{}"]);
        }}>Add request mapping</Button>

        <p className="pt-2 font-medium">Response mappings</p>
        {responseMappings.map((mapping, index) => (
          <div key={`response-${index}`} className="grid gap-2 border p-3 md:grid-cols-[1fr_1fr_1fr_auto_auto]">
            <Input value={mapping.tool ?? ""} onChange={(event) => setResponseMappings((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, tool: event.target.value || undefined } : item))} placeholder="Tool (optional)" />
            <Input value={mapping.field} onChange={(event) => setResponseMappings((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, field: event.target.value } : item))} placeholder="contacts.cust_id" />
            <Input value={mapping.rename ?? ""} onChange={(event) => setResponseMappings((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, rename: event.target.value || undefined } : item))} placeholder="Rename to id" />
            <label className="flex items-center gap-2"><input type="checkbox" checked={Boolean(mapping.drop)} onChange={(event) => setResponseMappings((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, drop: event.target.checked } : item))} /> Drop</label>
            <Button type="button" variant="outline" onClick={() => setResponseMappings((current) => current.filter((_, itemIndex) => itemIndex !== index))}>Remove</Button>
          </div>
        ))}
        <Button type="button" variant="outline" onClick={() => setResponseMappings((current) => [...current, newResponseMapping()])}>Add response mapping</Button>
      </section>

      <section className="space-y-3 border-t pt-6">
        <div>
          <h3 className="font-semibold">Reliability policy</h3>
          <p className="text-muted-foreground">Retry network failures, 429s, and selected 5xx responses with bounded exponential backoff. Write retries reuse one idempotency key.</p>
        </div>
        <div className="grid gap-3 md:grid-cols-3">
          <div><Label>Maximum attempts</Label><Input type="number" min={1} max={4} value={execution.max_attempts} onChange={(event) => setExecution({ ...execution, max_attempts: Number(event.target.value) })} /></div>
          <div><Label>Timeout (ms)</Label><Input type="number" min={1000} max={30000} value={execution.timeout_ms} onChange={(event) => setExecution({ ...execution, timeout_ms: Number(event.target.value) })} /></div>
          <div><Label>Base backoff (ms)</Label><Input type="number" min={0} max={2000} value={execution.base_delay_ms} onChange={(event) => setExecution({ ...execution, base_delay_ms: Number(event.target.value) })} /></div>
          <div className="md:col-span-2"><Label>Retry HTTP statuses</Label><Input value={retryStatusesText} onChange={(event) => setExecution({ ...execution, retry_statuses: event.target.value.split(",").map(Number).filter((value) => Number.isInteger(value)) })} /></div>
          <div><Label>Idempotency header</Label><Input value={execution.idempotency_header} onChange={(event) => setExecution({ ...execution, idempotency_header: event.target.value })} /></div>
        </div>
        <label className="flex items-center gap-2"><input type="checkbox" checked={execution.retry_writes} onChange={(event) => setExecution({ ...execution, retry_writes: event.target.checked })} /> Retry write calls with the same idempotency key</label>
      </section>

      <section className="space-y-3 border-t pt-6">
        <div><h3 className="font-semibold">Agent action permissions</h3><p className="text-muted-foreground">Choose exactly what agents may do. Per-tool allow, approval, and block rules still apply afterward.</p></div>
        <div className="flex flex-wrap gap-3">
          {ACTIONS.map((action) => (
            <label key={action} className="flex items-center gap-2 border px-3 py-2">
              <input type="checkbox" checked={actions.includes(action)} onChange={(event) => setActions((current) => event.target.checked ? [...current, action] : current.filter((item) => item !== action))} />
              {action}
            </label>
          ))}
        </div>
      </section>

      <section className="space-y-3 border-t pt-6">
        <div><h3 className="font-semibold">Schema migration</h3><p className="text-muted-foreground">Compare the live OpenAPI document with this integration, then regenerate changed tools while preserving tool policies and customer mappings.</p></div>
        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="outline" disabled={!canCheckSchema} onClick={() => void checkSchema(false)}>Check for drift</Button>
          <Button type="button" variant="outline" disabled={!canCheckSchema} onClick={() => void checkSchema(true)}>Check and migrate</Button>
        </div>
        {schemaResult && <p className="text-muted-foreground">{schemaResult}</p>}
      </section>

      <section className="space-y-3 border-t pt-6">
        <div><h3 className="font-semibold">Signed, idempotent webhooks</h3><p className="text-muted-foreground">Every request needs an HMAC-SHA256 signature. Sign <code>event-id.raw-body</code> when sending an event ID, or the raw body when omitting it. Replayed IDs are accepted once and marked as duplicates afterward.</p></div>
        <div className="flex flex-col gap-2 sm:flex-row"><Input value={webhookName} onChange={(event) => setWebhookName(event.target.value)} /><Button type="button" variant="outline" onClick={() => void createWebhook()}>Create endpoint</Button></div>
        {webhookSecret && <div className="border border-amber-300 bg-amber-50 p-3 text-amber-950"><p className="font-medium">Copy this secret now. It will not be shown again.</p><code className="mt-2 block break-all">{webhookSecret.secret}</code><code className="mt-2 block break-all">{webhookSecret.url}</code></div>}
        {webhooks.map((endpoint) => <div key={endpoint.id} className="flex items-center justify-between gap-3 border p-3"><div><p className="font-medium">{endpoint.name}</p><p className="text-xs text-muted-foreground">{endpoint.signature_header} · {endpoint.event_id_header} · {endpoint.secret_preview}</p></div><Button type="button" variant="outline" onClick={() => void removeWebhook(endpoint.id)}>Remove</Button></div>)}
      </section>

      <section className="space-y-3 border-t pt-6">
        <div><h3 className="font-semibold">Integration cost</h3><p className="text-muted-foreground">Measure setup, maintenance, support, and customer-specific exceptions separately.</p></div>
        <p className="font-medium">Total: {Math.round(costTotals.minutes / 60 * 10) / 10} hours · ${costTotals.amount.toFixed(2)}</p>
        <div className="grid gap-2 md:grid-cols-[170px_120px_120px_1fr_auto]">
          <select value={costCategory} onChange={(event) => setCostCategory(event.target.value)} className="h-9 border bg-background px-2"><option value="setup">Setup</option><option value="maintenance">Maintenance</option><option value="support">Support/debugging</option><option value="custom_exception">Customer exception</option></select>
          <Input aria-label="Minutes" type="number" min={0} value={costMinutes} onChange={(event) => setCostMinutes(event.target.value)} placeholder="Minutes" />
          <Input aria-label="Amount" type="number" min={0} step="0.01" value={costAmount} onChange={(event) => setCostAmount(event.target.value)} placeholder="Cost" />
          <Input aria-label="Cost note" value={costNote} onChange={(event) => setCostNote(event.target.value)} placeholder="What consumed the time?" />
          <Button type="button" variant="outline" onClick={() => void recordCost()}>Record</Button>
        </div>
      </section>

      <section className="space-y-3 border-t pt-6">
        <div><h3 className="font-semibold">Audit history</h3><p className="text-muted-foreground">Export human-readable tool calls with trace IDs, retries, upstream status, errors, and latency.</p></div>
        <div className="flex flex-wrap gap-2">
          <Button asChild variant="outline"><a href={`/api/audit/export?server_id=${encodeURIComponent(serverId)}&format=csv`}>Export CSV</a></Button>
          <Button asChild variant="outline"><a href={`/api/audit/export?server_id=${encodeURIComponent(serverId)}&format=json`}>Export JSON</a></Button>
        </div>
      </section>

      <div className="border-t pt-4"><Button type="button" onClick={() => void saveOperations()} disabled={saving}>{saving ? "Saving..." : "Save integration operations"}</Button>{message && <p className="mt-2 text-muted-foreground">{message}</p>}</div>
    </div>
  );
}
