import { notFound } from "next/navigation";
import { AddToGatewayButton } from "@/components/AddToGatewayButton";
import { CodeViewer } from "@/components/CodeViewer";
import { EndpointBox } from "@/components/EndpointBox";
import { McpClientSnippets } from "@/components/McpClientSnippets";
import { Navbar } from "@/components/Navbar";
import { RuntimeBehavior } from "@/components/RuntimeBehavior";
import { ToolList } from "@/components/ToolList";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { findPresetServer } from "@/lib/preset-servers";
import { getRuntimeStatusSummary } from "@/lib/runtime/tool-call-logs";
import { formatDate } from "@/lib/utils";
import type { McpServer } from "@/lib/types";

export default async function MarketplaceDetailPage({ params }: { params: { id: string } }) {
  const preset = findPresetServer(params.id);
  if (preset) {
    return <MarketplaceDetail server={preset} />;
  }

  notFound();
}

async function MarketplaceDetail({ server }: { server: McpServer }) {
  const endpoint = server.hosted_endpoint?.startsWith("http")
    ? server.hosted_endpoint
    : `/api/mcp/${server.id}`;
  const endpointMap = server.endpoint_map ?? [];
  const hasAuthRequiredEndpoints = endpointMap.some((item) => item.requires_auth || hasSecurityRequirement(item.security_requirements ?? item.security));
  const hasExecutableEndpoints = endpointMap.some((item) =>
    ["GET", "POST"].includes(item.method) &&
    Boolean(item.base_url) &&
    !item.requires_auth &&
    !hasSecurityRequirement(item.security_requirements ?? item.security)
  );
  const runtimeStatus = server.source_type === "preset"
    ? null
    : await safeRuntimeStatus(server.id);

  return (
    <main>
      <Navbar />
      <div className="mx-auto max-w-6xl space-y-6 px-4 py-10">
          <div className="flex flex-col justify-between gap-4 md:flex-row md:items-start">
            <div>
              <div className="mb-3 flex flex-wrap gap-2">
                <Badge className="border-primary text-primary">public</Badge>
                <Badge>{server.category ?? (server.source_type === "preset" ? "Template" : "Generated")}</Badge>
                <Badge>{formatDate(server.created_at)}</Badge>
                <Badge>{server.call_count ?? 0} calls</Badge>
              </div>
              <h1 className="text-3xl font-semibold">{server.name}</h1>
              <p className="mt-2 max-w-3xl text-muted-foreground">{server.description}</p>
          </div>
          <AddToGatewayButton serverId={server.id} />
        </div>

        <EndpointBox endpoint={endpoint} />

        <Card>
          <CardHeader><CardTitle>MCP client snippets</CardTitle></CardHeader>
          <CardContent>
            <McpClientSnippets
              serverName={server.name}
              endpoint={endpoint}
              tools={server.tools_json ?? []}
              endpointMap={endpointMap}
            />
          </CardContent>
        </Card>

        <RuntimeBehavior
          hasEndpointMap={endpointMap.length > 0}
          hasAuthRequiredEndpoints={hasAuthRequiredEndpoints}
          hasExecutableEndpoints={hasExecutableEndpoints}
          lastStatus={runtimeStatus?.lastStatus}
          lastExecutionMode={runtimeStatus?.lastExecutionMode}
          lastToolName={runtimeStatus?.lastToolName}
          lastLatencyMs={runtimeStatus?.lastLatencyMs}
          lastUpstreamStatus={runtimeStatus?.lastUpstreamStatus}
          lastTraceId={runtimeStatus?.lastTraceId}
          lastErrorCode={runtimeStatus?.lastErrorCode}
          observabilityStorage={runtimeStatus?.observabilityStorage}
          rateLimitMode={process.env.RATE_LIMIT_MODE ?? "in_memory"}
        />

        <div className="grid items-start gap-6 xl:grid-cols-[360px_1fr]">
          <Card className="self-start">
            <CardHeader><CardTitle>Tools</CardTitle></CardHeader>
            <CardContent><ToolList tools={server.tools_json ?? []} /></CardContent>
          </Card>
          <CodeViewer code={server.generated_code ?? ""} />
        </div>
      </div>
    </main>
  );
}

async function safeRuntimeStatus(serverId: string) {
  try {
    return await getRuntimeStatusSummary(serverId);
  } catch (error) {
    console.error("astrail.marketplace.runtime_status_unavailable", {
      serverId,
      message: error instanceof Error ? error.message : "Unknown runtime status error",
    });
    return null;
  }
}

function hasSecurityRequirement(security: unknown) {
  if (!security) return false;
  if (Array.isArray(security)) return security.length > 0;
  if (typeof security === "object") return Object.keys(security).length > 0;
  return Boolean(security);
}
