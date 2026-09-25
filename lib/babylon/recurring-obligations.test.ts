import { describe, expect, it } from "vitest";
import { EMPTY_STATE } from "@/lib/babylon/constants";
import {
  actualSpendTotals,
  livingBudgetRemaining,
  markExpensePaid,
  upcomingNeedsTotal,
} from "@/lib/babylon/engine";
import { sumAccountBalances } from "@/lib/babylon/financial-position";
import {
  buildLedgerBackup,
  normalizePersistedState,
  validateLedgerBackup,
} from "@/lib/babylon/persistence";
import {
  buildRecurringObligation,
  comingUpObligations,
  deleteExpenseOccurrence,
  dueDateForMonth,
  materializeRecurringObligations,
  replaceExpenseOccurrence,
  replaceRecurringObligation,
} from "@/lib/babylon/recurring-obligations";
import type {
  ExpenseEntry,
  FinancialAccount,
  RecurringObligation,
} from "@/types/babylon";

function ids() {
  let n = 0;
  return () => `occ-${++n}`;
}

function rule(partial: Partial<RecurringObligation> = {}): RecurringObligation {
  return {
    id: "phone-rule",
    name: "Phone",
    amount: 85,
    category: "need",
    budgetCategoryId: "utilities",
    dueDay: 18,
    startMonth: "2026-10",
    isActive: true,
    createdAt: "2026-09-24",
    skippedMonths: [],
    ...partial,
  };
}

function account(): FinancialAccount {
  return {
    id: "checking",
    name: "Checking",
    kind: "checking",
    balance: 2000,
    asOf: "2026-09-24",
  };
}

