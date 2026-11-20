"use server";

import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/supabase/config";

export interface AuthActionResult {
  error?: string;
  success?: boolean;
  requiresEmailConfirmation?: boolean;
}

export async function loginAction(
  _prevState: AuthActionResult | null,
  formData: FormData
): Promise<AuthActionResult> {
  const email = (formData.get("email") as string)?.trim();
  const password = (formData.get("password") as string)?.trim();

  if (!email || !password) {
    return { error: "Alamat email dan kata sandi wajib diisi." };
  }

  if (isSupabaseConfigured()) {
    try {
      const supabase = await createSupabaseServerClient();
      if (!supabase) {
        return { error: "Konfigurasi Supabase belum tersedia." };
      }

      const { data, error } = await supabase.auth.signInWithPassword({
        email,
        password,
      });

      if (error) {
        const msg = error.message.toLowerCase();
        if (msg.includes("invalid login credentials")) {
          return { error: "Email atau kata sandi salah. Silakan coba lagi." };
        }
        if (msg.includes("email not confirmed")) {
          return {
            error:
              "Email Anda belum dikonfirmasi. Silakan periksa kotak masuk email Anda terlebih dahulu.",
          };
        }
        return {
          error: error.message || "Gagal masuk ke akun. Silakan coba lagi.",
        };
      }

      if (data.user) {
        const defaultName =
          (data.user.user_metadata?.display_name as string | undefined) ||
          email.split("@")[0] ||
          "Learner";

        // Ensure profile exists for this user
        const { error: profileError } = await supabase.from("profiles").upsert(
          {
            id: data.user.id,
            display_name: defaultName,
          },
          { onConflict: "id", ignoreDuplicates: true }
        );
        if (profileError) {
          console.warn("Could not ensure profile row:", profileError.message);
        }
      }

      return { success: true };
    } catch (e: unknown) {
      const message =
        e instanceof Error ? e.message : "Gagal menghubungi server autentikasi.";
      console.error("Supabase sign-in error:", e);
      return { error: message };
    }
  }

  // Offline development fallback when Supabase env vars are not set
  const cookieStore = await cookies();
  const id = `user_${email.replace(/[^a-zA-Z0-9]/g, "_")}`;
  const devPayload = JSON.stringify({
    id,
    name: email.split("@")[0] || "Learner",
    email,
  });
  cookieStore.set("language_fox_dev_session", devPayload, {
    path: "/",
    httpOnly: true,
    maxAge: 60 * 60 * 24 * 7,
  });
  return { success: true };
}

export async function signupAction(
  _prevState: AuthActionResult | null,
  formData: FormData
): Promise<AuthActionResult> {
  const name = (formData.get("name") as string)?.trim();
  const email = (formData.get("email") as string)?.trim();
  const password = (formData.get("password") as string)?.trim();

  if (!email || !password) {
    return { error: "Email dan kata sandi wajib diisi." };
  }

  if (password.length < 6) {
    return { error: "Kata sandi minimal 6 karakter." };
  }

  const displayName = name || email.split("@")[0] || "Learner";

  if (isSupabaseConfigured()) {
    try {
      const supabase = await createSupabaseServerClient();
      if (!supabase) {
        return { error: "Konfigurasi Supabase belum tersedia." };
      }

      const headerStore = await headers();
      const origin =
        headerStore.get("origin") ||
        process.env.NEXT_PUBLIC_APP_URL ||
        "http://localhost:3000";

      const { data, error } = await supabase.auth.signUp({
        email,
        password,
        options: {
          data: {
            display_name: displayName,
          },
          emailRedirectTo: `${origin.replace(/\/+$/, "")}/auth/callback`,
        },
      });

      if (error) {
        const msg = error.message.toLowerCase();
        if (
          msg.includes("already registered") ||
          msg.includes("already exists")
        ) {
          return { error: "Email ini sudah terdaftar. Silakan langsung masuk." };
        }
        return { error: error.message || "Gagal mendaftarkan akun." };
      }

      if (data.session && data.user) {
        // Immediate session (email confirmation disabled)
        const { error: profileError } = await supabase.from("profiles").upsert(
          {
            id: data.user.id,
            display_name: displayName,
          },
          { onConflict: "id" }
        );
        if (profileError) {
          console.warn("Could not upsert profile:", profileError.message);
        }
        return { success: true };
      }

      if (data.user) {
        // Email confirmation enabled in Supabase Auth
        return { success: true, requiresEmailConfirmation: true };
      }

      return { error: "Gagal mendaftarkan akun. Silakan coba lagi." };
    } catch (e: unknown) {
      const message =
        e instanceof Error ? e.message : "Gagal menghubungi server autentikasi.";
      console.error("Supabase sign-up error:", e);
      return { error: message };
    }
  }

  // Offline development fallback when Supabase env vars are not set
  const cookieStore = await cookies();
  const id = `user_${email.replace(/[^a-zA-Z0-9]/g, "_")}`;
  const devSignupPayload = JSON.stringify({
    id,
    name: displayName,
    email,
  });
  cookieStore.set("language_fox_dev_session", devSignupPayload, {
    path: "/",
    httpOnly: true,
    maxAge: 60 * 60 * 24 * 7,
  });
  return { success: true };
}

