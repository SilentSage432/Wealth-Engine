import { NextResponse } from "next/server";
import {
  observeBackgroundBalances,
  readPlaidItemOwners,
} from "@/lib/babylon/background-balance-observation";
import { recordPlaidBalanceObservations } from "@/lib/babylon/plaid-balance-record";
import {
  authorizeCronRequest,
  isCanonicalSupabaseUrl,
} from "@/lib/babylon/notification-delivery";
import {
  getSupabaseServiceClient,
  requireAuthenticatedUser,
} from "@/lib/supabase/server";

/**
 * GET /api/plaid/observe-balances
 * Daily cached balance observation. Vercel Cron sends Authorization: Bearer CRON_SECRET.
 * The request cannot choose a user, an Item, or an account.
 * This route stores observations only. It does not accept a balance or write the vault.
 */
export async function GET(request: Request) {
  if (
    !authorizeCronRequest(
      request.headers.get("authorization"),
      process.env.CRON_SECRET
    )
  ) {
    return json({ error: "Unauthorized." }, 401);
  }
  if (!isCanonicalSupabaseUrl(process.env.NEXT_PUBLIC_SUPABASE_URL)) {
    return json({ error: "Balance observation is unavailable." }, 503);
  }
  const service = getSupabaseServiceClient();
  if (!service) {
    return json({ error: "Balance observation is unavailable." }, 503);
  }

  const listed = await service.from("plaid_items").select("id, user_id");
  if (listed.error || !listed.data) {
    console.error("[plaid] background balance observation failed.");
    return json({ error: "Balance observation is unavailable." }, 503);
  }
  const items = readPlaidItemOwners(listed.data);
  if (!items) {
    console.error("[plaid] background balance observation failed.");
    return json({ error: "Balance observation is unavailable." }, 503);
  }

  const summary = await observeBackgroundBalances({
    items,
    record: (item) =>
      recordPlaidBalanceObservations({
        service,
        userId: item.userId,
        itemRowId: item.id,
      }),
  });
  return json(summary, 200);
}

/**
 * POST /api/plaid/observe-balances
 * Signed-in cached balance observation. The session chooses the owner.
 * The body cannot choose a user, an Item, or an account.
 * This does not sync transactions, accept a balance, or write the vault.
 */
export async function POST(request: Request) {
  const auth = await requireAuthenticatedUser(request);
  if (auth instanceof NextResponse) return auth;

  const raw = await request.text();
  if (raw.trim()) {
    return json({ error: "This request does not accept a body." }, 400);
  }
  if (!isCanonicalSupabaseUrl(process.env.NEXT_PUBLIC_SUPABASE_URL)) {
    return json({ error: "Balance observation is unavailable." }, 503);
  }
  const service = getSupabaseServiceClient();
  if (!service) {
    return json({ error: "Balance observation is unavailable." }, 503);
  }

  const listed = await service
    .from("plaid_items")
    .select("id, user_id")
    .eq("user_id", auth.user.id);
  if (listed.error || !listed.data) {
    console.error("[plaid] foreground balance observation failed.");
    return json({ error: "Balance observation is unavailable." }, 503);
  }
  const items = readPlaidItemOwners(listed.data);
  if (!items || items.some((item) => item.userId !== auth.user.id)) {
    console.error("[plaid] foreground balance observation failed.");
    return json({ error: "Balance observation is unavailable." }, 503);
  }

  const summary = await observeBackgroundBalances({
    items,
    record: (item) =>
      recordPlaidBalanceObservations({
        service,
        userId: item.userId,
        itemRowId: item.id,
      }),
  });
  return json(summary, 200);
}

function json(
  body:
    | { error: string }
    | { items: number; attempted: number; applied: number; notApplied: number },
  status: number
) {
  return NextResponse.json(body, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
}
