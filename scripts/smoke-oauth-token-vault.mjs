import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import vm from "node:vm";
import ts from "typescript";

const root = process.cwd();
const nodeRequire = createRequire(import.meta.url);

function loadTsModule(relativePath, requireMap = {}) {
  const source = readFileSync(join(root, relativePath), "utf8");
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      esModuleInterop: true,
    },
    fileName: relativePath,
  });
  const module = { exports: {} };
  const context = vm.createContext({
    AbortSignal,
    Buffer,
    URL,
    URLSearchParams,
    console,
    fetch,
    module,
    exports: module.exports,
    process,
    require(id) {
      if (id in requireMap) return requireMap[id];
      return nodeRequire(id);
    },
    setTimeout,
    clearTimeout,
  });
  vm.runInContext(outputText, context, { filename: relativePath });
  return module.exports;
}

process.env.CREDENTIAL_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString("hex");

const networkPolicy = loadTsModule("lib/runtime/network-policy.ts");
const credentials = loadTsModule("lib/credentials.ts", {
  "@/lib/runtime/network-policy": networkPolicy,
});
const ciphertext = credentials.encryptCredential("oauth-access-token");
assert.notEqual(ciphertext, "oauth-access-token");
assert.equal(credentials.decryptCredential(ciphertext), "oauth-access-token");
assert.equal(credentials.oauthCredentialExpired(new Date(Date.now() - 10_000).toISOString()), true);
assert.equal(credentials.oauthCredentialExpired(new Date(Date.now() + 10 * 60_000).toISOString()), false);

const refreshed = await credentials.refreshOAuthAccessToken({
  provider: "example",
  tokenUrl: "https://example.com/oauth/token",
  clientId: "client_123",
  clientSecret: "client_secret",
  refreshToken: "refresh_123",
  scopes: ["read", "write"],
}, async (_url, init) => {
  assert.equal(init.method, "POST");
  assert.match(String(init.body), /grant_type=refresh_token/);
  assert.match(String(init.body), /refresh_token=refresh_123/);
  return new Response(JSON.stringify({
    access_token: "new_access",
    refresh_token: "new_refresh",
    expires_in: 3600,
    scope: "read write",
  }), { status: 200, headers: { "content-type": "application/json" } });
});
assert.equal(refreshed.accessToken, "new_access");
assert.equal(refreshed.refreshToken, "new_refresh");
assert.equal(JSON.stringify(refreshed.scopes), JSON.stringify(["read", "write"]));
assert.ok(refreshed.expiresAt);

await assert.rejects(
  credentials.refreshOAuthAccessToken({
    provider: "example",
    tokenUrl: "http://127.0.0.1/oauth/token",
    refreshToken: "refresh_123",
  }, async () => {
    throw new Error("blocked token URL should not be fetched");
  }),
  /HTTPS|blocked|public/i,
);

const permissions = loadTsModule("lib/runtime/permissions.ts");
const runtime = loadTsModule("lib/runtime/execute-tool.ts", {
  "@/lib/runtime/network-policy": networkPolicy,
  "@/lib/runtime/playwright-website": {
    executeWebsiteReadWithPlaywright: async () => {
      throw new Error("not used");
    },
    isBlockedWebsiteHostname: () => false,
  },
  "@/lib/runtime/permissions": permissions,
});

const server = {
  id: "srv_oauth",
  user_id: "user_1",
  name: "OAuth Test Server",
  description: "test",
  source_url: null,
  source_type: "openapi_url",
  generated_code: null,
  tools_json: [{ name: "list_items", description: "List items", input_schema: { type: "object", properties: {} }, method: "GET", path: "/items" }],
  endpoint_map: [{
    method: "GET",
    path: "/items",
    base_url: "https://api.example.test",
    tool_name: "list_items",
    operation_id: "list_items",
    summary: "List items",
    description: "List items",
    parameters: [],
    requires_auth: true,
    security_requirements: [{ oauth2: ["items.read"] }],
  }],
  hosted_endpoint: null,
  is_public: true,
  call_count: 0,
  created_at: new Date().toISOString(),
};

const missingOAuth = await runtime.executeToolFromEndpointMap(server, server.tools_json[0], {});
assert.equal(missingOAuth.status, "oauth_required");
assert.equal(missingOAuth.errorCode, "oauth_required");
const payload = JSON.parse(missingOAuth.mcpResult.content[0].text);
assert.equal(payload.status, "oauth_required");
assert.equal(payload.setup.credential_type, "oauth2");

console.log("PASS: OAuth token vault encryption, expiry, refresh, and missing-runtime response are covered.");
