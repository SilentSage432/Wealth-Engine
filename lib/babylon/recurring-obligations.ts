/**
 * Declared recurring obligations.
 * A rule describes the bill and how many calendar months pass between
 * occurrences. An expense occurrence is one due month of it.
 * Generation creates Upcoming expenses. It never marks them paid.
 * A missing interval is monthly. Months the interval does not include are
 * not skips, and the rule does not set money aside between occurrences.
 * projectRecurringOccurrences answers a caller-supplied month range. It does
 * not persist, and it does not read the device clock. Effective expense
 * reads compose that projection. Hydration does not write default rows.
 */

/** UI frequencies. The rule itself accepts any positive integer interval. */
export const OBLIGATION_INTERVAL_CHOICES = [1, 2, 3, 6, 12] as const;

import { nextMonthKey, roundMoney } from "@/lib/babylon/engine";
import type {
  ExpenseEntry,
  ExpenseKind,
  RecurringObligation,
} from "@/types/babylon";

const MONTH_KEY = /^\d{4}-\d{2}$/;

export function isRealLocalIsoDate(value: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
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

function monthKey(isoDate: string): string {
  return isoDate.slice(0, 7);
}

/** Current calendar month and the next one. Not a year of bills. */
export function horizonMonthKeys(today: string): [string, string] {
  const current = monthKey(today);
  return [current, nextMonthKey(current)];
}

/** Months since year 0. Not a day count. Invalid keys are null. */
function calendarMonthIndex(monthKeyValue: string): number | null {
  if (!MONTH_KEY.test(monthKeyValue)) return null;
  const year = Number(monthKeyValue.slice(0, 4));
  const month = Number(monthKeyValue.slice(5, 7));
  if (month < 1 || month > 12) return null;
  return year * 12 + (month - 1);
}

/**
 * True when the candidate month is the start month or a later month whose
 * calendar-month distance from the start is a multiple of the interval.
 */
export function isObligationMonthDue(
  startMonth: string,
  candidateMonth: string,
  intervalMonths: number
): boolean {
  if (!Number.isInteger(intervalMonths) || intervalMonths < 1) return false;
  const start = calendarMonthIndex(startMonth);
  const candidate = calendarMonthIndex(candidateMonth);
  if (start === null || candidate === null) return false;
  const distance = candidate - start;
  return distance >= 0 && distance % intervalMonths === 0;
}

/** Absent interval is monthly. */
export function obligationIntervalMonths(
  rule: Pick<RecurringObligation, "intervalMonths">
): number {
  return rule.intervalMonths ?? 1;
}

/** Steward-facing cadence. Interval 1 and a missing interval are Monthly. */
export function obligationIntervalLabel(intervalMonths?: number): string {
  const interval = intervalMonths ?? 1;
  if (interval === 1) return "Monthly";
  if (interval === 12) return "Yearly";
  return `Every ${interval} months`;
}

export function obligationIntervalChoices(current?: number): number[] {
  const interval = current ?? 1;
  if ((OBLIGATION_INTERVAL_CHOICES as readonly number[]).includes(interval)) {
    return [...OBLIGATION_INTERVAL_CHOICES];
  }
  return [...OBLIGATION_INTERVAL_CHOICES, interval].sort((left, right) => left - right);
}

/**
 * Calendar day in a month. Day 31 in February is the 28th or 29th.
 * The rule's dueDay is not changed.
 */
export function dueDateForMonth(dueDay: number, monthKeyValue: string): string {
  const [year, month] = monthKeyValue.split("-").map(Number);
  const lastDay = new Date(year, month, 0).getDate();
  const day = Math.min(dueDay, lastDay);
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function isDueDay(value: number): boolean {
  return Number.isInteger(value) && value >= 1 && value <= 31;
}

function isIntervalMonths(value: number): boolean {
  return Number.isInteger(value) && value >= 1;
}

export function buildRecurringObligation(
  input: {
    name: string;
    amount: number;
    category: ExpenseKind;
    budgetCategoryId: string;
    firstDueDate: string;
    /** Absent or 1 stays off the stored rule. Both mean monthly. */
    intervalMonths?: number;
  },
  id: string,
  createdAt: string
): RecurringObligation | null {
  if (!input.name.trim()) return null;
  if (!Number.isFinite(input.amount) || input.amount <= 0) return null;
  if (input.category !== "need" && input.category !== "desire") return null;
  if (!input.budgetCategoryId.trim()) return null;
  if (!isRealLocalIsoDate(input.firstDueDate)) return null;
  if (!isRealLocalIsoDate(createdAt)) return null;
  if (!id.trim()) return null;
  if (
    input.intervalMonths !== undefined &&
    !isIntervalMonths(input.intervalMonths)
  ) {
    return null;
  }
  const day = Number(input.firstDueDate.slice(8, 10));
  const intervalMonths = input.intervalMonths;
  return {
    id,
    name: input.name.trim(),
    amount: roundMoney(input.amount),
    category: input.category,
    budgetCategoryId: input.budgetCategoryId.trim(),
    dueDay: day,
    startMonth: monthKey(input.firstDueDate),
    ...(intervalMonths !== undefined && intervalMonths !== 1
      ? { intervalMonths }
      : {}),
    isActive: true,
    createdAt,
    skippedMonths: [],
  };
}

export function parseRecurringObligation(value: unknown): RecurringObligation | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Record<string, unknown>;
  if (typeof raw.id !== "string" || !raw.id.trim()) return null;
  if (typeof raw.name !== "string" || !raw.name.trim()) return null;
  if (typeof raw.amount !== "number" || !Number.isFinite(raw.amount) || raw.amount <= 0) {
    return null;
  }
  if (raw.category !== "need" && raw.category !== "desire") return null;
  if (typeof raw.budgetCategoryId !== "string" || !raw.budgetCategoryId.trim()) {
    return null;
  }
  if (typeof raw.dueDay !== "number" || !isDueDay(raw.dueDay)) return null;
  if (typeof raw.startMonth !== "string" || !MONTH_KEY.test(raw.startMonth)) {
    return null;
  }
  if (typeof raw.isActive !== "boolean") return null;
  if (typeof raw.createdAt !== "string" || !isRealLocalIsoDate(raw.createdAt)) {
    return null;
  }
  let intervalMonths: number | undefined;
  if (raw.intervalMonths !== undefined) {
    if (typeof raw.intervalMonths !== "number" || !isIntervalMonths(raw.intervalMonths)) {
      return null;
    }
    intervalMonths = raw.intervalMonths;
  }
  if (!Array.isArray(raw.skippedMonths)) return null;
  const skippedMonths: string[] = [];
  for (const month of raw.skippedMonths) {
    if (typeof month !== "string" || !MONTH_KEY.test(month)) return null;
    if (!skippedMonths.includes(month)) skippedMonths.push(month);
  }
  return {
    id: raw.id.trim(),
    name: raw.name.trim(),
    amount: roundMoney(raw.amount),
    category: raw.category,
    budgetCategoryId: raw.budgetCategoryId.trim(),
    dueDay: raw.dueDay,
    startMonth: raw.startMonth,
    ...(intervalMonths !== undefined ? { intervalMonths } : {}),
    isActive: raw.isActive,
    createdAt: raw.createdAt,
    skippedMonths,
  };
}

function hasOccurrence(
  expenses: readonly ExpenseEntry[],
  ruleId: string,
  recurrenceMonth: string
): boolean {
  return expenses.some(
    (expense) =>
      expense.recurringObligationId === ruleId &&
      expense.recurrenceMonth === recurrenceMonth
  );
}

/**
 * Persisted id for one generated occurrence.
 * The semantic key is the rule id plus the recurrence month.
 * A length prefix keeps two rule ids from aliasing across the separator.
 * Null when either part is not a supported key. No clock, randomness, or device.
 */
export function recurringOccurrenceId(
  ruleId: string,
  recurrenceMonth: string
): string | null {
  if (!ruleId || ruleId !== ruleId.trim()) return null;
  if (!MONTH_KEY.test(recurrenceMonth)) return null;
  return `occ.${String(ruleId.length)}.${ruleId}.${recurrenceMonth}`;
}

/**
 * Ensure each active rule has an Upcoming occurrence for a due month inside
 * the current month and the next month. A longer interval does not widen
 * that horizon. A month the interval does not include is left alone and is
 * not recorded as skipped. Existing and skipped due months are left alone.
 * Nothing is marked paid.
 * A new row uses recurringOccurrenceId. A row already stored for that
 * rule and month, including an older random id, is left as it was.
 * createId is only for in-memory readers that must not persist these rows.
 */
export function materializeRecurringObligations(
  rules: readonly RecurringObligation[],
  expenses: readonly ExpenseEntry[],
  today: string,
  createId: (
    ruleId: string,
    recurrenceMonth: string
  ) => string | null = recurringOccurrenceId
): { expenses: ExpenseEntry[]; created: ExpenseEntry[] } {
  if (!isRealLocalIsoDate(today)) return { expenses: [...expenses], created: [] };
  const months = horizonMonthKeys(today);
  const created: ExpenseEntry[] = [];
  const next = [...expenses];

  for (const rule of rules) {
    if (!rule.isActive) continue;
    for (const recurrenceMonth of months) {
      if (
        !isObligationMonthDue(
          rule.startMonth,
          recurrenceMonth,
          obligationIntervalMonths(rule)
        )
      ) {
        continue;
      }
      if (rule.skippedMonths.includes(recurrenceMonth)) continue;
      if (hasOccurrence(next, rule.id, recurrenceMonth)) continue;
      const id = createId(rule.id, recurrenceMonth);
      if (!id) continue;
      const dueDate = dueDateForMonth(rule.dueDay, recurrenceMonth);
      const entry: ExpenseEntry = {
        id,
        name: rule.name,
        category: rule.category,
        amount: roundMoney(rule.amount),
        date: dueDate,
        dueDate,
        budgetCategoryId: rule.budgetCategoryId,
        isSettled: false,
        recurringObligationId: rule.id,
        recurrenceMonth,
      };
      created.push(entry);
      next.unshift(entry);
    }
  }

  if (created.length === 0) return { expenses: [...expenses], created };
  return { expenses: next, created };
}

/**
 * Inclusive civil months the caller already resolved.
 * This is not a timezone and not a device clock reading.
 */
export interface CivilMonthRange {
  /** Inclusive YYYY-MM. */
  fromMonth: string;
  /** Inclusive YYYY-MM. */
  throughMonth: string;
}

export type RecurrenceProjectionInvalidReason =
  | "invalid_range"
  | "invalid_rule"
  | "invalid_occurrence_evidence"
  | "duplicate_semantic_occurrence";

/**
 * Persisted evidence is the stored expense row.
 * A derived occurrence is the default the rule implies for that month.
 */
export interface ProjectedRecurringOccurrence {
  origin: "persisted" | "derived";
  expense: ExpenseEntry;
}

export type RecurrenceProjection =
  | {
      status: "projected";
      occurrences: readonly ProjectedRecurringOccurrence[];
    }
  | {
      status: "invalid";
      reason: RecurrenceProjectionInvalidReason;
    };

function monthKeyFromIndex(index: number): string {
  const year = Math.floor(index / 12);
  const month = (index % 12) + 1;
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}`;
}

/** Inclusive month keys. Null when either boundary is not a real month or the range runs backward. */
function civilMonthsInRange(range: CivilMonthRange): string[] | null {
  if (!range || typeof range.fromMonth !== "string" || typeof range.throughMonth !== "string") {
    return null;
  }
  const from = calendarMonthIndex(range.fromMonth);
  const through = calendarMonthIndex(range.throughMonth);
  if (from === null || through === null || from > through) return null;
  const months: string[] = [];
  for (let index = from; index <= through; index += 1) {
    months.push(monthKeyFromIndex(index));
  }
  return months;
}

function occurrenceSemanticKey(ruleId: string, recurrenceMonth: string): string {
  return `${String(ruleId.length)}.${ruleId}.${recurrenceMonth}`;
}

/**
 * A one-off expense has no semantic key. A half-filled or impossible
 * rule/month pair is invalid evidence. Valid evidence keeps its stored id.
 */
function readOccurrenceEvidence(
  expense: ExpenseEntry
): { ok: true; key: string | null; month: string | null } | { ok: false } {
  if (!expense || typeof expense !== "object") return { ok: false };
  const hasRule = expense.recurringObligationId !== undefined;
  const hasMonth = expense.recurrenceMonth !== undefined;
  if (!hasRule && !hasMonth) return { ok: true, key: null, month: null };
  if (!hasRule || !hasMonth) return { ok: false };
  const ruleId = expense.recurringObligationId;
  const month = expense.recurrenceMonth;
  if (!ruleId || ruleId !== ruleId.trim()) return { ok: false };
  if (!month || calendarMonthIndex(month) === null) return { ok: false };
  return { ok: true, key: occurrenceSemanticKey(ruleId, month), month };
}

/** True when parsing would keep this rule as it already is. No silent cleanup. */
function isAuthoritativeRecurringRule(rule: RecurringObligation): boolean {
  if (!rule || typeof rule !== "object") return false;
  const parsed = parseRecurringObligation(rule);
  if (!parsed) return false;
  if (parsed.id !== rule.id || !recurringOccurrenceId(rule.id, rule.startMonth)) {
    return false;
  }
  if (parsed.name !== rule.name) return false;
  if (parsed.amount !== rule.amount) return false;
  if (parsed.category !== rule.category) return false;
  if (parsed.budgetCategoryId !== rule.budgetCategoryId) return false;
  if (parsed.dueDay !== rule.dueDay) return false;
  if (parsed.startMonth !== rule.startMonth) return false;
  if (parsed.intervalMonths !== rule.intervalMonths) return false;
  if (parsed.isActive !== rule.isActive) return false;
  if (parsed.createdAt !== rule.createdAt) return false;
  if (parsed.skippedMonths.length !== rule.skippedMonths.length) return false;
  for (let index = 0; index < parsed.skippedMonths.length; index += 1) {
    if (parsed.skippedMonths[index] !== rule.skippedMonths[index]) return false;
  }
  return true;
}

function derivedOccurrence(
  rule: RecurringObligation,
  recurrenceMonth: string
): ExpenseEntry | null {
  const id = recurringOccurrenceId(rule.id, recurrenceMonth);
  if (!id) return null;
  const dueDate = dueDateForMonth(rule.dueDay, recurrenceMonth);
  return {
    id,
    name: rule.name,
    category: rule.category,
    amount: roundMoney(rule.amount),
    date: dueDate,
    dueDate,
    budgetCategoryId: rule.budgetCategoryId,
    isSettled: false,
    recurringObligationId: rule.id,
    recurrenceMonth,
  };
}

/**
 * Which recurring occurrences exist in a caller-supplied inclusive month range.
 *
 * Financial recurrence projection does not own timezone resolution. The caller
 * supplies the authoritative civil range. This function does not read the
 * device clock.
 *
 * A due month inside the range is derived when no stored expense already
 * carries that rule id and recurrence month, including a month no client
 * opened. The derived id is recurringOccurrenceId. A stored row is returned
 * unchanged: legacy id, canonical id, paid, or steward-edited.
 * skippedMonths and an inactive rule do not create a row. They also do not
 * erase a row that is already stored. Duplicate semantic evidence fails closed.
 * One-off expenses are not recurring occurrences.
 *
 * Nothing is persisted. Income, allocation, plans, and month close are not
 * inputs. Hydration does not call this function.
 */
export function projectRecurringOccurrences(
  rules: readonly RecurringObligation[],
  expenses: readonly ExpenseEntry[],
  range: CivilMonthRange
): RecurrenceProjection {
  const months = civilMonthsInRange(range);
  if (!months) return { status: "invalid", reason: "invalid_range" };

  const seenRuleIds = new Set<string>();
  for (const rule of rules) {
    if (!isAuthoritativeRecurringRule(rule) || seenRuleIds.has(rule.id)) {
      return { status: "invalid", reason: "invalid_rule" };
    }
    seenRuleIds.add(rule.id);
  }

  const evidence = new Map<string, ExpenseEntry>();
  for (const expense of expenses) {
    const read = readOccurrenceEvidence(expense);
    if (!read.ok) return { status: "invalid", reason: "invalid_occurrence_evidence" };
    if (!read.key) continue;
    if (evidence.has(read.key)) {
      return { status: "invalid", reason: "duplicate_semantic_occurrence" };
    }
    evidence.set(read.key, expense);
  }

  const occurrences: ProjectedRecurringOccurrence[] = [];
  const claimed = new Set<string>();
  for (const recurrenceMonth of months) {
    for (const rule of rules) {
      if (!rule.isActive) continue;
      if (
        !isObligationMonthDue(
          rule.startMonth,
          recurrenceMonth,
          obligationIntervalMonths(rule)
        )
      ) {
        continue;
      }
      if (rule.skippedMonths.includes(recurrenceMonth)) continue;
      const key = occurrenceSemanticKey(rule.id, recurrenceMonth);
      const stored = evidence.get(key);
      if (stored) {
        occurrences.push({ origin: "persisted", expense: stored });
      } else {
        const created = derivedOccurrence(rule, recurrenceMonth);
        if (!created) return { status: "invalid", reason: "invalid_rule" };
        occurrences.push({ origin: "derived", expense: created });
      }
      claimed.add(key);
    }
    for (const expense of expenses) {
      const read = readOccurrenceEvidence(expense);
      if (!read.ok || !read.key || read.month !== recurrenceMonth || claimed.has(read.key)) {
        continue;
      }
      occurrences.push({ origin: "persisted", expense });
      claimed.add(read.key);
    }
  }

  return { status: "projected", occurrences };
}

export function replaceRecurringObligation(
  rules: readonly RecurringObligation[],
  id: string,
  patch: {
    name?: string;
    amount?: number;
    category?: ExpenseKind;
    budgetCategoryId?: string;
    dueDay?: number;
    isActive?: boolean;
    intervalMonths?: number;
  }
): RecurringObligation[] | null {
  const current = rules.find((rule) => rule.id === id);
  if (!current) return null;
  if (patch.name !== undefined && !patch.name.trim()) return null;
  if (
    patch.amount !== undefined &&
    (!Number.isFinite(patch.amount) || patch.amount <= 0)
  ) {
    return null;
  }
  if (
    patch.category !== undefined &&
    patch.category !== "need" &&
    patch.category !== "desire"
  ) {
    return null;
  }
  if (patch.budgetCategoryId !== undefined && !patch.budgetCategoryId.trim()) {
    return null;
  }
  if (patch.dueDay !== undefined && !isDueDay(patch.dueDay)) return null;
  if (
    patch.intervalMonths !== undefined &&
    !isIntervalMonths(patch.intervalMonths)
  ) {
    return null;
  }

  return rules.map((rule) => {
    if (rule.id !== id) return rule;
    const next: RecurringObligation = {
      ...rule,
      ...(patch.name !== undefined ? { name: patch.name.trim() } : {}),
      ...(patch.amount !== undefined ? { amount: roundMoney(patch.amount) } : {}),
      ...(patch.category !== undefined ? { category: patch.category } : {}),
      ...(patch.budgetCategoryId !== undefined
        ? { budgetCategoryId: patch.budgetCategoryId.trim() }
        : {}),
      ...(patch.dueDay !== undefined ? { dueDay: patch.dueDay } : {}),
      ...(patch.isActive !== undefined ? { isActive: patch.isActive } : {}),
    };
    if (patch.intervalMonths === undefined) return next;
    if (patch.intervalMonths === 1) {
      delete next.intervalMonths;
      return next;
    }
    next.intervalMonths = patch.intervalMonths;
    return next;
  });
}

/** One month's expense only. The rule's normal amount is not changed. */
export function replaceExpenseOccurrence(
  expenses: readonly ExpenseEntry[],
  id: string,
  patch: { amount?: number; dueDate?: string }
): ExpenseEntry[] | null {
  const current = expenses.find((expense) => expense.id === id);
  if (!current) return null;
  if (
    patch.amount !== undefined &&
    (!Number.isFinite(patch.amount) || patch.amount <= 0)
  ) {
    return null;
  }
  if (patch.dueDate !== undefined && !isRealLocalIsoDate(patch.dueDate)) {
    return null;
  }
  return expenses.map((expense) => {
    if (expense.id !== id) return expense;
    return {
      ...expense,
      ...(patch.amount !== undefined ? { amount: roundMoney(patch.amount) } : {}),
      ...(patch.dueDate !== undefined ? { dueDate: patch.dueDate } : {}),
    };
  });
}

/**
 * Remove one expense. A generated month is remembered on the rule so reload
 * does not create it again. The rule itself stays.
 */
export function deleteExpenseOccurrence(
  rules: readonly RecurringObligation[],
  expenses: readonly ExpenseEntry[],
  expenseId: string
): { rules: RecurringObligation[]; expenses: ExpenseEntry[] } | null {
  const target = expenses.find((expense) => expense.id === expenseId);
  if (!target) return null;
  const nextExpenses = expenses.filter((expense) => expense.id !== expenseId);
  if (!target.recurringObligationId || !target.recurrenceMonth) {
    return { rules: [...rules], expenses: nextExpenses };
  }
  const ruleId = target.recurringObligationId;
  const recurrenceMonth = target.recurrenceMonth;
  return {
    rules: rules.map((rule) => {
      if (rule.id !== ruleId) return rule;
      if (rule.skippedMonths.includes(recurrenceMonth)) return rule;
      return { ...rule, skippedMonths: [...rule.skippedMonths, recurrenceMonth] };
    }),
    expenses: nextExpenses,
  };
}

/** Next unpaid expenses, recurring or not. Paid rows are omitted. */
export function comingUpObligations(
  expenses: readonly ExpenseEntry[],
  limit = 5
): ExpenseEntry[] {
  return expenses
    .filter((expense) => !expense.isSettled)
    .slice()
    .sort((a, b) => a.dueDate.localeCompare(b.dueDate) || a.name.localeCompare(b.name))
    .slice(0, limit);
}
