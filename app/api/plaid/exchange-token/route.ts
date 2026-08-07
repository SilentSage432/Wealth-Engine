import { NextResponse } from "next/server";
import { plaidFetch, plaidJsonError } from "@/lib/babylon/plaid-server";
import {
  getSupabaseServiceClient,
  requireAuthenticatedUser,
} from "@/lib/supabase/server";

type ExchangeResponse = {
  access_token: string;
  item_id: string;
};

type ExchangeBody = {
  public_token?: string;
  institution_name?: string;
};

/**
 * POST /api/plaid/exchange-token
 * Requires Supabase JWT. Exchanges public_token → access_token and persists
 * the secret via service role. Response never includes access_token.
 */
export async function POST(request: Request) {
  const auth = await requireAuthenticatedUser(request);
  if (auth instanceof NextResponse) return auth;

  let body: ExchangeBody;
  try {
    body = (await request.json()) as ExchangeBody;
  } catch {
    return plaidJsonError("missing_public_token", 400);
  }

  const publicToken = body.public_token?.trim();
  if (!publicToken) {
    return plaidJsonError("missing_public_token", 400);
  }

  const institutionName =
    body.institution_name?.trim() || "Connected institution";

  const exchanged = await plaidFetch<ExchangeResponse>(
    "/item/public_token/exchange",
    { public_token: publicToken }
  );

  if (!exchanged.ok) return exchanged.response;

  const { access_token: accessToken, item_id: itemId } = exchanged.data;
  if (!accessToken || !itemId) {
    return plaidJsonError("exchange_failed", 502);
  }

  const service = getSupabaseServiceClient();
  if (!service) {
    console.error(
      "[plaid] SUPABASE_SERVICE_ROLE_KEY missing — cannot persist item."
    );
    return plaidJsonError("persist_failed", 503);
  }

  const { data, error } = await service
    .from("plaid_items")
    .upsert(
      {
        user_id: auth.user.id,
        access_token: accessToken,
        item_id: itemId,
        institution_name: institutionName,
      },
      { onConflict: "item_id" }
    )
    .select("id, user_id, item_id, institution_name, created_at")
    .single();

  if (error || !data) {
    console.error("[plaid] persist item failed", error?.message);
    return plaidJsonError("persist_failed", 502);
  }

  // Explicit public shape — access_token never leaves the server.
  return NextResponse.json({
    item: {
      id: data.id,
      userId: data.user_id,
      itemId: data.item_id,
      institutionName: data.institution_name,
      createdAt: data.created_at,
    },
  });
}
