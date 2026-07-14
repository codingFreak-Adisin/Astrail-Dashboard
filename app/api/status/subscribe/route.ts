import { NextResponse } from "next/server";
import { createSupabaseAdmin, getWaitlistTable, isSupabaseConfigured } from "@/lib/waitlist";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as { email?: unknown } | null;
  const email = typeof body?.email === "string" ? body.email.trim().toLowerCase() : "";

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return NextResponse.json({ error: "Enter a valid email address." }, { status: 400 });
  }

  if (!isSupabaseConfigured()) {
    return NextResponse.json({ ok: true, preview: true });
  }

  const supabase = createSupabaseAdmin();
  const { error } = await supabase.from(getWaitlistTable()).insert({ email });

  if (error && error.code !== "23505") {
    return NextResponse.json({ error: "Could not subscribe yet." }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
