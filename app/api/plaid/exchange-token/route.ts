import { NextResponse } from "next/server";
import {
  persistExchangedPlaidItem,
  type PlaidItemWriteGateway,
} from "@/lib/babylon/plaid-item-persist";
import { plaidFetch, plaidJsonError } from "@/lib/babylon/plaid-server";
import {
  PLAID_ITEM_PUBLIC_COLUMNS,
  toPlaidItemPublic,
  type PlaidItemPublic,
} from "@/lib/babylon/plaid-schema";
import {
  getSupabaseServiceClient,
  requireAuthenticatedUser,
  type BabylonServerSupabase,
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
 * the secret via service role. An existing Item is updated only for the same
 * owner. Response never includes access_token.
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

  const persisted = await persistExchangedPlaidItem(
    createSupabasePlaidItemGateway(service),
    {
      actorUserId: auth.user.id,
      plaidItemId: itemId,
      accessToken,
      institutionName,
    }
  );

  if (persisted.status === "owned_elsewhere") {
    return plaidJsonError("item_owned_elsewhere", 409);
  }
  if (persisted.status !== "saved") {
    return plaidJsonError("persist_failed", 502);
  }

  return NextResponse.json({ item: persisted.item });
}

function createSupabasePlaidItemGateway(
  service: BabylonServerSupabase
): PlaidItemWriteGateway {
  return {
    async findByPlaidItemId(plaidItemId) {
      const { data, error } = await service
        .from("plaid_items")
        .select("id, user_id")
        .eq("item_id", plaidItemId)
        .maybeSingle();
      if (error || !data) return null;
      return { id: data.id, userId: data.user_id };
    },

    async updateOwnedItem(rowId, actorUserId, accessToken, institutionName) {
      const { data, error } = await service
        .from("plaid_items")
        .update({
          access_token: accessToken,
          institution_name: institutionName,
        })
        .eq("id", rowId)
        .eq("user_id", actorUserId)
        .select(PLAID_ITEM_PUBLIC_COLUMNS)
        .maybeSingle();
      if (error || !data) {
        console.error("[plaid] update item failed", error?.message);
        return null;
      }
      return toPublicItem(data);
    },

    async insertItem(input) {
      const { data, error } = await service
        .from("plaid_items")
        .insert({
          user_id: input.actorUserId,
          access_token: input.accessToken,
          item_id: input.plaidItemId,
          institution_name: input.institutionName,
        })
        .select(PLAID_ITEM_PUBLIC_COLUMNS)
        .maybeSingle();
      if (error || !data) {
        console.error("[plaid] persist item failed", error?.message);
        return { ok: false, conflict: error?.code === "23505" };
      }
      return { ok: true, item: toPublicItem(data) };
    },
  };
}

function toPublicItem(row: {
  id: string;
  user_id: string;
  item_id: string;
  institution_name: string;
  created_at: string;
}): PlaidItemPublic {
  return toPlaidItemPublic(row);
}
