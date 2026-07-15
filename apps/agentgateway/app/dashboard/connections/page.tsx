import Link from "next/link";
import { LockKeyhole, Plus } from "lucide-react";
import { ConnectionsTable } from "@/components/control-plane/ConnectionsTable";
import { PageFrame, StatStrip, WarningBanner } from "@/components/control-plane/PageFrame";
import { loadDashboardControlPlane } from "@/lib/dashboard-control-plane";

export default async function ConnectionsPage() {
  const data = await loadDashboardControlPlane();
  const serverNames = Object.fromEntries(data.servers.map((server) => [server.id, server.name]));
  const oauth = data.credentials.filter((credential) => credential.auth_scheme === "oauth2").length;
  const expired = data.credentials.filter((credential) => credential.expires_at && new Date(credential.expires_at).getTime() <= Date.now()).length;
  return (
    <PageFrame eyebrow="Credential vault" title="Connections" description="Manage the provider accounts and secrets Astrail may inject into upstream calls. Secret values are encrypted at rest, redacted from logs, and never returned to the browser after creation." actions={<Link href="/dashboard/integrations" className="inline-flex h-10 items-center gap-2 rounded-lg bg-neutral-950 px-4 text-sm font-semibold text-white"><Plus className="h-4 w-4" />Choose an integration</Link>}>
      <WarningBanner warnings={data.warnings} />
      <StatStrip items={[
        { label: "Connections", value: data.credentials.length },
        { label: "OAuth accounts", value: oauth, note: "Refresh supported" },
        { label: "API key or bearer", value: data.credentials.length - oauth },
        { label: "Needs attention", value: expired, note: "Expired credentials" },
      ]} />
      <div className="flex gap-3 rounded-lg border border-neutral-200 bg-white px-4 py-4 text-sm leading-6 text-neutral-700"><LockKeyhole className="mt-0.5 h-5 w-5 shrink-0 text-orange-700" /><p><strong className="text-neutral-950">AES-GCM vault.</strong> OAuth access and refresh tokens, client secrets, bearer tokens, and API keys are stored as ciphertext. Injection happens only for the owning integration and configured authentication scheme.</p></div>
      <ConnectionsTable credentials={data.credentials} serverNames={serverNames} />
    </PageFrame>
  );
}
