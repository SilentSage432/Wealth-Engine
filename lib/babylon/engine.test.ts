import { describe, expect, it } from "vitest";
import {
  allocateIncome,
  buildBudgetVariances,
  computeDesiresPoolRemaining,
  msUntilNextLocalMidnight,
  primaryHourlyRate,
  roundMoney,
  todayIso,
} from "@/lib/babylon/engine";
import type {
  BudgetTarget,
  ExpenseEntry,
  IncomeEntry,
} from "@/types/babylon";

function cents(value: number): number {
  return Math.round(value * 100);
}

function expectSharesSumToGross(
  gross: number,
  hasActiveDebt: boolean
): void {
  const split = allocateIncome(gross, hasActiveDebt);
  expect(
    cents(split.wealthShare) +
      cents(split.debtShare) +
      cents(split.expenditureShare)
  ).toBe(cents(gross));
}

function income(
  partial: Pick<IncomeEntry, "source" | "amount" | "date"> &
    Partial<IncomeEntry>
): IncomeEntry {
  return {
    id: partial.id ?? `${partial.source}-${partial.date}`,
    interval: "monthly",
    kind: "primary",
    wealthShare: 0,
    debtShare: 0,
    expenditureShare: 0,
    debtRedirected: false,
    ...partial,
  };
}

function expense(
  partial: Pick<ExpenseEntry, "amount" | "budgetCategoryId"> &
    Partial<ExpenseEntry>
): ExpenseEntry {
  return {
    id: partial.id ?? `expense-${partial.budgetCategoryId}-${partial.amount}`,
    name: partial.name ?? "Spend",
    category: partial.category ?? "need",
    date: partial.date ?? "2026-09-15",
    dueDate: partial.dueDate ?? "2026-09-15",
    isSettled: partial.isSettled ?? false,
    ...partial,
  };
}

describe("allocateIncome", () => {
  it("splits a clean amount 10/20/70 while debt is active", () => {
    expect(allocateIncome(1000, true)).toEqual({
      wealthShare: 100,
      debtShare: 200,
      expenditureShare: 700,
      debtRedirected: false,
    });
  });

  it("redirects the 20% into wealth when debt-free", () => {
    expect(allocateIncome(1000, false)).toEqual({
      wealthShare: 300,
      debtShare: 0,
      expenditureShare: 700,
      debtRedirected: true,
    });
  });

  it("keeps an awkward cent amount penny-exact with debt active", () => {
    const split = allocateIncome(1.15, true);
    expect(split.debtRedirected).toBe(false);
    expect(cents(split.wealthShare)).toBe(12);
    expect(cents(split.debtShare)).toBe(23);
    expect(cents(split.expenditureShare)).toBe(80);
    expectSharesSumToGross(1.15, true);
  });

  it("keeps the debt-free redirect penny-exact", () => {
    const split = allocateIncome(1.15, false);
    expect(split.debtRedirected).toBe(true);
    expect(split.debtShare).toBe(0);
    expect(cents(split.wealthShare)).toBe(35);
    expect(cents(split.expenditureShare)).toBe(80);
    expectSharesSumToGross(1.15, false);
  });

  it("puts a one-cent deposit entirely in the expenditure share", () => {
    const split = allocateIncome(0.01, true);
    expect(split).toEqual({
      wealthShare: 0,
      debtShare: 0,
      expenditureShare: 0.01,
      debtRedirected: false,
    });
    expectSharesSumToGross(0.01, true);
    expectSharesSumToGross(0.01, false);
  });

  it("sums to gross across representative amounts", () => {
    for (const gross of [0.05, 10, 10.03, 1847.33, 9999.99]) {
      expectSharesSumToGross(gross, true);
      expectSharesSumToGross(gross, false);
    }
  });
});

