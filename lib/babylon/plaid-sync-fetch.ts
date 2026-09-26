import "server-only";

import { plaidFetch } from "@/lib/babylon/plaid-server";
import {
  parsePlaidTransactionsSyncResponse,
  plaidTransactionsSyncBody,
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
  const rawAccounts =
    result.data &&
    typeof result.data === "object" &&
    !Array.isArray(result.data) &&
    Array.isArray((result.data as { accounts?: unknown }).accounts)
      ? (result.data as { accounts: unknown[] }).accounts
      : null;
  console.log("[WE-ATTENTION-ACCOUNT-PROBE]", {
    accountsPresent: rawAccounts !== null,
    accountsCount: rawAccounts ? rawAccounts.length : 0,
    parsedAccountsCount: page ? page.accounts.length : 0,
    pageAccepted: page !== null,
  });
  if (!page) return { ok: false };
  return { ok: true, page };
}
