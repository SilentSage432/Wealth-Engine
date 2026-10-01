import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { composeFinancialAttention, deriveDueAttention } from "@/lib/babylon/attention";
import { financialVaultFingerprint } from "@/lib/babylon/cloud-vault";
import { EMPTY_STATE } from "@/lib/babylon/constants";
import {
  composeEffectiveExpenses,
  occurrenceForStewardAction,
  operatingRecurrenceRange,
} from "@/lib/babylon/effective-expenses";
import { markExpensePaid } from "@/lib/babylon/engine";
import {
  deleteExpenseOccurrence,
  recurringOccurrenceId,
  replaceExpenseOccurrence,
} from "@/lib/babylon/recurring-obligations";
import type { ExpenseEntry, PersistedState, RecurringObligation } from "@/types/babylon";

function rule(partial: Partial<RecurringObligation> = {}): RecurringObligation {
  return {
    id: "phone-rule",
    name: "Phone",
    amount: 85,
    category: "need",
    budgetCategoryId: "utilities",
    dueDay: 15,
    startMonth: "2026-01",
    isActive: true,
    createdAt: "2026-01-02",
    skippedMonths: [],
    ...partial,
  };
}

function oneOff(): ExpenseEntry {
  return {
    id: "groceries",
    name: "Groceries",
    category: "need",
    amount: 40,
    date: "2026-01-03",
    dueDate: "2026-01-03",
    isSettled: false,
  };
}

function ready(today: string, rules: RecurringObligation[], expenses: ExpenseEntry[]) {
  const range = operatingRecurrenceRange(rules, today);
  expect(range).not.toBeNull();
  const read = composeEffectiveExpenses(rules, expenses, range!);
  expect(read.status).toBe("ready");
  if (read.status !== "ready") throw new Error("unread");
  return read;
}

describe("composeEffectiveExpenses", () => {
  it("reads a due occurrence without persisting it or changing the fingerprint", () => {
    const rules = [rule()];
    const expenses = [oneOff()];
    const state: PersistedState = {
      ...EMPTY_STATE,
      recurringObligations: rules,
      expenses,
    };
    const before = structuredClone(state);
    const fingerprint = financialVaultFingerprint(state);
    const read = ready("2026-01-20", rules, expenses);
    expect(state).toEqual(before);
    expect(financialVaultFingerprint(state)).toBe(fingerprint);
    expect(read.expenses.some((row) => row.id === "groceries")).toBe(true);
    expect(read.derivedIds.has(recurringOccurrenceId("phone-rule", "2026-01")!)).toBe(true);
    expect(expenses).toHaveLength(1);
  });

  it("returns the same rows for the same persisted state and civil date", () => {
    const left = ready("2026-01-20", [rule()], [oneOff()]);
    const right = ready("2026-01-20", [rule()], [oneOff()]);
    expect(left.expenses).toEqual(right.expenses);
  });

  it("keeps persisted paid and edited evidence and omits a skip", () => {
    const paid = {
      id: "legacy-paid",
      name: "Phone",
      category: "need" as const,
      amount: 90,
      date: "2026-01-16",
      dueDate: "2026-01-15",
      budgetCategoryId: "utilities",
      isSettled: true,
      recurringObligationId: "phone-rule",
      recurrenceMonth: "2026-01",
    };
    const read = ready("2026-01-20", [rule({ skippedMonths: ["2026-02"] })], [paid]);
    const january = read.expenses.find((row) => row.recurrenceMonth === "2026-01");
    expect(january).toEqual(paid);
    expect(read.derivedIds.has(paid.id)).toBe(false);
    expect(read.expenses.some((row) => row.recurrenceMonth === "2026-02")).toBe(false);
  });

  it("keeps an edited unsettled row instead of the rule default", () => {
    const edited = {
      id: recurringOccurrenceId("phone-rule", "2026-01")!,
      name: "Phone",
      category: "need" as const,
      amount: 70,
      date: "2026-01-15",
      dueDate: "2026-01-12",
      budgetCategoryId: "utilities",
      isSettled: false,
      recurringObligationId: "phone-rule",
      recurrenceMonth: "2026-01",
    };
    const read = ready("2026-01-20", [rule()], [edited]);
    expect(read.expenses.filter((row) => row.recurrenceMonth === "2026-01")).toEqual([edited]);
  });

  it("does not derive an inactive rule and keeps a stored row", () => {
    const stored = {
      id: "kept",
      name: "Phone",
      category: "need" as const,
      amount: 85,
      date: "2026-01-15",
      dueDate: "2026-01-15",
      budgetCategoryId: "utilities",
      isSettled: false,
      recurringObligationId: "phone-rule",
      recurrenceMonth: "2026-01",
    };
    const quiet = ready("2026-01-20", [rule({ isActive: false })], []);
    expect(quiet.derivedIds.size).toBe(0);
    const kept = ready("2026-01-20", [rule({ isActive: false })], [stored]);
    expect(kept.expenses).toEqual([stored]);
  });

  it("recovers an unwitnessed historical due month only inside the requested horizon", () => {
    const read = ready("2026-03-20", [rule({ startMonth: "2026-01" })], []);
    const months = read.expenses.map((row) => row.recurrenceMonth);
    expect(months).toEqual(["2026-01", "2026-02", "2026-03", "2026-04"]);
    const attention = deriveDueAttention(read.expenses, "2026-03-20");
    expect(attention.map((item) => item.dueDate)).toEqual([
      "2026-01-15",
      "2026-02-15",
      "2026-03-15",
    ]);
    const composed = composeFinancialAttention({
      expenses: read.expenses,
      today: "2026-03-20",
      currentMonthKey: "2026-03",
      lastClosedMonthKey: "2026-02",
    });
    expect(composed.due.knowledge).toBe("present");
    expect(composed.quiet).toBe(false);
  });

  it("leaves a not-yet-due current month quiet", () => {
    const read = ready("2026-01-10", [rule({ dueDay: 28 })], []);
    const composed = composeFinancialAttention({
      expenses: read.expenses,
      today: "2026-01-10",
      currentMonthKey: "2026-01",
      lastClosedMonthKey: "2025-12",
    });
    expect(composed.due.knowledge).toBe("quiet");
    expect(read.expenses.map((row) => row.recurrenceMonth)).toEqual(["2026-01", "2026-02"]);
  });

  it("fails closed on duplicate semantic evidence and does not return a list", () => {
    const row = {
      id: "one",
      name: "Phone",
      category: "need" as const,
      amount: 85,
      date: "2026-01-15",
      dueDate: "2026-01-15",
      isSettled: false,
      recurringObligationId: "phone-rule",
      recurrenceMonth: "2026-01",
    };
    const copy = { ...row, id: "two" };
    const range = operatingRecurrenceRange([rule()], "2026-01-20")!;
    const read = composeEffectiveExpenses([rule()], [row, copy], range);
    expect(read).toEqual({
      status: "invalid",
      reason: "duplicate_semantic_occurrence",
    });
  });

  it("does not read the clock inside the composition", () => {
    const source = readFileSync("lib/babylon/effective-expenses.ts", "utf8");
    expect(source).not.toContain("Date.now");
    expect(source).not.toContain("todayIso");
    expect(source).not.toContain("notification_preferences");
    expect(source).not.toContain("compareAndSwap");
    expect(source).not.toContain("savePersistedState");
  });
});

