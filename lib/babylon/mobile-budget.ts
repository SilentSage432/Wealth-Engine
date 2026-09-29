/**
 * Phone Budget composition. Presentation order only.
 * Figures stay the ones the engine already derived.
 */

/** First-glance plan, then a closed deeper-analysis entry. */
export const PHONE_BUDGET_SECTION_ORDER = [
  "living-budget",
  "allocation-purpose",
  "monthly-plan",
  "category-plan",
  "debt-payoff",
  "deeper-analysis",
] as const;

/** Deeper panels stay unmounted until the steward opens one. */
export const PHONE_BUDGET_DEEPER_ACTIONS = [
  "income",
  "charts",
  "affordability",
] as const;

export type PhoneBudgetDeeper = (typeof PHONE_BUDGET_DEEPER_ACTIONS)[number];

export { phoneBudgetDebtShareNote } from "@/lib/babylon/allocation-execution-copy";
