import "server-only";

import {
  associatedDepositoryAccountIds,
  toBalanceObservationJson,
  type BalanceObservationSource,
} from "@/lib/babylon/balance-observation";
import { realtimeBalanceRequestNeeded } from "@/lib/babylon/foreground-balance-refresh";
import { logRealtimeBalanceStage } from "@/lib/babylon/realtime-balance-diagnostics";
import {
  fetchPlaidAccountBalances,
  fetchPlaidRealtimeBalances,
} from "@/lib/babylon/plaid-sync-fetch";
import type { Json } from "@/lib/supabase/database.types";
import type { BabylonServerSupabase } from "@/lib/supabase/server";

/** The observation RPC committed. Anything earlier is not a committed observation. */
export type BalanceObservationRecordResult = "applied" | "not-applied";

/** Realtime recorder outcome. Repair is only ITEM_LOGIN_REQUIRED. */
export type RealtimeBalanceObservationOutcome = {
  /**
   * applied = balance_get RPC committed.
   * skipped = no Balance write (no targets / fresh duplicate).
   * not-applied = failure.
   */
  result: "applied" | "skipped" | "not-applied";
  repair?: "ITEM_LOGIN_REQUIRED";
};

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
      observations: toBalanceObservationJson(fetched.accounts, "accounts_get") as Json,
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

type TargetAccountRow = {
  plaidAccountId: string;
  accountType: string | null;
  subtype: string | null;
};

type StoredBalanceRow = {
  plaidAccountId: string;
  source: string;
  observedAt: string;
};

function readText(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed || null;
}

function readTargetAccounts(rows: unknown): TargetAccountRow[] | null {
  if (!Array.isArray(rows)) return null;
  const accounts: TargetAccountRow[] = [];
  for (const row of rows) {
    if (!row || typeof row !== "object" || Array.isArray(row)) return null;
    const record = row as {
      plaid_account_id?: unknown;
      account_type?: unknown;
      subtype?: unknown;
    };
    const plaidAccountId = readText(record.plaid_account_id);
    if (!plaidAccountId) return null;
    accounts.push({
      plaidAccountId,
      accountType: readText(record.account_type),
      subtype: readText(record.subtype),
    });
  }
  return accounts;
}

function readAssociatedIds(rows: unknown): string[] | null {
  if (!Array.isArray(rows)) return null;
  const ids: string[] = [];
  for (const row of rows) {
    if (!row || typeof row !== "object" || Array.isArray(row)) return null;
    const id = readText((row as { plaid_account_id?: unknown }).plaid_account_id);
    if (!id) return null;
    ids.push(id);
  }
  return ids;
}

function readStoredBalances(rows: unknown): StoredBalanceRow[] | null {
  if (!Array.isArray(rows)) return null;
  const stored: StoredBalanceRow[] = [];
  for (const row of rows) {
    if (!row || typeof row !== "object" || Array.isArray(row)) return null;
    const record = row as {
      plaid_account_id?: unknown;
      source?: unknown;
      observed_at?: unknown;
    };
    const plaidAccountId = readText(record.plaid_account_id);
    const source = readText(record.source);
    const observedAt = readText(record.observed_at);
    if (!plaidAccountId || !source || !observedAt) return null;
    stored.push({ plaidAccountId, source, observedAt });
  }
  return stored;
}

async function commitBalanceObservations(args: {
  service: BabylonServerSupabase;
  userId: string;
  drafts: Parameters<typeof toBalanceObservationJson>[0];
  source: BalanceObservationSource;
  diagnose?: boolean;
}): Promise<BalanceObservationRecordResult> {
  const { data, error } = await args.service.rpc("apply_plaid_balance_observations", {
    actor_user_id: args.userId,
    observations: toBalanceObservationJson(args.drafts, args.source) as Json,
  });
  if (error || !data || typeof data !== "object" || Array.isArray(data)) {
    if (args.diagnose) {
      logRealtimeBalanceStage("rpc-result", {
        result: "failed",
        reason: error ? "rpc_error" : "rpc_shape",
      });
    }
    console.error("[plaid] balance observation failed.");
    return "not-applied";
  }
  const status = typeof data.status === "string" ? data.status : "unknown";
  if (status !== "applied") {
    if (args.diagnose) {
      logRealtimeBalanceStage("rpc-result", { result: "not-applied", status });
    }
    console.error("[plaid] balance observation failed.");
    return "not-applied";
  }
  if (args.diagnose) {
    logRealtimeBalanceStage("rpc-result", {
      result: "applied",
      drafts: args.drafts.length,
    });
  }
  return "applied";
}

/**
 * Store an institution-refreshed balance for associated depository accounts
 * on one owned Item. No association means no Balance request. A current
 * balance_get inside the duplicate guard is not requested again. Failure
 * leaves the stored observation in place and does not call /accounts/get.
 */
