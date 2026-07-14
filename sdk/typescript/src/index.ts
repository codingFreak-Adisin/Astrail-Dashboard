export type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | { [key: string]: JsonValue };

export type ToolArguments = Record<string, JsonValue>;

export type AstrailClientOptions = {
  endpoint?: string;
  baseUrl?: string;
  serverId?: string;
  apiKey?: string;
  fetch?: typeof fetch;
  timeoutMs?: number;
  headers?: Record<string, string>;
};

export type JsonRpcResponse<T> = {
  jsonrpc: "2.0";
  id: number;
  result?: T;
  error?: {
    code: number;
    message: string;
    data?: unknown;
  };
};

export type McpTool = {
  name: string;
  description?: string;
  inputSchema?: Record<string, unknown>;
  input_schema?: Record<string, unknown>;
  annotations?: Record<string, unknown>;
};

export type ToolCallContent = {
  type: "text";
  text: string;
};

export type ToolCallResult = {
  content?: ToolCallContent[];
  structuredContent?: unknown;
  isError?: boolean;
};

export type SearchDocsArgs = {
  query: string;
  resource?: string;
  operation?: "read" | "write" | "destructive";
  detail?: "compact" | "schema" | "examples" | "auth";
  limit?: number;
};

export type ExecuteArgs = {
  code: string;
  result_mode?: "compact" | "full";
};

export class AstrailError extends Error {
  code: number;
  data: unknown;
  status: number | null;

  constructor(message: string, code: number, data?: unknown, status: number | null = null) {
    super(message);
    this.name = "AstrailError";
    this.code = code;
    this.data = data;
    this.status = status;
  }
}

export class AstrailClient {
  private endpoint: string;
  private apiKey?: string;
  private fetchImpl: typeof fetch;
  private timeoutMs: number;
  private headers: Record<string, string>;
  private nextId = 1;

  constructor(options: AstrailClientOptions) {
    const endpoint = options.endpoint ?? endpointFromServer(options);
    if (!endpoint || !(/^(https?:)?\/\//.test(endpoint) || endpoint.startsWith("/"))) {
      throw new Error("AstrailClient requires an endpoint or baseUrl + serverId.");
    }
    this.endpoint = endpoint;
    this.apiKey = options.apiKey ?? defaultApiKey();
    this.fetchImpl = options.fetch ?? fetch;
    this.timeoutMs = options.timeoutMs ?? 30_000;
    this.headers = options.headers ?? {};
  }

  async initialize() {
    return this.rpc("initialize", {});
  }

  async listTools() {
    const result = await this.rpc<{ tools: McpTool[] }>("tools/list", {});
    return result.tools;
  }

  async callToolRaw(name: string, args: ToolArguments = {}) {
    return this.rpc<ToolCallResult>("tools/call", {
      name,
      arguments: args,
    });
  }

  async callTool<T = unknown>(name: string, args: ToolArguments = {}) {
    const result = await this.callToolRaw(name, args);
    return parseToolResult<T>(result);
  }

  async callEndpoint<T = unknown>(
    endpointId: string,
    args: ToolArguments = {},
    options: { toolName?: string; dynamic?: boolean } = {},
  ) {
    if (options.toolName && options.dynamic === false) {
      return this.callTool<T>(options.toolName, args);
    }
    if (options.toolName) {
      try {
        return await this.callTool<T>("invoke_api_endpoint", { endpoint_id: endpointId, arguments: args });
      } catch (error) {
        if (error instanceof AstrailError && error.code === -32601) {
          return this.callTool<T>(options.toolName, args);
        }
        throw error;
      }
    }
    return this.callTool<T>("invoke_api_endpoint", { endpoint_id: endpointId, arguments: args });
  }

  async searchDocs(args: string | SearchDocsArgs) {
    return this.callTool("search_docs", typeof args === "string" ? { query: args } : toToolArguments(args));
  }

  async execute(args: string | ExecuteArgs) {
    return this.callTool("execute", typeof args === "string" ? { code: args } : toToolArguments(args));
  }

  async rpc<T>(method: string, params: Record<string, unknown>) {
    const id = this.nextId;
    this.nextId += 1;
    const controller = typeof AbortController !== "undefined" ? new AbortController() : null;
    const timeout = controller && this.timeoutMs > 0
      ? setTimeout(() => controller.abort(), this.timeoutMs)
      : null;

    let response: Response;
    try {
      response = await this.fetchImpl(this.endpoint, {
        method: "POST",
        headers: {
          ...this.headers,
          "content-type": "application/json",
          ...(this.apiKey ? { authorization: `Bearer ${this.apiKey}` } : {}),
        },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id,
          method,
          params,
        }),
        ...(controller ? { signal: controller.signal } : {}),
      });
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") {
        throw new AstrailError(`Astrail request timed out after ${this.timeoutMs}ms.`, -32000);
      }
      throw error;
    } finally {
      if (timeout) clearTimeout(timeout);
    }

    const raw = await response.text();
    let payload: JsonRpcResponse<T> | null = null;
    try {
      payload = raw ? JSON.parse(raw) as JsonRpcResponse<T> : null;
    } catch {
      throw new AstrailError(`Astrail returned a non-JSON response with HTTP ${response.status}.`, response.status, raw.slice(0, 500), response.status);
    }
    if (!payload) {
      throw new AstrailError(`Astrail returned an empty response with HTTP ${response.status}.`, response.status, undefined, response.status);
    }
    if (!response.ok || payload.error) {
      throw new AstrailError(
        payload.error?.message ?? `Astrail request failed with HTTP ${response.status}.`,
        payload.error?.code ?? response.status,
        payload.error?.data,
        response.status,
      );
    }
    if (payload.result === undefined) {
      throw new AstrailError("Astrail returned an empty JSON-RPC result.", -32603, undefined, response.status);
    }
    return payload.result;
  }
}

export function parseToolResult<T = unknown>(result: ToolCallResult): T {
  if (result.structuredContent !== undefined) return result.structuredContent as T;
  const content = Array.isArray(result.content) ? result.content : [];
  const text = content.find((item) => item.type === "text")?.text ?? "";
  try {
    return JSON.parse(text) as T;
  } catch {
    return text as T;
  }
}

function toToolArguments(value: Record<string, unknown>): ToolArguments {
  return Object.fromEntries(
    Object.entries(value).filter((entry): entry is [string, JsonValue] => entry[1] !== undefined && isJsonValue(entry[1]))
  );
}

function isJsonValue(value: unknown): value is JsonValue {
  if (value === null) return true;
  if (["string", "number", "boolean"].includes(typeof value)) return true;
  if (Array.isArray(value)) return value.every(isJsonValue);
  if (typeof value === "object") return Object.values(value as Record<string, unknown>).every(isJsonValue);
  return false;
}

function defaultApiKey() {
  const env = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env;
  return env?.ASTRAIL_API_KEY;
}

function endpointFromServer(options: AstrailClientOptions) {
  if (!options.serverId) return undefined;
  const baseUrl = (options.baseUrl ?? "").replace(/\/$/, "");
  return `${baseUrl}/api/mcp/${encodeURIComponent(options.serverId)}`;
}

export function createAstrailClient(options: AstrailClientOptions) {
  return new AstrailClient(options);
}
