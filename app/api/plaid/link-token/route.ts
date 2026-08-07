import { NextResponse } from "next/server";
import { plaidFetch, plaidJsonError } from "@/lib/babylon/plaid-server";
import { requireAuthenticatedUser } from "@/lib/supabase/server";

type LinkTokenCreateResponse = {
  link_token: string;
  expiration: string;
};

/**
 * POST /api/plaid/link-token
 * Requires Supabase JWT. Creates a Plaid Link token for the signed-in steward.
 * PLAID_SECRET is used only inside plaid-server (never returned).
 */
export async function POST(request: Request) {
  const auth = await requireAuthenticatedUser(request);
  if (auth instanceof NextResponse) return auth;

  const result = await plaidFetch<LinkTokenCreateResponse>(
    "/link/token/create",
    {
      user: { client_user_id: auth.user.id },
      client_name: "Wealth Engine",
      products: ["transactions"],
      country_codes: ["US"],
      language: "en",
    }
  );

  if (!result.ok) return result.response;

  if (!result.data.link_token) {
    return plaidJsonError("link_token_failed", 502);
  }

  return NextResponse.json({
    link_token: result.data.link_token,
    expiration: result.data.expiration,
  });
}
