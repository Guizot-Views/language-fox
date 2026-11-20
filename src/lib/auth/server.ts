import { cookies } from "next/headers";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/supabase/config";

export interface UserSession {
  id: string;
  name: string;
  email: string;
  avatarUrl?: string | null;
}

/**
 * Returns the current authenticated session from Supabase Auth.
 * Falls back to local dev session cookie ONLY when Supabase env vars are not configured.
 */
export async function getSession(): Promise<{ user: UserSession | null }> {
  if (isSupabaseConfigured()) {
    const supabase = await createSupabaseServerClient();
    if (!supabase) {
      return { user: null };
    }

    try {
      const {
        data: { user },
        error,
      } = await supabase.auth.getUser();

      if (error || !user) {
        return { user: null };
      }

      const fallbackName =
        (user.user_metadata?.display_name as string | undefined)?.trim() ||
        (user.user_metadata?.full_name as string | undefined)?.trim() ||
        user.email?.split("@")[0] ||
        "Learner";

      // Fetch profile display_name & avatar_url if available
      const { data: profile } = await supabase
        .from("profiles")
        .select("display_name, avatar_url")
        .eq("id", user.id)
        .maybeSingle();

      return {
        user: {
          id: user.id,
          name: profile?.display_name?.trim() || fallbackName,
          email: user.email || "",
          avatarUrl:
            profile?.avatar_url ||
            (user.user_metadata?.avatar_url as string | undefined) ||
            null,
        },
      };
    } catch (err) {
      console.warn("Supabase Auth getUser failed:", err);
      return { user: null };
    }
  }

  // Offline local dev fallback when Supabase is not configured
  const cookieStore = await cookies();
  const devSessionCookie =
    cookieStore.get("lingo_fox_dev_session") ||
    cookieStore.get("lingo_fox_session");

  if (devSessionCookie?.value) {
    try {
      const parsed = JSON.parse(devSessionCookie.value);
      if (parsed?.id) {
        return { user: parsed };
      }
    } catch {
      // ignore invalid cookie
    }
  }

  return { user: null };
}

/**
 * Retrieves the authenticated user or throws an unauthorized error.
 * Ensures that all queries derive ownership directly from the session.
 */
export async function requireUser(): Promise<UserSession> {
  const { user } = await getSession();
  if (!user) {
    throw new Error("Unauthorized: User is not authenticated.");
  }
  return user;
}
