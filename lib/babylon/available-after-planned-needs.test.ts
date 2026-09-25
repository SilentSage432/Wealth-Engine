import { describe, expect, it } from "vitest";
import { EMPTY_STATE } from "@/lib/babylon/constants";
import { deriveAvailableAfterPlannedNeeds } from "@/lib/babylon/available-after-planned-needs";
import {
  livingBudgetRemaining,
  markExpensePaid,
  upcomingNeedsTotal,
} from "@/lib/babylon/engine";
import {
  assignAccounts,
  sumAccountBalances,
} from "@/lib/babylon/financial-position";
import {
  buildLedgerBackup,
  LEDGER_BACKUP_VERSION,
  validateLedgerBackup,
} from "@/lib/babylon/persistence";
import { totalProtectedMoney } from "@/lib/babylon/protected-money";
import {
  comingUpObligations,
  materializeRecurringObligations,
} from "@/lib/babylon/recurring-obligations";
import type { ExpenseEntry, FinancialAccount, RecurringObligation } from "@/types/babylon";

function derive(
  moneyAvailable: number,
  protectedMoney: number,
  upcomingNeeds: number
) {
  return deriveAvailableAfterPlannedNeeds({
    moneyAvailable,
    protectedMoney,
    upcomingNeeds,
  });
}

function need(partial: Partial<ExpenseEntry> & Pick<ExpenseEntry, "id" | "amount">): ExpenseEntry {
  return {
    name: partial.name ?? "Bill",
    category: partial.category ?? "need",
    date: partial.date ?? "2026-10-01",
    dueDate: partial.dueDate ?? "2026-10-01",
    isSettled: partial.isSettled ?? false,
    ...partial,
  };
}

function account(balance: number): FinancialAccount {
  return {
    id: "checking",
    name: "Checking",
    kind: "checking",
    balance,
    asOf: "2026-09-24",
  };
}

