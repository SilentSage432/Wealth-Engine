/**
 * Page/session reconciliation for ITEM_LOGIN_REQUIRED repair chrome.
 * Absence from repairs[] is not recovery. Only an Item-scoped applied
 * balance_get outcome clears that Item.
 */

import type {
  PlaidItemObservationOutcome,
  PlaidItemRepairSignal,
} from "@/lib/babylon/background-balance-observation";

/**
 * Merge prior repair state with one foreground observation summary.
 * Upsert ITEM_LOGIN_REQUIRED. Clear only on result === "applied".
 * skipped / not-applied / missing Items leave prior repair unchanged.
 */
export function reconcilePlaidItemRepairs(input: {
  previous: readonly PlaidItemRepairSignal[];
  repairs: readonly PlaidItemRepairSignal[];
  itemOutcomes: readonly PlaidItemObservationOutcome[];
}): PlaidItemRepairSignal[] {
  const next = new Map<string, PlaidItemRepairSignal>();
  for (const repair of input.previous) {
    if (repair.code !== "ITEM_LOGIN_REQUIRED") continue;
    const itemId = repair.itemId.trim();
    if (!itemId) continue;
    next.set(itemId, { itemId, code: "ITEM_LOGIN_REQUIRED" });
  }
  for (const repair of input.repairs) {
    if (repair.code !== "ITEM_LOGIN_REQUIRED") continue;
    const itemId = repair.itemId.trim();
    if (!itemId) continue;
    next.set(itemId, { itemId, code: "ITEM_LOGIN_REQUIRED" });
  }
  for (const outcome of input.itemOutcomes) {
    const itemId = outcome.itemId.trim();
    if (!itemId) continue;
    if (outcome.result === "applied") {
      next.delete(itemId);
    }
  }
  return [...next.values()];
}
