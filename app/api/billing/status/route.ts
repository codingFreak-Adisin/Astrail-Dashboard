import { NextResponse } from "next/server";
import { getBillingUsageSummary } from "@/lib/billing/usage";
import { localDemoUserId } from "@/lib/local-demo";
import { hasServerSupabaseEnv } from "@/lib/supabase/env";
import { createServerSupabaseClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  if (!hasServerSupabaseEnv()) {
    const usage = await getBillingUsageSummary(localDemoUserId);
    return NextResponse.json({ usage, preview: true });
  }

  let data;
  try {
    const supabase = createServerSupabaseClient();
    const result = await supabase.auth.getUser();
    data = result.data;
  } catch (error) {
    console.error("astrail.billing.status.auth_unavailable", {
      message: error instanceof Error ? error.message : "Unknown auth error",
    });

    return NextResponse.json(
      { error: "Billing usage is temporarily unavailable." },
      { status: 503 },
    );
  }

  if (!data.user) {
    return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  }

  const usage = await getBillingUsageSummary(data.user.id);
  return NextResponse.json({ usage });
}
