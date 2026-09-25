import { describe, expect, it } from "vitest";
import { EMPTY_STATE } from "@/lib/babylon/constants";
import {
  actualSpendTotals,
  allocateIncome,
  livingBudgetRemaining,
  markExpensePaid,
  roundMoney,
  upcomingNeedsTotal,
} from "@/lib/babylon/engine";
import {
  assignAccounts,
  sumAccountBalances,
} from "@/lib/babylon/financial-position";
import {
  buildLedgerBackup,
  normalizePersistedState,
  validateLedgerBackup,
} from "@/lib/babylon/persistence";
import {
  protectedDesignationError,
  protectedExceedsAvailable,
  totalEmergencyFund,
  totalProtectedMoney,
  totalWealthBuilding,
} from "@/lib/babylon/protected-money";
import type {
  AllocationEvent,
  FinancialAccount,
  PersistedState,
} from "@/types/babylon";

function account(balance: number, id = "checking"): FinancialAccount {
  return {
    id,
    name: "Checking",
    kind: "checking",
    balance,
    asOf: "2026-09-24",
  };
}

function allocation(wealth: number): AllocationEvent {
  return {
    id: "alloc-1",
    incomeId: "income-1",
    date: "2026-09-01",
    monthKey: "2026-09",
    gross: wealth * 10,
    wealth,
    debt: wealth * 2,
    expenditure: wealth * 7,
  };
}

function withBalances(
  state: PersistedState,
  balances: number[]
): PersistedState {
  return assignAccounts(
    state,
    balances.map((balance, index) => account(balance, `acct-${index}`))
  );
}

/**
 * Same decision as `updateProtectedDesignations`: reject, or replace only the
 * two designation fields. Does not allocate, and does not change accounts.
 */
function commitDesignations(
  state: PersistedState,
  wealth: number,
  emergency: number
): PersistedState | string {
  const error = protectedDesignationError(
    wealth,
    emergency,
    sumAccountBalances(state.accounts)
  );
  if (error) return error;
  return {
    ...state,
    openingWealthBuilding: roundMoney(wealth),
    openingEmergencyFund: roundMoney(emergency),
  };
}

