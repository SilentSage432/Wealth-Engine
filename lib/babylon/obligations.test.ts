import { describe, expect, it } from "vitest";
import { EMPTY_STATE } from "@/lib/babylon/constants";
import {
  actualSpendTotals,
  buildBudgetVariances,
  isOverdue,
  livingBudgetRemaining,
  markExpensePaid,
  upcomingNeedsTotal,
} from "@/lib/babylon/engine";
import {
  buildLedgerBackup,
  EXPENSE_SEMANTICS_VERSION,
  normalizePersistedState,
  validateLedgerBackup,
} from "@/lib/babylon/persistence";
import type { BudgetTarget, ExpenseEntry, PersistedState } from "@/types/babylon";

const rentCap: BudgetTarget = {
  id: "rent",
  categoryName: "Rent",
  plannedAmount: 700,
  isEssential: true,
};

function expense(partial: Partial<ExpenseEntry> & Pick<ExpenseEntry, "id" | "amount">): ExpenseEntry {
  return {
    name: partial.name ?? "Rent",
    category: partial.category ?? "need",
    date: partial.date ?? "2026-09-15",
    dueDate: partial.dueDate ?? "2026-09-30",
    budgetCategoryId: partial.budgetCategoryId ?? "rent",
    isSettled: partial.isSettled ?? false,
    ...partial,
  };
}

describe("paid vs upcoming spending", () => {
  const pool = 875;

  it("counts a settled current-month expense as spending", () => {
    const paid = expense({ id: "paid", amount: 100, isSettled: true, date: "2026-09-10" });
    const actual = actualSpendTotals([paid], "2026-09");
    expect(actual.need).toBe(100);
    expect(actual.total).toBe(100);
    expect(livingBudgetRemaining(pool, actual.total)).toBe(775);
    const [row] = buildBudgetVariances([rentCap], [paid]);
    expect(row.actualAmount).toBe(100);
    expect(row.remainingAmount).toBe(600);
  });

  it("does not treat an unsettled expense as spending", () => {
    const upcoming = expense({ id: "upcoming", amount: 700, isSettled: false });
    const actual = actualSpendTotals([upcoming], "2026-09");
    expect(actual.total).toBe(0);
    expect(actual.need).toBe(0);
    expect(livingBudgetRemaining(pool, actual.total)).toBe(pool);
    const [row] = buildBudgetVariances([rentCap], [upcoming]);
    expect(row.actualAmount).toBe(0);
    expect(row.remainingAmount).toBe(700);
  });

  it("sums every unsettled Need and excludes unsettled Wants", () => {
    const rows = [
      expense({ id: "rent", amount: 700, dueDate: "2026-09-01" }),
      expense({ id: "phone", name: "Phone", amount: 80, dueDate: "2026-11-04" }),
      expense({
        id: "dinner",
        name: "Dinner",
        amount: 40,
        category: "desire",
        isSettled: false,
      }),
      expense({ id: "groceries", name: "Groceries", amount: 50, isSettled: true }),
    ];
    expect(upcomingNeedsTotal(rows)).toBe(780);
  });

  it("marks the same row paid once and dates spending on the payment day", () => {
    const upcoming = expense({
      id: "rent",
      amount: 700,
      date: "2026-09-01",
      dueDate: "2026-09-01",
    });
    const paid = markExpensePaid(upcoming, "2026-10-02");
    expect(paid.id).toBe(upcoming.id);
    expect(paid.isSettled).toBe(true);
    expect(paid.date).toBe("2026-10-02");
    expect(paid.dueDate).toBe("2026-09-01");
    expect(actualSpendTotals([paid], "2026-09").total).toBe(0);
    expect(actualSpendTotals([paid], "2026-10").total).toBe(700);
    expect(actualSpendTotals([paid, paid], "2026-10").total).toBe(1400);
    expect(upcomingNeedsTotal([paid])).toBe(0);
  });

  it("keeps an unpaid prior-month obligation upcoming without spending it later", () => {
    const rent = expense({
      id: "rent",
      amount: 700,
      date: "2026-09-30",
      dueDate: "2026-09-30",
      isSettled: false,
    });
    expect(upcomingNeedsTotal([rent])).toBe(700);
    expect(actualSpendTotals([rent], "2026-09").total).toBe(0);
    expect(actualSpendTotals([rent], "2026-10").total).toBe(0);
    expect(isOverdue(rent.dueDate, "2026-10-01")).toBe(true);
  });
});

