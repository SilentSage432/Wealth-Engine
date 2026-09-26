import "server-only";

import { fetchPlaidAccountIdentity } from "@/lib/babylon/plaid-sync-fetch";
import {
  bootstrapPlaidAccountIdentity,
  toPlaidAccountIdentityJson,
} from "@/lib/babylon/plaid-transaction-sync";
import type { Json } from "@/lib/supabase/database.types";
import type { BabylonServerSupabase } from "@/lib/supabase/server";

/**
 * After a successful observation sync, store Item account identity once
 * when this Item has no descriptors yet. Failure is logged and swallowed.
 * The transaction cursor is not read or written here.
 */
export async function bootstrapPlaidAccountIdentityIfAbsent(args: {
  service: BabylonServerSupabase;
  userId: string;
  itemRowId: string;
}): Promise<void> {
  try {
    const counted = await args.service
      .from("plaid_accounts")
      .select("id", { count: "exact", head: true })
      .eq("user_id", args.userId)
      .eq("plaid_item_id", args.itemRowId);
    if (counted.error || counted.count === null) {
      console.error("[plaid] account identity count failed.");
      return;
    }

    const outcome = await bootstrapPlaidAccountIdentity({
      descriptorCount: counted.count,
      loadAccessToken: async () => {
        const loaded = await args.service
          .from("plaid_items")
          .select("access_token")
          .eq("id", args.itemRowId)
          .eq("user_id", args.userId)
          .maybeSingle();
        if (loaded.error || !loaded.data?.access_token.trim()) return null;
        return loaded.data.access_token;
      },
      fetchAccounts: (accessToken) => fetchPlaidAccountIdentity({ accessToken }),
      persist: async (accounts) => {
        const { data, error } = await args.service.rpc(
          "upsert_plaid_account_identity",
          {
            actor_user_id: args.userId,
            target_item_id: args.itemRowId,
            accounts: toPlaidAccountIdentityJson(accounts) as Json,
          }
        );
        if (error || !data || typeof data !== "object" || Array.isArray(data)) {
          return false;
        }
        return data.status === "applied";
      },
    });
    if (outcome === "failed") {
      console.error("[plaid] account identity bootstrap failed.");
    }
  } catch {
    console.error("[plaid] account identity bootstrap failed.");
  }
}
