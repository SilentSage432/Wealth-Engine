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
  return "Of Money Available, already designated for Wealth Building or the Emergency Fund — including money currently positioned in purpose accounts and any Existing amounts not located in those accounts. Not additional cash. Progress tracked from income and month close is separate.";
}

export function recordedDebtExplain(remainingDebt: number): string {
  if (remainingDebt <= 0) {
    return "No remaining debt is recorded.";
  }
  return "Current amount owed as recorded in Wealth Engine. Separate from Money Available. Not a live creditor statement.";
}

export function availableAfterPlannedNeedsExplain(): string {
  return "Of money available to use after unavailable amounts and already-set-aside Wealth/Emergency designations, then after known unpaid Needs. Unavailable and Already Set Aside may overlap. Does not subtract debt, Wants, Living Budget, or past allocations. Not a promise the remainder is safe to spend.";
}

/** Aggregate label when some owned liquid is steward-unavailable. */
export const UNAVAILABLE_LABEL = "Unavailable";

export function unavailableExplain(unavailableTotal: number): string {
  if (unavailableTotal <= 0) {
    return "No unavailable amount declared.";
  }
  return "Of Money Available, presently unavailable for deployment. Still owned. Not Already Set Aside, debt, or borrowing capacity.";
}

export const WEALTH_BUILDING_POSITIONED_LABEL = "Wealth Building";

export const EMERGENCY_FUND_POSITIONED_LABEL = "Emergency Fund";

export const CURRENTLY_POSITIONED_HINT = "currently positioned";

/**
 * Already Set Aside / Protected Money.
 * Account-backed purpose positions + residual openings.
 * Tracked wealth and emergency shield are ignored by design.
 */
export function composeAlreadySetAside(input: {
  openingWealthBuilding: number;
  openingEmergencyFund: number;
  currentWealthBuildingPosition?: number;
  currentEmergencyFundPosition?: number;
  trackedWealthBuilding?: number;
  emergencyShield?: number;
}): number {
  return totalProtectedMoney(
    input.openingWealthBuilding,
    input.openingEmergencyFund,
    input.currentWealthBuildingPosition ?? 0,
    input.currentEmergencyFundPosition ?? 0
  );
}

/**
 * Recorded debt is sibling context. It must not change Money Available or AAPN.
 * When deployable fields are omitted, assumes no restriction (legacy identity).
 */
export function composePositionWithRecordedDebt(input: {
  moneyAvailable: number;
  openingWealthBuilding: number;
  openingEmergencyFund: number;
  upcomingNeeds: number;
  debts: readonly DebtEntry[];
  currentWealthBuildingPosition?: number;
  currentEmergencyFundPosition?: number;
  deployablePosition?: number;
  deployableProtected?: number;
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
    currentWealthBuildingPosition: input.currentWealthBuildingPosition,
    currentEmergencyFundPosition: input.currentEmergencyFundPosition,
  });
  const deployablePosition = input.deployablePosition ?? input.moneyAvailable;
  const deployableProtected = input.deployableProtected ?? alreadySetAside;
  const planned = deriveAvailableAfterPlannedNeeds({
    deployablePosition,
    deployableProtected,
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
