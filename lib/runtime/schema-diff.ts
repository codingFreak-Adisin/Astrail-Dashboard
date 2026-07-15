import type { McpTool } from "../types";

// Deterministic tool-schema diffing for spec re-imports. When a customer's
// API contract changes, the diff tells a human exactly what moved before the
// hosted server is updated: added/removed tools, argument-level changes, and
// whether any change is breaking for agents already calling the server.

export type ToolChange = {
  name: string;
  breaking: boolean;
  changes: string[];
};

export type ToolSchemaDiff = {
  added: string[];
  removed: string[];
  changed: ToolChange[];
  unchanged: number;
  breaking: boolean;
  summary: string;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function schemaProperties(tool: McpTool): Record<string, unknown> {
  const schema = tool.input_schema;
  if (!isRecord(schema)) return {};
  return isRecord(schema.properties) ? schema.properties : {};
}

function requiredArguments(tool: McpTool): Set<string> {
  const schema = tool.input_schema;
  if (!isRecord(schema) || !Array.isArray(schema.required)) return new Set();
  return new Set(schema.required.filter((item): item is string => typeof item === "string"));
}

function propertyType(value: unknown) {
  return isRecord(value) && typeof value.type === "string" ? value.type : null;
}

function diffTool(previous: McpTool, next: McpTool): ToolChange | null {
  const changes: string[] = [];
  let breaking = false;

  const previousMethod = previous.method?.toUpperCase() ?? null;
  const nextMethod = next.method?.toUpperCase() ?? null;
  if (previousMethod !== nextMethod) {
    changes.push(`HTTP method changed from ${previousMethod ?? "none"} to ${nextMethod ?? "none"}.`);
    breaking = true;
  }
  if ((previous.path ?? null) !== (next.path ?? null)) {
    changes.push(`Upstream path changed from ${previous.path ?? "none"} to ${next.path ?? "none"}.`);
    breaking = true;
  }
  if (previous.description !== next.description) {
    changes.push("Description changed.");
  }

  const previousProperties = schemaProperties(previous);
  const nextProperties = schemaProperties(next);
  const previousRequired = requiredArguments(previous);
  const nextRequired = requiredArguments(next);

  for (const name of Object.keys(previousProperties)) {
    if (!(name in nextProperties)) {
      changes.push(`Argument "${name}" was removed.`);
      breaking = true;
    }
  }
  for (const name of Object.keys(nextProperties)) {
    if (!(name in previousProperties)) {
      const requiredNote = nextRequired.has(name) ? " (required — breaking for existing callers)" : "";
      changes.push(`Argument "${name}" was added${requiredNote}.`);
      if (nextRequired.has(name)) breaking = true;
      continue;
    }
    const previousType = propertyType(previousProperties[name]);
    const nextType = propertyType(nextProperties[name]);
    if (previousType !== nextType) {
      changes.push(`Argument "${name}" type changed from ${previousType ?? "unspecified"} to ${nextType ?? "unspecified"}.`);
      breaking = true;
    }
    if (!previousRequired.has(name) && nextRequired.has(name)) {
      changes.push(`Argument "${name}" became required.`);
      breaking = true;
    }
    if (previousRequired.has(name) && !nextRequired.has(name)) {
      changes.push(`Argument "${name}" became optional.`);
    }
  }

  if (changes.length === 0) return null;
  return { name: next.name, breaking, changes };
}

export function diffToolSchemas(previous: McpTool[], next: McpTool[]): ToolSchemaDiff {
  const previousByName = new Map(previous.map((tool) => [tool.name, tool]));
  const nextByName = new Map(next.map((tool) => [tool.name, tool]));

  const added = next.filter((tool) => !previousByName.has(tool.name)).map((tool) => tool.name);
  const removed = previous.filter((tool) => !nextByName.has(tool.name)).map((tool) => tool.name);
  const changed: ToolChange[] = [];
  let unchanged = 0;

  for (const [name, previousTool] of Array.from(previousByName.entries())) {
    const nextTool = nextByName.get(name);
    if (!nextTool) continue;
    const change = diffTool(previousTool, nextTool);
    if (change) changed.push(change);
    else unchanged += 1;
  }

  const breaking = removed.length > 0 || changed.some((change) => change.breaking);
  const parts = [
    added.length > 0 ? `${added.length} tool${added.length === 1 ? "" : "s"} added` : null,
    removed.length > 0 ? `${removed.length} removed` : null,
    changed.length > 0 ? `${changed.length} changed` : null,
    `${unchanged} unchanged`,
  ].filter(Boolean);

  return {
    added,
    removed,
    changed,
    unchanged,
    breaking,
    summary: `${parts.join(", ")}. ${breaking ? "Contains breaking changes: existing agent integrations may need updates." : "No breaking changes detected."}`,
  };
}

// Preserve owner-configured tool settings (policies, visibility, metadata)
// across a re-import so regenerating from an updated spec never silently
// resets approval requirements on tools that still exist.
export function carryOverToolConfiguration(previous: McpTool[], next: McpTool[]): McpTool[] {
  const previousByName = new Map(previous.map((tool) => [tool.name, tool]));
  return next.map((tool) => {
    const prior = previousByName.get(tool.name);
    if (!prior) return tool;
    return {
      ...tool,
      ...(prior.policy ? { policy: prior.policy } : {}),
      ...(prior.visibility ? { visibility: prior.visibility } : {}),
      ...(prior.metadata ? { metadata: { ...prior.metadata, ...(tool.metadata ?? {}) } } : {}),
    };
  });
}
