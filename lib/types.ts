export type SourceType = "url" | "openapi_url" | "json_paste" | "preset" | "website" | "workflow";

export type ServerStatus = "live" | "error" | "pending" | "preset";

export type PipelineStatus = "passed" | "completed" | "failed" | "pending";

export type McpGenerationMode = "auto" | "static" | "dynamic" | "code";

export type McpClientPreset = "default" | "claude" | "claude-code" | "cursor" | "openai";

export type McpOperationFilter = "read" | "write" | "destructive";

export type McpEndpointFilters = {
  tools?: string[];
  noTools?: string[];
  resources?: string[];
  noResources?: string[];
  tags?: string[];
  noTags?: string[];
  operations?: McpOperationFilter[];
  noOperations?: McpOperationFilter[];
};

export type McpToolAnnotations = {
  title?: string;
  readOnlyHint?: boolean;
  destructiveHint?: boolean;
  idempotentHint?: boolean;
  openWorldHint?: boolean;
};

export type AstrailToolProfile = {
  method?: string;
  path?: string;
  visibility?: "public" | "private";
  risk: "read" | "write" | "destructive";
  requires_auth: boolean;
  auth_schemes: string[];
  required_scopes: string[];
  prerequisites: string[];
  agent_instructions: string[];
  response_hints?: unknown;
  example_arguments: Record<string, unknown>;
  complexity?: {
    parameter_count: number;
    body_mode: "schema" | "compact_object";
    compressed: boolean;
  };
};

export type RuntimePermissionPattern = string | {
  pattern: string;
  regex?: boolean;
  match?: "sdk_method" | "endpoint_id" | "tool_name" | "operation_id" | "method_path" | "resource" | "tag" | "path" | "http_method";
  note?: string;
};

export type RuntimePermissionPolicy = {
  allow_http_gets?: boolean;
  allowed_methods?: RuntimePermissionPattern[];
  blocked_methods?: RuntimePermissionPattern[];
  allowed_resources?: RuntimePermissionPattern[];
  blocked_resources?: RuntimePermissionPattern[];
  read_only?: boolean;
};

export type McpTool = {
  name: string;
  description: string;
  input_schema?: Record<string, unknown>;
  method?: string;
  path?: string;
  annotations?: McpToolAnnotations;
  x_astrail?: AstrailToolProfile;
  metadata?: Record<string, unknown>;
  visibility?: "public" | "private";
};

export type McpServer = {
  id: string;
  user_id: string;
  name: string;
  description: string | null;
  source_url: string | null;
  source_type: SourceType | string | null;
  category?: string | null;
  generated_code: string | null;
  tools_json: McpTool[] | null;
  endpoint_map?: OpenApiEndpoint[] | null;
  runtime_policy?: RuntimePermissionPolicy | null;
  diagnostics?: GenerationDiagnostics | string[] | null;
  status?: ServerStatus | string | null;
  validation_status?: PipelineStatus | string | null;
  generation_status?: PipelineStatus | string | null;
  is_public: boolean;
  hosted_endpoint: string | null;
  call_count: number;
  generation_version?: number | string | null;
  protocol_version?: string | null;
  created_at: string;
};

export type RuntimeLog = {
  id: string;
  server_id: string;
  user_id: string | null;
  tool_name: string | null;
  status: string | null;
  method: string | null;
  path: string | null;
  execution_mode: string | null;
  upstream_status?: number | null;
  trace_id?: string | null;
  attempt_count?: number | null;
  error_code?: string | null;
  error: string | null;
  latency_ms: number | null;
  created_at: string;
};

export type ApiKey = {
  id: string;
  user_id: string;
  name: string;
  key_preview: string;
  last_used: string | null;
  created_at: string;
};

export type DesignPartnerRequest = {
  id: string;
  name: string;
  email: string;
  company: string;
  role: string | null;
  agent_kind: string;
  needed_api: string;
  has_api_docs: "yes" | "no" | string;
  api_docs_url_or_notes: string | null;
  runtime_preference: "hosted" | "exported_code" | "self_hosted" | string;
  urgency: "today" | "this_week" | "exploring" | string;
  status: "new" | "contacted" | "onboarded" | "generated" | "success" | string;
  created_at: string;
};

export type GeneratedMcpServer = {
  name: string;
  description: string;
  tools: McpTool[];
  generated_code: string;
};

export type SpecFormat = "json" | "yaml";

export type SpecDiscoveryResult = {
  status: "found" | "not_found" | "error";
  input_url: string;
  discovered_url?: string;
  discovery_method?: string;
  content_type?: string;
  spec_raw?: string;
  spec_format?: SpecFormat;
  diagnostics: string[];
};

export type OpenApiEndpoint = {
  method: string;
  path: string;
  tool_name?: string | null;
  runtime_kind?: "rest" | "browser" | "graphql";
  browser_action?: "open_page" | "click" | "submit_form" | "follow_link";
  selector?: string | null;
  target_url?: string | null;
  base_url?: string | null;
  operation_id: string | null;
  summary: string | null;
  description: string | null;
  tags?: string[];
  parameters?: unknown[];
  path_params?: unknown[];
  query_params?: unknown[];
  request_body?: unknown;
  request_body_schema?: unknown;
  responses?: unknown;
  response_hints?: unknown;
  security?: unknown;
  security_requirements?: unknown;
  requires_auth?: boolean;
  visibility?: "public" | "private";
  resource?: string | null;
  operation_kind?: McpOperationFilter;
  input_schema?: Record<string, unknown>;
  docs_corpus?: Record<string, unknown>;
};

export type GenerationDiagnostics = {
  input_url: string | null;
  discovered_url: string | null;
  discovery_method: string | null;
  spec_size_bytes: number;
  endpoint_count: number;
  selected_group: string;
  tools_generated: number;
  hosted_endpoint: string | null;
  warnings: string[];
  errors: string[];
  timestamps: {
    started_at?: string;
    completed_at?: string;
    failed_at?: string;
  };
  trace: Array<{
    label: string;
    status: "passed" | "warning" | "failed" | "pending";
    detail?: string;
  }>;
  raw: string[];
};

export type SpecPreview = {
  source_url: string | null;
  spec_size_bytes: number;
  endpoint_count: number;
  endpoint_limit: number;
  groups: Array<{ name: string; count: number }>;
  resources?: Array<{ name: string; count: number }>;
  operations?: Array<{ name: McpOperationFilter; count: number }>;
  recommended_mode?: Exclude<McpGenerationMode, "auto">;
  client_presets?: McpClientPreset[];
  is_large: boolean;
  warning: string | null;
  diagnostics: string[];
};
