type StructuredLogPrimitive = string | number | boolean | null;
type StructuredLogValue = StructuredLogPrimitive | StructuredLogValue[] | { [key: string]: StructuredLogValue };

const REDACTED = "[redacted]";
const MAX_LOG_STRING_LENGTH = 2_048;
const MAX_LOG_DEPTH = 8;

const SENSITIVE_KEY_PATTERN =
  /(^|[-_\s])(api[-_]?key|authorization|bearer|client[-_]?secret|cookie|credential|password|private[-_]?key|refresh[-_]?token|secret|session|signature|token)([-_\s]|$)/i;
const BEARER_PATTERN = /\bBearer\s+[A-Za-z0-9._~+/=-]+/gi;
const SECRET_ASSIGNMENT_PATTERN =
  /\b(api[-_]?key|access[-_]?token|authorization|bearer|client[-_]?secret|cookie|credential|password|private[-_]?key|refresh[-_]?token|secret|session|signature|token)\s*[:=]\s*["']?([^&\s"',}]+)/gi;
const SECRET_QUERY_PATTERN =
  /([?&](?:api[-_]?key|access[-_]?token|authorization|bearer|client[-_]?secret|cookie|credential|password|private[-_]?key|refresh[-_]?token|secret|session|signature|token)=)([^&#\s]+)/gi;
const COMMON_SECRET_PATTERN =
  /\b(sk-[A-Za-z0-9_-]{8,}|gh[pousr]_[A-Za-z0-9_]{12,}|xox[baprs]-[A-Za-z0-9-]{12,}|AIza[0-9A-Za-z_-]{16,})\b/g;

function truncateLogString(value: string) {
  if (value.length <= MAX_LOG_STRING_LENGTH) return value;
  return `${value.slice(0, MAX_LOG_STRING_LENGTH)}...[truncated]`;
}

export function redactLogText(value: string) {
  return truncateLogString(value)
    .replace(BEARER_PATTERN, "Bearer [redacted]")
    .replace(SECRET_ASSIGNMENT_PATTERN, (_match, key) => `${key}=[redacted]`)
    .replace(SECRET_QUERY_PATTERN, (_match, prefix) => `${prefix}${REDACTED}`)
    .replace(COMMON_SECRET_PATTERN, REDACTED);
}

export function sanitizeStructuredLog<T>(value: T, seen = new WeakSet<object>(), depth = 0): T {
  if (typeof value === "string") return redactLogText(value) as T;
  if (typeof value === "number" || typeof value === "boolean" || value === null || value === undefined) return value;
  if (typeof value !== "object") return String(value) as T;
  if (seen.has(value)) return "[circular]" as T;
  if (depth >= MAX_LOG_DEPTH) return "[max_depth]" as T;
  seen.add(value);

  if (Array.isArray(value)) {
    return value.map((item) => sanitizeStructuredLog(item, seen, depth + 1)) as T;
  }

  const output: Record<string, unknown> = {};
  for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
    output[key] = SENSITIVE_KEY_PATTERN.test(key)
      ? REDACTED
      : sanitizeStructuredLog(nested, seen, depth + 1);
  }
  return output as T;
}

export function writeStructuredLog(payload: Record<string, unknown>) {
  console.info(JSON.stringify(sanitizeStructuredLog(payload) as StructuredLogValue));
}

export function sanitizeToolLogRecord<T extends Record<string, unknown>>(record: T): T {
  return sanitizeStructuredLog(record);
}

export function auditMcpSecurityEvent(payload: Record<string, unknown>) {
  const traceId = typeof payload.trace_id === "string" && payload.trace_id.trim()
    ? payload.trace_id
    : createMcpAuditTraceId();
  const event = sanitizeStructuredLog({
    event: "astrail.mcp_security",
    timestamp: new Date().toISOString(),
    ...payload,
    trace_id: traceId,
  });
  writeStructuredLog(event);
  return event as Record<string, unknown> & { trace_id: string };
}

export function createMcpAuditTraceId() {
  return `sec_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}
