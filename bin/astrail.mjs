#!/usr/bin/env node

import { createInterface } from "node:readline";

const argv = process.argv.slice(2);

function option(name, fallback) {
  const index = argv.indexOf(`--${name}`);
  return index >= 0 ? argv[index + 1] : fallback;
}

function positional() {
  const valueOptions = new Set(["endpoint", "api-key", "args", "query", "execution-id"]);
  const values = [];
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value.startsWith("--")) {
      if (valueOptions.has(value.slice(2))) index += 1;
      continue;
    }
    values.push(value);
  }
  return values;
}

const [command = "help", subcommand, name] = positional();
const endpoint = option("endpoint", process.env.ASTRAIL_MCP_ENDPOINT);
const apiKey = option("api-key", process.env.ASTRAIL_API_KEY);

function help() {
  process.stdout.write(`Astrail CLI

Usage:
  astrail status --endpoint URL [--api-key KEY]
  astrail tools list|search|describe [NAME] --endpoint URL [--query TEXT]
  astrail call TOOL --endpoint URL [--args JSON]
  astrail resume EXECUTION_ID --endpoint URL
  astrail mcp --endpoint URL
  astrail config --endpoint URL

Environment: ASTRAIL_MCP_ENDPOINT, ASTRAIL_API_KEY
`);
}

function requireEndpoint() {
  if (!endpoint) throw new Error("Set --endpoint or ASTRAIL_MCP_ENDPOINT.");
  return new URL(endpoint).toString();
}

async function rpc(method, params = {}, id = 1) {
  const response = await fetch(requireEndpoint(), {
    method: "POST",
    headers: {
      accept: "application/json, text/event-stream",
      "content-type": "application/json",
      ...(apiKey ? { authorization: `Bearer ${apiKey}` } : {}),
    },
    body: JSON.stringify({ jsonrpc: "2.0", id, method, params }),
    redirect: "manual",
    signal: AbortSignal.timeout(30_000),
  });
  const text = await response.text();
  if (response.status === 204 || !text.trim()) return null;
  let payload;
  try {
    payload = JSON.parse(text);
  } catch {
    const data = text.split(/\r?\n/).find((line) => line.startsWith("data:"));
    if (!data) throw new Error(`MCP endpoint returned HTTP ${response.status} with a non-JSON body.`);
    payload = JSON.parse(data.slice(5).trim());
  }
  if (!response.ok || payload.error) throw new Error(payload.error?.message ?? `MCP endpoint returned HTTP ${response.status}.`);
  return payload;
}

function print(value) {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

async function main() {
  if (command === "help" || command === "--help" || command === "-h") return help();
  if (command === "status") {
    const initialized = await rpc("initialize", { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "astrail-cli", version: "0.1.0" } });
    return print({ status: "connected", endpoint: requireEndpoint(), server: initialized.result?.serverInfo, capabilities: initialized.result?.capabilities });
  }
  if (command === "tools") {
    const tools = (await rpc("tools/list")).result?.tools ?? [];
    if (subcommand === "list") return print(tools);
    if (subcommand === "search") {
      const query = (option("query", name) ?? "").toLowerCase();
      return print(tools.filter((tool) => `${tool.name} ${tool.description ?? ""}`.toLowerCase().includes(query)));
    }
    if (subcommand === "describe") {
      const tool = tools.find((item) => item.name === name);
      if (!tool) throw new Error(`Tool not found: ${name ?? ""}`);
      return print(tool);
    }
    throw new Error("Use tools list, tools search, or tools describe.");
  }
  if (command === "call") {
    if (!subcommand) throw new Error("Tool name is required.");
    const rawArgs = option("args", "{}");
    let args;
    try { args = JSON.parse(rawArgs); } catch { throw new Error("--args must be valid JSON."); }
    return print((await rpc("tools/call", { name: subcommand, arguments: args })).result);
  }
  if (command === "resume") {
    if (!subcommand) throw new Error("Execution ID is required.");
    return print((await rpc("astrail/resume", { execution_id: subcommand })).result);
  }
  if (command === "config") {
    return print({ mcpServers: { astrail: { command: "astrail", args: ["mcp", "--endpoint", requireEndpoint()], env: apiKey ? { ASTRAIL_API_KEY: "<set securely>" } : {} } } });
  }
  if (command === "mcp") {
    requireEndpoint();
    const input = createInterface({ input: process.stdin, crlfDelay: Infinity });
    for await (const line of input) {
      if (!line.trim()) continue;
      try {
        const request = JSON.parse(line);
        const response = await rpc(request.method, request.params ?? {}, request.id);
        if (response) process.stdout.write(`${JSON.stringify(response)}\n`);
      } catch (error) {
        process.stdout.write(`${JSON.stringify({ jsonrpc: "2.0", id: null, error: { code: -32603, message: error instanceof Error ? error.message : "CLI bridge error." } })}\n`);
      }
    }
    return;
  }
  throw new Error(`Unknown command: ${command}`);
}

main().catch((error) => {
  process.stderr.write(`astrail: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
