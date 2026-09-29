/**
 * Financial Position composition — labels and sibling context only.
 * Does not change Money Available, Protected Money, AAPN, or debt math.
 *
 * Steward-facing owned-liquid aggregate label is Liquid Position (owned liquid).
 * Domain/runtime field remains `moneyAvailable`; IC stays `money_available_cents`.
 *
 * When Unavailable > 0, visual hierarchy promotes Available to use (deployable)
 * as the decision-relevant hero; Liquid Position becomes supporting context.
 */

import { deriveAvailableAfterPlannedNeeds } from "@/lib/babylon/available-after-planned-needs";
import { totalProtectedMoney } from "@/lib/babylon/protected-money";
import { totalRemainingDebt } from "@/lib/babylon/engine";
import type { DebtEntry } from "@/types/babylon";

/** Desktop full-surface conceptual order inside Financial Position. */
export const FINANCIAL_POSITION_TRUTH_ORDER = [
  "liquid-position",
  "already-set-aside",
  "available-after-planned-needs",
  "accounts",
  "recorded-debt",
] as const;

/**
 * Restricted-state document order inside the primary aggregate block.
 * Decision-relevant deployable first; owned and unavailable as support.
 */
export const RESTRICTED_POSITION_DOCUMENT_ORDER = [
  "available-to-use",
  "liquid-position",
  "unavailable",
] as const;

export const FINANCIAL_POSITION_HEADING = "Financial Position";

/**
 * Steward-facing owned-liquid aggregate label.
 * Domain field remains `moneyAvailable`; this is presentation only.
 */
export const LIQUID_POSITION_LABEL = "Liquid Position";

/** @deprecated Prefer LIQUID_POSITION_LABEL. Same presentation string. */
export const MONEY_AVAILABLE_LABEL = LIQUID_POSITION_LABEL;

/**
 * Concise scope: liquid money known to Wealth Engine, not net worth,
 * not safe-to-spend, and not limited to deployable money.
 */
export const LIQUID_POSITION_SCOPE =
  "Money currently held in checking, savings, and cash. Includes money that may be unavailable or already set aside. Not net worth.";

/** @deprecated Prefer LIQUID_POSITION_SCOPE. */
export const MONEY_AVAILABLE_SCOPE = LIQUID_POSITION_SCOPE;

export const ALREADY_SET_ASIDE_LABEL = "Already Set Aside";

export const EXISTING_WEALTH_BUILDING_LABEL = "Existing Wealth Building";

export const EXISTING_EMERGENCY_FUND_LABEL = "Existing Emergency Fund";

export const AVAILABLE_AFTER_PLANNED_NEEDS_LABEL =
  "Available After Planned Needs";

export const UPCOMING_NEEDS_LABEL = "Upcoming Needs";

export const RECORDED_DEBT_LABEL = "Recorded Debt";

/** Aggregate deployable remainder when Unavailable > 0. Derived, not persisted. */
export const AVAILABLE_TO_USE_LABEL = "Available to use";

/**
 * Restricted-state hero explanation. Not safe-to-spend. Not AAPN.
 */
export function availableToUseExplain(): string {
  return "Owned liquid money presently available to use before set-aside purposes and Upcoming Needs.";
}

/**
 * Existing designations only. Tracked Wealth Building and Emergency Fund
 * progress are owned elsewhere and must not be implied by a $0 here.
 */
export function alreadySetAsideExplain(protectedMoney: number): string {
  if (protectedMoney <= 0) {
    return "No existing designation yet. Progress tracked from income and month close is separate.";
  }
  return "Of Liquid Position, already designated for Wealth Building or the Emergency Fund — including money currently positioned in purpose accounts and any Existing amounts not located in those accounts. Not additional cash. Progress tracked from income and month close is separate.";
}

export function recordedDebtExplain(remainingDebt: number): string {
  if (remainingDebt <= 0) {
    return "No remaining debt is recorded.";
  }
  return "Current amount owed as recorded in Wealth Engine. Separate from Liquid Position. Not a live creditor statement.";
}

/**
 * Candidate A: of deployable money, after deployable set-aside and unpaid Needs.
 * Does not claim Unavailable and Already Set Aside are separate pools.
 */
export function availableAfterPlannedNeedsExplain(): string {
  return "Of money available to use, after Wealth/Emergency amounts already set aside and known unpaid Needs. Unavailable and Already Set Aside may overlap. Does not subtract debt, Wants, Living Budget, or past allocations. Not a promise the remainder is safe to spend.";
}

/** Aggregate label when some owned liquid is steward-unavailable. */
export const UNAVAILABLE_LABEL = "Unavailable";

export function unavailableExplain(unavailableTotal: number): string {
  if (unavailableTotal <= 0) {
    return "No unavailable amount declared.";
  }
  return "Still owned, but presently unavailable to use.";
}

/**
 * Candidate A shortfall: unmet Upcoming Needs against deployable unprotected money.
 * Does not claim a shortfall in funding ProtectedOwned itself.
 */
export function plannedNeedsShortfallExplain(): string {
  return "short of covering known Upcoming Needs with money currently available after set-aside purposes.";
}

export const WEALTH_BUILDING_POSITIONED_LABEL = "Wealth Building";

export const EMERGENCY_FUND_POSITIONED_LABEL = "Emergency Fund";

export const CURRENTLY_POSITIONED_HINT = "currently positioned";

export type FinancialPositionHeroKind = "liquid-position" | "available-to-use";

/**
 * Derived Available to use for presentation. Equals DeployablePosition.
 * Do not persist. Quiet when Unavailable is zero.
 *
 * When restricted, heroKind promotes Available to use for decision relevance.
 * Supporting composition may show Unavailable with a minus because
 * Liquid Position − Unavailable = Available to use (Unavailable ⊆ Owned).
 */
export function deriveAvailableToUsePresentation(input: {
  moneyAvailable: number;
  restrictedEffectiveTotal: number;
  deployablePosition?: number;
}): {
  heroKind: FinancialPositionHeroKind;
  showUnavailable: boolean;
  showAvailableToUse: boolean;
  availableToUse: number;
  /** True when supporting composition should prefix Unavailable with −. */
  unavailableAsSubtraction: boolean;
} {
  const unavailable = Math.max(0, input.restrictedEffectiveTotal);
  const availableToUse =
    input.deployablePosition ??
    Math.max(0, input.moneyAvailable - unavailable);
  const showUnavailable = unavailable > 0;
  return {
    heroKind: showUnavailable ? "available-to-use" : "liquid-position",
    showUnavailable,
    showAvailableToUse: showUnavailable,
    availableToUse,
    unavailableAsSubtraction: showUnavailable,
  };
}

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
