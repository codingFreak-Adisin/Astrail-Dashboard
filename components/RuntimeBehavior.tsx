export function RuntimeBehavior({
  hasEndpointMap,
  hasAuthRequiredEndpoints = false,
  hasExecutableEndpoints = false,
  hasBrowserRuntimeEndpoints = false,
  lastStatus = null,
  lastExecutionMode = null,
  lastToolName = null,
  lastLatencyMs = null,
  lastUpstreamStatus = null,
  lastTraceId = null,
  lastErrorCode = null,
  observabilityStorage = "structured_log",
  rateLimitMode = "in_memory",
}: {
  hasEndpointMap: boolean;
  hasAuthRequiredEndpoints?: boolean;
  hasExecutableEndpoints?: boolean;
  hasBrowserRuntimeEndpoints?: boolean;
  lastStatus?: string | null;
  lastExecutionMode?: string | null;
  lastToolName?: string | null;
  lastLatencyMs?: number | null;
  lastUpstreamStatus?: number | null;
  lastTraceId?: string | null;
  lastErrorCode?: string | null;
  observabilityStorage?: "tool_call_logs" | "structured_log" | "unavailable";
  rateLimitMode?: string;
}) {
  const executionMode = !hasEndpointMap
    ? "mapping_required"
    : hasBrowserRuntimeEndpoints
      ? "website_browser_runtime"
    : hasExecutableEndpoints
      ? "safe_rest_execution"
      : hasAuthRequiredEndpoints
        ? "auth_required"
        : "mapping_required";
  const runtimeHealth = !hasEndpointMap
    ? "needs_mapping"
    : lastStatus === "error"
      ? "degraded"
      : "healthy";
  const endpointHealth = typeof lastUpstreamStatus !== "number"
    ? "not_checked"
    : lastUpstreamStatus >= 200 && lastUpstreamStatus < 400
      ? "healthy"
      : "upstream_error";
  const observabilityLabel = formatObservabilityStorage(observabilityStorage);
  const rateLimitLabel = formatRateLimitMode(rateLimitMode);

  const rows: Array<{ label: string; value: React.ReactNode }> = [
    { label: "Runtime health", value: <span className={`pill ${runtimeHealth === "healthy" ? "pill-success" : runtimeHealth === "degraded" ? "pill-danger" : "pill-neutral"}`}>{runtimeHealth.replaceAll("_", " ")}</span> },
    { label: "Endpoint health", value: <span className={`pill ${endpointHealth === "healthy" ? "pill-success" : endpointHealth === "upstream_error" ? "pill-danger" : "pill-neutral"}`}>{endpointHealth.replaceAll("_", " ")}</span> },
    { label: "Execution mode", value: <code className="font-mono text-xs text-neutral-700">{executionMode}</code> },
    { label: "Deterministic execution", value: hasExecutableEndpoints ? <span className="pill pill-success">Supported</span> : <span className="pill pill-neutral">Not yet executable</span> },
    { label: "Generated source", value: "Export only" },
    { label: "Endpoint map", value: hasEndpointMap ? "Available" : "Required" },
    { label: "Endpoint mapped", value: hasEndpointMap ? "Yes" : "No" },
    { label: "Auth-required endpoints", value: hasAuthRequiredEndpoints ? "Present" : "None detected" },
    { label: "Browser runtime endpoints", value: hasBrowserRuntimeEndpoints ? "Present" : "None detected" },
    { label: "Last status", value: <code className="font-mono text-xs text-neutral-700">{lastStatus ?? "not recorded"}</code> },
    { label: "Last execution mode", value: <code className="font-mono text-xs text-neutral-700">{lastExecutionMode ?? "not recorded"}</code> },
    { label: "Last tool", value: lastToolName ?? "not recorded" },
    { label: "Last latency", value: typeof lastLatencyMs === "number" ? <span className="font-mono text-xs tabular-nums text-neutral-700">{lastLatencyMs}ms</span> : "not recorded" },
    { label: "Upstream status", value: typeof lastUpstreamStatus === "number" ? <span className="font-mono text-xs tabular-nums text-neutral-700">{lastUpstreamStatus}</span> : "not recorded" },
    { label: "Trace ID", value: <code className="font-mono text-xs text-neutral-700">{lastTraceId ?? "not recorded"}</code> },
    { label: "Error code", value: <code className="font-mono text-xs text-neutral-700">{lastErrorCode ?? "none"}</code> },
    { label: "Observability", value: <code className="font-mono text-xs text-neutral-700">{observabilityLabel}</code> },
    { label: "Rate limit mode", value: <code className="font-mono text-xs text-neutral-700">{rateLimitLabel}</code> },
    { label: "Missing auth", value: <code className="font-mono text-xs text-neutral-700">auth_required / oauth_required</code> },
    { label: "Missing mapping", value: <code className="font-mono text-xs text-neutral-700">mapping_required</code> },
  ];

  return (
    <section className="section-card">
      <div className="section-card-header">
        <h2 className="text-lg font-semibold text-neutral-950">Runtime behavior</h2>
        <span className={`pill ${runtimeHealth === "healthy" ? "pill-success" : runtimeHealth === "degraded" ? "pill-danger" : "pill-neutral"}`}>
          {runtimeHealth.replaceAll("_", " ")}
        </span>
      </div>
      <div className="text-sm">
        {rows.map((row) => (
          <div key={row.label} className="console-table-row flex items-center justify-between gap-4 py-2.5">
            <span className="text-neutral-500">{row.label}</span>
            <span className="text-right text-neutral-800">{row.value}</span>
          </div>
        ))}
      </div>
      <p className="mt-4 text-sm text-neutral-500">
        Astrail does not evaluate generated TypeScript inside Next.js. Hosted calls are routed through stored
        tool metadata and endpoint maps.
      </p>
    </section>
  );
}

function formatObservabilityStorage(storage: "tool_call_logs" | "structured_log" | "unavailable") {
  if (storage === "tool_call_logs") return "database logs";
  if (storage === "structured_log") return "structured fallback";
  return "not enabled";
}

function formatRateLimitMode(mode: string) {
  if (mode === "in_memory") return "standard";
  if (mode === "upstash" || mode === "redis") return "distributed";
  return mode.replaceAll("_", " ");
}
