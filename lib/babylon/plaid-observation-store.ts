import "server-only";

import type { PlaidObservationSyncStore } from "@/lib/babylon/plaid-transaction-sync";
import type { Json } from "@/lib/supabase/database.types";
import type { BabylonServerSupabase } from "@/lib/supabase/server";

/**
 * Durable sync store. Claim, page apply, and release are Postgres functions
 * so the cursor cannot move backward and a page is stored with its cursor.
 */
export function createSupabasePlaidObservationStore(
  service: BabylonServerSupabase
): PlaidObservationSyncStore {
  return {
    async claim(input) {
      const { data, error } = await service.rpc("claim_plaid_transaction_sync", {
        actor_user_id: input.userId,
        target_item_id: input.itemRowId,
        lock_token: input.lockId,
        stale_before: new Date(input.staleBeforeMs).toISOString(),
      });
      if (error) return { status: "error" };
      const record = asRecord(data);
      if (!record) return { status: "error" };
      if (record.status === "busy") return { status: "busy" };
      if (record.status === "not_found") return { status: "not_found" };
      if (
        record.status === "claimed" &&
        typeof record.access_token === "string" &&
        record.access_token.trim()
      ) {
        return {
          status: "claimed",
          accessToken: record.access_token,
          cursor: typeof record.cursor === "string" ? record.cursor : null,
          plaidItemId:
            typeof record.plaid_item_id === "string" ? record.plaid_item_id : "",
        };
      }
      return { status: "error" };
    },

    async applyPage(input) {
      const { data, error } = await service.rpc("apply_plaid_sync_page", {
        actor_user_id: input.userId,
        target_item_id: input.itemRowId,
        lock_token: input.lockId,
        expected_cursor: input.expectedCursor,
        next_cursor: input.nextCursor,
        observations: input.drafts.map((draft) => ({
          plaid_transaction_id: draft.plaidTransactionId,
          pending_transaction_id: draft.pendingTransactionId,
          account_id: draft.accountId,
          amount: draft.amount,
          name: draft.name,
          category: draft.category,
          date: draft.date,
          pending: draft.pending,
        })) as Json,
        removed_ids: [...input.removedIds],
        accounts: input.accounts.map((account) => ({
          plaid_account_id: account.plaidAccountId,
          name: account.name,
          mask: account.mask,
          account_type: account.accountType,
          subtype: account.subtype,
        })) as Json,
      });
      if (error) return { status: "error" };
      const record = asRecord(data);
      if (!record || typeof record.status !== "string") return { status: "error" };
      if (
        record.status === "applied" ||
        record.status === "not_found" ||
        record.status === "lost_lock" ||
        record.status === "cursor_conflict" ||
        record.status === "rejected"
      ) {
        return { status: record.status };
      }
      return { status: "error" };
    },

    async release(input) {
      const { error } = await service.rpc("release_plaid_transaction_sync", {
        actor_user_id: input.userId,
        target_item_id: input.itemRowId,
        lock_token: input.lockId,
      });
      if (error) {
        console.error("[plaid] release sync lock failed", error.message);
      }
    },
  };
}

function asRecord(value: Json | null): Record<string, Json | undefined> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value;
}
