"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { CheckCircle2, Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { CopySnippet } from "@/components/CopySnippet";
import { readJsonResponse } from "@/lib/client-json";

function safeFileName(name: string) {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "astrail-sdk";
}

const bundleItems = ["SDK clients", "Docs", "Tests", "GitHub updates"];

export function SdkExportPanel({ serverId, serverName }: { serverId: string; serverName: string }) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [billingRequired, setBillingRequired] = useState(false);
  const [appUrl, setAppUrl] = useState("https://your-domain.com");

  useEffect(() => {
    setAppUrl(window.location.origin);
  }, []);

  async function exportSdkBundle() {
    setLoading(true);
    setError(null);
    setBillingRequired(false);
    try {
      const response = await fetch(`/api/servers/${serverId}/sdk?format=tgz`);
      if (!response.ok) {
        const bundle = await readJsonResponse<{ error?: string }>(response);
        setBillingRequired(response.status === 402);
        throw new Error(bundle.error ?? "Could not export SDK bundle.");
      }
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `${safeFileName(serverName)}-sdk.tar.gz`;
      anchor.click();
      URL.revokeObjectURL(url);
    } catch (sdkError) {
      setError(sdkError instanceof Error ? sdkError.message : "Could not export SDK bundle.");
    } finally {
      setLoading(false);
    }
  }

  const commands = `# Pull and unpack this server's SDK bundle:
ASTRAIL_SDK_BUNDLE_URL=${appUrl}/api/servers/${serverId}/sdk \\
ASTRAIL_SDK_OUT_DIR=./${safeFileName(serverName)}-sdk \\
npm run sdk:pull

cd ./${safeFileName(serverName)}-sdk
node scripts/verify-generated-sdk.mjs

# Then smoke the generated SDK:
cd ./typescript
npm install
ASTRAIL_MCP_ENDPOINT=${appUrl}/api/mcp/${serverId} npm test

cd ../python
python -m py_compile */client.py

# Multi-target files are included too:
test -f ../go/astrail/client.go
test -f ../java/pom.xml
test -f ../kotlin/build.gradle.kts
test -f ../ruby/*.gemspec
test -f ../php/composer.json
test -f ../cli/bin/astrail.mjs
test -f ../csharp/*.csproj
test -f ../terraform/examples/mcp_endpoint.tf
test -f ../docs/REFERENCE.md
test -f ../docs/MCP.md
test -f ../docs/STAINLESS_PARITY.md
test -f ../docs/llms.txt
test -f ../mcp/manifest.json
test -f ../mcp/install.json
test -f ../mcp/mcpb-manifest.json
test -f ../openapi/endpoint-catalog.json
test -f ../openapi/documented-spec.json
test -f ../openapi/diagnostics.json
test -f ../policies/agent-policy.json
test -f ../evals/tasks.json
ASTRAIL_MCP_ENDPOINT=${appUrl}/api/mcp/${serverId} node ../scripts/run-astrail-evals.mjs`;

  return (
    <Card>
      <CardContent className="space-y-4 p-5 text-sm">
        <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-start">
          <div>
            <h2 className="text-lg font-semibold">Create SDK bundle</h2>
            <p className="mt-1 text-muted-foreground">Download client code and docs for this server.</p>
          </div>
          <Button type="button" variant="outline" onClick={exportSdkBundle} disabled={loading}>
            <Download className="h-4 w-4" />
            {loading ? "Preparing..." : "Generate bundle"}
          </Button>
        </div>

        <div className="grid gap-2 sm:grid-cols-4">
          {bundleItems.map((item) => (
            <div key={item} className="flex items-center gap-2 border bg-background px-3 py-2 text-muted-foreground">
              <CheckCircle2 className="h-4 w-4 shrink-0 text-orange-600" />
              <span>{item}</span>
            </div>
          ))}
        </div>

        {billingRequired ? (
          <Button asChild>
            <Link href="/dashboard/billing">Open billing</Link>
          </Button>
        ) : null}

        <details className="border bg-background px-3 py-2">
          <summary className="cursor-pointer text-sm font-medium">Show commands</summary>
          <div className="mt-3">
            <CopySnippet title="SDK commands" code={commands} />
          </div>
        </details>

        {error && <p className="text-destructive">{error}</p>}
      </CardContent>
    </Card>
  );
}
