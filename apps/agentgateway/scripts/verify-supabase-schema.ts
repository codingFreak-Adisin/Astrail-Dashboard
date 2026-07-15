const { existsSync, readFileSync } = require("node:fs");
const { resolve } = require("node:path");
const { createClient } = require("@supabase/supabase-js");

const requirements = [
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
      "auth_scheme",
      "injection_name",
      "scopes",
      "secret_ciphertext",
      "key_preview",
      "created_at",
      "updated_at",
    ],
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
  "billing_webhook_events_event_type_idx",
  "billing_subscriptions_user_id_idx",
  "billing_subscriptions_entitlement_idx",
  "billing_payment_events_user_created_at_idx",
  "billing_payment_events_payment_id_idx",
  "billing_usage_user_id_created_at_idx",
];

const expectedPolicies = [
  "tool call logs are owned by users",
  "bundles are owned by users",
  "bundle servers follow bundle ownership",
  "credentials are owned by users",
  "Users can read own subscriptions",
  "Users can read own billing payment events",
  "Users can read own billing usage",
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
    for (const table of ["api_credentials", "tool_call_logs", "mcp_bundles", "mcp_bundle_servers", "billing_subscriptions", "billing_payment_events", "billing_usage"]) {
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
  console.log("next_action: Run supabase-schema.sql, or run supabase-migration-mcp-metadata.sql and supabase-migration-billing.sql, then rerun npm run verify:schema.");
  process.exit(1);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
