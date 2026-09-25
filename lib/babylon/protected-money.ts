/**
 * Existing protected money — designations inside current account balances.
 * These are not income, allocations, or extra cash.
 */

import { roundMoney } from "@/lib/babylon/engine";

function cents(value: number): number {
  return Math.round(roundMoney(value) * 100);
}

export function totalProtectedMoney(
  openingWealthBuilding: number,
  openingEmergencyFund: number
): number {
  return roundMoney(
    roundMoney(openingWealthBuilding) + roundMoney(openingEmergencyFund)
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
  moneyAvailable: number
): boolean {
  return (
    cents(totalProtectedMoney(openingWealthBuilding, openingEmergencyFund)) >
    cents(moneyAvailable)
  );
}

/**
 * Null when the designations fit inside Money Available.
 * Does not change any stored amount.
 */
export function protectedDesignationError(
  openingWealthBuilding: number,
  openingEmergencyFund: number,
  moneyAvailable: number
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
      moneyAvailable
    )
  ) {
    return "Protected designations exceed your current Money Available. Update your protected amounts or Financial Position.";
  }
  return null;
}
