/**
 * Phone Home composition. Presentation order and preview windows only.
 * Financial figures stay the ones the engine already derived.
 */

import type { MobileDestination } from "@/lib/babylon/constants";
import { comingUpObligations } from "@/lib/babylon/recurring-obligations";
import type { ExpenseEntry } from "@/types/babylon";

/** Glance order. Due attention is omitted from the page when nothing is due. */
export const PHONE_HOME_SECTION_ORDER = [
  "attention",
  "financial-position",
  "available-after-planned-needs",
  "upcoming-needs",
  "recent-activity",
] as const;

export const PHONE_HOME_UPCOMING_LIMIT = 3;
export const PHONE_HOME_ACTIVITY_LIMIT = 3;

/** Links Home may use. They write the existing phone destination. */
export const PHONE_HOME_NAV_TARGETS = ["ledger", "more"] as const satisfies readonly MobileDestination[];

/**
 * Capabilities that left the phone Home catalog, and the destination that
 * still mounts them. Month-close Attention stays in the phone header.
 */
export const PHONE_MOVED_CAPABILITIES = {
  "spending-power": "budget",
  "golden-triad": "budget",
  "tribute-engines": "budget",
  "budget-blueprint": "budget",
  "debt-freedom": "budget",
  analytics: "budget",
  "affordability-anchor": "budget",
  "connected-banks": "more",
  "financial-guidance": "more",
  "account-management": "more",
  "close-month": "more",
  ledger: "ledger",
} as const satisfies Record<string, MobileDestination>;

export function phoneHomeShowsDueAttention(dueCount: number): boolean {
  return dueCount > 0;
}

/**
 * Next unpaid bills after the due-attention rows, in the existing
 * coming-up order (due date, then name). Due rows stay in Attention.
 */
export function phoneHomeUpcomingPreview(
  expenses: readonly ExpenseEntry[],
  dueIds: ReadonlySet<string>,
  limit = PHONE_HOME_UPCOMING_LIMIT
): ExpenseEntry[] {
  const ordered = comingUpObligations(expenses, expenses.length);
  const preview: ExpenseEntry[] = [];
  for (const expense of ordered) {
    if (dueIds.has(expense.id)) continue;
    preview.push(expense);
    if (preview.length >= limit) break;
  }
  return preview;
}

export function phoneHomeActivityPreview<T>(
  events: readonly T[],
  limit = PHONE_HOME_ACTIVITY_LIMIT
): T[] {
  return events.slice(0, limit);
}