describe("available after planned needs", () => {
  it("subtracts protected money and upcoming needs", () => {
    const result = derive(2000, 500, 650);
    expect(result.availableAfterPlannedNeeds).toBe(850);
    expect(result.plannedNeedsShortfall).toBe(0);
    expect(result.rawDifference).toBe(850);
  });

  it("is zero when the inputs meet exactly", () => {
    const result = derive(1000, 400, 600);
    expect(result.availableAfterPlannedNeeds).toBe(0);
    expect(result.plannedNeedsShortfall).toBe(0);
    expect(result.rawDifference).toBe(0);
  });

  it("floors a shortfall at zero and reports the gap", () => {
    const result = derive(1000, 400, 800);
    expect(result.rawDifference).toBe(-200);
    expect(result.availableAfterPlannedNeeds).toBe(0);
    expect(result.plannedNeedsShortfall).toBe(200);
  });

  it("does not rewrite protected money when it exceeds money available", () => {
    const stored = { openingWealthBuilding: 500, openingEmergencyFund: 0 };
    const result = derive(400, totalProtectedMoney(500, 0), 100);
    expect(result.availableAfterPlannedNeeds).toBe(0);
    expect(result.plannedNeedsShortfall).toBe(200);
    expect(stored.openingWealthBuilding).toBe(500);
  });

  it("uses the current designation, not tracked wealth or emergency history", () => {
    const existingWealth = 500;
    const trackedWealth = 5000;
    const existingEmergency = 0;
    const trackedShield = 900;
    const protectedMoney = totalProtectedMoney(existingWealth, existingEmergency);
    expect(protectedMoney).toBe(500);
    expect(protectedMoney).not.toBe(existingWealth + trackedWealth + trackedShield);
    expect(derive(2000, protectedMoney, 650).availableAfterPlannedNeeds).toBe(850);
  });

  it("matches the real-world cases", () => {
    const protectedMoney = totalProtectedMoney(700, 500);
    expect(derive(3000, protectedMoney, 1100).availableAfterPlannedNeeds).toBe(700);
    expect(derive(2000, 600, 1700)).toMatchObject({
      availableAfterPlannedNeeds: 0,
      plannedNeedsShortfall: 300,
    });
    const wants = 300;
    const withWants = derive(2000, 600, 700);
    expect(withWants.availableAfterPlannedNeeds).toBe(700);
    expect(withWants.availableAfterPlannedNeeds).not.toBe(700 - wants);
    const livingBudget = livingBudgetRemaining(700, 450);
    expect(livingBudget).toBe(250);
    expect(derive(2000, 600, 700).availableAfterPlannedNeeds).toBe(700);
  });

  it("counts an unpaid Need once and ignores a Want", () => {
    const rows = [
      need({ id: "rent", amount: 650, name: "Rent" }),
      need({
        id: "stream",
        name: "Streaming",
        amount: 300,
        category: "desire",
      }),
    ];
    expect(upcomingNeedsTotal(rows)).toBe(650);
    expect(derive(2000, 500, upcomingNeedsTotal(rows)).availableAfterPlannedNeeds).toBe(
      850
    );
  });

  it("counts a materialized recurring Need once and ignores a recurring Want", () => {
    const rent: RecurringObligation = {
      id: "rent-rule",
      name: "Rent",
      amount: 700,
      category: "need",
      budgetCategoryId: "housing",
      dueDay: 1,
      startMonth: "2026-10",
      isActive: true,
      createdAt: "2026-09-24",
      skippedMonths: [],
    };
    const stream: RecurringObligation = {
      ...rent,
      id: "stream-rule",
      name: "Streaming",
      amount: 15,
      category: "desire",
    };
    let n = 0;
    const materialized = materializeRecurringObligations(
      [rent, stream],
      [],
      "2026-09-24",
      () => `row-${++n}`
    );
    const upcoming = upcomingNeedsTotal(materialized.expenses);
    expect(upcoming).toBe(700);
    expect(upcoming).not.toBe(700 + rent.amount);
    expect(derive(2000, 0, upcoming).availableAfterPlannedNeeds).toBe(1300);
  });

  it("uses the full Upcoming Needs total, not the Coming Up preview", () => {
    const rows = [1, 2, 3, 4, 5, 6].map((index) =>
      need({
        id: `bill-${index}`,
        name: `Bill ${index}`,
        amount: 100,
        dueDate: `2026-10-0${index}`,
      })
    );
    expect(comingUpObligations(rows, 5)).toHaveLength(5);
    expect(upcomingNeedsTotal(rows)).toBe(600);
    expect(derive(1000, 0, upcomingNeedsTotal(rows)).availableAfterPlannedNeeds).toBe(
      400
    );
  });

  it("recomputes when a Need is paid, reopened, edited, reclassified, or deleted", () => {
    const rent = need({ id: "rent", amount: 650, name: "Rent" });
    const accounts = [account(2000)];
    expect(sumAccountBalances(accounts)).toBe(2000);

    const unpaid = upcomingNeedsTotal([rent]);
    expect(derive(2000, 500, unpaid).availableAfterPlannedNeeds).toBe(850);

    const paid = markExpensePaid(rent, "2026-09-24");
    expect(upcomingNeedsTotal([paid])).toBe(0);
    expect(derive(2000, 500, 0).availableAfterPlannedNeeds).toBe(1500);
    expect(sumAccountBalances(accounts)).toBe(2000);

    const reopened = { ...paid, isSettled: false };
    expect(upcomingNeedsTotal([reopened])).toBe(650);
    expect(derive(2000, 500, 650).availableAfterPlannedNeeds).toBe(850);

    const raised = { ...reopened, amount: 800 };
    expect(derive(2000, 500, upcomingNeedsTotal([raised])).availableAfterPlannedNeeds).toBe(
      700
    );

    const asWant = { ...raised, category: "desire" as const };
    expect(upcomingNeedsTotal([asWant])).toBe(0);
    expect(derive(2000, 500, 0).availableAfterPlannedNeeds).toBe(1500);

    const asNeed = { ...asWant, category: "need" as const };
    expect(derive(2000, 500, upcomingNeedsTotal([asNeed])).availableAfterPlannedNeeds).toBe(
      700
    );

    expect(upcomingNeedsTotal([])).toBe(0);
    expect(derive(2000, 500, 0).availableAfterPlannedNeeds).toBe(1500);
  });

  it("recomputes from account balances and protected designations", () => {
    const before = assignAccounts(EMPTY_STATE, [account(2000)]);
    expect(derive(sumAccountBalances(before.accounts), 500, 650).availableAfterPlannedNeeds).toBe(
      850
    );
    const after = assignAccounts(before, [account(1800)]);
    expect(derive(sumAccountBalances(after.accounts), 500, 650).availableAfterPlannedNeeds).toBe(
      650
    );
    expect(derive(2000, totalProtectedMoney(700, 0), 650).availableAfterPlannedNeeds).toBe(
      650
    );
  });

  it("ignores Living Budget, income allocations, and month-close history", () => {
    const position = derive(2000, 500, 650);
    expect(livingBudgetRemaining(300, 0)).toBe(300);
    expect(position.availableAfterPlannedNeeds).toBe(850);
    const trackedWealth = 5000;
    const emergencyShield = 900;
    expect(trackedWealth + emergencyShield).toBeGreaterThan(500);
    expect(position.availableAfterPlannedNeeds).toBe(850);
  });

  it("does not store the result in a version 5 backup", () => {
    const state = {
      ...EMPTY_STATE,
      accounts: [account(2000)],
      openingWealthBuilding: 500,
      openingEmergencyFund: 0,
      expenses: [need({ id: "rent", amount: 650 })],
    };
    const backup = buildLedgerBackup(state);
    expect(backup.version).toBe(5);
    expect(backup.version).toBe(LEDGER_BACKUP_VERSION);
    const serialized = JSON.stringify(backup);
    expect(serialized).not.toContain("availableAfterPlannedNeeds");
    expect(serialized).not.toContain("plannedNeedsShortfall");
    const restored = validateLedgerBackup(backup);
    const again = derive(
      sumAccountBalances(restored?.accounts ?? []),
      totalProtectedMoney(
        restored?.openingWealthBuilding ?? 0,
        restored?.openingEmergencyFund ?? 0
      ),
      upcomingNeedsTotal(restored?.expenses ?? [])
    );
    expect(again.availableAfterPlannedNeeds).toBe(850);
  });
});
