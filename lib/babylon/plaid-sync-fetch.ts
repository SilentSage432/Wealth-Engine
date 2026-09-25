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
  if (!page) return { ok: false };
  return { ok: true, page };
}
