import {
  decryptCredential,
  encryptCredential,
  hasCredentialEncryptionKey,
  oauthCredentialExpired,
  refreshOAuthAccessToken,
} from "../credentials";
import { localDemoUserId } from "../local-demo";
import { createAdminClient, hasServiceRoleKey } from "../supabase/server";
import type { McpServer, McpTool } from "../types";
import {
  findEndpointForTool,
  hasOAuthSecurityRequirement,
  hasSecurityRequirement,
  type RuntimeCredential,
} from "./execute-tool";

type CredentialRow = {
  id: string;
  auth_scheme: RuntimeCredential["scheme"];
  provider: string | null;
  client_id: string | null;
  client_secret_ciphertext: string | null;
  injection_name: string | null;
  scopes: unknown;
  secret_ciphertext: string;
  access_token_ciphertext: string | null;
  refresh_token_ciphertext: string | null;
  token_url: string | null;
  expires_at: string | null;
};

export async function loadRuntimeCredentialForTool(server: McpServer, tool: McpTool): Promise<RuntimeCredential | null> {
  if (server.user_id === localDemoUserId && process.env.ASTRAIL_ENABLE_LOCAL_SECURITY_FIXTURES === "1") {
    const endpoint = findEndpointForTool(server, tool);
    if (!endpoint || !hasSecurityRequirement(endpoint)) return null;
    if (process.env.ASTRAIL_LOCAL_PROVIDER_CREDENTIALS_DISABLED === "1") return null;
    return {
      scheme: "api_key_query",
      injectionName: "api_key",
      secret: process.env.ASTRAIL_LOCAL_PROVIDER_SECRET ?? "local_provider_secret",
    };
  }

  if (!hasServiceRoleKey() || !hasCredentialEncryptionKey()) return null;
  const endpoint = findEndpointForTool(server, tool);
  if (!endpoint) return null;
  const isMcpProxy = endpoint.runtime_kind === "mcp_proxy" || endpoint.method.toUpperCase() === "MCP_PROXY";
  if (!isMcpProxy && !hasSecurityRequirement(endpoint)) return null;
  const requiresOAuth = hasOAuthSecurityRequirement(endpoint);

  try {
    const admin = createAdminClient();
    const { data, error } = await admin
      .from("api_credentials")
      .select("id,auth_scheme,provider,client_id,client_secret_ciphertext,injection_name,scopes,secret_ciphertext,access_token_ciphertext,refresh_token_ciphertext,token_url,expires_at")
      .eq("user_id", server.user_id)
      .eq("server_id", server.id)
      .order("created_at", { ascending: false })
      .limit(8);

    if (error || !data || data.length === 0) return null;
    const credentials = data as CredentialRow[];
    const credential = credentials.find((item) =>
      requiresOAuth ? item.auth_scheme === "oauth2" : item.auth_scheme !== "oauth2"
    ) ?? credentials[0];

    if (credential.auth_scheme === "oauth2") {
      const accessTokenCiphertext = credential.access_token_ciphertext ?? credential.secret_ciphertext;
      if (!accessTokenCiphertext) return null;
      if (oauthCredentialExpired(credential.expires_at)) {
        if (!credential.refresh_token_ciphertext || !credential.token_url) return null;
        const refreshed = await refreshOAuthAccessToken({
          provider: credential.provider ?? "oauth",
          tokenUrl: credential.token_url,
          clientId: credential.client_id,
          clientSecret: credential.client_secret_ciphertext ? decryptCredential(credential.client_secret_ciphertext) : null,
          refreshToken: decryptCredential(credential.refresh_token_ciphertext),
          scopes: Array.isArray(credential.scopes) ? credential.scopes.filter((item): item is string => typeof item === "string") : [],
        });
        const encryptedAccessToken = encryptCredential(refreshed.accessToken);
        await admin.from("api_credentials").update({
          secret_ciphertext: encryptedAccessToken,
          access_token_ciphertext: encryptedAccessToken,
          refresh_token_ciphertext: refreshed.refreshToken ? encryptCredential(refreshed.refreshToken) : credential.refresh_token_ciphertext,
          scopes: refreshed.scopes,
          expires_at: refreshed.expiresAt,
          updated_at: new Date().toISOString(),
        }).eq("id", credential.id).eq("user_id", server.user_id);
        return { scheme: "oauth2", secret: refreshed.accessToken };
      }
      return { scheme: "oauth2", secret: decryptCredential(accessTokenCiphertext) };
    }

    return {
      scheme: credential.auth_scheme,
      injectionName: credential.injection_name,
      secret: decryptCredential(credential.secret_ciphertext),
    };
  } catch {
    return null;
  }
}
