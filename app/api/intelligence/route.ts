import { NextResponse } from "next/server";
import {
  CLOUD_VAULT_SCHEMA_VERSION,
  parseCloudVaultData,
} from "@/lib/babylon/cloud-vault";
import { assembleIntelligenceContract } from "@/lib/babylon/intelligence-contract";
import {
  authorizeCronRequest,
  isCanonicalSupabaseUrl,
} from "@/lib/babylon/notification-delivery";
import { getSupabaseServiceClient } from "@/lib/supabase/server";

const READ_SECRET = "INTELLIGENCE_READ_SECRET";
const SELECTOR_PARAMS = new Set(["user", "user_id", "userId"]);

function json(body: unknown, status: number): NextResponse {
  return NextResponse.json(body, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
}

/**
 * GET /api/intelligence
 * Read-only contract for the single steward. The bearer is not a session
 * and not the scheduler secret. The response is not the vault.
 */
export async function GET(request: Request) {
  const secret = process.env[READ_SECRET];
  if (!secret || secret.length < 16 || /\s/.test(secret)) {
    return json({ error: "Intelligence contract is unavailable." }, 503);
  }
  if (!authorizeCronRequest(request.headers.get("authorization"), secret)) {
    return json({ error: "Unauthorized." }, 401);
  }

  const url = new URL(request.url);
  for (const key of url.searchParams.keys()) {
    if (SELECTOR_PARAMS.has(key)) {
      return json({ error: "This contract does not accept a user selector." }, 400);
    }
  }
  const raw = await request.text();
  if (raw.trim()) {
    return json({ error: "This contract does not accept a body." }, 400);
  }

  if (!isCanonicalSupabaseUrl(process.env.NEXT_PUBLIC_SUPABASE_URL)) {
    return json({ error: "Intelligence contract is unavailable." }, 503);
  }
  const client = getSupabaseServiceClient();
  if (!client) {
    return json({ error: "Intelligence contract is unavailable." }, 503);
  }

  const vaults = await client
    .from("wealth_engine_vaults")
    .select("user_id, schema_version, vault_data");
  if (vaults.error || !vaults.data || vaults.data.length !== 1) {
    return json({ error: "Intelligence contract is unavailable." }, 503);
  }
  const vault = vaults.data[0];
  if (vault.schema_version !== CLOUD_VAULT_SCHEMA_VERSION) {
    return json({ error: "Intelligence contract is unavailable." }, 503);
  }
  const state = parseCloudVaultData(vault.vault_data);
  if (!state) {
    return json({ error: "Intelligence contract is unavailable." }, 503);
  }

  const preferences = await client
    .from("notification_preferences")
    .select("user_id, iana_timezone");
  if (preferences.error || !preferences.data) {
    return json({ error: "Intelligence contract is unavailable." }, 503);
  }
  const owned = preferences.data.filter((row) => row.user_id === vault.user_id);
  if (owned.length > 1 || preferences.data.length !== owned.length) {
    return json({ error: "Intelligence contract is unavailable." }, 503);
  }

  const now = new Date();
  const contract = assembleIntelligenceContract({
    state,
    ianaTimeZone: owned[0]?.iana_timezone ?? null,
    now,
    generatedAt: now.toISOString(),
  });
  return json(contract, 200);
}
