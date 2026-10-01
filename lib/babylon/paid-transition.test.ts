import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { EMPTY_STATE } from "@/lib/babylon/constants";
import { transitionOccurrencePaid, type PaidPreimage } from "@/lib/babylon/paid-transition";
import {
  dueDateForMonth,
  recurringOccurrenceId,
} from "@/lib/babylon/recurring-obligations";
import type { ExpenseEntry, PersistedState, RecurringObligation } from "@/types/babylon";

const ZONE = "America/Denver";
/** 2026-10-02 02:30 UTC is still 2026-10-01 in Denver. */
const DENVER_OCTOBER_FIRST = new Date("2026-10-02T02:30:00.000Z");
/** 2026-10-02 06:30 UTC is 2026-10-02 in Denver. */
const DENVER_OCTOBER_SECOND = new Date("2026-10-02T06:30:00.000Z");

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

function oneOff(partial: Partial<ExpenseEntry> = {}): ExpenseEntry {
  return {
    id: "groceries",
    name: "Groceries",
    category: "need",
    amount: 40,
    date: "2026-01-03",
    dueDate: "2026-01-03",
    isSettled: false,
    ...partial,
  };
}

function vault(partial: Partial<PersistedState> = {}): PersistedState {
  return {
    ...EMPTY_STATE,
    financialTimeZone: ZONE,
    displayName: "Ada",
    activityLog: [
      {
        id: "act-1",
        kind: "income",
        title: "Payroll",
        createdAt: "2026-09-01T15:00:00.000Z",
      },
    ],
    ...partial,
  };
}

function preimage(expense: Pick<
  ExpenseEntry,
  | "name"
  | "amount"
  | "category"
  | "dueDate"
  | "budgetCategoryId"
  | "recurringObligationId"
  | "recurrenceMonth"
>): PaidPreimage {
  return {
    name: expense.name,
    amount: expense.amount,
    category: expense.category,
    dueDate: expense.dueDate,
    budgetCategoryId: expense.budgetCategoryId ?? null,
    recurringObligationId: expense.recurringObligationId ?? null,
    recurrenceMonth: expense.recurrenceMonth ?? null,
    isSettled: false,
  };
}

