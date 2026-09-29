/**
 * Existing protected money — designations inside current account balances.
 * These are not income, allocations, or extra cash.
 *
 * With account purpose: Protected = account-backed purpose positions
 * + residual openings (unlocated designations). Tracked goldRetained /
 * emergencyShield are never included.
 */

import { roundMoney } from "@/lib/babylon/engine";

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
    return "Protected designations exceed your current Money Available. Update your protected amounts or Financial Position.";
  }
  return null;
}
