/**
 * Allocation ≠ Execution — user-facing copy helpers.
 *
 * PURPOSE: what money was assigned to accomplish.
 * EXECUTION: evidence the intended action actually occurred.
 *
 * These strings do not change allocation math, debt waterfall, or persistence.
 * Income/month-close debt allocation still mutates remainingDebt as modeled
 * purpose progress (historical compatibility). That is not creditor settlement.
 */

import type { SurplusDisposition } from "@/types/babylon";

/** Golden Triad / paycheck: tracked wealth from allocations, not cash moved. */
export const TRACKED_WEALTH_HINT =
  "Tracked from income allocations — not proof cash moved.";

/** Golden Triad secondary line when opening Wealth Building is zero. */
export const WEALTH_PURPOSE_OUTSIDE_LIVING =
  "Allocated outside the Living Budget";

/** Percent of original debt reduced by WE modeled progress (not creditor receipt). */
export function modeledDebtProgressLabel(pct: number): string {
  return `${pct}% modeled progress`;
}

export function modeledDebtProgressAria(creditor: string, pct: number): string {
  return `${creditor} ${pct}% modeled progress`;
}

export const MODELED_REMAINING_HINT = "Modeled remaining";

export function paycheckWealthHint(): string {
  return "Allocated toward Wealth Building";
}

export function paycheckDebtHint(hasActiveDebt: boolean): string {
  if (hasActiveDebt) {
    return "Allocated toward debt · smallest balance first";
  }
  return "Redirected to Wealth Building";
}

export function paycheckLivingHint(): string {
  return "This month's Living Budget capacity";
}

export function phoneBudgetDebtShareNote(hasActiveDebt: boolean): string {
  if (hasActiveDebt) return "Allocated toward active debt.";
  return "No active debt. This share goes to Wealth Building.";
}

export function debtFreedomProjectionNote(): string {
  return "Projection from Wealth Engine's recorded debt balances — not a live creditor statement.";
}

export function monthCloseSweepDescription(
  id: SurplusDisposition,
  surplus: number,
  hasDebt: boolean,
  money: (n: number) => string
): string {
  if (id === "split_50_50" || id === "debt_wealth") {
    return hasDebt
      ? `Assign ${money(surplus)} between tracked Wealth Building and modeled debt progress.`
      : `Assign ${money(surplus)} toward tracked Wealth Building. There is no active debt.`;
  }
  if (id === "wealth_boost") {
    return `Assign ${money(surplus)} toward tracked Wealth Building.`;
  }
  if (id === "rollover") {
    return `Carry ${money(surplus)} into next month's Living Budget capacity.`;
  }
  return `Assign ${money(surplus)} to the tracked Emergency Fund (not a bank transfer).`;
}

export function monthCloseConfirmCopy(input: {
  monthLabel: string;
  dispositionLabel: string;
  surplus: number;
  money: (n: number) => string;
}): string {
  const surplusClause =
    input.surplus > 0 ? ` (${input.money(input.surplus)})` : "";
  return (
    `Confirming will close ${input.monthLabel}, save the month archive, and apply ` +
    `${input.dispositionLabel}${surplusClause}. ` +
    `Unpaid expenses stay unpaid. Account balances do not change.`
  );
}

export function monthCloseActivitySubtitle(
  disposition: SurplusDisposition
): string {
  switch (disposition) {
    case "emergency_shield":
      return "Surplus assigned to tracked Emergency Fund";
    case "wealth_boost":
      return "Surplus assigned to tracked Wealth Building";
    case "split_50_50":
      return "Surplus split between tracked Wealth Building and modeled debt progress";
    case "rollover":
      return "Surplus rolled into next month's Living Budget";
    case "debt_wealth":
      return "Surplus split between tracked Wealth Building and modeled debt progress";
    default:
      return "Surplus disposition recorded";
  }
}

/** Forbidden phrases that overclaim execution in close / debt / wealth copy. */
export const FORBIDDEN_EXECUTION_OVERCLAIMS = [
  "mark this month's open expenses as paid",
  "% paid off",
  "Applied to active debt",
  "Applied to the smallest balance first",
] as const;
