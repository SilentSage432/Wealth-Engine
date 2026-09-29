import { NextResponse } from "next/server";
import { isCanonicalSupabaseUrl } from "@/lib/babylon/notification-delivery";
import { plaidFetch, plaidJsonError } from "@/lib/babylon/plaid-server";
import {
  getSupabaseServiceClient,
  requireAuthenticatedUser,
} from "@/lib/supabase/server";

type LinkTokenCreateResponse = {
  link_token: string;
  expiration: string;
};

type LinkTokenBody = {
  item?: unknown;
};

/**
 * POST /api/plaid/link-token
 * Requires Supabase JWT.
 *
 * CONNECT (no item): create an initial Link token for a new institution.
 * REPAIR (item = local plaid_items.id): create an update-mode Link token for
 * an owned existing Item using its server-side access_token. No products list.
 * The access_token never leaves the server.
 */
export async function POST(request: Request) {
  const auth = await requireAuthenticatedUser(request);
  if (auth instanceof NextResponse) return auth;

  let body: LinkTokenBody = {};
  const raw = await request.text();
  if (raw.trim()) {
    try {
      body = JSON.parse(raw) as LinkTokenBody;
    } catch {
      return plaidJsonError("unexpected", 400);
    }
  }

  const itemRowId =
    typeof body.item === "string" ? body.item.trim() : body.item == null ? "" : null;
  if (itemRowId === null) {
    return plaidJsonError("unexpected", 400);
  }

  if (itemRowId) {
    return createRepairLinkToken({
      userId: auth.user.id,
      itemRowId,
    });
  }

  const result = await plaidFetch<LinkTokenCreateResponse>("/link/token/create", {
    user: { client_user_id: auth.user.id },
    client_name: "Wealth Engine",
    products: ["transactions"],
    country_codes: ["US"],
    language: "en",
  });

  if (!result.ok) return result.response;

  if (!result.data.link_token) {
    return plaidJsonError("link_token_failed", 502);
  }

  return NextResponse.json({
    link_token: result.data.link_token,
    expiration: result.data.expiration,
  });
}

async function createRepairLinkToken(args: {
  userId: string;
  itemRowId: string;
}): Promise<NextResponse> {
  if (!isCanonicalSupabaseUrl(process.env.NEXT_PUBLIC_SUPABASE_URL)) {
    return plaidJsonError("not_configured", 503);
  }
  const service = getSupabaseServiceClient();
  if (!service) {
    return plaidJsonError("not_configured", 503);
  }

  const loaded = await service
    .from("plaid_items")
    .select("access_token")
    .eq("id", args.itemRowId)
    .eq("user_id", args.userId)
    .maybeSingle();
  if (loaded.error || !loaded.data?.access_token?.trim()) {
    return plaidJsonError("item_not_found", 404);
  }

  const accessToken = loaded.data.access_token.trim();
  const result = await plaidFetch<LinkTokenCreateResponse>("/link/token/create", {
    user: { client_user_id: args.userId },
    client_name: "Wealth Engine",
    country_codes: ["US"],
    language: "en",
    access_token: accessToken,
  });

  if (!result.ok) return result.response;
  if (!result.data.link_token) {
    return plaidJsonError("link_token_failed", 502);
  }

  return NextResponse.json({
    link_token: result.data.link_token,
    expiration: result.data.expiration,
  });
}
