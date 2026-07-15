import type { FieldMappingRule, ResponseFieldRule, ServerFieldMappings } from "../types";

// Per-server field mapping reconciles a customer's quirky upstream schema
// (renamed CRM fields, tenant-specific enum labels, constant defaults) without
// regenerating tools or forking connector code. Rules are declarative data,
// applied deterministically — no eval, no templates.

const MAX_RULES = 100;
const MAX_VALUE_MAP_ENTRIES = 100;
const MAX_NAME_LENGTH = 256;
const MAX_RESPONSE_PATH_DEPTH = 8;
const UNSAFE_PROPERTY_NAMES = new Set(["__proto__", "prototype", "constructor"]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function normalizedName(value: unknown) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > MAX_NAME_LENGTH) return null;
  return trimmed;
}

function safePropertyName(value: unknown) {
  const name = normalizedName(value);
  return name && !UNSAFE_PROPERTY_NAMES.has(name) ? name : null;
}

function normalizeArgumentRule(value: unknown): FieldMappingRule | null {
  if (!isRecord(value)) return null;
  const argument = safePropertyName(value.argument);
  if (!argument) return null;

  const rule: FieldMappingRule = { argument };
  const tool = normalizedName(value.tool);
  if (tool) rule.tool = tool;
  const upstreamName = safePropertyName(value.upstream_name);
  if (upstreamName) rule.upstream_name = upstreamName;
  if (value.drop === true) rule.drop = true;
  if ("default" in value && value.default !== undefined) rule.default = value.default;
  if (isRecord(value.value_map)) {
    const entries = Object.entries(value.value_map).slice(0, MAX_VALUE_MAP_ENTRIES);
    if (entries.length > 0) rule.value_map = Object.fromEntries(entries);
  }
  const note = normalizedName(value.note);
  if (note) rule.note = note;
  return rule;
}

function normalizeResponseRule(value: unknown): ResponseFieldRule | null {
  if (!isRecord(value)) return null;
  const field = normalizedName(value.field);
  if (!field) return null;
  const fieldSegments = field.split(".");
  if (fieldSegments.length > MAX_RESPONSE_PATH_DEPTH || fieldSegments.some((segment) => !safePropertyName(segment))) return null;

  const rule: ResponseFieldRule = { field };
  const tool = normalizedName(value.tool);
  if (tool) rule.tool = tool;
  const rename = safePropertyName(value.rename);
  if (rename && !rename.includes(".")) rule.rename = rename;
  if (value.drop === true) rule.drop = true;
  const note = normalizedName(value.note);
  if (note) rule.note = note;
  return rule;
}

export function normalizeFieldMappings(value: unknown): ServerFieldMappings | null {
  if (!isRecord(value)) return null;

  const argumentRules = (Array.isArray(value.arguments) ? value.arguments : [])
    .map(normalizeArgumentRule)
    .filter((rule): rule is FieldMappingRule => rule !== null)
    .slice(0, MAX_RULES);
  const responseRules = (Array.isArray(value.response) ? value.response : [])
    .map(normalizeResponseRule)
    .filter((rule): rule is ResponseFieldRule => rule !== null)
    .slice(0, MAX_RULES);

  if (argumentRules.length === 0 && responseRules.length === 0) return null;
  return {
    ...(argumentRules.length > 0 ? { arguments: argumentRules } : {}),
    ...(responseRules.length > 0 ? { response: responseRules } : {}),
  };
}

function ruleAppliesToTool(rule: { tool?: string }, toolName: string) {
  return !rule.tool || rule.tool === toolName;
}

function mappedValue(rule: FieldMappingRule, value: unknown) {
  if (rule.value_map && (typeof value === "string" || typeof value === "number" || typeof value === "boolean")) {
    const key = String(value);
    if (Object.prototype.hasOwnProperty.call(rule.value_map, key)) return rule.value_map[key];
  }
  return value;
}

export function applyArgumentMappings(
  mappings: ServerFieldMappings | null | undefined,
  toolName: string,
  args: Record<string, unknown>
): Record<string, unknown> {
  const rules = (mappings?.arguments ?? []).filter((rule) => ruleAppliesToTool(rule, toolName));
  if (rules.length === 0) return args;

  const output: Record<string, unknown> = { ...args };
  for (const rule of rules) {
    const present = Object.prototype.hasOwnProperty.call(output, rule.argument);
    if (rule.drop) {
      if (present) delete output[rule.argument];
      continue;
    }

    let value = present ? output[rule.argument] : undefined;
    if ((value === undefined || value === null || value === "") && "default" in rule) {
      value = rule.default;
    }
    if (value === undefined) continue;

    value = mappedValue(rule, value);
    if (rule.upstream_name && rule.upstream_name !== rule.argument) {
      delete output[rule.argument];
      output[rule.upstream_name] = value;
    } else {
      output[rule.argument] = value;
    }
  }
  return output;
}

function applyResponseRuleAtPath(container: unknown, segments: string[], rule: ResponseFieldRule) {
  if (Array.isArray(container)) {
    for (const item of container) applyResponseRuleAtPath(item, segments, rule);
    return;
  }
  if (!isRecord(container)) return;

  const [head, ...rest] = segments;
  if (rest.length > 0) {
    if (Object.prototype.hasOwnProperty.call(container, head)) applyResponseRuleAtPath(container[head], rest, rule);
    return;
  }

  if (!Object.prototype.hasOwnProperty.call(container, head)) return;
  if (rule.drop) {
    delete container[head];
    return;
  }
  if (rule.rename && rule.rename !== head) {
    container[rule.rename] = container[head];
    delete container[head];
  }
}

export function applyResponseMappings(
  mappings: ServerFieldMappings | null | undefined,
  toolName: string,
  body: unknown
): unknown {
  const rules = (mappings?.response ?? []).filter((rule) => ruleAppliesToTool(rule, toolName));
  if (rules.length === 0 || !body || typeof body !== "object") return body;

  const clone = JSON.parse(JSON.stringify(body)) as unknown;
  for (const rule of rules) {
    applyResponseRuleAtPath(clone, rule.field.split("."), rule);
  }
  return clone;
}

export function fieldMappingSummary(mappings: ServerFieldMappings | null | undefined) {
  if (!mappings) return null;
  return {
    argument_rules: mappings.arguments?.length ?? 0,
    response_rules: mappings.response?.length ?? 0,
    note: "Field mappings are applied deterministically before upstream execution (arguments) and before the agent sees the response (response).",
  };
}
