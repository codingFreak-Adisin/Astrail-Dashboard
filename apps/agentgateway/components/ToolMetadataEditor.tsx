"use client";

import { useState } from "react";
import { Save } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { readJsonResponse } from "@/lib/client-json";
import type { McpTool, McpToolPolicy } from "@/lib/types";

export function ToolMetadataEditor({ serverId, tools }: { serverId: string; tools: McpTool[] }) {
  const [items, setItems] = useState(tools);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  function updateDescription(index: number, description: string) {
    setItems((current) =>
      current.map((tool, toolIndex) => toolIndex === index ? { ...tool, description } : tool)
    );
  }

  function updatePolicy(index: number, policy: McpToolPolicy) {
    setItems((current) => current.map((tool, toolIndex) => toolIndex === index ? { ...tool, policy } : tool));
  }

  async function save() {
    setSaving(true);
    setMessage(null);
    try {
      const response = await fetch(`/api/servers/${serverId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tools_json: items }),
      });
      const result = await readJsonResponse<{ error?: string }>(response);
      if (!response.ok) throw new Error(result.error ?? "Could not save tool metadata.");
      setMessage("Tool metadata saved.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not save tool metadata.");
    } finally {
      setSaving(false);
    }
  }

  if (items.length === 0) {
    return <p className="text-sm text-muted-foreground">No editable tools for this server.</p>;
  }

  return (
    <div className="space-y-3">
      <div className="space-y-3">
        {items.map((tool, index) => (
          <div key={`${tool.name}-${index}`} className="border bg-background p-3">
            <div className="flex flex-col justify-between gap-2 sm:flex-row sm:items-center">
              <code className="text-sm font-medium">{tool.name}</code>
              <select
                aria-label={`Policy for ${tool.name}`}
                value={tool.policy ?? "allow"}
                onChange={(event) => updatePolicy(index, event.target.value as McpToolPolicy)}
                className="h-9 rounded-md border border-input bg-background px-3 text-sm"
              >
                <option value="allow">Allow</option>
                <option value="approval">Require approval</option>
                <option value="block">Block</option>
              </select>
            </div>
            <Textarea
              value={tool.description}
              onChange={(event) => updateDescription(index, event.target.value)}
              className="mt-2 min-h-20"
            />
          </div>
        ))}
      </div>
      <Button type="button" variant="outline" onClick={save} disabled={saving}>
        <Save className="h-4 w-4" />
        {saving ? "Saving..." : "Save metadata"}
      </Button>
      {message && <p className="text-sm text-muted-foreground">{message}</p>}
      <p className="text-xs text-muted-foreground">
        Policies run before upstream execution. Blocked calls never leave Astrail; approval calls pause with a one-time execution ID.
      </p>
    </div>
  );
}