export async function logoutAction() {
  if (isSupabaseConfigured()) {
    try {
      const supabase = await createSupabaseServerClient();
      if (supabase) {
        await supabase.auth.signOut();
      }
    } catch (e) {
      console.warn("Supabase signOut error:", e);
    }
  }

  const cookieStore = await cookies();
  cookieStore.delete("language_fox_session");
  cookieStore.delete("language_fox_dev_session");
  cookieStore.delete("lingo_fox_session");
  cookieStore.delete("grwly_session");
  cookieStore.delete("lingo_fox_dev_session");
  cookieStore.delete("grwly_dev_session");
  redirect("/login");
}

export async function updateProfileAction(newName: string) {
  const cleanName = newName?.trim();
  if (!cleanName) {
    return { error: "Nama tidak boleh kosong." };
  }

  if (isSupabaseConfigured()) {
    try {
      const supabase = await createSupabaseServerClient();
      if (!supabase) {
        return { error: "Konfigurasi Supabase belum tersedia." };
      }

      const {
        data: { user },
        error: userError,
      } = await supabase.auth.getUser();

      if (userError || !user) {
        return { error: "Sesi tidak ditemukan." };
      }

      const { error: profileError } = await supabase.from("profiles").upsert(
        {
          id: user.id,
          display_name: cleanName,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "id" }
      );

      if (profileError) {
        return { error: profileError.message || "Gagal memperbarui profil." };
      }

      await supabase.auth.updateUser({
        data: { display_name: cleanName },
      });

      revalidatePath("/settings");
      revalidatePath("/dashboard");
      revalidatePath("/", "layout");
      return { success: true };
    } catch (e: unknown) {
      const message =
        e instanceof Error ? e.message : "Gagal memperbarui profil.";
      return { error: message };
    }
  }

  // Offline development fallback
  const cookieStore = await cookies();
  const sessionCookie =
    cookieStore.get("language_fox_dev_session") ||
    cookieStore.get("language_fox_session") ||
    cookieStore.get("lingo_fox_dev_session") ||
    cookieStore.get("lingo_fox_session");

  if (sessionCookie?.value) {
    try {
      const parsed = JSON.parse(sessionCookie.value);
      parsed.name = cleanName;
      cookieStore.set("language_fox_dev_session", JSON.stringify(parsed), {
        path: "/",
        httpOnly: true,
        maxAge: 60 * 60 * 24 * 7,
      });
      revalidatePath("/settings");
      revalidatePath("/dashboard");
      return { success: true };
    } catch (e: unknown) {
      const message =
        e instanceof Error ? e.message : "Gagal memperbarui profil.";
      return { error: message };
    }
  }

  return { error: "Sesi tidak ditemukan." };
}
