import { createHash, createHmac, timingSafeEqual } from "crypto";

const SENSITIVE_HEADER_PATTERN = /(^|[-_])(authorization|cookie|token|secret|api[-_]?key)([-_]|$)/i;

export function isSensitiveWebhookHeader(name: string) {
  return SENSITIVE_HEADER_PATTERN.test(name.trim());
}

function signedWebhookMessage(raw: string, eventId?: string | null) {
  return eventId ? `${eventId}.${raw}` : raw;
}

export function signWebhookPayload(raw: string, secret: string, eventId?: string | null) {
  return createHmac("sha256", secret).update(signedWebhookMessage(raw, eventId)).digest("hex");
}

export function verifyWebhookSignature(raw: string, supplied: string, secret: string, eventId?: string | null) {
  const normalized = supplied.trim().replace(/^sha256=/i, "");
  if (!/^[a-f0-9]{64}$/i.test(normalized)) return false;
  return timingSafeEqual(Buffer.from(normalized, "hex"), Buffer.from(signWebhookPayload(raw, secret, eventId), "hex"));
}

export function webhookEventId(raw: string, supplied?: string | null) {
  return (supplied || createHash("sha256").update(raw).digest("hex")).slice(0, 240);
}

export async function readBoundedRequestText(request: Request, maxBytes: number) {
  if (!request.body) return "";
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      totalBytes += value.byteLength;
      if (totalBytes > maxBytes) {
        await reader.cancel();
        return null;
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const body = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(body);
}
