import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

export class NetworkPolicyError extends Error {
  code: string;

  constructor(message: string, code = "upstream_url_blocked") {
    super(message);
    this.name = "NetworkPolicyError";
    this.code = code;
  }
}

function ipv4Parts(value: string) {
  const parts = value.split(".").map((part) => Number(part));
  return parts.length === 4 && parts.every((part) => Number.isInteger(part) && part >= 0 && part <= 255)
    ? parts
    : null;
}

export function isBlockedRuntimeHostname(hostname: string) {
  const lower = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  const ipVersion = isIP(lower);

  if (ipVersion === 4) {
    const parts = ipv4Parts(lower);
    if (!parts) return true;
    const [first, second] = parts;
    return (
      first === 0 ||
      first === 10 ||
      first === 127 ||
      (first === 100 && second >= 64 && second <= 127) ||
      (first === 169 && second === 254) ||
      (first === 172 && second >= 16 && second <= 31) ||
      (first === 192 && second === 168) ||
      (first === 198 && (second === 18 || second === 19)) ||
      first >= 224
    );
  }

  if (ipVersion === 6) {
    return (
      lower === "::" ||
      lower === "::1" ||
      lower.startsWith("fc") ||
      lower.startsWith("fd") ||
      lower.startsWith("fe80:") ||
      lower.startsWith("::ffff:0.") ||
      lower.startsWith("::ffff:10.") ||
      lower.startsWith("::ffff:127.") ||
      lower.startsWith("::ffff:169.254.") ||
      lower.startsWith("::ffff:172.16.") ||
      lower.startsWith("::ffff:172.17.") ||
      lower.startsWith("::ffff:172.18.") ||
      lower.startsWith("::ffff:172.19.") ||
      lower.startsWith("::ffff:172.2") ||
      lower.startsWith("::ffff:172.30.") ||
      lower.startsWith("::ffff:172.31.") ||
      lower.startsWith("::ffff:192.168.")
    );
  }

  return (
    lower === "localhost" ||
    lower === "0.0.0.0" ||
    lower.endsWith(".local")
  );
}

export function assertPublicHttpUrl(url: URL) {
  if (!["http:", "https:"].includes(url.protocol)) {
    throw new NetworkPolicyError("Only public http/https upstream URLs are supported.", "upstream_protocol_blocked");
  }

  if (isBlockedRuntimeHostname(url.hostname)) {
    throw new NetworkPolicyError("Upstream URL points to a blocked private or local network target.");
  }
}

export async function assertSafeUpstreamUrl(url: URL) {
  assertPublicHttpUrl(url);

  if (isIP(url.hostname.replace(/^\[|\]$/g, ""))) return;

  let addresses: Array<{ address: string }> = [];
  try {
    addresses = await lookup(url.hostname, { all: true, verbatim: true });
  } catch {
    throw new NetworkPolicyError("Could not resolve upstream hostname.", "upstream_dns_failed");
  }

  if (addresses.length === 0 || addresses.some((item) => isBlockedRuntimeHostname(item.address))) {
    throw new NetworkPolicyError("Upstream hostname resolves to a blocked private or local network target.");
  }
}

export async function readBoundedResponseText(response: Response, maxBytes: number, label = "Upstream response") {
  const contentLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(contentLength) && contentLength > maxBytes) {
    throw new Error(`${label} exceeded ${maxBytes} bytes.`);
  }
  if (!response.body) return "";

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      totalBytes += value.byteLength;
      if (totalBytes > maxBytes) {
        await reader.cancel();
        throw new Error(`${label} exceeded ${maxBytes} bytes.`);
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
