"use client";

import { Check, Copy } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";

export function CopySnippet({ title, code }: { title: string; code: string }) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    await navigator.clipboard.writeText(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  return (
    <div className="min-w-0 overflow-hidden rounded-xl bg-neutral-950">
      <div className="flex min-w-0 items-center justify-between gap-3 border-b border-white/10 px-3 py-2">
        <p className="min-w-0 truncate text-sm font-medium text-neutral-300">{title}</p>
        <Button type="button" variant="outline" size="sm" onClick={copy} className="shrink-0">
          {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
          {copied ? "Copied" : "Copy"}
        </Button>
      </div>
      <pre className="max-w-full overflow-x-auto p-3 font-mono text-xs leading-5 text-neutral-400">
        <code className="block min-w-max">{code}</code>
      </pre>
    </div>
  );
}
