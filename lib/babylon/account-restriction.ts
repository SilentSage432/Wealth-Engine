/**
 * Account restriction — steward-declared unavailable owned position.
 *
 * OWNED != DEPLOYABLE.
 * Restriction does not alter EffectiveAccountPosition.
 * Restriction is not purpose, Protected, debt, borrowing capacity,
 * movement, execution, or Plaid available.
 *
 * Residual openings have no account location; DeployableProtected includes
 * them in full (conservative). Physical overlap with restriction is UNKNOWN.
 */

import { roundMoney } from "@/lib/babylon/engine";
import type { EffectiveAccountPosition } from "@/lib/babylon/balance-observation";
import type { FinancialAccount } from "@/types/babylon";

/** Declared unavailable amount. Absent or invalid → 0. */
export function restrictedDeclared(
  account: Pick<FinancialAccount, "restrictedAmount">
): number {
  const value = account.restrictedAmount;
  if (value === undefined || value === null) return 0;
  if (!Number.isFinite(value) || value < 0) return 0;
  return roundMoney(value);
}

/** Arithmetic bound: never exceeds owned account position. */
export function restrictedEffective(
  accountBalance: number,
  declared: number
): number {
  const balance = roundMoney(Math.max(0, accountBalance));
  const amount = roundMoney(Math.max(0, declared));
  return roundMoney(Math.min(amount, balance));
}

export function hasRestrictionConflict(
  accountBalance: number,
  declared: number
): boolean {
  return roundMoney(Math.max(0, declared)) > roundMoney(Math.max(0, accountBalance));
}

/** Deployable contribution from one account position. Never negative. */
export function accountDeployableBalance(
  accountBalance: number,
  declared: number
): number {
  return roundMoney(
    Math.max(0, roundMoney(accountBalance) - restrictedEffective(accountBalance, declared))
  );
}

function positionBalance(
  account: FinancialAccount,
  byId: ReadonlyMap<string, EffectiveAccountPosition>
): number {
  const position = byId.get(account.id);
  return position ? position.balance : account.balance;
}

/** Σ max(0, EAP − restrictedEffective). Does not change EAP. */
export function deriveDeployablePosition(
  accounts: readonly FinancialAccount[],
  positions: readonly EffectiveAccountPosition[]
): number {
  const byId = new Map(
    positions.map((position) => [position.accountId, position] as const)
  );
  let sum = 0;
  for (const account of accounts) {
    sum += accountDeployableBalance(
      positionBalance(account, byId),
      restrictedDeclared(account)
    );
  }
  return roundMoney(sum);
}

/** Σ restrictedEffective across accounts (for Unavailable aggregate). */
export function deriveRestrictedEffectiveTotal(
  accounts: readonly FinancialAccount[],
  positions: readonly EffectiveAccountPosition[]
): number {
  const byId = new Map(
    positions.map((position) => [position.accountId, position] as const)
  );
  let sum = 0;
  for (const account of accounts) {
    sum += restrictedEffective(
      positionBalance(account, byId),
      restrictedDeclared(account)
    );
  }
  return roundMoney(sum);
}

/**
 * Deployable portion of Protected for AAPN.
 * Purpose accounts contribute deployable EAP; residual openings add in full.
 */
export function deriveDeployableProtected(
  accounts: readonly FinancialAccount[],
  positions: readonly EffectiveAccountPosition[],
  openingWealthBuilding: number,
  openingEmergencyFund: number
): number {
  const byId = new Map(
    positions.map((position) => [position.accountId, position] as const)
  );
  let purposeDeployable = 0;
  for (const account of accounts) {
    if (
      account.purpose !== "wealth_building" &&
      account.purpose !== "emergency_fund"
    ) {
      continue;
    }
    purposeDeployable += accountDeployableBalance(
      positionBalance(account, byId),
      restrictedDeclared(account)
    );
  }
  return roundMoney(
    purposeDeployable +
      roundMoney(openingWealthBuilding) +
      roundMoney(openingEmergencyFund)
  );
}

/** Set or clear steward restriction. Omits zero. Preserves purpose. */
export function withAccountRestrictedAmount(
  account: FinancialAccount,
  restrictedAmount: number | undefined
): FinancialAccount {
  const next: FinancialAccount = {
    id: account.id,
    name: account.name,
    kind: account.kind,
    balance: account.balance,
    asOf: account.asOf,
  };
  if (account.purpose !== undefined) {
    next.purpose = account.purpose;
  }
  if (
    restrictedAmount !== undefined &&
    Number.isFinite(restrictedAmount) &&
    restrictedAmount > 0
  ) {
    next.restrictedAmount = roundMoney(restrictedAmount);
  }
  return next;
}
