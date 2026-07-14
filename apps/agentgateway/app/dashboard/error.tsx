"use client";

import { Button } from "@/components/ui/button";

export default function DashboardError({ reset }: { reset: () => void }) {
  return (
    <div className="border bg-card p-6">
      <h2 className="font-semibold">Workspace is loading</h2>
      <p className="mt-2 text-sm text-muted-foreground">
        We could not load your workspace yet. Refresh once; if it still fails, sign in again.
      </p>
      <Button className="mt-4" onClick={reset}>Refresh workspace</Button>
    </div>
  );
}
