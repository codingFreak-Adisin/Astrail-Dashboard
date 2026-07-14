import { redirect } from "next/navigation";
import { Sidebar } from "@/components/Sidebar";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { hasServerSupabaseEnv } from "@/lib/supabase/env";

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  if (!hasServerSupabaseEnv()) {
    return (
      <div className="min-h-screen bg-[#f7f7fb] text-neutral-950 md:flex">
        <Sidebar />
        <main className="min-w-0 flex-1 overflow-x-hidden bg-[#f7f7fb] p-4 md:p-6 lg:p-8">{children}</main>
      </div>
    );
  }

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

  return (
    <div className="min-h-screen bg-[#f7f7fb] text-neutral-950 md:flex">
      <Sidebar />
      <main className="min-w-0 flex-1 overflow-x-hidden bg-[#f7f7fb] p-4 md:p-6 lg:p-8">{children}</main>
    </div>
  );
}
