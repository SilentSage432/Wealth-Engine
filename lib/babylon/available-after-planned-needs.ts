/**
 * Available After Planned Needs.
 *
 * FreeBeforeNeeds = max(0, Deployable − DeployableProtected).
 * AAPN = max(0, FreeBeforeNeeds − Upcoming Needs).
 * Shortfall = max(0, Upcoming Needs − FreeBeforeNeeds).
 *
 * When every account has no restriction, Deployable equals Owned (Money
 * Available) and DeployableProtected equals ProtectedOwned — legacy identity.
 * Derived only. Not stored, and not a spending recommendation.
 */

import { roundMoney } from "@/lib/babylon/engine";

export interface AvailableAfterPlannedNeeds {
  /** Floored at zero. A shortfall is reported separately. */
  availableAfterPlannedNeeds: number;
  /** How far Upcoming Needs exceed FreeBeforeNeeds. */
  plannedNeedsShortfall: number;
  /** Signed difference FreeBeforeNeeds − UpcomingNeeds before the zero floor. */
  rawDifference: number;
  /** Deployable minus DeployableProtected, floored at zero. */
  freeBeforeNeeds: number;
}

export function deriveAvailableAfterPlannedNeeds(input: {
  deployablePosition: number;
  deployableProtected: number;
  upcomingNeeds: number;
}): AvailableAfterPlannedNeeds {
  const deployablePosition = roundMoney(input.deployablePosition);
  const deployableProtected = roundMoney(input.deployableProtected);
  const upcomingNeeds = roundMoney(input.upcomingNeeds);
  const freeBeforeNeeds = roundMoney(
    Math.max(0, deployablePosition - deployableProtected)
  );
  const rawDifference = roundMoney(freeBeforeNeeds - upcomingNeeds);
  if (rawDifference < 0) {
    return {
      availableAfterPlannedNeeds: 0,
      plannedNeedsShortfall: roundMoney(Math.abs(rawDifference)),
      rawDifference,
      freeBeforeNeeds,
    };
  }
  return {
    availableAfterPlannedNeeds: rawDifference,
    plannedNeedsShortfall: 0,
    rawDifference,
    freeBeforeNeeds,
  };
}
