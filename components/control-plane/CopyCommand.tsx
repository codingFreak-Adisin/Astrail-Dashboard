"use client";

import { Check, Copy } from "lucide-react";
import { useState } from "react";

export function CopyCommand({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);
  async function copy() {
    await navigator.clipboard.writeText(value);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1600);
  }
  return (
    <div className="flex min-w-0 items-center gap-2 rounded-lg border border-neutral-200 bg-neutral-950 p-2 pl-3 text-white">
      <code className="min-w-0 flex-1 overflow-x-auto whitespace-nowrap text-xs text-neutral-200">{value}</code>
      <button type="button" onClick={() => void copy()} aria-label="Copy command" className="grid h-8 w-8 shrink-0 place-items-center rounded-md bg-white/10 text-white hover:bg-white/20">{copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}</button>
    </div>
  );
}
