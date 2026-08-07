/**
 * Plaid integration contracts.
 *
 * Ownership:
 * - Client-safe types / env probes: this module (Persistence prep)
 * - Secrets + REST: `lib/babylon/plaid-server.ts` (server-only)
 * - JWT + service role: `lib/supabase/server.ts` (server-only)
 *
 * Never import `plaid-server` or `PLAID_SECRET` from hooks/components.
 */

/** Public metadata safe for UI / client state — no access_token. */
export type PlaidItemPublic = {
  id: string;
  userId: string;
  itemId: string;
  institutionName: string;
  createdAt: string;
};

/**
 * Server-only full row. Do not put this type into React state or hook returns.
 * Prefer `PlaidItemPublic` anywhere the browser can see data.
 */
export type PlaidItemSecret = PlaidItemPublic & {
  /** Encrypted / service-role held — never render or serialize to the client. */
  accessToken: string;
};

export type PlaidTransactionRecord = {
  id: string;
  userId: string;
  plaidTransactionId: string;
  accountId: string;
  amount: number;
  name: string;
  category: string | null;
  date: string;
  pending: boolean;
  isProcessed: boolean;
};

/** Browser-safe env keys only. Secrets live in server env / plaid-server. */
export const PLAID_PUBLIC_ENV_KEYS = ["NEXT_PUBLIC_PLAID_ENV"] as const;

/** @deprecated Use PLAID_PUBLIC_ENV_KEYS — secret names must not ship in client probes. */
export const PLAID_ENV_KEYS = PLAID_PUBLIC_ENV_KEYS;

/** Columns allowed in client Supabase selects (excludes access_token). */
export const PLAID_ITEM_PUBLIC_COLUMNS =
  "id, user_id, item_id, institution_name, created_at" as const;

export function toPlaidItemPublic(row: {
  id: string;
  user_id: string;
  item_id: string;
  institution_name: string;
  created_at: string;
}): PlaidItemPublic {
  return {
    id: row.id,
    userId: row.user_id,
    itemId: row.item_id,
    institutionName: row.institution_name,
    createdAt: row.created_at,
  };
}

export function isPlaidClientConfigured(): boolean {
  // Browser-safe probe — full secrets stay server-side when Link is wired.
  return Boolean(process.env.NEXT_PUBLIC_PLAID_ENV?.trim());
}
