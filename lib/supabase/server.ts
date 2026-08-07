import "server-only";

import { createClient, type SupabaseClient, type User } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import { NextResponse } from "next/server";

export type BabylonServerSupabase = SupabaseClient<Database>;

function readPublicEnv(): { url: string; anonKey: string } | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const anonKey =
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY?.trim() ||
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim();
  if (!url || !anonKey) return null;
  return { url, anonKey };
}

/**
 * Validates the caller's Supabase JWT from `Authorization: Bearer <token>`.
 * Returns the authenticated user or a fail-soft NextResponse (never throws).
 */
export async function requireAuthenticatedUser(
  request: Request
): Promise<{ user: User; accessToken: string } | NextResponse> {
  const env = readPublicEnv();
  if (!env) {
    return NextResponse.json(
      { error: "Cloud vault is not configured." },
      { status: 503 }
    );
  }

  const header = request.headers.get("authorization");
  const match = header?.match(/^Bearer\s+(.+)$/i);
  const accessToken = match?.[1]?.trim();
  if (!accessToken) {
    return NextResponse.json(
      { error: "Sign in required to connect a bank." },
      { status: 401 }
    );
  }

  const supabase = createClient<Database>(env.url, env.anonKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  });

  const { data, error } = await supabase.auth.getUser(accessToken);
  if (error || !data.user) {
    return NextResponse.json(
      { error: "Your session expired. Sign in again to continue." },
      { status: 401 }
    );
  }

  return { user: data.user, accessToken };
}

/**
 * Service-role client for writing Plaid secrets. Never import into client bundles.
 */
export function getSupabaseServiceClient(): BabylonServerSupabase | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!url || !serviceKey) return null;

  return createClient<Database>(url, serviceKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  });
}
