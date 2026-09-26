import "server-only";

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
