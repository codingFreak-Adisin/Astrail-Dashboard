const { existsSync, readFileSync } = require("node:fs");
const { resolve } = require("node:path");
const { createClient } = require("@supabase/supabase-js");

const requirements = [
  {
    table: "api_keys",
    columns: ["id", "user_id", "name", "key_hash", "key_preview", "end_user_id", "actor_role", "last_used", "created_at"],
  },
  {
    table: "mcp_servers",
    columns: ["id", "user_id", "field_mappings", "execution_policy", "runtime_policy", "schema_fingerprint", "schema_checked_at", "schema_drift_detected"],
  },
  {
    table: "tool_call_logs",
    columns: [
      "id",
      "server_id",
      "user_id",
      "tool_name",
      "status",
      "method",
      "path",
      "execution_mode",
      "upstream_status",
      "trace_id",
      "attempt_count",
      "error_code",
      "error",
      "end_user_id",
      "actor_role",
      "arguments_redacted",
      "summary",
      "latency_ms",
      "created_at",
    ],
  },
  {
    table: "mcp_bundles",
    columns: ["id", "user_id", "name", "hosted_endpoint", "is_public", "created_at"],
  },
  {
    table: "mcp_bundle_servers",
    columns: ["bundle_id", "server_id", "created_at"],
  },
  {
    table: "api_credentials",
    columns: [
      "id",
      "user_id",
      "server_id",
      "name",
      "provider",
      "security_scheme",
      "security_binding",
      "auth_scheme",
      "client_id",
      "client_secret_ciphertext",
      "authorization_url",
      "token_auth_method",
      "refresh_lease_id",
      "refresh_lease_until",
      "connect_status",
      "connect_state",
      "connect_state_expires_at",
      "pkce_verifier_ciphertext",
      "end_user_id",
      "injection_name",
      "scopes",
      "secret_ciphertext",
      "access_token_ciphertext",
      "refresh_token_ciphertext",
      "token_url",
      "expires_at",
      "key_preview",
      "created_at",
      "updated_at",
    ],
  },
  {
    table: "tool_approval_requests",
    columns: ["id", "server_id", "user_id", "tool_name", "arguments_ciphertext", "arguments_redacted", "status", "expires_at", "decided_at", "executed_at", "created_at"],
  },
  {
    table: "tool_execution_dedup",
    columns: ["id", "server_id", "user_id", "tool_name", "idempotency_key", "trace_id", "result_text", "status", "claim_token", "lease_expires_at", "updated_at", "created_at"],
  },
  {
    table: "tool_schema_versions",
    columns: ["id", "server_id", "user_id", "version", "tools_json", "endpoint_map", "diff", "tool_count", "created_at"],
  },
  {
    table: "webhook_endpoints",
    columns: ["id", "user_id", "server_id", "name", "secret_ciphertext", "secret_preview", "signature_header", "event_id_header", "is_active", "created_at"],
  },
  {
    table: "webhook_events",
    columns: ["id", "endpoint_id", "user_id", "event_id", "event_type", "payload", "headers", "status", "received_at"],
  },
  {
    table: "integration_schema_versions",
    columns: ["id", "user_id", "server_id", "fingerprint", "endpoint_count", "change_summary", "detected_at"],
  },
  {
    table: "integration_cost_events",
    columns: ["id", "user_id", "server_id", "category", "minutes", "amount", "note", "created_at"],
  },
  {
    table: "integration_cost_totals",
    columns: ["user_id", "server_id", "category", "minutes", "amount", "events"],
  },
  {
    table: "billing_webhook_events",
    columns: ["id", "dodo_event_id", "event_type", "user_id", "event_created_at", "processing_result", "payload", "processed_at"],
  },
  {
    table: "billing_subscriptions",
    columns: [
      "id",
      "user_id",
      "dodo_customer_id",
      "dodo_subscription_id",
      "dodo_payment_id",
      "plan",
      "status",
      "entitlement_status",
      "paid_confirmed_at",
      "current_period_start",
      "current_period_end",
      "cancel_at_period_end",
      "last_payment_status",
      "last_payment_at",
      "dodo_last_event_id",
      "dodo_last_event_type",
      "dodo_last_event_at",
      "created_at",
      "updated_at",
    ],
  },
  {
    table: "billing_payment_events",
    columns: [
      "id",
      "dodo_event_id",
      "dodo_payment_id",
      "user_id",
      "dodo_customer_id",
      "dodo_subscription_id",
      "plan",
      "status",
      "amount",
      "currency",
      "event_created_at",
      "payload",
      "processed_at",
    ],
  },
  {
    table: "billing_usage",
    columns: ["id", "user_id", "server_id", "tool_name", "usage_type", "quantity", "created_at"],
  },
];