describe("legacy unsettled migration", () => {
  const legacyUnsettled = {
    id: "old",
    name: "Groceries",
    category: "need",
    amount: 40,
    date: "2026-09-02",
    dueDate: "2026-09-02",
    isSettled: false,
  };

  it("settles legacy unsettled expenses once", () => {
    const migrated = normalizePersistedState({
      incomes: [{ id: "keep", source: "Job", amount: 1000, date: "2026-09-01", interval: "monthly", kind: "primary", wealthShare: 100, debtShare: 200, expenditureShare: 700, debtRedirected: false }],
      expenses: [legacyUnsettled],
    });
    expect(migrated.expenseSemanticsVersion).toBe(EXPENSE_SEMANTICS_VERSION);
    expect(migrated.expenses[0]?.isSettled).toBe(true);
    expect(migrated.expenses[0]?.amount).toBe(40);
    expect(migrated.incomes).toHaveLength(1);
  });

  it("does not convert new upcoming expenses on a later load", () => {
    const migrated = normalizePersistedState({ expenses: [legacyUnsettled] });
    const reloaded = normalizePersistedState({
      ...migrated,
      expenses: [
        ...migrated.expenses,
        { ...legacyUnsettled, id: "new-bill", isSettled: false, name: "Rent" },
      ],
    });
    expect(reloaded.expenses.find((row) => row.id === "old")?.isSettled).toBe(true);
    expect(reloaded.expenses.find((row) => row.id === "new-bill")?.isSettled).toBe(false);
    const again = normalizePersistedState(reloaded);
    expect(again.expenses.find((row) => row.id === "new-bill")?.isSettled).toBe(false);
  });
});

describe("upcoming backup semantics", () => {
  const upcoming = expense({ id: "bill", amount: 80, isSettled: false });

  function stateWith(row: ExpenseEntry): PersistedState {
    return { ...EMPTY_STATE, expenses: [row] };
  }

  it("keeps upcoming rows unpaid on the current backup", () => {
    const backup = buildLedgerBackup(stateWith(upcoming));
    expect(backup.version).toBe(4);
    const restored = validateLedgerBackup(backup);
    expect(restored?.expenses[0]?.isSettled).toBe(false);
  });

  it("imports a version 3 upcoming expense as unpaid", () => {
    const restored = validateLedgerBackup({
      version: 3,
      exportedAt: "2026-09-24T00:00:00.000Z",
      incomes: [],
      expenses: [upcoming],
      debts: [],
      displayName: "",
      accounts: [],
    });
    expect(restored?.expenses[0]?.isSettled).toBe(false);
    expect(restored?.openingWealthBuilding).toBe(0);
    expect(restored?.openingEmergencyFund).toBe(0);
  });

  it("imports a version 2 unsettled expense as paid", () => {
    const restored = validateLedgerBackup({
      version: 2,
      exportedAt: "2026-09-24T00:00:00.000Z",
      incomes: [],
      expenses: [upcoming],
      debts: [],
      displayName: "",
      accounts: [],
    });
    expect(restored?.expenses[0]?.isSettled).toBe(true);
  });
});

describe("expense isolation from allocation and accounts", () => {
  it("paying an expense does not replace income, allocations, or accounts", () => {
    const before: PersistedState = {
      ...EMPTY_STATE,
      incomes: [
        {
          id: "income-1",
          source: "Job",
          amount: 1000,
          date: "2026-09-01",
          interval: "monthly",
          kind: "primary",
          wealthShare: 100,
          debtShare: 200,
          expenditureShare: 700,
          debtRedirected: false,
        },
      ],
      allocations: [
        {
          id: "alloc-1",
          incomeId: "income-1",
          date: "2026-09-01",
          monthKey: "2026-09",
          gross: 1000,
          wealth: 100,
          debt: 200,
          expenditure: 700,
        },
      ],
      accounts: [
        {
          id: "checking",
          name: "Checking",
          kind: "checking",
          balance: 1250,
          asOf: "2026-09-24",
        },
      ],
    };
    const paid = markExpensePaid(
      expense({ id: "rent", amount: 100, isSettled: false }),
      "2026-09-24"
    );
    const after: PersistedState = { ...before, expenses: [paid] };
    expect(after.incomes).toBe(before.incomes);
    expect(after.allocations).toBe(before.allocations);
    expect(after.accounts).toBe(before.accounts);
    expect(after.accounts[0]?.balance).toBe(1250);
    expect(after.expenses).toHaveLength(1);
  });
});
