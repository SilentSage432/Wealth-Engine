/**
 * Existing protected money — designations inside current account balances.
 * These are not income, allocations, or extra cash.
 *
 * With account purpose: Protected = account-backed purpose positions
 * + residual openings (unlocated designations). Tracked goldRetained /
 * emergencyShield are never included.
 */

import {
  currentEmergencyFundPosition,
  currentWealthBuildingPosition,
} from "@/lib/babylon/account-purpose";
import { roundMoney } from "@/lib/babylon/engine";
import type { EffectiveAccountPosition } from "@/lib/babylon/balance-observation";
import type { FinancialAccount } from "@/types/babylon";

function cents(value: number): number {
  return Math.round(roundMoney(value) * 100);
}

/**
 * Already Set Aside / Protected Money.
 * Positions default to 0 so legacy openings-only call sites stay valid.
 */
export function totalProtectedMoney(
  openingWealthBuilding: number,
  openingEmergencyFund: number,
  currentWealthBuildingPosition = 0,
  currentEmergencyFundPosition = 0
): number {
  return roundMoney(
    roundMoney(openingWealthBuilding) +
      roundMoney(openingEmergencyFund) +
      roundMoney(currentWealthBuildingPosition) +
      roundMoney(currentEmergencyFundPosition)
  );
}

/** Existing designation plus wealth from tracked allocations. */
export function totalWealthBuilding(
  openingWealthBuilding: number,
  trackedWealthBuilding: number
): number {
  return roundMoney(
    roundMoney(openingWealthBuilding) + roundMoney(trackedWealthBuilding)
  );
}

/** Existing designation plus Emergency Fund from tracked month-close surplus. */
export function totalEmergencyFund(
  openingEmergencyFund: number,
  trackedEmergencyFund: number
): number {
  return roundMoney(
    roundMoney(openingEmergencyFund) + roundMoney(trackedEmergencyFund)
  );
}

export function protectedExceedsAvailable(
  openingWealthBuilding: number,
  openingEmergencyFund: number,
  moneyAvailable: number,
  currentWealthBuildingPosition = 0,
  currentEmergencyFundPosition = 0
): boolean {
  return (
    cents(
      totalProtectedMoney(
        openingWealthBuilding,
        openingEmergencyFund,
        currentWealthBuildingPosition,
        currentEmergencyFundPosition
      )
    ) > cents(moneyAvailable)
  );
}

/**
 * Null when the designations fit inside Money Available.
 * Does not change any stored amount.
 */
export function protectedDesignationError(
  openingWealthBuilding: number,
  openingEmergencyFund: number,
  moneyAvailable: number,
  currentWealthBuildingPosition = 0,
  currentEmergencyFundPosition = 0
): string | null {
  if (
    !Number.isFinite(openingWealthBuilding) ||
    openingWealthBuilding < 0 ||
    !Number.isFinite(openingEmergencyFund) ||
    openingEmergencyFund < 0
  ) {
    return "Enter zero or a positive amount.";
  }
  if (
    protectedExceedsAvailable(
      openingWealthBuilding,
      openingEmergencyFund,
      moneyAvailable,
      currentWealthBuildingPosition,
      currentEmergencyFundPosition
    )
  ) {
    return "Protected designations exceed your current Liquid Position. Update your protected amounts or Financial Position.";
  }
  return null;
}

/**
 * One composition for Already Set Aside versus Liquid Position.
 * Purpose positions are included. Screen, contract, and Quiet all call this.
 * Tracked allocation totals are not position and are not included.
 */
export function composeProtectedOverflow(input: {
  openingWealthBuilding: number;
  openingEmergencyFund: number;
  moneyAvailable: number;
  accounts: readonly FinancialAccount[];
  positions: readonly EffectiveAccountPosition[];
}): {
  openingWealthBuilding: number;
  openingEmergencyFund: number;
  moneyAvailable: number;
  currentWealthBuildingPosition: number;
  currentEmergencyFundPosition: number;
} {
  return {
    openingWealthBuilding: input.openingWealthBuilding,
    openingEmergencyFund: input.openingEmergencyFund,
    moneyAvailable: input.moneyAvailable,
    currentWealthBuildingPosition: currentWealthBuildingPosition(
      input.accounts,
      input.positions
    ),
    currentEmergencyFundPosition: currentEmergencyFundPosition(
      input.accounts,
      input.positions
    ),
  };
}

/** True when that canonical composition exceeds Liquid Position. */
export function protectedOverflowExceeds(input: {
  openingWealthBuilding: number;
  openingEmergencyFund: number;
  moneyAvailable: number;
  accounts: readonly FinancialAccount[];
  positions: readonly EffectiveAccountPosition[];
}): boolean {
  const composed = composeProtectedOverflow(input);
  return protectedExceedsAvailable(
    composed.openingWealthBuilding,
    composed.openingEmergencyFund,
    composed.moneyAvailable,
    composed.currentWealthBuildingPosition,
    composed.currentEmergencyFundPosition
  );
}
