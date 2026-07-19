import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";

export type BabylonSupabaseClient = SupabaseClient<Database>;

let browserClient: BabylonSupabaseClient | null = null;
let missingEnvLogged = false;

function readPublicEnv(): { url: string; anonKey: string } | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim();

  if (!url || !anonKey) {
    if (!missingEnvLogged) {
      console.warn(
        "[supabase] Cloud client disabled — set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY to enable Path A sync."
      );
      missingEnvLogged = true;
    }
    return null;
  }

  return { url, anonKey };
}

/**
 * Browser Supabase singleton. Returns null when env is missing so the
 * local vault remains fully offline-capable.
 */
export function getSupabaseBrowserClient(): BabylonSupabaseClient | null {
  const env = readPublicEnv();
  if (!env) return null;

  if (!browserClient) {
    browserClient = createClient<Database>(env.url, env.anonKey, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
        storage:
          typeof window !== "undefined" ? window.localStorage : undefined,
      },
    });
  }

  return browserClient;
}

/** True when public Supabase env vars are present (client may still be anonymous). */
export function isSupabaseConfigured(): boolean {
  return readPublicEnv() !== null;
}
