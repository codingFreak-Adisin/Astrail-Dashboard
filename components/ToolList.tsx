import type { McpTool } from "@/lib/types";

export function ToolList({ tools }: { tools: McpTool[] }) {
  if (tools.length === 0) {
    return <p className="text-sm text-neutral-500">No tools were extracted.</p>;
  }

  return (
    <div>
      {tools.map((tool) => (
        <div key={`${tool.name}-${tool.path ?? ""}`} className="console-table-row grid gap-2 py-3.5 text-sm">
          <div className="flex min-w-0 flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <code className="min-w-0 truncate font-mono text-sm font-semibold text-neutral-950">{tool.name}</code>
            {(tool.method || tool.path) && (
              <div className="flex shrink-0 flex-wrap gap-2">
                {tool.method ? <span className="pill pill-info">{tool.method}</span> : null}
                {tool.path ? <span className="pill pill-neutral max-w-48 truncate font-mono">{tool.path}</span> : null}
              </div>
            )}
          </div>
          <p className="line-clamp-2 text-sm leading-6 text-neutral-500">{tool.description}</p>
        </div>
      ))}
    </div>
  );
}
