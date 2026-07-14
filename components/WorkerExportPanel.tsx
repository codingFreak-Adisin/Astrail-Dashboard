"use client";

import { useState } from "react";
import { Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import { CopySnippet } from "@/components/CopySnippet";
import { readJsonResponse } from "@/lib/client-json";

type WorkerBundle = {
  files: Array<{ path: string; content: string }>;
};

function safeFileName(name: string) {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "astrail-worker";
}

export function WorkerExportPanel({ serverId, serverName }: { serverId: string; serverName: string }) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function exportWorkerBundle() {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch(`/api/servers/${serverId}/worker`);
      const bundle = await readJsonResponse<WorkerBundle & { error?: string }>(response);
      if (!response.ok) throw new Error(bundle.error ?? "Could not export Worker bundle.");
      const blob = new Blob([JSON.stringify(bundle, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `${safeFileName(serverName)}-worker-export.json`;
      anchor.click();
      URL.revokeObjectURL(url);
    } catch (exportError) {
      setError(exportError instanceof Error ? exportError.message : "Could not export Worker bundle.");
    } finally {
      setLoading(false);
    }
  }

  const deployCommands = `# 1. Click "Export Worker bundle" and unpack the JSON into files.
# 2. Install dependencies inside the exported folder.
npm install

# 3. Add secrets if the exported runtime is private or needs upstream credentials.
npx wrangler secret put ASTRAIL_API_KEY

# 4. Optional manual deploy to Cloudflare Workers after review.
npx wrangler deploy`;

  return (
    <div className="section-card space-y-3 text-sm">
      <div className="section-card-header pb-0">
        <h2 className="text-lg font-semibold text-neutral-950">Cloudflare Worker export</h2>
      </div>
      <p className="text-neutral-500">
        Export a Worker-ready MCP runtime bundle with `src/worker.ts`, `wrangler.toml`, and review notes.
        This is a manual export path, not one-click Cloudflare deployment.
      </p>
      <div className="rounded-xl border border-neutral-100 bg-neutral-50/80 p-3 text-sm text-neutral-500">
        <p className="font-medium text-neutral-900">How hosting works</p>
        <p className="mt-1">
          Astrail hosts the endpoint immediately through Next.js at `/api/mcp/{serverId}`. Worker export is an optional portability path that should be reviewed before running with credentials or private APIs.
        </p>
      </div>
      <Button type="button" variant="outline" onClick={exportWorkerBundle} disabled={loading}>
        <Download className="h-4 w-4" />
        {loading ? "Preparing export..." : "Export Worker bundle"}
      </Button>
      <CopySnippet title="Manual Worker export commands" code={deployCommands} />
      {error && <p className="text-red-600">{error}</p>}
    </div>
  );
}
