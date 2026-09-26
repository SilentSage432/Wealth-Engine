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
  /**
   * Plaintext at rest. Readable by the service role only.
   * Not application-encrypted. Never render or serialize to the client.
   */
  accessToken: string;
};

/**
 * One current Plaid transaction observation.
 * `amount` uses Plaid's sign: positive is money out, negative is money in.
 */
export type PlaidObservationPublic = {
  id: string;
  userId: string;
  plaidTransactionId: string;
  pendingTransactionId: string | null;
  accountId: string;
  amount: number;
  name: string;
  category: string | null;
  date: string;
  pending: boolean;
};

export type PlaidTransactionRecord = PlaidObservationPublic & {
  removedAt: string | null;
  isProcessed: boolean;
};

/** Browser-safe env keys only. Secrets live in server env / plaid-server. */
export const PLAID_PUBLIC_ENV_KEYS = ["NEXT_PUBLIC_PLAID_ENV"] as const;

/** @deprecated Use PLAID_PUBLIC_ENV_KEYS — secret names must not ship in client probes. */
export const PLAID_ENV_KEYS = PLAID_PUBLIC_ENV_KEYS;

/** Columns allowed in client Supabase selects (excludes access_token). */
export const PLAID_ITEM_PUBLIC_COLUMNS =
  "id, user_id, item_id, institution_name, created_at" as const;

/**
 * Owner-scoped observation columns. No access token exists on this table.
 * `removed_at` is selected so a removed row can be dropped before display.
 */
export const PLAID_OBSERVATION_COLUMNS =
  "id, user_id, plaid_transaction_id, pending_transaction_id, account_id, amount, name, category, date, pending, removed_at" as const;

/** Owner-scoped account descriptors. No balances and no access token. */
export const PLAID_ACCOUNT_PUBLIC_COLUMNS =
  "id, user_id, plaid_item_id, plaid_account_id, name, mask, account_type, subtype" as const;

export type PlaidAccountPublic = {
  id: string;
  userId: string;
  plaidItemId: string;
  plaidAccountId: string;
  name: string | null;
  mask: string | null;
  accountType: string | null;
  subtype: string | null;
};

export function toPlaidAccountPublic(row: {
  id: string;
  user_id: string;
  plaid_item_id: string;
  plaid_account_id: string;
  name: string | null;
  mask: string | null;
  account_type: string | null;
  subtype: string | null;
}): PlaidAccountPublic {
  return {
    id: row.id,
    userId: row.user_id,
    plaidItemId: row.plaid_item_id,
    plaidAccountId: row.plaid_account_id,
    name: row.name,
    mask: row.mask,
    accountType: row.account_type,
    subtype: row.subtype,
  };
}

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

export function toPlaidObservationPublic(row: {
  id: string;
  user_id: string;
  plaid_transaction_id: string;
  pending_transaction_id: string | null;
  account_id: string;
  amount: number | string;
  name: string;
  category: string | null;
  date: string;
  pending: boolean;
  removed_at?: string | null;
}): PlaidObservationPublic | null {
  if (row.removed_at) return null;
  const amount =
    typeof row.amount === "number" ? row.amount : Number(row.amount);
  if (!Number.isFinite(amount)) return null;
  return {
    id: row.id,
    userId: row.user_id,
    plaidTransactionId: row.plaid_transaction_id,
    pendingTransactionId: row.pending_transaction_id,
    accountId: row.account_id,
    amount,
    name: row.name,
    category: row.category,
    date: row.date,
    pending: row.pending,
  };
}

export function isPlaidClientConfigured(): boolean {
  // Browser-safe probe — full secrets stay server-side when Link is wired.
  return Boolean(process.env.NEXT_PUBLIC_PLAID_ENV?.trim());
}
