import assert from "node:assert/strict";
import { createServer } from "node:http";
import { spawn } from "node:child_process";

const server = createServer(async (request, response) => {
  let body = "";
  for await (const chunk of request) body += chunk;
  const rpc = JSON.parse(body);
  const result = rpc.method === "initialize"
    ? { serverInfo: { name: "CLI smoke", version: "1" }, capabilities: { tools: {} } }
    : rpc.method === "tools/list"
      ? { tools: [{ name: "hello", description: "Say hello", inputSchema: { type: "object" } }] }
      : rpc.method === "tools/call"
        ? { content: [{ type: "text", text: `hello ${rpc.params.arguments.name}` }] }
        : { resumed: rpc.params.execution_id };
  response.writeHead(200, { "content-type": "application/json" });
  response.end(JSON.stringify({ jsonrpc: "2.0", id: rpc.id, result }));
});

await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const address = server.address();
const endpoint = `http://127.0.0.1:${address.port}/mcp`;

async function run(args, input = null) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ["bin/astrail.mjs", ...args, "--endpoint", endpoint], { cwd: process.cwd() });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("error", reject);
    child.on("close", (code) => code === 0 ? resolve(stdout) : reject(new Error(stderr)));
    if (input !== null) child.stdin.end(input); else child.stdin.end();
  });
}

try {
  assert.match(await run(["status"]), /CLI smoke/);
  assert.match(await run(["tools", "search", "--query", "hello"]), /Say hello/);
  assert.match(await run(["call", "hello", "--args", '{"name":"Astrail"}']), /hello Astrail/);
  assert.match(await run(["resume", "approval-1"]), /approval-1/);
  assert.match(await run(["mcp"], '{"jsonrpc":"2.0","id":7,"method":"tools/list","params":{}}\n'), /"id":7/);
  console.log("PASS: Astrail CLI status, discovery, call, resume, and stdio bridge.");
} finally {
  server.close();
}
