import "server-only";

import {
  parsePlaidBalanceGetResponse,
  type PlaidBalanceDraft,
} from "@/lib/babylon/balance-observation";
import { plaidFetch } from "@/lib/babylon/plaid-server";
import {
  parsePlaidAccountsGetResponse,
  parsePlaidTransactionsSyncResponse,
  plaidTransactionsSyncBody,
  type PlaidAccountDraft,
  type PlaidSyncFetchResult,
} from "@/lib/babylon/plaid-transaction-sync";

/** One Plaid /transactions/sync page. The access token stays on the server. */
export async function fetchPlaidTransactionSyncPage(args: {
  accessToken: string;
  cursor: string | null;
}): Promise<PlaidSyncFetchResult> {
  const result = await plaidFetch<unknown>(
    "/transactions/sync",
    plaidTransactionsSyncBody(args.accessToken, args.cursor)
  );
  if (!result.ok) return { ok: false };
  const page = parsePlaidTransactionsSyncResponse(result.data);
  if (!page) return { ok: false };
  return { ok: true, page };
}

/** Item account identity. The access token stays on the server. */
export async function fetchPlaidAccountIdentity(args: {
  accessToken: string;
}): Promise<{ ok: true; accounts: PlaidAccountDraft[] } | { ok: false }> {
  const result = await plaidFetch<unknown>("/accounts/get", {
    access_token: args.accessToken,
  });
  if (!result.ok) return { ok: false };
  const accounts = parsePlaidAccountsGetResponse(result.data);
  if (!accounts) return { ok: false };
  return { ok: true, accounts };
}

/**
 * Cached balances from /accounts/get. Identity parsing stays separate and
 * still drops balances. This does not request a live balance pull.
 */
export async function fetchPlaidAccountBalances(args: {
  accessToken: string;
}): Promise<{ ok: true; accounts: PlaidBalanceDraft[] } | { ok: false }> {
  const result = await plaidFetch<unknown>("/accounts/get", {
    access_token: args.accessToken,
  });
  if (!result.ok) return { ok: false };
  const accounts = parsePlaidBalanceGetResponse(result.data);
  if (!accounts) return { ok: false };
  return { ok: true, accounts };
}

/**
 * Institution-refreshed balances.
 * The response uses the same accounts[].balances fields as the cached read.
 * account_ids are chosen by the server. An empty list is not a request.
 */
export async function fetchPlaidRealtimeBalances(args: {
  accessToken: string;
  accountIds: readonly string[];
}): Promise<{ ok: true; accounts: PlaidBalanceDraft[] } | { ok: false }> {
  const accountIds = args.accountIds.map((id) => id.trim()).filter((id) => id.length > 0);
  if (accountIds.length === 0) return { ok: false };
  const result = await plaidFetch<unknown>("/accounts/balance/get", {
    access_token: args.accessToken,
    options: { account_ids: accountIds },
  });
  if (!result.ok) return { ok: false };
  const accounts = parsePlaidBalanceGetResponse(result.data);
  if (!accounts) return { ok: false };
  const allowed = new Set(accountIds);
  return { ok: true, accounts: accounts.filter((account) => allowed.has(account.plaidAccountId)) };
}
