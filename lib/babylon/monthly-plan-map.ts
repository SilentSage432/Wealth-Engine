/**
 * Pure presentation derivations for the Monthly Planning map.
 * Does not persist, allocate, or invent financial truth.
 */

import { roundMoney } from "@/lib/babylon/engine";
import { seedMonthlyPlanFromTargets } from "@/lib/babylon/monthly-plan";
import type {
  AllocationSplit,
  BudgetTarget,
  MonthlyPlanCategoryPurpose,
} from "@/types/babylon";

export type LivingPurposeMapState =
  | { kind: "awaiting_basis" }
  | { kind: "unmapped"; remainingCents: number }
  | { kind: "partial"; remainingCents: number }
  | { kind: "complete" }
  | { kind: "overcommitted"; overCents: number };

/** Month title for the planning workspace. Period remains caller-supplied. */
export function formatPlanMonthTitle(periodKey: string): string {
  const [year, month] = periodKey.split("-").map(Number);
  if (!year || !month || month < 1 || month > 12) return periodKey;
  return new Date(year, month - 1, 1).toLocaleDateString("en-US", {
    month: "long",
    year: "numeric",
  });
}

/**
 * Living-pool mapping state from preview cents.
 * Incomplete drafts remain visible; finalize still requires exact assignment.
 */
export function livingPurposeMapState(
  remainingCents: number | null,
  assignedCents: number | null
): LivingPurposeMapState {
  if (remainingCents === null || assignedCents === null) {
    return { kind: "awaiting_basis" };
  }
  if (remainingCents > 0 && assignedCents === 0) {
    return { kind: "unmapped", remainingCents };
  }
  if (remainingCents > 0) {
    return { kind: "partial", remainingCents };
  }
  if (remainingCents < 0) {
    return { kind: "overcommitted", overCents: Math.abs(remainingCents) };
  }
  return { kind: "complete" };
}

/**
 * Intention overlay only.
 * Already-protected Wealth Building designation + this plan's Wealth share.
 * Not Money Available, not tracked allocations, not Emergency Fund.
 */
export function planResultWealthBuilding(
  openingWealthBuilding: number,
  wealthShare: number
): {
  alreadyProtected: number;
  thisPlan: number;
  ifExecuted: number;
} {
  const alreadyProtected = roundMoney(Math.max(0, openingWealthBuilding));
  const thisPlan = roundMoney(Math.max(0, wealthShare));
  return {
    alreadyProtected,
    thisPlan,
    ifExecuted: roundMoney(alreadyProtected + thisPlan),
  };
}

/** Relative widths for the canonical split. Exact amounts stay authoritative. */
export function planSplitProportions(
  split: AllocationSplit,
  planningBasis: number
): {
  wealthRatio: number;
  debtRatio: number;
  livingRatio: number;
} {
  const basisCents = Math.round(roundMoney(Math.max(0, planningBasis)) * 100);
  if (basisCents <= 0) {
    return { wealthRatio: 0, debtRatio: 0, livingRatio: 0 };
  }
  const wealthCents = Math.round(roundMoney(split.wealthShare) * 100);
  const debtCents = Math.round(roundMoney(split.debtShare) * 100);
  const livingCents = Math.round(roundMoney(split.expenditureShare) * 100);
  return {
    wealthRatio: wealthCents / basisCents,
    debtRatio: debtCents / basisCents,
    livingRatio: livingCents / basisCents,
  };
}

export function totalRemainingDebtCents(
  debts: readonly { remainingDebt: number }[]
): number {
  return debts.reduce(
    (sum, debt) => sum + Math.round(roundMoney(debt.remainingDebt) * 100),
    0
  );
}

/**
 * First-draft only: append live BudgetTargets that are not yet purposes.
 * Does not overwrite steward-edited amounts. Does not invent categories.
 * Revise drafts must not call this — they stay on the revision seed.
 */
export function mergeFirstDraftPurposes(
  current: readonly MonthlyPlanCategoryPurpose[],
  targets: readonly BudgetTarget[]
): MonthlyPlanCategoryPurpose[] {
  const known = new Set(current.map((purpose) => purpose.id));
  const missing = targets.filter((target) => !known.has(target.id));
  if (missing.length === 0) return current as MonthlyPlanCategoryPurpose[];
  return [...current, ...seedMonthlyPlanFromTargets(missing)];
}

/** Pair amount fields for newly merged first-draft purposes. */
export function mergeFirstDraftAmountFields(
  current: Readonly<Record<string, string>>,
  targets: readonly BudgetTarget[]
): Record<string, string> {
  let changed = false;
  const next = { ...current };
  for (const target of targets) {
    if (next[target.id] === undefined) {
      next[target.id] = String(target.plannedAmount);
      changed = true;
    }
  }
  return changed ? next : (current as Record<string, string>);
}
