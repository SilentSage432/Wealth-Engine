/**
 * Financial Position — money that already exists.
 * Account balances are what the steward says already exists. They never enter 10/20/70.
 * A cached bank balance is a separate observation and does not write these balances.
 */

import { isFinancialAccountPurpose } from "@/lib/babylon/account-purpose";
import { roundMoney, todayIso } from "@/lib/babylon/engine";
import type {
  FinancialAccount,
  FinancialAccountInput,
  FinancialAccountKind,
  FinancialAccountPurpose,
  PersistedState,
} from "@/types/babylon";

export const FINANCIAL_ACCOUNT_KINDS: readonly FinancialAccountKind[] = [
  "checking",
  "savings",
  "cash",
];

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export function isLocalIsoDate(value: unknown): value is string {
  return (
    typeof value === "string" &&
    ISO_DATE.test(value) &&
    Number.isFinite(Date.parse(`${value}T00:00:00`))
  );
}

export function isFinancialAccountKind(
  value: unknown
): value is FinancialAccountKind {
  return (
    typeof value === "string" &&
    (FINANCIAL_ACCOUNT_KINDS as readonly string[]).includes(value)
  );
}

/** Stored observation time in the viewer's local zone. */
export function formatObservedAt(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "time unknown";
  return date.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

/** Local calendar label for an as-of date. Does not parse the date as UTC. */
export function formatAsOfLabel(
  isoDate: string,
  today: string = todayIso()
): string {
  const [year, month, day] = isoDate.split("-").map(Number);
  if (!year || !month || !day) return isoDate;
  const date = new Date(year, month - 1, day);
  const sameYear = today.slice(0, 4) === String(year);
  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    ...(sameYear ? {} : { year: "numeric" }),
  });
}

export function normalizeAccountDraft(
  input: FinancialAccountInput & { purpose?: FinancialAccountPurpose },
  id: string
): FinancialAccount | null {
  const name = input.name.trim();
  if (!name || !id.trim()) return null;
  if (!isFinancialAccountKind(input.kind)) return null;
  if (!Number.isFinite(input.balance) || input.balance < 0) return null;
  if (!isLocalIsoDate(input.asOf)) return null;
  if (
    input.purpose !== undefined &&
    !isFinancialAccountPurpose(input.purpose)
  ) {
    return null;
  }
  if (
    input.restrictedAmount !== undefined &&
    (!Number.isFinite(input.restrictedAmount) || input.restrictedAmount < 0)
  ) {
    return null;
  }

  const account: FinancialAccount = {
    id,
    name,
    kind: input.kind,
    balance: roundMoney(input.balance),
    asOf: input.asOf,
  };
  if (input.purpose !== undefined) {
    account.purpose = input.purpose;
  }
  if (
    input.restrictedAmount !== undefined &&
    input.restrictedAmount > 0
  ) {
    account.restrictedAmount = roundMoney(input.restrictedAmount);
  }
  return account;
}

/** Declaration sum. Operational Money Available is derived beside balance evidence. */
export function sumAccountBalances(
  accounts: readonly FinancialAccount[]
): number {
  return roundMoney(
    accounts.reduce((sum, account) => sum + account.balance, 0)
  );
}

export function prependAccount(
  accounts: readonly FinancialAccount[],
  account: FinancialAccount
): FinancialAccount[] {
  return [account, ...accounts];
}

/** Null when the id is not in the list. Does not append a new account. */
export function replaceAccount(
  accounts: readonly FinancialAccount[],
  id: string,
  next: FinancialAccount
): FinancialAccount[] | null {
  if (!accounts.some((account) => account.id === id)) return null;
  return accounts.map((account) => (account.id === id ? next : account));
}

export function withoutAccount(
  accounts: readonly FinancialAccount[],
  id: string
): FinancialAccount[] {
  return accounts.filter((account) => account.id !== id);
}

/**
 * Replace only the account list. Every other ledger field keeps its reference.
 * Callers must not feed the result into income allocation.
 */
export function assignAccounts(
  state: PersistedState,
  accounts: FinancialAccount[]
): PersistedState {
  return { ...state, accounts };
}