describe("existing protected money", () => {
  it("loads a vault without designation fields as zero", () => {
    const state = normalizePersistedState({
      incomes: [],
      allocations: [allocation(5000)],
      emergencyShield: 800,
    });
    expect(state.openingWealthBuilding).toBe(0);
    expect(state.openingEmergencyFund).toBe(0);
    expect(state.emergencyShield).toBe(800);
    expect(state.allocations[0]?.wealth).toBe(5000);
  });

  it("does not change accounts, money available, or the rest of the ledger", () => {
    const before = withBalances(
      {
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
        allocations: [allocation(100)],
        expenses: [
          {
            id: "rent",
            name: "Rent",
            category: "need",
            amount: 200,
            date: "2026-09-01",
            dueDate: "2026-09-01",
            isSettled: true,
          },
        ],
        debts: [
          {
            id: "card",
            creditor: "Card",
            totalDebt: 400,
            remainingDebt: 150,
            monthlyAllocation: 40,
        createdAt: "2026-09-01",
        interestRate: 12,
      },
        ],
        emergencyShield: 25,
      },
      [2000, 1000]
    );
    const available = sumAccountBalances(before.accounts);
    const livingBefore = livingBudgetRemaining(
      700,
      actualSpendTotals(before.expenses).total
    );

    const after = commitDesignations(before, 700, 500);
    if (typeof after === "string") throw new Error(after);

    expect(sumAccountBalances(after.accounts)).toBe(available);
    expect(sumAccountBalances(after.accounts)).toBe(3000);
    expect(after.accounts).toBe(before.accounts);
    expect(after.incomes).toBe(before.incomes);
    expect(after.allocations).toBe(before.allocations);
    expect(after.expenses).toBe(before.expenses);
    expect(after.debts).toBe(before.debts);
    expect(after.emergencyShield).toBe(25);
    expect(after.activityLog).toBe(before.activityLog);
    expect(
      livingBudgetRemaining(700, actualSpendTotals(after.expenses).total)
    ).toBe(livingBefore);
    expect(upcomingNeedsTotal(after.expenses)).toBe(
      upcomingNeedsTotal(before.expenses)
    );
  });

  it("does not turn an existing designation into an allocation", () => {
    const before = withBalances(EMPTY_STATE, [3000]);
    const split = allocateIncome(700, true);
    const after = commitDesignations(before, 700, 500);
    if (typeof after === "string") throw new Error(after);

    expect(after.openingWealthBuilding).toBe(700);
    expect(after.openingEmergencyFund).toBe(500);
    expect(after.allocations).toEqual([]);
    expect(after.incomes).toEqual([]);
    expect(after.periodArchives).toEqual([]);
    expect(split.wealthShare).toBe(70);
    expect(after.openingWealthBuilding).not.toBe(split.wealthShare);
  });

  it("adds the two existing designations into Protected Money", () => {
    expect(totalProtectedMoney(700, 500)).toBe(1200);
  });

  it("rejects a new designation that exceeds Money Available", () => {
    const state = withBalances(
      { ...EMPTY_STATE, openingWealthBuilding: 100, openingEmergencyFund: 50 },
      [1000]
    );
    const error = commitDesignations(state, 700, 500);
    expect(error).toBe(
      "Protected designations exceed your current Money Available. Update your protected amounts or Financial Position."
    );
    expect(state.openingWealthBuilding).toBe(100);
    expect(state.openingEmergencyFund).toBe(50);
    expect(state.accounts[0]?.balance).toBe(1000);
  });

  it("keeps stored designations when accounts later fall below them", () => {
    const stored = withBalances(
      { ...EMPTY_STATE, openingWealthBuilding: 700, openingEmergencyFund: 300 },
      [2000]
    );
    const reduced = assignAccounts(stored, [account(800)]);
    expect(reduced.openingWealthBuilding).toBe(700);
    expect(reduced.openingEmergencyFund).toBe(300);
    expect(sumAccountBalances(reduced.accounts)).toBe(800);
    expect(protectedExceedsAvailable(700, 300, 800)).toBe(true);
    expect(protectedDesignationError(700, 300, 800)).toMatch(/exceed/i);
    expect(stored.openingWealthBuilding).toBe(700);
  });

  it("shows existing wealth plus tracked allocations without rewriting history", () => {
    const tracked = 100;
    expect(totalWealthBuilding(500, tracked)).toBe(600);
    expect(allocation(tracked).wealth).toBe(100);
  });

  it("shows existing emergency money plus tracked surplus without rewriting history", () => {
    const tracked = 100;
    expect(totalEmergencyFund(400, tracked)).toBe(500);
    expect(tracked).toBe(100);
  });

  it("does not treat historical allocations as current protected cash", () => {
    const trackedWealth = 5000;
    const openingWealth = 600;
    const available = 2000;
    expect(totalWealthBuilding(openingWealth, trackedWealth)).toBe(5600);
    expect(totalProtectedMoney(openingWealth, 0)).toBe(600);
    expect(protectedExceedsAvailable(openingWealth, 0, available)).toBe(false);
    expect(
      protectedExceedsAvailable(openingWealth + trackedWealth, 0, available)
    ).toBe(true);
  });

  it("leaves designations in place across month close, expenses, and income deletion", () => {
    const before: PersistedState = {
      ...withBalances(
        {
          ...EMPTY_STATE,
          openingWealthBuilding: 500,
          openingEmergencyFund: 400,
          emergencyShield: 0,
          incomes: [
            {
              id: "income-1",
              source: "Job",
              amount: 1000,
              date: "2026-09-01",
              interval: "one-time",
              kind: "primary",
              wealthShare: 100,
              debtShare: 200,
              expenditureShare: 700,
              debtRedirected: false,
            },
          ],
          allocations: [allocation(100)],
          expenses: [
            {
              id: "bill",
              name: "Bill",
              category: "need",
              amount: 40,
              date: "2026-09-20",
              dueDate: "2026-09-20",
              isSettled: false,
            },
          ],
        },
        [3000]
      ),
    };

    const closed = {
      ...before,
      emergencyShield: roundMoney(before.emergencyShield + 100),
      lastClosedMonthKey: "2026-09",
    };
    expect(closed.openingWealthBuilding).toBe(500);
    expect(closed.openingEmergencyFund).toBe(400);
    expect(totalEmergencyFund(closed.openingEmergencyFund, closed.emergencyShield)).toBe(
      500
    );

    const paid = {
      ...before,
      expenses: before.expenses.map((expense) =>
        markExpensePaid(expense, "2026-09-24")
      ),
    };
    expect(paid.openingWealthBuilding).toBe(500);
    expect(paid.openingEmergencyFund).toBe(400);
    expect(paid.expenses[0]?.isSettled).toBe(true);

    const deletedIncome = {
      ...before,
      incomes: before.incomes.filter((income) => income.id !== "income-1"),
      allocations: before.allocations.filter(
        (row) => row.incomeId !== "income-1"
      ),
    };
    expect(deletedIncome.openingWealthBuilding).toBe(500);
    expect(deletedIncome.openingEmergencyFund).toBe(400);
    expect(deletedIncome.incomes).toEqual([]);
    expect(deletedIncome.allocations).toEqual([]);
  });

  it("round-trips designations on a version 4 backup and zeros them on older backups", () => {
    const state = withBalances(
      {
        ...EMPTY_STATE,
        openingWealthBuilding: 700,
        openingEmergencyFund: 500,
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
      },
      [3000]
    );
    const backup = buildLedgerBackup(state);
    expect(backup.version).toBe(4);
    const restored = validateLedgerBackup(backup);
    expect(restored?.openingWealthBuilding).toBe(700);
    expect(restored?.openingEmergencyFund).toBe(500);
    expect(restored?.expenses[0]?.isSettled).toBe(false);
    expect(restored?.accounts).toEqual(state.accounts);

    const version3 = validateLedgerBackup({
      version: 3,
      exportedAt: "2026-09-24T00:00:00.000Z",
      incomes: [],
      expenses: state.expenses,
      debts: [],
      displayName: "",
      accounts: state.accounts,
      openingWealthBuilding: 700,
      openingEmergencyFund: 500,
    });
    expect(version3?.openingWealthBuilding).toBe(0);
    expect(version3?.openingEmergencyFund).toBe(0);
    expect(version3?.expenses[0]?.isSettled).toBe(false);

    expect(
      validateLedgerBackup({
        version: 4,
        exportedAt: "2026-09-24T00:00:00.000Z",
        incomes: [],
        expenses: [],
        debts: [],
        displayName: "",
        accounts: [],
      })
    ).toBeNull();
  });
});
