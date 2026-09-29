/**
 * Account purpose — steward meaning of a FinancialAccount.
 *
 * PURPOSE POSITION composes from EffectiveAccountPosition.
 * Historical allocation (goldRetained / emergencyShield) is not position.
 * Plaid observation is not purpose authority.
 */

import { roundMoney } from "@/lib/babylon/engine";
import type { EffectiveAccountPosition } from "@/lib/babylon/balance-observation";
import type {
  FinancialAccount,
  FinancialAccountPurpose,
} from "@/types/babylon";

export const FINANCIAL_ACCOUNT_PURPOSES = [
  "wealth_building",
  "emergency_fund",
] as const satisfies readonly FinancialAccountPurpose[];

export function isFinancialAccountPurpose(
  value: unknown
): value is FinancialAccountPurpose {
  return (
    typeof value === "string" &&
    (FINANCIAL_ACCOUNT_PURPOSES as readonly string[]).includes(value)
  );
}

/** User-facing purpose label. Not "saved" or "executed". */
export function accountPurposeLabel(
  purpose: FinancialAccountPurpose
): string {
  if (purpose === "wealth_building") return "Wealth Building";
  return "Emergency Fund";
}

export function accountHasPurpose(
  accounts: readonly FinancialAccount[],
  purpose: FinancialAccountPurpose
): boolean {
  return accounts.some((account) => account.purpose === purpose);
}

/**
 * Sum effective balances for accounts carrying purpose.
 * Falls back to declared balance only when that account has no position row.
 */
export function currentPurposePosition(
  accounts: readonly FinancialAccount[],
  positions: readonly EffectiveAccountPosition[],
  purpose: FinancialAccountPurpose
): number {
  const byId = new Map(
    positions.map((position) => [position.accountId, position] as const)
  );
  let sum = 0;
  for (const account of accounts) {
    if (account.purpose !== purpose) continue;
    const position = byId.get(account.id);
    sum += position ? position.balance : account.balance;
  }
  return roundMoney(sum);
}

export function currentWealthBuildingPosition(
  accounts: readonly FinancialAccount[],
  positions: readonly EffectiveAccountPosition[]
): number {
  return currentPurposePosition(accounts, positions, "wealth_building");
}

export function currentEmergencyFundPosition(
  accounts: readonly FinancialAccount[],
  positions: readonly EffectiveAccountPosition[]
): number {
  return currentPurposePosition(accounts, positions, "emergency_fund");
}

export type FirstDesignationReconcileChoice =
  | "keep_remainder"
  | "replace_existing";

/**
 * Residual opening after first designation reconcile.
 * Cancel is handled by the caller (no write).
 */
export function residualAfterFirstDesignation(
  opening: number,
  accountPosition: number,
  choice: FirstDesignationReconcileChoice
): number {
  const openingRounded = roundMoney(Math.max(0, opening));
  const positionRounded = roundMoney(Math.max(0, accountPosition));
  if (choice === "replace_existing") return 0;
  return roundMoney(Math.max(0, openingRounded - positionRounded));
}

/** Whether assigning purpose is the first account for that purpose. */
export function isFirstPurposeDesignation(
  accounts: readonly FinancialAccount[],
  accountId: string,
  purpose: FinancialAccountPurpose
): boolean {
  return !accounts.some(
    (account) => account.id !== accountId && account.purpose === purpose
  );
}

export function withAccountPurpose(
  account: FinancialAccount,
  purpose: FinancialAccountPurpose | undefined
): FinancialAccount {
  if (purpose === undefined) {
    return {
      id: account.id,
      name: account.name,
      kind: account.kind,
      balance: account.balance,
      asOf: account.asOf,
    };
  }
  return { ...account, purpose };
}

export function openingForPurpose(
  purpose: FinancialAccountPurpose,
  openingWealthBuilding: number,
  openingEmergencyFund: number
): number {
  return purpose === "wealth_building"
    ? openingWealthBuilding
    : openingEmergencyFund;
}
