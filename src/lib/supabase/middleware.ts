import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { getSupabaseConfig } from "./config";

const PROTECTED_PATHS = [
  "/dashboard",
  "/vocabulary",
  "/review",
  "/languages",
  "/settings",
];

const AUTH_PATHS = ["/login", "/signup"];

export async function updateSession(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const isProtected = PROTECTED_PATHS.some((path) => pathname.startsWith(path));
  const isAuthPage = AUTH_PATHS.some((path) => pathname.startsWith(path));

  const { url, anonKey } = getSupabaseConfig();

  // Fallback for local offline preview when Supabase env vars are not set yet
  if (!url || !anonKey) {
    if (isProtected) {
      const hasDevSession =
        request.cookies.has("language_fox_dev_session") ||
        request.cookies.has("language_fox_session") ||
        request.cookies.has("lingo_fox_dev_session") ||
        request.cookies.has("lingo_fox_session");
      if (!hasDevSession) {
        return NextResponse.redirect(new URL("/login", request.url));
      }
    }
    return NextResponse.next({ request });
  }

  let supabaseResponse = NextResponse.next({ request });

  const supabase = createServerClient(url, anonKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value }) => {
          request.cookies.set(name, value);
        });
        supabaseResponse = NextResponse.next({ request });
        cookiesToSet.forEach(({ name, value, options }) => {
          supabaseResponse.cookies.set(name, value, options);
        });
      },
    },
  });

  // Refresh session if expired - required for Server Components
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (isProtected && !user) {
    const loginUrl = new URL("/login", request.url);
    return NextResponse.redirect(loginUrl);
  }

  if (isAuthPage && user) {
    const dashboardUrl = new URL("/dashboard", request.url);
    return NextResponse.redirect(dashboardUrl);
  }

  return supabaseResponse;
}
