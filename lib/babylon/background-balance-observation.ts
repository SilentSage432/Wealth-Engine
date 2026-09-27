import type { BalanceObservationRecordResult } from "@/lib/babylon/plaid-balance-record";

/**
 * Daily server wake for cached balance observation.
 * Enumerates owner/Item pairs and calls the existing recorder.
 * It does not sync transactions, write the vault, or decide Financial Position.
 */

export type BackgroundBalanceItem = {
  id: string;
  userId: string;
};

export type BackgroundBalanceSummary = {
  items: number;
  attempted: number;
  applied: number;
  notApplied: number;
};

/**
 * Rows from `plaid_items` selected as `id, user_id` only.
 * A malformed list is unavailable. It is not treated as an empty institution.
 */
export function readPlaidItemOwners(rows: unknown): BackgroundBalanceItem[] | null {
  if (!Array.isArray(rows)) return null;
  const items: BackgroundBalanceItem[] = [];
  for (const row of rows) {
    if (!row || typeof row !== "object" || Array.isArray(row)) return null;
    const record = row as { id?: unknown; user_id?: unknown };
    if (typeof record.id !== "string" || typeof record.user_id !== "string") return null;
    const id = record.id.trim();
    const userId = record.user_id.trim();
    if (!id || !userId) return null;
    items.push({ id, userId });
  }
  return items;
}

/**
 * One attempt per authoritative pair. A thrown recorder does not stop the rest.
 * `applied` counts only a recorder result that the observation RPC committed.
 */
export async function observeBackgroundBalances(input: {
  items: readonly BackgroundBalanceItem[];
  record: (item: BackgroundBalanceItem) => Promise<BalanceObservationRecordResult>;
}): Promise<BackgroundBalanceSummary> {
  let attempted = 0;
  let applied = 0;
  let notApplied = 0;
  for (const item of input.items) {
    attempted += 1;
    try {
      if ((await input.record(item)) === "applied") applied += 1;
      else notApplied += 1;
    } catch {
      notApplied += 1;
      console.error("[plaid] background balance observation failed.");
    }
  }
  return { items: input.items.length, attempted, applied, notApplied };
}
