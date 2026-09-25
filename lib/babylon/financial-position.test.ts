import { describe, expect, it } from "vitest";
import { EMPTY_STATE } from "@/lib/babylon/constants";
import { allocateIncome } from "@/lib/babylon/engine";
import {
  assignAccounts,
  formatAsOfLabel,
  normalizeAccountDraft,
  prependAccount,
  replaceAccount,
  sumAccountBalances,
  withoutAccount,
} from "@/lib/babylon/financial-position";
import {
  buildLedgerBackup,
  LEDGER_BACKUP_VERSION,
  normalizePersistedState,
  validateLedgerBackup,
} from "@/lib/babylon/persistence";
import type {
  AllocationEvent,
  FinancialAccount,
  IncomeEntry,
  PersistedState,
} from "@/types/babylon";

function account(
  partial: Partial<FinancialAccount> & Pick<FinancialAccount, "id" | "balance">
): FinancialAccount {
  return {
    name: partial.name ?? "Checking",
    kind: partial.kind ?? "checking",
    asOf: partial.asOf ?? "2026-09-24",
    ...partial,
  };
}

function incomeRow(): IncomeEntry {
  return {
    id: "income-1",
    source: "Lowe's",
    amount: 1250,
    date: "2026-09-24",
    interval: "one-time",
    kind: "primary",
    wealthShare: 125,
    debtShare: 250,
    expenditureShare: 875,
    debtRedirected: false,
  };
}

function allocationRow(): AllocationEvent {
  return {
    id: "alloc-1",
    incomeId: "income-1",
    date: "2026-09-24",
    monthKey: "2026-09",
    gross: 1250,
    wealth: 125,
    debt: 250,
    expenditure: 875,
  };
}

function occupiedState(): PersistedState {
  return {
    ...EMPTY_STATE,
    incomes: [incomeRow()],
    allocations: [allocationRow()],
    expenses: [
      {
        id: "expense-1",
        name: "Rent",
        category: "need",
        amount: 700,
        date: "2026-09-01",
        dueDate: "2026-09-01",
        isSettled: false,
      },
    ],
    debts: [
      {
        id: "debt-1",
        creditor: "Card",
        totalDebt: 400,
        remainingDebt: 150,
        monthlyAllocation: 40,
        createdAt: "2026-09-01",
        interestRate: 12,
      },
    ],
    budgetTargets: [
      {
        id: "budget-1",
        categoryName: "Groceries",
        plannedAmount: 250,
        isEssential: true,
      },
    ],
    emergencyShield: 40,
    periodArchives: [
      {
        id: "archive-1",
        monthKey: "2026-08",
        closedAt: "2026-09-01T00:00:00.000Z",
        totalIncome: 1000,
        totalSpent: 700,
        wealthAllocated: 100,
        debtAllocated: 200,
        expenditurePool: 700,
        expenditureRemaining: 0,
        surplusDisposition: "rollover",
        surplusAmount: 0,
      },
    ],
    lastClosedMonthKey: "2026-08",
  };
}

function expectLedgerUntouched(before: PersistedState, after: PersistedState) {
  expect(after.incomes).toBe(before.incomes);
  expect(after.allocations).toBe(before.allocations);
  expect(after.expenses).toBe(before.expenses);
  expect(after.debts).toBe(before.debts);
  expect(after.budgetTargets).toBe(before.budgetTargets);
  expect(after.emergencyShield).toBe(before.emergencyShield);
  expect(after.periodArchives).toBe(before.periodArchives);
  expect(after.lastClosedMonthKey).toBe(before.lastClosedMonthKey);
  expect(after.activityLog).toBe(before.activityLog);
}

describe("financial position persistence", () => {
  it("loads a vault with no accounts as an empty account list", () => {
    const raw = {
      incomes: [incomeRow()],
      expenses: [],
      debts: [],
      allocations: [allocationRow()],
      emergencyShield: 15,
    };
    const state = normalizePersistedState(raw);
    expect(state.accounts).toEqual([]);
    expect(state.incomes).toHaveLength(1);
    expect(state.incomes[0]?.amount).toBe(1250);
    expect(state.emergencyShield).toBe(15);
  });

  it("does not infer an account from income, living budget, or expenses", () => {
    const state = normalizePersistedState({
      incomes: [incomeRow()],
      allocations: [allocationRow()],
      expenses: occupiedState().expenses,
      emergencyShield: 80,
    });
    expect(state.accounts).toEqual([]);
    expect(sumAccountBalances(state.accounts)).toBe(0);
  });

  it("keeps the as-of date as the local calendar string", () => {
    const state = normalizePersistedState({
      accounts: [
        {
          id: "acct-1",
          name: "  Checking  ",
          kind: "checking",
          balance: 1250.1,
          asOf: "2026-09-24",
        },
      ],
    });
    expect(state.accounts[0]).toEqual({
      id: "acct-1",
      name: "Checking",
      kind: "checking",
      balance: 1250.1,
      asOf: "2026-09-24",
    });
  });
});

