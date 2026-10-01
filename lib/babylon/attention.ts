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
  /** Present when the hook joins a stored interval. Absent means monthly. */
  intervalMonths?: number;
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

/**
 * Why a due or month-close reading cannot be called quiet.
 * These are evidence limits. They are not Attention kinds.
 */
export type AttentionTemporalUnknown =
  | { reason: "invalid_civil_today" }
  | { reason: "invalid_due_date"; expenseId: string }
  | { reason: "invalid_current_month_key" };

export type EstablishedAttentionItem =
  | { kind: "due_obligation"; item: DueAttentionItem }
  | { kind: "month_close"; item: MonthCloseAttention };

export type DueAttentionEpistemic =
  | {
      knowledge: "present";
      items: readonly DueAttentionItem[];
      unknowns: readonly [];
    }
  | {
      knowledge: "quiet";
      items: readonly [];
      unknowns: readonly [];
    }
  | {
      knowledge: "unknown";
      /** Validly derived due rows. Empty here is not quiet. */
      items: readonly DueAttentionItem[];
      unknowns: readonly AttentionTemporalUnknown[];
    };

export type MonthCloseAttentionEpistemic =
  | {
      knowledge: "present";
      item: MonthCloseAttention;
      /** The notice exists only while this month is still open. */
      currentMonthClosed: false;
      unknowns: readonly [];
    }
  | {
      knowledge: "absent";
      item: null;
      /**
       * True only when lastClosedMonthKey is the evaluated current month.
       * A false value does not mean a previous month was closed.
       */
      currentMonthClosed: boolean;
      unknowns: readonly [];
    }
  | {
      knowledge: "unknown";
      item: null;
      currentMonthClosed: null;
      unknowns: readonly AttentionTemporalUnknown[];
    };

export interface ComposedFinancialAttention {
  due: DueAttentionEpistemic;
  monthClose: MonthCloseAttentionEpistemic;
  /**
   * Established due_obligation rows in deriveDueAttention order, then
   * month_close when that notice exists. An empty array is not quiet.
   */
  items: readonly EstablishedAttentionItem[];
  /**
   * Both predicates were evaluated on valid temporal evidence and neither
   * produced an established item. This is the only quiet claim.
   */
  quiet: boolean;
}

export type FinancialAttentionEpistemic = "present" | "quiet" | "unknown";

const NO_UNKNOWNS = [] as const;

function invalidCandidateDueDates(
  expenses: readonly ExpenseEntry[]
): AttentionTemporalUnknown[] {
  const unknowns: AttentionTemporalUnknown[] = [];
  for (const expense of expenses) {
    if (expense.isSettled !== false) continue;
    if (isCivilIsoDate(expense.dueDate)) continue;
    unknowns.push({ reason: "invalid_due_date", expenseId: expense.id });
  }
  return unknowns;
}

function monthKeyIsReal(monthKey: string): boolean {
  return lastCivilDayOfMonth(monthKey) !== null;
}

/**
 * Read-only epistemic composition of the two established Attention predicates.
 * Does not add kinds, does not interpret settlement, and does not treat an
 * empty derivation as proof that nothing is due.
 */
export function composeFinancialAttention(input: {
  expenses: readonly ExpenseEntry[];
  today: string;
  /** Null when no current month was established. A string must be a real YYYY-MM. */
  currentMonthKey: string | null;
  lastClosedMonthKey: string | null;
}): ComposedFinancialAttention {
  const todayValid = isCivilIsoDate(input.today);
  const invalidDueDates = invalidCandidateDueDates(input.expenses);
  const dueUnknowns: AttentionTemporalUnknown[] = [];
  if (!todayValid) dueUnknowns.push({ reason: "invalid_civil_today" });
  dueUnknowns.push(...invalidDueDates);

  const dueItems = todayValid
    ? deriveDueAttention(input.expenses, input.today)
    : [];

  const due: DueAttentionEpistemic =
    dueUnknowns.length > 0
      ? { knowledge: "unknown", items: dueItems, unknowns: dueUnknowns }
      : dueItems.length > 0
        ? { knowledge: "present", items: dueItems, unknowns: NO_UNKNOWNS }
        : { knowledge: "quiet", items: [], unknowns: NO_UNKNOWNS };

  const monthUnknowns: AttentionTemporalUnknown[] = [];
  if (!todayValid) monthUnknowns.push({ reason: "invalid_civil_today" });
  if (input.currentMonthKey === null) {
    if (todayValid) monthUnknowns.push({ reason: "invalid_current_month_key" });
  } else if (!monthKeyIsReal(input.currentMonthKey)) {
    monthUnknowns.push({ reason: "invalid_current_month_key" });
  }

  let monthClose: MonthCloseAttentionEpistemic;
  if (monthUnknowns.length > 0 || input.currentMonthKey === null) {
    monthClose = {
      knowledge: "unknown",
      item: null,
      currentMonthClosed: null,
      unknowns: monthUnknowns,
    };
  } else {
    const notice = deriveMonthCloseAttention({
      today: input.today,
      currentMonthKey: input.currentMonthKey,
      lastClosedMonthKey: input.lastClosedMonthKey,
    });
    const currentMonthClosed = input.lastClosedMonthKey === input.currentMonthKey;
    monthClose = notice
      ? {
          knowledge: "present",
          item: notice,
          currentMonthClosed: false,
          unknowns: NO_UNKNOWNS,
        }
      : {
          knowledge: "absent",
          item: null,
          currentMonthClosed,
          unknowns: NO_UNKNOWNS,
        };
  }

  const items: EstablishedAttentionItem[] = [];
  for (const item of due.items) {
    items.push({ kind: "due_obligation", item });
  }
  if (monthClose.knowledge === "present") {
    items.push({ kind: "month_close", item: monthClose.item });
  }

  return {
    due,
    monthClose,
    items,
    quiet: due.knowledge === "quiet" && monthClose.knowledge === "absent",
  };
}

/** Whole-reading status. Unknown wins. Empty items do not select quiet. */
export function financialAttentionEpistemic(
  composed: ComposedFinancialAttention
): FinancialAttentionEpistemic {
  if (
    composed.due.knowledge === "unknown" ||
    composed.monthClose.knowledge === "unknown"
  ) {
    return "unknown";
  }
  if (composed.quiet) return "quiet";
  return "present";
}
