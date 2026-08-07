/**
 * Plaid integration foundation — typed contracts for future Link + sync.
 * Ownership: Persistence/Infrastructure prep only. No live Plaid SDK calls yet.
 */

export type PlaidItemRecord = {
  id: string;
  userId: string;
  /** Encrypted / server-held in production — never render in UI. */
  accessToken: string;
  itemId: string;
  institutionName: string;
  createdAt: string;
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

/** Env keys reserved for Path B Plaid enablement. */
export const PLAID_ENV_KEYS = [
  "NEXT_PUBLIC_PLAID_ENV",
  "PLAID_CLIENT_ID",
  "PLAID_SECRET",
] as const;

export function isPlaidClientConfigured(): boolean {
  // Browser-safe probe — full secrets stay server-side when Link is wired.
  return Boolean(process.env.NEXT_PUBLIC_PLAID_ENV?.trim());
}