describe("transitionOccurrencePaid", () => {
  it("pays a persisted one-off and leaves every other field in place", () => {
    const expense = oneOff();
    const state = vault({
      expenses: [expense],
      budgetTargets: [
        { id: "utilities", categoryName: "Utilities", plannedAmount: 100, isEssential: true },
      ],
    });
    const before = structuredClone(state);
    const result = transitionOccurrencePaid({
      state,
      occurrenceId: expense.id,
      preimage: preimage(expense),
      commitInstant: DENVER_OCTOBER_FIRST,
    });
    expect(state).toEqual(before);
    expect(result.status).toBe("paid");
    if (result.status !== "paid") return;
    expect(result.paymentDate).toBe("2026-10-01");
    expect(result.state.expenses).toEqual([
      { ...expense, isSettled: true, date: "2026-10-01" },
    ]);
    expect(result.state.activityLog).toEqual(state.activityLog);
    expect(result.state.budgetTargets).toEqual(state.budgetTargets);
    expect(result.state.financialTimeZone).toBe(ZONE);
    const { expenses: paidExpenses, ...paidRest } = result.state;
    const { expenses: originalExpenses, ...originalRest } = state;
    expect(paidRest).toEqual(originalRest);
    expect(originalExpenses).toEqual([expense]);
    expect(paidExpenses).toHaveLength(1);
  });

  it("pays a persisted recurring row without inserting another occurrence", () => {
    const expense = oneOff({
      id: "legacy-jan",
      name: "Phone",
      amount: 85,
      dueDate: "2026-01-15",
      date: "2026-01-15",
      budgetCategoryId: "utilities",
      recurringObligationId: "phone-rule",
      recurrenceMonth: "2026-01",
    });
    const state = vault({
      recurringObligations: [rule({ amount: 90, name: "Mobile" })],
      expenses: [expense, oneOff()],
    });
    const result = transitionOccurrencePaid({
      state,
      occurrenceId: expense.id,
      preimage: preimage(expense),
      commitInstant: DENVER_OCTOBER_FIRST,
    });
    expect(result.status).toBe("paid");
    if (result.status !== "paid") return;
    expect(result.state.expenses).toHaveLength(2);
    expect(result.state.expenses[0]).toEqual({
      ...expense,
      isSettled: true,
      date: "2026-10-01",
    });
    expect(result.state.expenses[1]).toEqual(oneOff());
    expect(result.state.recurringObligations).toEqual(state.recurringObligations);
  });

  it("materializes exactly the targeted derived month and settles it", () => {
    const month = "2026-03";
    const id = recurringOccurrenceId("phone-rule", month)!;
    const obligation = rule();
    const state = vault({
      recurringObligations: [obligation],
      expenses: [oneOff()],
    });
    const derived = {
      id,
      name: obligation.name,
      amount: obligation.amount,
      category: obligation.category,
      dueDate: dueDateForMonth(obligation.dueDay, month),
      budgetCategoryId: obligation.budgetCategoryId,
      recurringObligationId: obligation.id,
      recurrenceMonth: month,
    };
    const result = transitionOccurrencePaid({
      state,
      occurrenceId: id,
      preimage: preimage(derived),
      commitInstant: DENVER_OCTOBER_FIRST,
    });
    expect(result.status).toBe("paid");
    if (result.status !== "paid") return;
    expect(result.state.expenses.map((row) => row.recurrenceMonth ?? row.id)).toEqual([
      "2026-03",
      "groceries",
    ]);
    expect(result.state.expenses[0]).toMatchObject({
      id,
      isSettled: true,
      date: "2026-10-01",
      dueDate: "2026-03-15",
      amount: 85,
    });
    expect(result.state.activityLog).toEqual(state.activityLog);
  });

  it("rejects a derived month that was skipped, inactivated, or no longer matches", () => {
    const id = recurringOccurrenceId("phone-rule", "2026-03")!;
    const acknowledged = preimage({
      name: "Phone",
      amount: 85,
      category: "need",
      dueDate: "2026-03-15",
      budgetCategoryId: "utilities",
      recurringObligationId: "phone-rule",
      recurrenceMonth: "2026-03",
    });
    expect(
      transitionOccurrencePaid({
        state: vault({ recurringObligations: [rule({ skippedMonths: ["2026-03"] })] }),
        occurrenceId: id,
        preimage: acknowledged,
        commitInstant: DENVER_OCTOBER_FIRST,
      }).status
    ).toBe("rejected");
    expect(
      transitionOccurrencePaid({
        state: vault({ recurringObligations: [rule({ isActive: false })] }),
        occurrenceId: id,
        preimage: acknowledged,
        commitInstant: DENVER_OCTOBER_FIRST,
      })
    ).toMatchObject({ status: "rejected", reason: "derived_unavailable" });
    expect(
      transitionOccurrencePaid({
        state: vault({ recurringObligations: [rule({ amount: 90 })] }),
        occurrenceId: id,
        preimage: acknowledged,
        commitInstant: DENVER_OCTOBER_FIRST,
      })
    ).toMatchObject({ status: "rejected", reason: "preimage_mismatch" });
  });

  it("does not insert a canonical row beside a legacy occurrence", () => {
    const canonical = recurringOccurrenceId("phone-rule", "2026-01")!;
    const legacy = oneOff({
      id: "legacy-jan",
      name: "Phone",
      amount: 85,
      dueDate: "2026-01-15",
      date: "2026-01-15",
      budgetCategoryId: "utilities",
      recurringObligationId: "phone-rule",
      recurrenceMonth: "2026-01",
    });
    const state = vault({
      recurringObligations: [rule()],
      expenses: [legacy],
    });
    const result = transitionOccurrencePaid({
      state,
      occurrenceId: canonical,
      preimage: preimage(legacy),
      commitInstant: DENVER_OCTOBER_FIRST,
    });
    expect(result).toMatchObject({ status: "rejected", reason: "legacy_collision" });
    expect(state.expenses).toEqual([legacy]);
  });

  it("rejects an unknown id and a material preimage mismatch with no next document", () => {
    const expense = oneOff();
    const state = vault({ expenses: [expense] });
    expect(
      transitionOccurrencePaid({
        state,
        occurrenceId: "missing",
        preimage: preimage(expense),
        commitInstant: DENVER_OCTOBER_FIRST,
      })
    ).toEqual({ status: "rejected", reason: "unknown_occurrence" });
    expect(
      transitionOccurrencePaid({
        state,
        occurrenceId: expense.id,
        preimage: { ...preimage(expense), amount: 41 },
        commitInstant: DENVER_OCTOBER_FIRST,
      })
    ).toEqual({ status: "rejected", reason: "preimage_mismatch" });
  });

  it("returns the stored payment date when the occurrence is already paid", () => {
    const expense = oneOff({ isSettled: true, date: "2026-09-30" });
    const state = vault({ expenses: [expense], financialTimeZone: undefined });
    const result = transitionOccurrencePaid({
      state,
      occurrenceId: expense.id,
      preimage: preimage(expense),
      commitInstant: DENVER_OCTOBER_SECOND,
    });
    expect(result).toEqual({
      status: "already_paid",
      expenseId: expense.id,
      paymentDate: "2026-09-30",
    });
  });

  it("fails closed when the canonical financial timezone cannot resolve a new payment", () => {
    const expense = oneOff();
    const missing = transitionOccurrencePaid({
      state: vault({ expenses: [expense], financialTimeZone: undefined }),
      occurrenceId: expense.id,
      preimage: preimage(expense),
      commitInstant: DENVER_OCTOBER_FIRST,
    });
    const unusable = transitionOccurrencePaid({
      state: vault({ expenses: [expense], financialTimeZone: "Not/AZone" }),
      occurrenceId: expense.id,
      preimage: preimage(expense),
      commitInstant: DENVER_OCTOBER_FIRST,
    });
    expect(missing).toEqual({ status: "rejected", reason: "financial_calendar_unknown" });
    expect(unusable).toEqual({ status: "rejected", reason: "financial_calendar_unknown" });
  });

  it("uses the financial timezone rather than the UTC date of the commit instant", () => {
    const expense = oneOff();
    const result = transitionOccurrencePaid({
      state: vault({ expenses: [expense] }),
      occurrenceId: expense.id,
      preimage: preimage(expense),
      commitInstant: DENVER_OCTOBER_FIRST,
    });
    expect(result).toMatchObject({ status: "paid", paymentDate: "2026-10-01" });
    expect(DENVER_OCTOBER_FIRST.toISOString().slice(0, 10)).toBe("2026-10-02");
  });

  it("does not read the clock or append activity", () => {
    const source = readFileSync("lib/babylon/paid-transition.ts", "utf8");
    expect(source).not.toContain("Date.now");
    expect(source).not.toContain("new Date(");
    expect(source).not.toContain("todayIso");
    expect(source).not.toContain("getTimezoneOffset");
    expect(source).not.toContain("notification_preferences");
    expect(source).not.toContain("pushActivity");
    expect(source).not.toContain("activityLog");
    expect(source).toContain("financialCivilDate");
    expect(source).toContain("occurrenceForStewardAction");
    expect(source).toContain("markExpensePaid");
  });
});
