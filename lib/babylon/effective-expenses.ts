/**
 * Effective expenses for one caller-supplied civil range.
 *
 * Persisted expense rows stay evidence. projectRecurringOccurrences supplies
 * the recurring occurrences for that range. Derived rows fill only a missing
 * semantic occurrence. They are not written back.
 *
 * This module does not choose a financial timezone, read the device clock, or
 * read notification preferences. The caller supplies the civil date that
 * anchors the range.
 *
 * Operating range, used by in-app obligation readers and by notification and
 * Intelligence reads: the earliest rule start month through the month after
 * the caller's civil month. That recovers an unwitnessed due month and keeps
 * the existing one-month look-ahead. Months after that look-ahead are not
 * invented. Spending, month close, export, and sync stay on persisted rows.
 */

import { nextMonthKey } from "@/lib/babylon/engine";
import {
  isRealLocalIsoDate,
  projectRecurringOccurrences,
  type CivilMonthRange,
  type RecurrenceProjectionInvalidReason,
} from "@/lib/babylon/recurring-obligations";
import type { ExpenseEntry, RecurringObligation } from "@/types/babylon";

export type EffectiveExpenseRead =
  | {
      status: "ready";
      expenses: ExpenseEntry[];
      derivedIds: ReadonlySet<string>;
    }
  | {
      status: "invalid";
      reason: RecurrenceProjectionInvalidReason;
    };

/**
 * Inclusive months an operating reader needs for the supplied civil date.
 * Null when that date is not a real local calendar day.
 */
export function operatingRecurrenceRange(
  rules: readonly RecurringObligation[],
  today: string
): CivilMonthRange | null {
  if (!isRealLocalIsoDate(today)) return null;
  const current = today.slice(0, 7);
  let fromMonth = current;
  for (const rule of rules) {
    if (typeof rule?.startMonth === "string" && rule.startMonth < fromMonth) {
      fromMonth = rule.startMonth;
    }
  }
  return { fromMonth, throughMonth: nextMonthKey(current) };
}

/**
 * Persisted rows, plus derived recurring occurrences for the range.
 * One-off rows stay. A stored occurrence stays as stored and is not paired
 * with a second derived row. Invalid projection returns no expense list.
 */
export function composeEffectiveExpenses(
  rules: readonly RecurringObligation[],
  expenses: readonly ExpenseEntry[],
  range: CivilMonthRange
): EffectiveExpenseRead {
  const projection = projectRecurringOccurrences(rules, expenses, range);
  if (projection.status !== "projected") {
    return { status: "invalid", reason: projection.reason };
  }

  const persistedIds = new Set<string>();
  for (const expense of expenses) {
    if (!expense || typeof expense.id !== "string") {
      return { status: "invalid", reason: "invalid_occurrence_evidence" };
    }
    if (persistedIds.has(expense.id)) {
      return { status: "invalid", reason: "duplicate_semantic_occurrence" };
    }
    persistedIds.add(expense.id);
  }

  const derived: ExpenseEntry[] = [];
  const derivedIds = new Set<string>();
  for (const occurrence of projection.occurrences) {
    if (occurrence.origin !== "derived") continue;
    if (persistedIds.has(occurrence.expense.id) || derivedIds.has(occurrence.expense.id)) {
      return { status: "invalid", reason: "duplicate_semantic_occurrence" };
    }
    derived.push({ ...occurrence.expense });
    derivedIds.add(occurrence.expense.id);
  }

  return {
    status: "ready",
    expenses: [...derived, ...expenses.map((expense) => ({ ...expense }))],
    derivedIds,
  };
}

/**
 * The persisted row for this id, or exactly one derived occurrence when the
 * id is the canonical id of a due month that has no stored row yet.
 * Does not add any other month. Null when the id is not an actionable row.
 */
export function occurrenceForStewardAction(
  rules: readonly RecurringObligation[],
  expenses: readonly ExpenseEntry[],
  expenseId: string
): { expenses: ExpenseEntry[]; expense: ExpenseEntry } | null {
  const existing = expenses.find((expense) => expense.id === expenseId);
  if (existing) return { expenses: [...expenses], expense: existing };

  const month = canonicalOccurrenceMonth(expenseId);
  if (!month) return null;
  const projection = projectRecurringOccurrences(rules, expenses, {
    fromMonth: month,
    throughMonth: month,
  });
  if (projection.status !== "projected") return null;
  const match = projection.occurrences.find(
    (occurrence) => occurrence.expense.id === expenseId && occurrence.origin === "derived"
  );
  if (!match) return null;
  const expense = { ...match.expense };
  return { expenses: [expense, ...expenses], expense };
}

/** Month encoded in occ.{length}.{ruleId}.{YYYY-MM}, or null. */
function canonicalOccurrenceMonth(expenseId: string): string | null {
  if (!expenseId.startsWith("occ.")) return null;
  const rest = expenseId.slice(4);
  const lengthDot = rest.indexOf(".");
  if (lengthDot <= 0) return null;
  const length = Number(rest.slice(0, lengthDot));
  if (!Number.isInteger(length) || length < 1) return null;
  const afterLength = rest.slice(lengthDot + 1);
  if (afterLength.length < length + 1 + 7) return null;
  const month = afterLength.slice(length + 1);
  if (!/^\d{4}-\d{2}$/.test(month)) return null;
  return month;
}
