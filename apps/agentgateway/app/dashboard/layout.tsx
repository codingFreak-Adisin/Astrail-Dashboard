import { redirect } from "next/navigation";
import { DashboardTopbar } from "@/components/DashboardTopbar";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { hasServerSupabaseEnv } from "@/lib/supabase/env";

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  if (hasServerSupabaseEnv()) {
    let user = null;

    try {
      const supabase = createServerSupabaseClient();
      const { data } = await supabase.auth.getUser();
      user = data.user;
    } catch (error) {
      console.warn("[dashboard] session verification failed", {
        name: error instanceof Error ? error.name : "unknown",
      });
      redirect("/login?error=We%20could%20not%20verify%20your%20session.%20Please%20sign%20in%20again.");
    }

    if (!user) redirect("/login");
  }

  return (
    <div className="dash-shell min-h-dvh bg-[#f8f6f1] text-neutral-950">
      <style>{`
        html,
        body {
          background: #f8f6f1;
          overscroll-behavior-y: none;
        }
      `}</style>
      <DashboardTopbar />
      <main className="mx-auto min-h-dvh w-full max-w-[1400px] overflow-x-hidden px-4 pb-16 pt-6 sm:px-6 md:pt-8">
        {children}
      </main>
    </div>
  );
}