export async function recordPlaidRealtimeBalanceObservations(args: {
  service: BabylonServerSupabase;
  userId: string;
  itemRowId: string;
  nowMs?: number;
}): Promise<RealtimeBalanceObservationOutcome> {
  try {
    const accountsResult = await args.service
      .from("plaid_accounts")
      .select("plaid_account_id, account_type, subtype")
      .eq("user_id", args.userId)
      .eq("plaid_item_id", args.itemRowId);
    if (accountsResult.error) {
      logRealtimeBalanceStage("targets-derived", {
        result: "not-applied",
        reason: "descriptors_query",
      });
      console.error("[plaid] balance observation failed.");
      return { result: "not-applied" };
    }
    const accounts = readTargetAccounts(accountsResult.data);
    const linksResult = await args.service
      .from("plaid_account_associations")
      .select("plaid_account_id")
      .eq("user_id", args.userId);
    if (linksResult.error) {
      logRealtimeBalanceStage("targets-derived", {
        result: "not-applied",
        reason: "associations_query",
      });
      console.error("[plaid] balance observation failed.");
      return { result: "not-applied" };
    }
    const associatedIds = readAssociatedIds(linksResult.data);
    if (!accounts || !associatedIds) {
      logRealtimeBalanceStage("targets-derived", {
        result: "not-applied",
        reason: "targets_parse",
      });
      console.error("[plaid] balance observation failed.");
      return { result: "not-applied" };
    }
    const accountIds = associatedDepositoryAccountIds({
      accounts,
      associatedPlaidAccountIds: associatedIds,
    });
    logRealtimeBalanceStage("targets-derived", {
      descriptors: accounts.length,
      associated: associatedIds.length,
      eligible: accountIds.length,
    });
    if (accountIds.length === 0) {
      logRealtimeBalanceStage("balance-skipped", {
        reason: "no-eligible-targets",
        result: "skipped",
      });
      return { result: "skipped" };
    }

    const storedResult = await args.service
      .from("plaid_balance_observations")
      .select("plaid_account_id, source, observed_at")
      .eq("user_id", args.userId)
      .eq("state", "current")
      .in("plaid_account_id", accountIds);
    if (storedResult.error) {
      logRealtimeBalanceStage("balance-skipped", {
        reason: "stored_query",
        result: "not-applied",
      });
      console.error("[plaid] balance observation failed.");
      return { result: "not-applied" };
    }
    const stored = readStoredBalances(storedResult.data);
    if (!stored) {
      logRealtimeBalanceStage("balance-skipped", {
        reason: "stored_parse",
        result: "not-applied",
      });
      console.error("[plaid] balance observation failed.");
      return { result: "not-applied" };
    }
    const nowMs = args.nowMs ?? Date.now();
    if (
      !realtimeBalanceRequestNeeded({
        accountIds,
        observations: stored,
        nowMs,
      })
    ) {
      logRealtimeBalanceStage("balance-skipped", {
        reason: "fresh-balance-get",
        result: "skipped",
      });
      return { result: "skipped" };
    }

    const loaded = await args.service
      .from("plaid_items")
      .select("access_token")
      .eq("id", args.itemRowId)
      .eq("user_id", args.userId)
      .maybeSingle();
    if (loaded.error || !loaded.data?.access_token.trim()) {
      logRealtimeBalanceStage("balance-request-failed", {
        reason: "missing_access_token",
      });
      console.error("[plaid] balance observation failed.");
      return { result: "not-applied" };
    }

    logRealtimeBalanceStage("balance-request-start", {
      eligible: accountIds.length,
    });
    const fetched = await fetchPlaidRealtimeBalances({
      accessToken: loaded.data.access_token,
      accountIds,
    });
    if (!fetched.ok) {
      logRealtimeBalanceStage("balance-request-failed", {
        reason: fetched.reason,
      });
      console.error("[plaid] balance observation failed.");
      if (fetched.reason === "item_login_required") {
        return { result: "not-applied", repair: "ITEM_LOGIN_REQUIRED" };
      }
      return { result: "not-applied" };
    }
    logRealtimeBalanceStage("balance-parsed", {
      accounts: fetched.accounts.length,
    });

    const committed = await commitBalanceObservations({
      service: args.service,
      userId: args.userId,
      drafts: fetched.accounts,
      source: "balance_get",
      diagnose: true,
    });
    return { result: committed === "applied" ? "applied" : "not-applied" };
  } catch {
    logRealtimeBalanceStage("balance-request-failed", { reason: "thrown" });
    console.error("[plaid] balance observation failed.");
    return { result: "not-applied" };
  }
}