const expectedIndexes = [
  "idx_tool_call_logs_server_created_at",
  "idx_tool_call_logs_user_created_at",
  "idx_tool_call_logs_trace_id",
  "idx_api_credentials_user_server",
  "idx_mcp_bundles_user_created_at",
  "idx_mcp_bundle_servers_server",
  "idx_tool_approval_requests_user_status",
  "idx_tool_approval_requests_server",
  "api_credentials_connect_state_key",
  "api_credentials_server_end_user_idx",
  "idx_tool_call_logs_end_user",
  "tool_execution_dedup_key",
  "idx_tool_schema_versions_server_created_at",
  "billing_webhook_events_event_type_idx",
  "billing_subscriptions_user_id_idx",
  "billing_subscriptions_entitlement_idx",
  "billing_payment_events_user_created_at_idx",
  "billing_payment_events_payment_id_idx",
  "billing_usage_user_id_created_at_idx",
  "idx_webhook_endpoints_user_server",
  "idx_webhook_events_endpoint_received",
  "idx_webhook_events_user_received",
  "idx_schema_versions_server_detected",
  "idx_integration_costs_user_created",
  "idx_integration_costs_server_created",
  "idx_mcp_servers_schema_watch",
];

const expectedPolicies = [
  "tool call logs are owned by users",
  "bundles are owned by users",
  "bundle servers follow bundle ownership",
  "credentials are owned by users",
  "tool approvals are owned by users",
  "tool execution dedup is owned by users",
  "tool schema versions are owned by users",
  "Users can read own subscriptions",
  "Users can read own billing payment events",
  "Users can read own billing usage",
  "webhook endpoints are owned by users",
  "webhook events are owned by users",
  "schema versions are owned by users",
  "integration costs are owned by users",
];

function loadEnvFile() {
  const path = resolve(process.cwd(), ".env.local");
  if (!existsSync(path)) return;
  const lines = readFileSync(path, "utf8").split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const index = trimmed.indexOf("=");
    if (index === -1) continue;
    const key = trimmed.slice(0, index);
    const value = trimmed.slice(index + 1);
    process.env[key] ||= value;
  }
}

async function main() {
  loadEnvFile();
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!url || !key) {
    console.error("missing_env");
    console.error("Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY or NEXT_PUBLIC_SUPABASE_ANON_KEY.");
    process.exit(1);
  }

  const supabase = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const anonClient = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
    ? createClient(url, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY, {
        auth: { persistSession: false, autoRefreshToken: false },
      })
    : null;

  const missingTables = [];
  const missingColumns = [];
  const publicLeaks = [];

  for (const requirement of requirements) {
    const { error: tableError } = await supabase.from(requirement.table).select("*").limit(1);
    if (tableError) {
      missingTables.push(requirement.table);
      continue;
    }

    for (const column of requirement.columns) {
      const { error } = await supabase.from(requirement.table).select(column).limit(1);
      if (error) missingColumns.push({ table: requirement.table, column, error: error.message });
    }
  }

  if (anonClient) {
    for (const table of ["api_keys", "api_credentials", "tool_approval_requests", "tool_call_logs", "tool_execution_dedup", "tool_schema_versions", "mcp_bundles", "mcp_bundle_servers", "billing_subscriptions", "billing_payment_events", "billing_usage", "webhook_endpoints", "webhook_events", "integration_schema_versions", "integration_cost_events", "integration_cost_totals"]) {
      const { data, error } = await anonClient.from(table).select("*").limit(1);
      if (!error && Array.isArray(data) && data.length > 0) {
        publicLeaks.push(table);
      }
    }
  }

  if (missingTables.length === 0 && missingColumns.length === 0 && publicLeaks.length === 0) {
    console.log("ready");
    console.log("Supabase schema has required Astrail runtime tables and columns.");
    if (anonClient) {
      console.log("rls_behavior_ready");
      console.log("Anonymous clients cannot read protected runtime tables.");
    }
    console.log("expected_indexes:");
    for (const index of expectedIndexes) console.log(`- ${index}`);
    console.log("expected_policies:");
    for (const policy of expectedPolicies) console.log(`- ${policy}`);
    console.log("catalog_note: Direct pg_catalog index/policy verification requires a database connection string or Supabase SQL Editor.");
    return;
  }

  console.log("not_ready");
  if (missingTables.length > 0) {
    console.log("missing_tables:");
    for (const table of missingTables) console.log(`- ${table}`);
  }
  if (missingColumns.length > 0) {
    console.log("missing_columns:");
    for (const item of missingColumns) console.log(`- ${item.table}.${item.column}: ${item.error}`);
  }
  if (publicLeaks.length > 0) {
    console.log("rls_public_leaks:");
    for (const table of publicLeaks) console.log(`- ${table}`);
  }
  console.log("next_action: Run supabase-schema.sql, or run the metadata, billing, and executor-parity migrations, then rerun npm run verify:schema.");
  process.exit(1);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
