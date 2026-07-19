import { getSupabaseBrowserClient } from "@/lib/supabase/client";

export type AuthResult =
  | { ok: true; userId: string }
  | { ok: false; message: string };

function mapAuthError(error: { message: string } | null): string {
  if (!error?.message) return "Authentication failed. Please try again.";
  const msg = error.message.toLowerCase();
  if (msg.includes("invalid login")) {
    return "Email or password is incorrect.";
  }
  if (msg.includes("already registered") || msg.includes("already been registered")) {
    return "An account with this email already exists. Sign in instead.";
  }
  if (msg.includes("password")) {
    return error.message;
  }
  if (msg.includes("email")) {
    return error.message;
  }
  return error.message;
}

export async function signInWithPassword(
  email: string,
  password: string
): Promise<AuthResult> {
  const supabase = getSupabaseBrowserClient();
  if (!supabase) {
    return {
      ok: false,
      message:
        "Cloud vault is not configured. Add NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY.",
    };
  }

  const { data, error } = await supabase.auth.signInWithPassword({
    email: email.trim(),
    password,
  });

  if (error || !data.user) {
    return { ok: false, message: mapAuthError(error) };
  }

  return { ok: true, userId: data.user.id };
}

export async function signUpWithPassword(
  email: string,
  password: string,
  username: string
): Promise<AuthResult> {
  const supabase = getSupabaseBrowserClient();
  if (!supabase) {
    return {
      ok: false,
      message:
        "Cloud vault is not configured. Add NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY.",
    };
  }

  const stewardName = username.trim() || "Steward";

  const { data, error } = await supabase.auth.signUp({
    email: email.trim(),
    password,
    options: {
      data: { username: stewardName },
    },
  });

  if (error || !data.user) {
    return { ok: false, message: mapAuthError(error) };
  }

  const { error: profileError } = await supabase.from("profiles").upsert(
    {
      id: data.user.id,
      username: stewardName,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "id" }
  );

  if (profileError) {
    console.error("[auth] profile upsert failed", profileError);
  }

  return { ok: true, userId: data.user.id };
}

export async function signOutCloudSession(): Promise<AuthResult> {
  const supabase = getSupabaseBrowserClient();
  if (!supabase) {
    return { ok: true, userId: "" };
  }

  const { error } = await supabase.auth.signOut();
  if (error) {
    return { ok: false, message: mapAuthError(error) };
  }

  return { ok: true, userId: "" };
}

export async function upsertStewardProfile(
  userId: string,
  username: string
): Promise<void> {
  const supabase = getSupabaseBrowserClient();
  if (!supabase) return;

  const { error } = await supabase.from("profiles").upsert(
    {
      id: userId,
      username: username.trim() || "Steward",
      updated_at: new Date().toISOString(),
    },
    { onConflict: "id" }
  );

  if (error) {
    console.error("[auth] profile upsert failed", error);
  }
}