describe("occurrenceForStewardAction", () => {
  it("persists only the targeted derived month when marked paid, skipped, or edited", () => {
    const rules = [rule()];
    const march = recurringOccurrenceId("phone-rule", "2026-03")!;
    const prepared = occurrenceForStewardAction(rules, [], march);
    expect(prepared?.expenses.map((row) => row.recurrenceMonth)).toEqual(["2026-03"]);
    const paid = prepared!.expenses.map((row) =>
      row.id === march ? markExpensePaid(row, "2026-03-04") : row
    );
    expect(paid).toHaveLength(1);
    expect(paid[0]?.isSettled).toBe(true);

    const skipped = deleteExpenseOccurrence(rules, prepared!.expenses, march);
    expect(skipped?.expenses).toEqual([]);
    expect(skipped?.rules[0]?.skippedMonths).toEqual(["2026-03"]);

    const edited = replaceExpenseOccurrence(prepared!.expenses, march, {
      amount: 40,
      dueDate: "2026-03-02",
    });
    expect(edited).toHaveLength(1);
    expect(edited?.[0]?.amount).toBe(40);
    expect(edited?.[0]?.dueDate).toBe("2026-03-02");
    const untouched: ExpenseEntry[] = [];
    occurrenceForStewardAction(rules, untouched, march);
    expect(untouched).toEqual([]);
  });

  it("does not invent a row for an unknown id or an inactive rule", () => {
    expect(occurrenceForStewardAction([rule()], [], "missing")).toBeNull();
    const id = recurringOccurrenceId("phone-rule", "2026-01")!;
    expect(occurrenceForStewardAction([rule({ isActive: false })], [], id)).toBeNull();
  });

  it("uses a stored legacy row and does not add the canonical id beside it", () => {
    const legacy = {
      id: "legacy-jan",
      name: "Phone",
      category: "need" as const,
      amount: 85,
      date: "2026-01-15",
      dueDate: "2026-01-15",
      isSettled: false,
      recurringObligationId: "phone-rule",
      recurrenceMonth: "2026-01",
    };
    const prepared = occurrenceForStewardAction([rule()], [legacy], legacy.id);
    expect(prepared?.expenses).toEqual([legacy]);
    const canonical = recurringOccurrenceId("phone-rule", "2026-01")!;
    expect(occurrenceForStewardAction([rule()], [legacy], canonical)).toBeNull();
  });
});

describe("hydration authorship", () => {
  it("does not write recurring defaults from hydration or the local day change", () => {
    const hook = readFileSync("hooks/useBabylonEngine.ts", "utf8");
    expect(hook).not.toContain("materializeRecurringObligations");
    const align = hook.slice(
      hook.indexOf("const align = () => {"),
      hook.indexOf("const schedule = () => {")
    );
    expect(align).not.toContain("setExpenses");
    const save = hook.slice(
      hook.indexOf("const payload: PersistedState"),
      hook.indexOf("savePersistedState(payload)")
    );
    expect(save).toContain("expenses,");
    expect(save).not.toContain("obligationExpenses");
    expect(save).not.toContain("composeEffectiveExpenses");
  });
});
