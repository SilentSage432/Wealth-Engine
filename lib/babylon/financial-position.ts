/**
 * Financial Position — money that already exists.
 * Account balances are observations. They never enter 10/20/70.
 */

import { roundMoney, todayIso } from "@/lib/babylon/engine";
import type {
  FinancialAccount,
  FinancialAccountInput,
  FinancialAccountKind,
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
  input: FinancialAccountInput,
  id: string
): FinancialAccount | null {
  const name = input.name.trim();
  if (!name || !id.trim()) return null;
  if (!isFinancialAccountKind(input.kind)) return null;
  if (!Number.isFinite(input.balance) || input.balance < 0) return null;
  if (!isLocalIsoDate(input.asOf)) return null;

  return {
    id,
    name,
    kind: input.kind,
    balance: roundMoney(input.balance),
    asOf: input.asOf,
  };
}

/** Money Available — sum of manually entered balances. Not stored. */
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
