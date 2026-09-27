import "server-only";

import { toBalanceObservationJson } from "@/lib/babylon/balance-observation";
import { fetchPlaidAccountBalances } from "@/lib/babylon/plaid-sync-fetch";
import type { Json } from "@/lib/supabase/database.types";
import type { BabylonServerSupabase } from "@/lib/supabase/server";

/**
 * Store cached depository balances for one owned Item.
 * Runs whether or not identity descriptors already exist. Failure is logged
 * and swallowed, and the previous observation stays in place.
 * The transaction cursor is not read or written here.
 */
export async function recordPlaidBalanceObservations(args: {
  service: BabylonServerSupabase;
  userId: string;
  itemRowId: string;
}): Promise<void> {
  try {
    const loaded = await args.service
      .from("plaid_items")
      .select("access_token")
      .eq("id", args.itemRowId)
      .eq("user_id", args.userId)
      .maybeSingle();
    if (loaded.error || !loaded.data?.access_token.trim()) {
      console.error("[plaid] balance observation failed.");
      return;
    }

    const fetched = await fetchPlaidAccountBalances({
      accessToken: loaded.data.access_token,
    });
    if (!fetched.ok) {
      console.error("[plaid] balance observation failed.");
      return;
    }

    const { data, error } = await args.service.rpc("apply_plaid_balance_observations", {
      actor_user_id: args.userId,
      observations: toBalanceObservationJson(fetched.accounts) as Json,
    });
    if (error || !data || typeof data !== "object" || Array.isArray(data)) {
      console.error("[plaid] balance observation failed.");
      return;
    }
    if (data.status !== "applied") {
      console.error("[plaid] balance observation failed.");
    }
  } catch {
    console.error("[plaid] balance observation failed.");
  }
}
