/**
 * Financial Position composition — labels and sibling context only.
 * Does not change Money Available, Protected Money, AAPN, or debt math.
 */

import { deriveAvailableAfterPlannedNeeds } from "@/lib/babylon/available-after-planned-needs";
import { totalProtectedMoney } from "@/lib/babylon/protected-money";
import { totalRemainingDebt } from "@/lib/babylon/engine";
import type { DebtEntry } from "@/types/babylon";

/** Desktop full-surface conceptual order inside Financial Position. */
export const FINANCIAL_POSITION_TRUTH_ORDER = [
  "money-available",
  "already-set-aside",
  "available-after-planned-needs",
  "accounts",
  "recorded-debt",
] as const;

export const FINANCIAL_POSITION_HEADING = "Financial Position";

export const MONEY_AVAILABLE_LABEL = "Money Available";

/** Concise scope: liquid money known to Wealth Engine, not net worth. */
export const MONEY_AVAILABLE_SCOPE =
  "Liquid money from checking, savings, and cash. Not net worth.";

export const ALREADY_SET_ASIDE_LABEL = "Already Set Aside";

export const EXISTING_WEALTH_BUILDING_LABEL = "Existing Wealth Building";

export const EXISTING_EMERGENCY_FUND_LABEL = "Existing Emergency Fund";

export const AVAILABLE_AFTER_PLANNED_NEEDS_LABEL =
  "Available After Planned Needs";

export const UPCOMING_NEEDS_LABEL = "Upcoming Needs";

export const RECORDED_DEBT_LABEL = "Recorded Debt";

/**
 * Existing designations only. Tracked Wealth Building and Emergency Fund
 * progress are owned elsewhere and must not be implied by a $0 here.
 */
export function alreadySetAsideExplain(protectedMoney: number): string {
  if (protectedMoney <= 0) {
    return "No existing designation yet. Progress tracked from income and month close is separate.";
  }
  return "Of Money Available, already designated for Wealth Building or the Emergency Fund. Not additional cash. Progress tracked from income and month close is separate.";
}

export function recordedDebtExplain(remainingDebt: number): string {
  if (remainingDebt <= 0) {
    return "No remaining debt is recorded.";
  }
  return "Current amount owed as recorded in Wealth Engine. Separate from Money Available. Not a live creditor statement.";
}

export function availableAfterPlannedNeedsExplain(): string {
  return "After already-set-aside money and known unpaid Needs. Does not subtract debt, Wants, Living Budget, or past allocations. Not a promise the remainder is safe to spend.";
}

/**
 * Prove openings alone define Already Set Aside / Protected Money.
 * Tracked wealth and emergency shield are ignored by design.
 */
export function composeAlreadySetAside(input: {
  openingWealthBuilding: number;
  openingEmergencyFund: number;
  trackedWealthBuilding?: number;
  emergencyShield?: number;
}): number {
  return totalProtectedMoney(
    input.openingWealthBuilding,
    input.openingEmergencyFund
  );
}

/**
 * Recorded debt is sibling context. It must not change Money Available or AAPN.
 */
export function composePositionWithRecordedDebt(input: {
  moneyAvailable: number;
  openingWealthBuilding: number;
  openingEmergencyFund: number;
  upcomingNeeds: number;
  debts: readonly DebtEntry[];
}): {
  moneyAvailable: number;
  alreadySetAside: number;
  availableAfterPlannedNeeds: number;
  plannedNeedsShortfall: number;
  recordedDebt: number;
} {
  const alreadySetAside = composeAlreadySetAside({
    openingWealthBuilding: input.openingWealthBuilding,
    openingEmergencyFund: input.openingEmergencyFund,
  });
  const planned = deriveAvailableAfterPlannedNeeds({
    moneyAvailable: input.moneyAvailable,
    protectedMoney: alreadySetAside,
    upcomingNeeds: input.upcomingNeeds,
  });
  return {
    moneyAvailable: input.moneyAvailable,
    alreadySetAside,
    availableAfterPlannedNeeds: planned.availableAfterPlannedNeeds,
    plannedNeedsShortfall: planned.plannedNeedsShortfall,
    recordedDebt: totalRemainingDebt([...input.debts]),
  };
}