describe("buildBudgetVariances", () => {
  const rent: BudgetTarget = {
    id: "rent",
    categoryName: "Rent",
    plannedAmount: 100,
    isEssential: true,
  };

  it("reports remaining under the planned cap", () => {
    const [row] = buildBudgetVariances(
      [rent],
      [expense({ amount: 40, budgetCategoryId: "rent" })]
    );
    expect(row.plannedAmount).toBe(100);
    expect(row.actualAmount).toBe(40);
    expect(row.remainingAmount).toBe(60);
    expect(row.variance).toBe(60);
  });

  it("keeps a negative variance when spending passes the cap and floors remaining at zero", () => {
    const [row] = buildBudgetVariances(
      [rent],
      [expense({ amount: 140, budgetCategoryId: "rent" })]
    );
    expect(row.actualAmount).toBe(140);
    expect(row.remainingAmount).toBe(0);
    expect(row.variance).toBe(-40);
  });

  it("ignores expenses tagged to another category", () => {
    const [row] = buildBudgetVariances(
      [rent],
      [expense({ amount: 80, budgetCategoryId: "groceries" })]
    );
    expect(row.actualAmount).toBe(0);
    expect(row.remainingAmount).toBe(100);
    expect(row.variance).toBe(100);
  });
});

describe("computeDesiresPoolRemaining", () => {
  it("reserves the greater of need spend and essential caps before desires", () => {
    expect(computeDesiresPoolRemaining(700, 200, 50, 300)).toBe(350);
  });

  it("uses actual need spend when it exceeds the essential caps", () => {
    expect(computeDesiresPoolRemaining(700, 250, 50, 100)).toBe(400);
  });

  it("floors at zero when desires or essentials consume the pool", () => {
    expect(computeDesiresPoolRemaining(700, 0, 500, 300)).toBe(0);
    expect(computeDesiresPoolRemaining(200, 0, 0, 300)).toBe(0);
  });
});

describe("primaryHourlyRate", () => {
  it("does not raise the wage as more of the same primary paycheck is recorded", () => {
    const once = primaryHourlyRate([
      income({ source: "Lowe's", amount: 3000, date: "2026-01-15" }),
    ]);
    const year = primaryHourlyRate(
      Array.from({ length: 12 }, (_, index) =>
        income({
          source: "Lowe's",
          amount: 3000,
          date: `2026-${String(index + 1).padStart(2, "0")}-15`,
        })
      )
    );
    expect(year).toBe(once);
    expect(year).toBeGreaterThan(0);
  });

  it("follows the latest paycheck when the same source changes amount", () => {
    const raised = primaryHourlyRate([
      income({ source: "Lowe's", amount: 3000, date: "2026-01-15" }),
      income({ source: "Lowe's", amount: 4000, date: "2026-06-15" }),
    ]);
    const current = primaryHourlyRate([
      income({ source: "Lowe's", amount: 4000, date: "2026-06-15" }),
    ]);
    expect(raised).toBe(current);
  });

  it("adds distinct primary sources and ignores one-time and non-primary rows", () => {
    const lowes = income({
      source: "Lowe's",
      amount: 3000,
      date: "2026-03-01",
    });
    const weekend = income({
      source: "Weekend shift",
      amount: 400,
      date: "2026-03-01",
    });
    const combined = primaryHourlyRate([
      lowes,
      weekend,
      income({
        source: "Lowe's",
        amount: 500,
        date: "2026-03-20",
        interval: "one-time",
      }),
      income({
        source: "Etsy",
        amount: 900,
        date: "2026-03-01",
        kind: "side_hustle",
      }),
    ]);
    const expected = primaryHourlyRate([
      income({ source: "Lowe's", amount: 3000, date: "2026-03-01" }),
      income({ source: "Weekend shift", amount: 400, date: "2026-03-01" }),
    ]);
    expect(combined).toBe(expected);
    expect(combined).toBe(
      primaryHourlyRate([
        income({ source: "Combined", amount: 3400, date: "2026-03-01" }),
      ])
    );
    expect(roundMoney(combined)).toBe(combined);
  });
});

describe("todayIso", () => {
  it("uses the local calendar day when UTC has already entered the next day", () => {
    // 2026-10-01 05:30 UTC is 2026-09-30 23:30 in America/Denver (MDT, UTC-6).
    const instant = new Date("2026-10-01T05:30:00.000Z");
    expect(instant.toISOString().slice(0, 10)).toBe("2026-10-01");
    expect(todayIso(instant)).toBe("2026-09-30");
  });
});

describe("msUntilNextLocalMidnight", () => {
  it("lands on the next local calendar day, including across the UTC date", () => {
    const instant = new Date("2026-10-01T05:30:00.000Z");
    const delay = msUntilNextLocalMidnight(instant);
    expect(todayIso(instant)).toBe("2026-09-30");
    expect(delay).toBe(30 * 60 * 1000);
    expect(todayIso(new Date(instant.getTime() + delay))).toBe("2026-10-01");
  });
});
