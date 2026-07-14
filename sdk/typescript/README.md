# Astrail TypeScript SDK

TypeScript client for Astrail hosted MCP endpoints.

Use it when your app or agent runtime wants a small typed wrapper around Astrail's JSON-RPC MCP endpoint.

## Install

```bash
npm install @astrail/sdk
```

## Quickstart

```ts
import { AstrailClient } from "@astrail/sdk";

const astrail = new AstrailClient({
  baseUrl: "https://your-app.com",
  serverId: "SERVER_ID",
  apiKey: process.env.ASTRAIL_API_KEY,
});

await astrail.initialize();
const tools = await astrail.listTools();

const status = await astrail.callEndpoint("get_status", { limit: 10 });

const rawTool = await astrail.callToolRaw("tools/list");

const docs = await astrail.searchDocs({
  query: "list active incidents",
  operation: "read",
  detail: "compact",
  limit: 5,
});

const result = await astrail.execute({
  code: `async function run(client) {
    return await client.incidents.list({ status: "active" });
  }`,
  result_mode: "compact",
});
```

## Raw JSON-RPC

```ts
const endpoint = "https://your-app.vercel.app/api/mcp/SERVER_ID";

const initialize = await fetch(endpoint, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} }),
}).then((response) => response.json());

const tools = await fetch(endpoint, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} }),
}).then((response) => response.json());
```

## Surface

- `initialize()`
- `listTools()`
- `callEndpoint(endpointId, args, options)`
- `callTool(name, args)`
- `callToolRaw(name, args)`
- `searchDocs(queryOrArgs)`
- `execute(codeOrArgs)`
- `rpc(method, params)`

## Astrail Code Mode

Code Mode endpoints expose two tools:

- `search_docs`: ranks SDK-shaped methods and returns endpoint docs, argument fields, required fields, auth requirements, pagination hints, response hints, and examples. Detail modes are `compact`, `schema`, `examples`, and `auth`.
- `execute`: accepts SDK-shaped TypeScript such as `await client.customers.list({ limit: 10 })`.

Hosted Astrail execution does not eval arbitrary JavaScript. It statically extracts supported `client.resource.method(...)` calls and routes them through the stored endpoint map.

## Generated SDK Bundles

Dashboard SDK exports include per-server TypeScript and Python clients with named resource helpers:

```ts
const client = new PetstoreClient({
  endpoint: "https://your-app.com/api/mcp/SERVER_ID",
  apiKey: process.env.ASTRAIL_API_KEY,
});

await client.pets.getPetById({ petId: "pet_123" });
```

The package SDK is the stable low-level runtime client. Generated bundles add server-specific endpoint catalogs, method names, docs, tests, manifests, and CI scaffolds on top.

## Roadmap

- framework adapters for OpenAI Agents, Claude, LangChain, and Mastra
- streaming transport support when the hosted runtime adds it
