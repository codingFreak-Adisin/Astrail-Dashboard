import { parseSpecText } from "./openapi";
import { discoverOpenApiSpec } from "./spec-discovery";
import type { SourceType } from "./types";

export type LoadedSpecInput = {
  inputUrl: string | null;
  parsedSpec: unknown;
  sourceUrl: string | null;
  discoveryMethod: string | null;
  specSizeBytes: number;
  diagnostics: string[];
};

export async function loadSpecInput(input: {
  sourceType: SourceType;
  sourceUrl?: string;
  rawJson?: string;
}): Promise<LoadedSpecInput> {
  const diagnostics: string[] = [];

  if (input.sourceType === "json_paste") {
    if (!input.rawJson) throw new Error("Raw OpenAPI, Swagger, or Google Discovery JSON/YAML is required.");
    diagnostics.push("Input type: raw OpenAPI/Swagger/Google Discovery JSON/YAML paste or uploaded file.");
    return {
      inputUrl: null,
      parsedSpec: parseSpecText(input.rawJson),
      sourceUrl: null,
      discoveryMethod: "json_paste",
      specSizeBytes: Buffer.byteLength(input.rawJson, "utf8"),
      diagnostics,
    };
  }

  if (!input.sourceUrl) throw new Error("API docs, OpenAPI, Swagger, or Google Discovery URL is required.");
  const discovery = await discoverOpenApiSpec(input.sourceUrl);
  diagnostics.push(...discovery.diagnostics);

  if (discovery.status !== "found" || !discovery.spec_raw || !discovery.spec_format) {
    const error = new Error("No OpenAPI/Swagger/Google Discovery spec found automatically. Paste a direct spec URL or raw JSON.");
    error.name = "SpecDiscoveryError";
    throw Object.assign(error, { diagnostics });
  }

  return {
    inputUrl: input.sourceUrl,
    parsedSpec: parseSpecText(discovery.spec_raw, discovery.spec_format),
    sourceUrl: discovery.discovered_url ?? input.sourceUrl,
    discoveryMethod: discovery.discovery_method ?? null,
    specSizeBytes: Buffer.byteLength(discovery.spec_raw, "utf8"),
    diagnostics,
  };
}
