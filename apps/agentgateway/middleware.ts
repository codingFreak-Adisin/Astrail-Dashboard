import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";

function shouldRequireAuth() {
  if (process.env.ASTRAIL_REQUIRE_AUTH === "false") return false;
  if (process.env.ASTRAIL_REQUIRE_AUTH === "true") return true;
  return process.env.NODE_ENV === "production";
}

export async function middleware(request: NextRequest) {
  let response = NextResponse.next({ request });
  const host = request.headers.get("host") ?? "";

  if (host.split(":")[0] === "status.astrail.dev" && request.nextUrl.pathname === "/") {
    const rewriteUrl = request.nextUrl.clone();
    rewriteUrl.pathname = "/status";
    return NextResponse.rewrite(rewriteUrl);
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? process.env.SUPABASE_ANON_KEY;

  if (!url || !anonKey) {
    if (shouldRequireAuth() && request.nextUrl.pathname.startsWith("/dashboard")) {
      const redirectUrl = request.nextUrl.clone();
      redirectUrl.pathname = "/login";
      redirectUrl.searchParams.set("redirect", `${request.nextUrl.pathname}${request.nextUrl.search}`);
      redirectUrl.searchParams.set("error", "Production sign-in is not configured yet. Finish workspace auth setup before opening the dashboard.");
      return NextResponse.redirect(redirectUrl);
    }

    return response;
  }

  const supabase = createServerClient(url, anonKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
        response = NextResponse.next({ request });
        cookiesToSet.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
      },
    },
  });

  const { data } = await supabase.auth.getUser();

  if (shouldRequireAuth() && request.nextUrl.pathname.startsWith("/dashboard") && !data.user) {
    const redirectUrl = request.nextUrl.clone();
    redirectUrl.pathname = "/login";
    redirectUrl.searchParams.set("redirect", `${request.nextUrl.pathname}${request.nextUrl.search}`);
    return NextResponse.redirect(redirectUrl);
  }

  return response;
}

export const config = {
  matcher: ["/", "/dashboard/:path*"],
};
