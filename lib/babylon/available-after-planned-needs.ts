/**
 * Available After Planned Needs.
 * Current observed money, minus current protected designations, minus known
 * unpaid Needs. Derived only. Not stored, and not a spending recommendation.
 */

import { roundMoney } from "@/lib/babylon/engine";

export interface AvailableAfterPlannedNeeds {
  /** Floored at zero. A shortfall is reported separately. */
  availableAfterPlannedNeeds: number;
  /** How far Protected Money plus Upcoming Needs exceeds Money Available. */
  plannedNeedsShortfall: number;
  /** Signed difference before the zero floor. */
  rawDifference: number;
}

export function deriveAvailableAfterPlannedNeeds(input: {
  moneyAvailable: number;
  protectedMoney: number;
  upcomingNeeds: number;
}): AvailableAfterPlannedNeeds {
  const moneyAvailable = roundMoney(input.moneyAvailable);
  const protectedMoney = roundMoney(input.protectedMoney);
  const upcomingNeeds = roundMoney(input.upcomingNeeds);
  const rawDifference = roundMoney(
    moneyAvailable - protectedMoney - upcomingNeeds
  );
  if (rawDifference < 0) {
    return {
      availableAfterPlannedNeeds: 0,
      plannedNeedsShortfall: roundMoney(Math.abs(rawDifference)),
      rawDifference,
    };
  }
  return {
    availableAfterPlannedNeeds: rawDifference,
    plannedNeedsShortfall: 0,
    rawDifference,
  };
}
