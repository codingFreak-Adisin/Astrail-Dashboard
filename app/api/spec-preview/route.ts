import { NextResponse } from "next/server";
import { z } from "zod";
import { previewSpec } from "@/lib/generation-pipeline";
import { hasServerSupabaseEnv } from "@/lib/supabase/env";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { requireTurnstile } from "@/lib/turnstile";

export const runtime = "nodejs";

const PreviewRequestSchema = z.object({
  sourceType: z.enum(["url", "openapi_url", "json_paste"]),
  sourceUrl: z.string().url().optional(),
  rawJson: z.string().optional(),
  turnstileToken: z.string().optional(),
  filters: z.object({
    tools: z.array(z.string()).optional(),
    noTools: z.array(z.string()).optional(),
    resources: z.array(z.string()).optional(),
    noResources: z.array(z.string()).optional(),
    tags: z.array(z.string()).optional(),
    noTags: z.array(z.string()).optional(),
    operations: z.array(z.enum(["read", "write", "destructive"])).optional(),
    noOperations: z.array(z.enum(["read", "write", "destructive"])).optional(),
  }).optional(),
});

export async function POST(request: Request) {
  if (!hasServerSupabaseEnv()) {
    try {
      const body = PreviewRequestSchema.parse(await request.json());
      const turnstileError = await requireTurnstile(request, body.turnstileToken, "mcp-generate");
      if (turnstileError) return turnstileError;
      const { turnstileToken: _turnstileToken, ...previewBody } = body;
      const preview = await previewSpec(previewBody);
      return NextResponse.json({ preview });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Could not inspect spec.";
      const diagnostics = typeof error === "object" && error && "diagnostics" in error
        ? (error.diagnostics as string[])
        : undefined;
      return NextResponse.json({ error: message, diagnostics }, { status: 400 });
    }
  }

  const supabase = createServerSupabaseClient();
  const { data: userData, error: userError } = await supabase.auth.getUser();

  if (userError || !userData.user) {
    return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  }

  try {
    const body = PreviewRequestSchema.parse(await request.json());
    const turnstileError = await requireTurnstile(request, body.turnstileToken, "mcp-generate");
    if (turnstileError) return turnstileError;
    const { turnstileToken: _turnstileToken, ...previewBody } = body;
    const preview = await previewSpec(previewBody);
    return NextResponse.json({ preview });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not inspect spec.";
    const diagnostics = typeof error === "object" && error && "diagnostics" in error
      ? (error.diagnostics as string[])
      : undefined;
    return NextResponse.json({ error: message, diagnostics }, { status: 400 });
  }
}
