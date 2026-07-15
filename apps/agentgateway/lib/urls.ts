export function getPublicBaseUrl(requestUrl?: string | URL) {
  const configured = cleanUrl(process.env.NEXT_PUBLIC_APP_URL)
    ?? cleanUrl(process.env.NEXT_PUBLIC_SITE_URL);

  if (configured) return configured;
  if (requestUrl) return new URL(requestUrl).origin;
  if (process.env.VERCEL_URL) return `https://${process.env.VERCEL_URL}`;

  return "http://localhost:3000";
}

export function getRuntimeBaseUrl(requestUrl?: string | URL) {
  const configured = cleanUrl(process.env.NEXT_PUBLIC_RUNTIME_BASE_URL)
    ?? cleanUrl(process.env.ASTRAIL_RUNTIME_BASE_URL)
    ?? cleanUrl(process.env.NEXT_PUBLIC_APP_URL)
    ?? cleanUrl(process.env.NEXT_PUBLIC_SITE_URL);

  if (configured) return configured;
  if (requestUrl) return new URL(requestUrl).origin;
  if (process.env.VERCEL_URL) return `https://${process.env.VERCEL_URL}`;

  return "http://localhost:3000";
}

export function buildMcpEndpoint(serverId: string, requestUrl?: string | URL) {
  return `${getRuntimeBaseUrl(requestUrl)}/api/mcp/${serverId}`;
}

export function buildBundleEndpoint(bundleId: string, requestUrl?: string | URL) {
  return `${getRuntimeBaseUrl(requestUrl)}/api/mcp/bundles/${bundleId}`;
}

function cleanUrl(value: string | undefined) {
  const trimmed = value?.trim();
  if (!trimmed) return null;
  const withProtocol = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  return withProtocol.replace(/\/$/, "");
}
