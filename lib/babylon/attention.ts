/**
 * In-app attention over decisions the steward already established.
 * Derived only. Not stored. Does not read Plaid observations.
 */

import { formatMonthLabel } from "@/lib/babylon/engine";
import type { ExpenseEntry } from "@/types/babylon";

const MONTH_KEY = /^\d{4}-\d{2}$/;
const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** Local civil date. Impossible days such as February 31 are rejected. */
export function isCivilIsoDate(value: string): boolean {
  const match = ISO_DATE.exec(value);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(year, month - 1, day);
  return (
    date.getFullYear() === year &&
    date.getMonth() === month - 1 &&
    date.getDate() === day
  );
}

/**
 * Last local calendar day of a YYYY-MM key.
 * Uses the same local Date construction as the month helpers in the engine.
 */
export function lastCivilDayOfMonth(monthKey: string): string | null {
  if (!MONTH_KEY.test(monthKey)) return null;
  const year = Number(monthKey.slice(0, 4));
  const month = Number(monthKey.slice(5, 7));
  if (month < 1 || month > 12) return null;
  const probe = new Date(year, month, 0);
  if (probe.getFullYear() !== year || probe.getMonth() !== month - 1) {
    return null;
  }
  const day = String(probe.getDate()).padStart(2, "0");
  const iso = `${monthKey}-${day}`;
  return isCivilIsoDate(iso) ? iso : null;
}

export type DueAttentionItem = {
  id: string;
  name: string;
  amount: number;
  dueDate: string;
  recurringObligationId?: string;
};

/**
 * Unpaid declared obligations whose due date is today or earlier.
 * Manual upcoming rows and generated recurring occurrences use the same rule.
 */
export function deriveDueAttention(
  expenses: readonly ExpenseEntry[],
  today: string
): DueAttentionItem[] {
  if (!isCivilIsoDate(today)) return [];
  const due: DueAttentionItem[] = [];
  for (const expense of expenses) {
    if (expense.isSettled !== false) continue;
    if (!isCivilIsoDate(expense.dueDate)) continue;
    if (expense.dueDate > today) continue;
    due.push({
      id: expense.id,
      name: expense.name,
      amount: expense.amount,
      dueDate: expense.dueDate,
      ...(expense.recurringObligationId
        ? { recurringObligationId: expense.recurringObligationId }
        : {}),
    });
  }
  due.sort((a, b) => {
    if (a.dueDate !== b.dueDate) return a.dueDate < b.dueDate ? -1 : 1;
    if (a.name !== b.name) return a.name < b.name ? -1 : 1;
    if (a.id === b.id) return 0;
    return a.id < b.id ? -1 : 1;
  });
  return due;
}

export type DueAttentionDecision = "paid" | "still-upcoming";

/**
 * Paid calls the existing payment mutation.
 * Still upcoming writes nothing.
 */
export function applyDueAttentionDecision(
  decision: DueAttentionDecision,
  expenseId: string,
  markPaid: (id: string) => void
): void {
  if (decision === "still-upcoming") return;
  markPaid(expenseId);
}

export type MonthCloseAttention = {
  monthKey: string;
  monthLabel: string;
  message: string;
};

/**
 * The current month is still open, and today is its last local calendar day.
 * A later month does not reopen an earlier unclosed month.
 */
export function deriveMonthCloseAttention(input: {
  today: string;
  currentMonthKey: string;
  lastClosedMonthKey: string | null;
}): MonthCloseAttention | null {
  if (!isCivilIsoDate(input.today)) return null;
  if (!MONTH_KEY.test(input.currentMonthKey)) return null;
  if (input.today.slice(0, 7) !== input.currentMonthKey) return null;
  if (input.lastClosedMonthKey === input.currentMonthKey) return null;
  const lastDay = lastCivilDayOfMonth(input.currentMonthKey);
  if (!lastDay || input.today !== lastDay) return null;
  const monthLabel = formatMonthLabel(input.currentMonthKey);
  return {
    monthKey: input.currentMonthKey,
    monthLabel,
    message: `${monthLabel} is still open and ends today.`,
  };
}
