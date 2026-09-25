import { NextResponse } from "next/server";
import { createSupabasePlaidObservationStore } from "@/lib/babylon/plaid-observation-store";
import { fetchPlaidTransactionSyncPage } from "@/lib/babylon/plaid-sync-fetch";
import {
  plaidSyncHttpResult,
  syncPlaidItemObservations,
} from "@/lib/babylon/plaid-transaction-sync";
import { plaidJsonError } from "@/lib/babylon/plaid-server";
import {
  getSupabaseServiceClient,
  requireAuthenticatedUser,
} from "@/lib/supabase/server";

type SyncBody = {
  id?: string;
};

/**
 * POST /api/plaid/sync-transactions
 * Owner-scoped observational sync. The body may carry the plaid_items UUID
 * only. Access tokens are loaded on the server and never returned.
 */
export async function POST(request: Request) {
  const auth = await requireAuthenticatedUser(request);
  if (auth instanceof NextResponse) return auth;

  let body: SyncBody;
  try {
    body = (await request.json()) as SyncBody;
  } catch {
    return plaidJsonError("missing_item", 400);
  }

  const itemRowId = body.id?.trim();
  if (!itemRowId) return plaidJsonError("missing_item", 400);

  const service = getSupabaseServiceClient();
  if (!service) {
    console.error(
      "[plaid] SUPABASE_SERVICE_ROLE_KEY missing — cannot sync transactions."
    );
    return plaidJsonError("persist_failed", 503);
  }

  const outcome = await syncPlaidItemObservations({
    userId: auth.user.id,
    itemRowId,
    store: createSupabasePlaidObservationStore(service),
    fetchPage: fetchPlaidTransactionSyncPage,
  });

  const http = plaidSyncHttpResult(outcome);
  return NextResponse.json(http.body, { status: http.status });
}