describe("account list isolation", () => {
  const checking = account({ id: "checking", name: "Checking", balance: 1250 });

  it("adding an account does not create income, allocations, debt, or expenses", () => {
    const before = occupiedState();
    const after = assignAccounts(before, prependAccount(before.accounts, checking));
    expectLedgerUntouched(before, after);
    expect(after.accounts).toEqual([checking]);
    expect(after.incomes).toHaveLength(1);
    expect(allocateIncome(checking.balance, true).expenditureShare).not.toBe(
      checking.balance
    );
  });

  it("editing a balance does not create ledger activity", () => {
    const before = assignAccounts(occupiedState(), [checking]);
    const edited = normalizeAccountDraft(
      { name: "Checking", kind: "checking", balance: 1100, asOf: "2026-09-24" },
      checking.id
    );
    expect(edited?.balance).toBe(1100);
    const nextList = replaceAccount(before.accounts, checking.id, edited!);
    const after = assignAccounts(before, nextList!);
    expectLedgerUntouched(before, after);
    expect(after.accounts[0]?.balance).toBe(1100);
    expect(after.incomes[0]?.amount).toBe(1250);
    expect(after.allocations[0]?.gross).toBe(1250);
  });

  it("removing an account leaves income and allocation history in place", () => {
    const before = assignAccounts(occupiedState(), [
      checking,
      account({ id: "savings", name: "Savings", kind: "savings", balance: 600 }),
    ]);
    const after = assignAccounts(before, withoutAccount(before.accounts, "checking"));
    expectLedgerUntouched(before, after);
    expect(after.accounts.map((row) => row.id)).toEqual(["savings"]);
    expect(after.incomes).toHaveLength(1);
    expect(after.allocations).toHaveLength(1);
  });
});

describe("Money Available", () => {
  it("sums account balances with money rounding", () => {
    const total = sumAccountBalances([
      account({ id: "checking", balance: 1250 }),
      account({ id: "savings", name: "Savings", kind: "savings", balance: 600 }),
      account({ id: "cash", name: "Cash", kind: "cash", balance: 50 }),
    ]);
    expect(total).toBe(1900);
    expect(sumAccountBalances([
      account({ id: "a", balance: 0.1 }),
      account({ id: "b", balance: 0.2 }),
    ])).toBe(0.3);
  });
});

describe("as-of local date", () => {
  it("formats the calendar date without shifting to the previous UTC day", () => {
    expect(formatAsOfLabel("2026-09-24", "2026-09-24")).toBe("Sep 24");
    const parsedAsUtc = new Date("2026-09-24T00:00:00.000Z");
    expect(parsedAsUtc.getDate()).toBe(23);
    expect(formatAsOfLabel("2025-12-31", "2026-09-24")).toBe("Dec 31, 2025");
  });

  it("rejects an as-of value that is not a calendar date", () => {
    expect(
      normalizeAccountDraft(
        {
          name: "Checking",
          kind: "checking",
          balance: 10,
          asOf: "09/24/2026",
        },
        "acct"
      )
    ).toBeNull();
  });
});

describe("ledger backup accounts", () => {
  it("exports the current backup and restores accounts", () => {
    const state = assignAccounts(occupiedState(), [
      account({ id: "checking", balance: 1250, asOf: "2026-09-24" }),
    ]);
    const backup = buildLedgerBackup(state);
    expect(backup.version).toBe(LEDGER_BACKUP_VERSION);
    expect(backup.version).toBe(3);
    const restored = validateLedgerBackup(backup);
    expect(restored?.accounts).toEqual(state.accounts);
    expect(restored?.incomes).toEqual(state.incomes);
  });

  it("imports a version 1 backup with an empty account list", () => {
    const restored = validateLedgerBackup({
      version: 1,
      exportedAt: "2026-09-01T00:00:00.000Z",
      incomes: [incomeRow()],
      expenses: [],
      debts: [],
      displayName: "A",
      accounts: [account({ id: "ignored", balance: 9999 })],
    });
    expect(restored?.version).toBe(1);
    expect(restored?.accounts).toEqual([]);
    expect(restored?.incomes).toHaveLength(1);
  });

  it("rejects a version 2 backup that omits or corrupts accounts", () => {
    const base = {
      version: 2,
      exportedAt: "2026-09-24T00:00:00.000Z",
      incomes: [],
      expenses: [],
      debts: [],
      displayName: "",
    };
    expect(validateLedgerBackup(base)).toBeNull();
    expect(
      validateLedgerBackup({
        ...base,
        accounts: [{ id: "bad", name: "Checking", kind: "brokerage", balance: 1, asOf: "2026-09-24" }],
      })
    ).toBeNull();
  });
});
