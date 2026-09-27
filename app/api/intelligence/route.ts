import { NextResponse } from "next/server";
import {
  ACCOUNT_ASSOCIATION_COLUMNS,
  BALANCE_OBSERVATION_COLUMNS,
  toAccountAssociationPublic,
  toBalanceObservationPublic,
  type AccountAssociationPublic,
  type BalanceObservationPublic,
} from "@/lib/babylon/balance-observation";
import {
  CLOUD_VAULT_SCHEMA_VERSION,
  parseCloudVaultData,
} from "@/lib/babylon/cloud-vault";
import {
  assembleIntelligenceContract,
  type IntelligenceBalanceEvidence,
} from "@/lib/babylon/intelligence-contract";
import {
  authorizeCronRequest,
  isCanonicalSupabaseUrl,
} from "@/lib/babylon/notification-delivery";
import {
  PLAID_ACCOUNT_PUBLIC_COLUMNS,
  toPlaidAccountPublic,
} from "@/lib/babylon/plaid-schema";
import {
  getSupabaseServiceClient,
  type BabylonServerSupabase,
} from "@/lib/supabase/server";

const READ_SECRET = "INTELLIGENCE_READ_SECRET";
const SELECTOR_PARAMS = new Set(["user", "user_id", "userId"]);

/**
 * Owner-scoped stored evidence for effective position.
 * A failed read is unavailable. It is not an empty success and it does not
 * fail the rest of the contract. This does not call Plaid.
 */
async function readBalanceEvidence(
  client: BabylonServerSupabase,
  userId: string
): Promise<IntelligenceBalanceEvidence> {
  try {
    const [accounts, observations, associations] = await Promise.all([
      client.from("plaid_accounts").select(PLAID_ACCOUNT_PUBLIC_COLUMNS).eq("user_id", userId),
      client
        .from("plaid_balance_observations")
        .select(BALANCE_OBSERVATION_COLUMNS)
        .eq("user_id", userId)
        .eq("state", "current"),
      client
        .from("plaid_account_associations")
        .select(ACCOUNT_ASSOCIATION_COLUMNS)
        .eq("user_id", userId),
    ]);
    if (
      accounts.error ||
      !accounts.data ||
      observations.error ||
      !observations.data ||
      associations.error ||
      !associations.data
    ) {
      return { status: "unavailable" };
    }
    return {
      status: "ready",
      plaidAccounts: accounts.data.map((row) =>
        toPlaidAccountPublic(
          row as {
            id: string;
            user_id: string;
            plaid_item_id: string;
            plaid_account_id: string;
            name: string | null;
            mask: string | null;
            account_type: string | null;
            subtype: string | null;
          }
        )
      ),
      observations: observations.data
        .map((row) =>
          toBalanceObservationPublic(
            row as {
              id: string;
              user_id: string;
              plaid_account_id: string;
              current_cents: number | null;
              available_cents: number | null;
              iso_currency_code: string | null;
              unofficial_currency_code: string | null;
              observed_at: string;
              source: string;
              state: string;
            }
          )
        )
        .filter((row): row is BalanceObservationPublic => row !== null),
      associations: associations.data
        .map((row) =>
          toAccountAssociationPublic(
            row as {
              id: string;
              user_id: string;
              financial_account_id: string;
              plaid_account_id: string;
              confirmed_at: string;
            }
          )
        )
        .filter((row): row is AccountAssociationPublic => row !== null),
    };
  } catch {
    return { status: "unavailable" };
  }
}

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

  const balanceEvidence = await readBalanceEvidence(client, vault.user_id);
  const now = new Date();
  const contract = assembleIntelligenceContract({
    state,
    ianaTimeZone: owned[0]?.iana_timezone ?? null,
    now,
    generatedAt: now.toISOString(),
    balanceEvidence,
  });
  return json(contract, 200);
}
