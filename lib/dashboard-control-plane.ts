import "server-only";

import { getDashboardSessionUser } from "@/lib/dashboard-session";
import { localDemoLogs, localDemoServers } from "@/lib/local-demo";
import { hasServerSupabaseEnv } from "@/lib/supabase/env";
import { createAdminClient, hasServiceRoleKey } from "@/lib/supabase/server";
import type { McpServer, RuntimeLog } from "@/lib/types";

export type CredentialSummary = {
  id: string;
  server_id: string | null;
  name: string;
  provider: string | null;
  security_scheme?: string | null;
  auth_scheme: string;
  injection_name: string | null;
  scopes: string[] | null;
  key_preview: string;
  expires_at?: string | null;
  connect_status?: string | null;
  end_user_id?: string | null;
  created_at: string;
  updated_at: string;
};

export type ApprovalSummary = {
  id: string;
  server_id: string;
  tool_name: string;
  status: string;
  expires_at: string;
  created_at: string;
};

export type DashboardControlPlane = {
  servers: McpServer[];
  credentials: CredentialSummary[];
  logs: RuntimeLog[];
  approvals: ApprovalSummary[];
  warnings: string[];
  preview: boolean;
};

export async function loadDashboardControlPlane(): Promise<DashboardControlPlane> {
  if (!hasServerSupabaseEnv()) {
    return {
      servers: localDemoServers(),
      credentials: [],
      logs: localDemoLogs(),
      approvals: [],
      warnings: ["Credential and approval rows appear after workspace storage is connected."],
      preview: true,
    };
  }

  const user = await getDashboardSessionUser();
  if (!hasServiceRoleKey()) {
    return {
      servers: [],
      credentials: [],
      logs: [],
      approvals: [],
      warnings: ["Workspace admin storage is not configured, so control-plane inventory is unavailable."],
      preview: false,
    };
  }

  const admin = createAdminClient();
  const [serversResult, initialCredentialsResult, logsResult, approvalsResult] = await Promise.all([
    admin.from("mcp_servers").select("*").eq("user_id", user.id).order("created_at", { ascending: false }),
    admin.from("api_credentials")
      .select("id,server_id,name,provider,security_scheme,auth_scheme,injection_name,scopes,key_preview,expires_at,connect_status,end_user_id,created_at,updated_at")
      .eq("user_id", user.id).order("created_at", { ascending: false }),
    admin.from("tool_call_logs")
      .select("id,server_id,user_id,tool_name,status,method,path,execution_mode,upstream_status,trace_id,attempt_count,error_code,error,latency_ms,created_at")
      .eq("user_id", user.id).order("created_at", { ascending: false }).limit(100),
    admin.from("tool_approval_requests")
      .select("id,server_id,tool_name,status,expires_at,created_at")
      .eq("user_id", user.id).order("created_at", { ascending: false }).limit(100),
  ]);
  let credentialsResult: { data: unknown[] | null; error: { message: string } | null } = initialCredentialsResult;
  if (credentialsResult.error?.message.includes("column")) {
    credentialsResult = await admin.from("api_credentials")
      .select("id,server_id,name,provider,auth_scheme,injection_name,scopes,key_preview,expires_at,connect_status,end_user_id,created_at,updated_at")
      .eq("user_id", user.id).order("created_at", { ascending: false });
  }
  if (credentialsResult.error?.message.includes("column")) {
    credentialsResult = await admin.from("api_credentials")
      .select("id,server_id,name,provider,auth_scheme,injection_name,scopes,key_preview,created_at,updated_at")
      .eq("user_id", user.id).order("created_at", { ascending: false });
  }

  const warnings = [
    serversResult.error ? `Integrations: ${serversResult.error.message}` : null,
    credentialsResult.error ? `Connections: ${credentialsResult.error.message}` : null,
    logsResult.error ? `Activity: ${logsResult.error.message}` : null,
    approvalsResult.error ? `Approvals: ${approvalsResult.error.message}` : null,
  ].filter((value): value is string => Boolean(value));

  return {
    servers: (serversResult.data ?? []) as McpServer[],
    credentials: (credentialsResult.data ?? []) as CredentialSummary[],
    logs: (logsResult.data ?? []) as RuntimeLog[],
    approvals: (approvalsResult.data ?? []) as ApprovalSummary[],
    warnings,
    preview: false,
  };
}

export function controlPlaneStats(data: DashboardControlPlane) {
  const tools = data.servers.flatMap((server) => server.tools_json ?? []);
  return {
    integrations: data.servers.length,
    liveIntegrations: data.servers.filter((server) => server.status === "live" || server.status === "preset").length,
    connections: data.credentials.length,
    tools: tools.length,
    allow: tools.filter((tool) => (tool.policy ?? "allow") === "allow").length,
    approval: tools.filter((tool) => tool.policy === "approval").length,
    block: tools.filter((tool) => tool.policy === "block").length,
    pendingApprovals: data.approvals.filter((approval) => approval.status === "pending").length,
  };
}