describe("monthly recurring obligations", () => {
  it("creates an upcoming occurrence and does not mark it paid", () => {
    const created = buildRecurringObligation(
      {
        name: "Phone",
        amount: 85,
        category: "need",
        budgetCategoryId: "utilities",
        firstDueDate: "2026-10-18",
      },
      "phone-rule",
      "2026-09-24"
    );
    expect(created?.dueDay).toBe(18);
    expect(created?.startMonth).toBe("2026-10");
    const result = materializeRecurringObligations(
      [created!],
      [],
      "2026-09-24",
      ids()
    );
    expect(result.created).toHaveLength(1);
    expect(result.created[0]?.isSettled).toBe(false);
    expect(result.created[0]?.dueDate).toBe("2026-10-18");
    expect(result.created.every((row) => row.isSettled === false)).toBe(true);
  });

  it("does not reduce Living Budget until the occurrence is paid", () => {
    const result = materializeRecurringObligations(
      [rule({ startMonth: "2026-09", dueDay: 27 })],
      [],
      "2026-09-24",
      ids()
    );
    const upcoming = result.expenses;
    expect(actualSpendTotals(upcoming).total).toBe(0);
    expect(livingBudgetRemaining(700, actualSpendTotals(upcoming).total)).toBe(700);
    const paid = markExpensePaid(upcoming[0]!, "2026-09-27");
    const after = upcoming.map((row) => (row.id === paid.id ? paid : row));
    expect(actualSpendTotals(after).total).toBe(85);
    expect(livingBudgetRemaining(700, actualSpendTotals(after).total)).toBe(615);
    expect(after.filter((row) => row.isSettled)).toHaveLength(1);
  });

  it("counts an unpaid Need once and leaves a Want out of Upcoming Needs", () => {
    const needs = materializeRecurringObligations(
      [rule({ id: "rent", name: "Rent", amount: 700, startMonth: "2026-10" })],
      [],
      "2026-09-24",
      ids()
    );
    const wants = materializeRecurringObligations(
      [
        rule({
          id: "streaming",
          name: "Streaming",
          amount: 15,
          category: "desire",
          startMonth: "2026-10",
        }),
      ],
      needs.expenses,
      "2026-09-24",
      ids()
    );
    expect(upcomingNeedsTotal(wants.expenses)).toBe(700);
    expect(wants.expenses.filter((row) => row.name === "Rent")).toHaveLength(1);
  });

  it("materializes only the current month and the next month", () => {
    const result = materializeRecurringObligations(
      [rule({ startMonth: "2026-09", dueDay: 15 })],
      [],
      "2026-09-24",
      ids()
    );
    expect(result.created.map((row) => row.recurrenceMonth).sort()).toEqual([
      "2026-09",
      "2026-10",
    ]);
    expect(result.created.some((row) => row.recurrenceMonth === "2026-11")).toBe(
      false
    );
  });

  it("does not create an overdue month before the first due date", () => {
    const result = materializeRecurringObligations(
      [rule()],
      [],
      "2026-09-24",
      ids()
    );
    expect(result.created.map((row) => row.recurrenceMonth)).toEqual(["2026-10"]);
    expect(result.created[0]?.dueDate).toBe("2026-10-18");
  });

  it("keeps a calendar day and clamps only the short month", () => {
    expect(dueDateForMonth(15, "2026-09")).toBe("2026-09-15");
    expect(dueDateForMonth(15, "2026-10")).toBe("2026-10-15");
    expect(dueDateForMonth(31, "2026-01")).toBe("2026-01-31");
    expect(dueDateForMonth(31, "2026-02")).toBe("2026-02-28");
    expect(dueDateForMonth(31, "2026-03")).toBe("2026-03-31");
    expect(dueDateForMonth(31, "2024-02")).toBe("2024-02-29");
    expect(dueDateForMonth(31, "2024-03")).toBe("2024-03-31");
    expect(dueDateForMonth(30, "2026-02")).toBe("2026-02-28");
    expect(dueDateForMonth(30, "2026-03")).toBe("2026-03-30");
  });

  it("does not duplicate a rule month when materialization repeats", () => {
    const phone = rule({ startMonth: "2026-09", dueDay: 15 });
    const createId = ids();
    const once = materializeRecurringObligations([phone], [], "2026-09-24", createId);
    const twice = materializeRecurringObligations(
      [phone],
      once.expenses,
      "2026-09-24",
      createId
    );
    expect(twice.created).toEqual([]);
    expect(twice.expenses).toHaveLength(2);
    const reloaded = normalizePersistedState({
      ...EMPTY_STATE,
      recurringObligations: [phone],
      expenses: once.expenses,
      expenseSemanticsVersion: 2,
    });
    const afterReload = materializeRecurringObligations(
      reloaded.recurringObligations,
      reloaded.expenses,
      "2026-09-24",
      createId
    );
    expect(afterReload.created).toEqual([]);
    expect(afterReload.expenses).toHaveLength(2);
  });

  it("pays one month without paying the next or changing the rule", () => {
    const phone = rule({ startMonth: "2026-09", dueDay: 15 });
    const result = materializeRecurringObligations(
      [phone],
      [],
      "2026-09-24",
      ids()
    );
    const september = result.expenses.find(
      (row) => row.recurrenceMonth === "2026-09"
    )!;
    const october = result.expenses.find(
      (row) => row.recurrenceMonth === "2026-10"
    )!;
    const paid = markExpensePaid(september, "2026-09-24");
    expect(paid.id).toBe(september.id);
    expect(paid.isSettled).toBe(true);
    expect(paid.date).toBe("2026-09-24");
    expect(paid.recurringObligationId).toBe(phone.id);
    expect(october.isSettled).toBe(false);
    expect(phone.amount).toBe(85);
  });

  it("edits one occurrence without changing the rule", () => {
    const phone = rule({ startMonth: "2026-10" });
    const result = materializeRecurringObligations([phone], [], "2026-09-24", ids());
    const october = result.expenses[0]!;
    const edited = replaceExpenseOccurrence(result.expenses, october.id, {
      amount: 92.43,
    });
    expect(edited?.[0]?.amount).toBe(92.43);
    expect(edited?.[0]?.recurrenceMonth).toBe("2026-10");
    expect(phone.amount).toBe(85);
  });

  it("applies a rule edit only to months generated afterward", () => {
    const phone = rule({ startMonth: "2026-09", dueDay: 15 });
    const first = materializeRecurringObligations(
      [phone],
      [],
      "2026-09-24",
      ids()
    );
    const updated = replaceRecurringObligation(first.expenses.length ? [phone] : [], phone.id, {
      amount: 90,
      dueDay: 20,
    })!;
    expect(first.expenses.every((row) => row.amount === 85)).toBe(true);
    const later = materializeRecurringObligations(
      updated,
      first.expenses,
      "2026-10-01",
      ids()
    );
    expect(later.created.map((row) => row.recurrenceMonth)).toEqual(["2026-11"]);
    expect(later.created[0]?.amount).toBe(90);
    expect(later.created[0]?.dueDate).toBe("2026-11-20");
    expect(
      later.expenses.find((row) => row.recurrenceMonth === "2026-10")?.amount
    ).toBe(85);
  });

  it("stops new months and keeps a paid occurrence", () => {
    const phone = rule({ startMonth: "2026-09", dueDay: 15 });
    const first = materializeRecurringObligations([phone], [], "2026-09-24", ids());
    const september = first.expenses.find((row) => row.recurrenceMonth === "2026-09")!;
    const paid = first.expenses.map((row) =>
      row.id === september.id ? markExpensePaid(row, "2026-09-20") : row
    );
    const stopped = replaceRecurringObligation([phone], phone.id, {
      isActive: false,
    })!;
    const later = materializeRecurringObligations(
      stopped,
      paid,
      "2026-10-01",
      ids()
    );
    expect(later.created).toEqual([]);
    expect(later.expenses.find((row) => row.recurrenceMonth === "2026-09")?.isSettled).toBe(
      true
    );
  });

  it("does not recreate a deleted month", () => {
    const phone = rule({ startMonth: "2026-09", dueDay: 15 });
    const first = materializeRecurringObligations([phone], [], "2026-09-24", ids());
    const october = first.expenses.find((row) => row.recurrenceMonth === "2026-10")!;
    const removed = deleteExpenseOccurrence([phone], first.expenses, october.id)!;
    expect(removed.rules[0]?.isActive).toBe(true);
    expect(removed.rules[0]?.skippedMonths).toEqual(["2026-10"]);
    const again = materializeRecurringObligations(
      removed.rules,
      removed.expenses,
      "2026-09-24",
      ids()
    );
    expect(again.created).toEqual([]);
    expect(again.expenses.some((row) => row.recurrenceMonth === "2026-10")).toBe(
      false
    );
    const nextMonth = materializeRecurringObligations(
      removed.rules,
      removed.expenses,
      "2026-10-01",
      ids()
    );
    expect(nextMonth.created.map((row) => row.recurrenceMonth)).toEqual(["2026-11"]);
  });

  it("adds the next horizon month once when the local month advances", () => {
    const phone = rule({ startMonth: "2026-09", dueDay: 15 });
    const september = materializeRecurringObligations(
      [phone],
      [],
      "2026-09-24",
      ids()
    );
    const october = materializeRecurringObligations(
      [phone],
      september.expenses,
      "2026-10-01",
      ids()
    );
    expect(october.created.map((row) => row.recurrenceMonth)).toEqual(["2026-11"]);
    const repeated = materializeRecurringObligations(
      [phone],
      october.expenses,
      "2026-10-01",
      ids()
    );
    expect(repeated.created).toEqual([]);
  });

  it("does not pay bills, change accounts, protected money, or allocations", () => {
    const state = {
      ...EMPTY_STATE,
      accounts: [account()],
      openingWealthBuilding: 500,
      openingEmergencyFund: 400,
      incomes: [],
      allocations: [],
    };
    const phone = rule({ startMonth: "2026-09", dueDay: 15 });
    const result = materializeRecurringObligations(
      [phone],
      state.expenses,
      "2026-09-24",
      ids()
    );
    expect(result.created.every((row) => !row.isSettled)).toBe(true);
    expect(sumAccountBalances(state.accounts)).toBe(2000);
    expect(state.openingWealthBuilding).toBe(500);
    expect(state.openingEmergencyFund).toBe(400);
    expect(state.incomes).toEqual([]);
    expect(state.allocations).toEqual([]);
    const closed = { ...state, lastClosedMonthKey: "2026-09", expenses: result.expenses };
    expect(closed.expenses.every((row) => row.isSettled === false)).toBe(true);
    expect(closed.openingWealthBuilding).toBe(500);
  });

  it("lists the next unpaid bills, recurring and not", () => {
    const rows: ExpenseEntry[] = [
      {
        id: "paid",
        name: "Old",
        category: "need",
        amount: 10,
        date: "2026-09-01",
        dueDate: "2026-09-01",
        isSettled: true,
      },
      {
        id: "phone",
        name: "Phone",
        category: "need",
        amount: 90,
        date: "2026-10-03",
        dueDate: "2026-10-03",
        isSettled: false,
        recurringObligationId: "phone-rule",
        recurrenceMonth: "2026-10",
      },
      {
        id: "rent",
        name: "Rent",
        category: "need",
        amount: 700,
        date: "2026-10-01",
        dueDate: "2026-10-01",
        isSettled: false,
      },
      {
        id: "net",
        name: "Internet",
        category: "desire",
        amount: 85,
        date: "2026-09-27",
        dueDate: "2026-09-27",
        isSettled: false,
      },
    ];
    expect(comingUpObligations(rows, 5).map((row) => row.name)).toEqual([
      "Internet",
      "Rent",
      "Phone",
    ]);
  });

  it("round-trips version 5 and keeps older backups free of rules", () => {
    const phone = rule({
      startMonth: "2026-09",
      dueDay: 15,
      skippedMonths: ["2026-08"],
    });
    const materialized = materializeRecurringObligations(
      [phone],
      [],
      "2026-09-24",
      ids()
    );
    const state = {
      ...EMPTY_STATE,
      accounts: [account()],
      openingWealthBuilding: 100,
      openingEmergencyFund: 50,
      recurringObligations: phone.skippedMonths
        ? [{ ...phone, skippedMonths: ["2026-10"] }]
        : [phone],
      expenses: materialized.expenses.filter(
        (row) => row.recurrenceMonth !== "2026-10"
      ),
    };
    const removed = deleteExpenseOccurrence(
      [phone],
      materialized.expenses,
      materialized.expenses.find((row) => row.recurrenceMonth === "2026-10")!.id
    )!;
    const backup = buildLedgerBackup({
      ...state,
      recurringObligations: removed.rules,
      expenses: removed.expenses,
    });
    expect(backup.version).toBe(5);
    const restored = validateLedgerBackup(backup);
    expect(restored?.recurringObligations?.[0]?.skippedMonths).toEqual([
      "2026-08",
      "2026-10",
    ]);
    expect(restored?.openingWealthBuilding).toBe(100);
    expect(restored?.expenses[0]?.isSettled).toBe(false);
    const again = materializeRecurringObligations(
      restored!.recurringObligations ?? [],
      restored!.expenses,
      "2026-09-24",
      ids()
    );
    expect(again.created).toEqual([]);
    expect(again.expenses.some((row) => row.recurrenceMonth === "2026-10")).toBe(
      false
    );

    const version4 = validateLedgerBackup({
      version: 4,
      exportedAt: "2026-09-24T00:00:00.000Z",
      incomes: [],
      expenses: [
        {
          id: "bill",
          name: "Bill",
          category: "need",
          amount: 80,
          date: "2026-09-20",
          dueDate: "2026-09-20",
          isSettled: false,
        },
      ],
      debts: [],
      displayName: "",
      accounts: [],
      openingWealthBuilding: 40,
      openingEmergencyFund: 10,
      recurringObligations: [phone],
    });
    expect(version4?.recurringObligations).toEqual([]);
    expect(version4?.openingWealthBuilding).toBe(40);
    expect(version4?.openingEmergencyFund).toBe(10);
    expect(version4?.expenses[0]?.isSettled).toBe(false);

    expect(
      validateLedgerBackup({
        version: 5,
        exportedAt: "2026-09-24T00:00:00.000Z",
        incomes: [],
        expenses: [],
        debts: [],
        displayName: "",
        accounts: [],
        openingWealthBuilding: 0,
        openingEmergencyFund: 0,
      })
    ).toBeNull();
  });
});
