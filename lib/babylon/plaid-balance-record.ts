import "server-only";

import { toBalanceObservationJson } from "@/lib/babylon/balance-observation";
import { fetchPlaidAccountBalances } from "@/lib/babylon/plaid-sync-fetch";
import type { Json } from "@/lib/supabase/database.types";
import type { BabylonServerSupabase } from "@/lib/supabase/server";

/** The observation RPC committed. Anything earlier is not a committed observation. */
export type BalanceObservationRecordResult = "applied" | "not-applied";

/**
 * Store cached depository balances for one owned Item.
 * Runs whether or not identity descriptors already exist. Failure is logged
 * and swallowed, and the previous observation stays in place.
 * The transaction cursor is not read or written here.
 * `applied` means the observation RPC returned its accepted success result.
 */
export async function recordPlaidBalanceObservations(args: {
  service: BabylonServerSupabase;
  userId: string;
  itemRowId: string;
}): Promise<BalanceObservationRecordResult> {
  try {
    const loaded = await args.service
      .from("plaid_items")
      .select("access_token")
      .eq("id", args.itemRowId)
      .eq("user_id", args.userId)
      .maybeSingle();
    if (loaded.error || !loaded.data?.access_token.trim()) {
      console.error("[plaid] balance observation failed.");
      return "not-applied";
    }

    const fetched = await fetchPlaidAccountBalances({
      accessToken: loaded.data.access_token,
    });
    if (!fetched.ok) {
      console.error("[plaid] balance observation failed.");
      return "not-applied";
    }

    const { data, error } = await args.service.rpc("apply_plaid_balance_observations", {
      actor_user_id: args.userId,
      observations: toBalanceObservationJson(fetched.accounts) as Json,
    });
    if (error || !data || typeof data !== "object" || Array.isArray(data)) {
      console.error("[plaid] balance observation failed.");
      return "not-applied";
    }
    if (data.status !== "applied") {
      console.error("[plaid] balance observation failed.");
      return "not-applied";
    }
    return "applied";
  } catch {
    console.error("[plaid] balance observation failed.");
    return "not-applied";
  }
}
