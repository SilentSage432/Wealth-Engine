import { describe, expect, it } from "vitest";
import {
  deriveDeployablePosition,
  deriveRestrictedEffectiveTotal,
} from "@/lib/babylon/account-restriction";
import { deriveAvailableAfterPlannedNeeds } from "@/lib/babylon/available-after-planned-needs";
import { CLOUD_VAULT_SCHEMA_VERSION } from "@/lib/babylon/cloud-vault";
import { EMPTY_STATE } from "@/lib/babylon/constants";
import { allocateIncome } from "@/lib/babylon/engine";
import { sumAccountBalances } from "@/lib/babylon/financial-position";
import { INTELLIGENCE_CONTRACT_VERSION } from "@/lib/babylon/intelligence-contract";
import {
  derivePaycheckFundingPlan,
  extractMonthlyFundingPurposes,
  splitCentsEarliestRemainder,
} from "@/lib/babylon/paycheck-funding";
import { LEDGER_BACKUP_VERSION } from "@/lib/babylon/persistence";
import { totalProtectedMoney } from "@/lib/babylon/protected-money";
import type {
  ExpectedPayday,
  MonthlyPlanRevision,
  PaySchedule,
} from "@/types/babylon";

function plan(
  partial: Partial<MonthlyPlanRevision> &
    Pick<MonthlyPlanRevision, "periodKey" | "categories" | "wealthShare" | "debtShare">
): MonthlyPlanRevision {
  return {
    id: partial.id ?? "plan-rev-1",
    periodKey: partial.periodKey,
    revision: partial.revision ?? 1,
    finalizedAt: partial.finalizedAt ?? "2026-10-01T12:00:00.000Z",
    supersedesId: partial.supersedesId ?? null,
    planningBasis: partial.planningBasis ?? 3000,
    wealthShare: partial.wealthShare,
    debtShare: partial.debtShare,
    expenditureShare: partial.expenditureShare ?? 2100,
    debtRedirected: partial.debtRedirected ?? false,
    categories: partial.categories,
    debts: partial.debts ?? [],
    obligations: partial.obligations ?? [],
    protectedContext: partial.protectedContext ?? {
      openingWealthBuilding: 0,
      openingEmergencyFund: 0,
    },
  };
}

function payday(
  partial: Partial<ExpectedPayday> & Pick<ExpectedPayday, "date">
): ExpectedPayday {
  const periodKey = partial.periodKey ?? partial.date.slice(0, 7);
  const row: ExpectedPayday = {
    scheduleId: partial.scheduleId ?? "sched-1",
    date: partial.date,
    periodKey,
  };
  if (partial.expectedAmount !== undefined) {
    row.expectedAmount = partial.expectedAmount;
  }
  if (partial.label !== undefined) {
    row.label = partial.label;
  }
  return row;
}

function amountsForPurpose(
  funding: ReturnType<typeof derivePaycheckFundingPlan>,
  purposeId: string
): number[] {
  if (!funding.ok) throw new Error(funding.reason);
  return funding.plan.paydays.map((slot) => {
    const row = slot.responsibilities.find((r) => r.purposeId === purposeId);
    if (!row) throw new Error(`missing purpose ${purposeId}`);
    return row.amount;
  });
}

function sumAmounts(values: readonly number[]): number {
  return values.reduce((sum, value) => sum + Math.round(value * 100), 0) / 100;
}

describe("splitCentsEarliestRemainder", () => {
  it("conserves cents and bounds spread to one penny", () => {
    const cases: Array<[number, number]> = [
      [50000, 3],
      [10000, 3],
      [1, 3],
      [60000, 2],
      [60000, 3],
      [60000, 4],
      [0, 5],
      [7, 5],
      [999, 7],
      [1, 1],
      [100, 1],
    ];
    for (const [cents, n] of cases) {
      const shares = splitCentsEarliestRemainder(cents, n);
      expect(shares).toHaveLength(n);
      expect(shares.reduce((a, b) => a + b, 0)).toBe(cents);
      expect(Math.max(...shares) - Math.min(...shares)).toBeLessThanOrEqual(1);
      for (const share of shares) expect(share).toBeGreaterThanOrEqual(0);
    }
  });

  it("assigns remainder to earliest slots", () => {
    expect(splitCentsEarliestRemainder(10000, 3)).toEqual([3334, 3333, 3333]);
    expect(splitCentsEarliestRemainder(50000, 3)).toEqual([16667, 16667, 16666]);
    expect(splitCentsEarliestRemainder(1, 3)).toEqual([1, 0, 0]);
  });
});

describe("derivePaycheckFundingPlan", () => {
  it("A: $600 Living / 3 paydays → 200 / 200 / 200", () => {
    const revision = plan({
      periodKey: "2026-10",
      wealthShare: 0,
      debtShare: 0,
      categories: [
        {
          id: "cat-groceries",
          categoryName: "Groceries",
          plannedAmount: 600,
          isEssential: true,
        },
      ],
    });
    const result = derivePaycheckFundingPlan(revision, [
      payday({ date: "2026-10-02" }),
      payday({ date: "2026-10-16", scheduleId: "sched-1" }),
      payday({ date: "2026-10-30", scheduleId: "sched-1" }),
    ]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.plan.status).toBe("decomposed");
    expect(amountsForPurpose(result, "cat-groceries")).toEqual([200, 200, 200]);
  });

  it("B: $600 / 2 → 300 / 300", () => {
    const revision = plan({
      periodKey: "2026-10",
      wealthShare: 0,
      debtShare: 0,
      categories: [
        {
          id: "cat-groceries",
          categoryName: "Groceries",
          plannedAmount: 600,
          isEssential: true,
        },
      ],
    });
    const result = derivePaycheckFundingPlan(revision, [
      payday({ date: "2026-10-01" }),
      payday({ date: "2026-10-15" }),
    ]);
    expect(amountsForPurpose(result, "cat-groceries")).toEqual([300, 300]);
  });

  it("C: $500 / 3 → exact penny conservation", () => {
    const revision = plan({
      periodKey: "2026-10",
      wealthShare: 0,
      debtShare: 0,
      categories: [
        {
          id: "cat-a",
          categoryName: "A",
          plannedAmount: 500,
          isEssential: true,
        },
      ],
    });
    const amounts = amountsForPurpose(
      derivePaycheckFundingPlan(revision, [
        payday({ date: "2026-10-02" }),
        payday({ date: "2026-10-16" }),
        payday({ date: "2026-10-30" }),
      ]),
      "cat-a"
    );
    expect(amounts).toEqual([166.67, 166.67, 166.66]);
    expect(sumAmounts(amounts)).toBe(500);
  });

  it("D: $100 / 3 → exact penny conservation", () => {
    const revision = plan({
      periodKey: "2026-10",
      wealthShare: 0,
      debtShare: 0,
      categories: [
        {
          id: "cat-a",
          categoryName: "A",
          plannedAmount: 100,
          isEssential: true,
        },
      ],
    });
    const amounts = amountsForPurpose(
      derivePaycheckFundingPlan(revision, [
        payday({ date: "2026-10-02" }),
        payday({ date: "2026-10-16" }),
        payday({ date: "2026-10-30" }),
      ]),
      "cat-a"
    );
    expect(amounts).toEqual([33.34, 33.33, 33.33]);
    expect(sumAmounts(amounts)).toBe(100);
  });

  it("E: $0.01 / 3 → exact penny conservation", () => {
    const revision = plan({
      periodKey: "2026-10",
      wealthShare: 0,
      debtShare: 0,
      categories: [
        {
          id: "cat-a",
          categoryName: "A",
          plannedAmount: 0.01,
          isEssential: true,
        },
      ],
    });
    const amounts = amountsForPurpose(
      derivePaycheckFundingPlan(revision, [
        payday({ date: "2026-10-02" }),
        payday({ date: "2026-10-16" }),
        payday({ date: "2026-10-30" }),
      ]),
      "cat-a"
    );
    expect(amounts).toEqual([0.01, 0, 0]);
    expect(sumAmounts(amounts)).toBe(0.01);
  });

  it("F: one payday assigns the entire purpose", () => {
    const revision = plan({
      periodKey: "2026-10",
      wealthShare: 0,
      debtShare: 0,
      categories: [
        {
          id: "cat-groceries",
          categoryName: "Groceries",
          plannedAmount: 600,
          isEssential: true,
        },
      ],
    });
    expect(
      amountsForPurpose(
        derivePaycheckFundingPlan(revision, [payday({ date: "2026-10-15" })]),
        "cat-groceries"
      )
    ).toEqual([600]);
  });

  it("G: zero paydays → explicit no_expected_funding", () => {
    const revision = plan({
      periodKey: "2026-10",
      wealthShare: 300,
      debtShare: 600,
      categories: [
        {
          id: "cat-groceries",
          categoryName: "Groceries",
          plannedAmount: 600,
          isEssential: true,
        },
      ],
    });
    const result = derivePaycheckFundingPlan(revision, []);
    expect(result).toEqual({
      ok: true,
      plan: {
        periodKey: "2026-10",
        monthlyPlanRevisionId: "plan-rev-1",
        status: "no_expected_funding",
        fundingOpportunityCount: 0,
        purposes: extractMonthlyFundingPurposes(revision),
        paydays: [],
      },
    });
  });

  it("H: multiple Living categories are independently conserved", () => {
    const revision = plan({
      periodKey: "2026-10",
      wealthShare: 0,
      debtShare: 0,
      categories: [
        {
          id: "cat-groceries",
          categoryName: "Groceries",
          plannedAmount: 600,
          isEssential: true,
        },
        {
          id: "cat-fuel",
          categoryName: "Fuel",
          plannedAmount: 300,
          isEssential: true,
        },
        {
          id: "cat-coffee",
          categoryName: "Coffee",
          plannedAmount: 90,
          isEssential: false,
        },
      ],
    });
    const result = derivePaycheckFundingPlan(revision, [
      payday({ date: "2026-10-02" }),
      payday({ date: "2026-10-16" }),
      payday({ date: "2026-10-30" }),
    ]);
    expect(amountsForPurpose(result, "cat-groceries")).toEqual([200, 200, 200]);
    expect(amountsForPurpose(result, "cat-fuel")).toEqual([100, 100, 100]);
    expect(amountsForPurpose(result, "cat-coffee")).toEqual([30, 30, 30]);
  });

  it("I: Wealth purpose is independently conserved from wealthShare", () => {
    const revision = plan({
      periodKey: "2026-10",
      wealthShare: 300,
      debtShare: 0,
      categories: [],
    });
    const amounts = amountsForPurpose(
      derivePaycheckFundingPlan(revision, [
        payday({ date: "2026-10-02" }),
        payday({ date: "2026-10-16" }),
        payday({ date: "2026-10-30" }),
      ]),
      "wealth"
    );
    expect(amounts).toEqual([100, 100, 100]);
    expect(sumAmounts(amounts)).toBe(300);
  });

  it("J: Debt purpose uses aggregate debtShare (not per-creditor)", () => {
    const revision = plan({
      periodKey: "2026-10",
      wealthShare: 0,
      debtShare: 600,
      categories: [],
      debts: [
        {
          id: "debt-a",
          creditor: "Card A",
          monthlyAllocation: 200,
          remainingDebt: 1000,
        },
        {
          id: "debt-b",
          creditor: "Card B",
          monthlyAllocation: 100,
          remainingDebt: 500,
        },
      ],
    });
    const result = derivePaycheckFundingPlan(revision, [
      payday({ date: "2026-10-02" }),
      payday({ date: "2026-10-16" }),
      payday({ date: "2026-10-30" }),
    ]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.plan.purposes.filter((p) => p.kind === "debt")).toHaveLength(1);
    expect(amountsForPurpose(result, "debt")).toEqual([200, 200, 200]);
    expect(
      result.plan.paydays.flatMap((slot) => slot.responsibilities).some((r) =>
        r.purposeId === "debt-a" || r.purposeId === "debt-b"
      )
    ).toBe(false);
  });

  it("K: out-of-order paydays sort by civil date", () => {
    const revision = plan({
      periodKey: "2026-10",
      wealthShare: 0,
      debtShare: 0,
      categories: [
        {
          id: "cat-a",
          categoryName: "A",
          plannedAmount: 300,
          isEssential: true,
        },
      ],
    });
    const result = derivePaycheckFundingPlan(revision, [
      payday({ date: "2026-10-30", scheduleId: "s" }),
      payday({ date: "2026-10-02", scheduleId: "s" }),
      payday({ date: "2026-10-16", scheduleId: "s" }),
    ]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.plan.paydays.map((slot) => slot.expectedPayday.date)).toEqual([
      "2026-10-02",
      "2026-10-16",
      "2026-10-30",
    ]);
  });

  it("L: duplicate scheduleId+date fails safely", () => {
    const revision = plan({
      periodKey: "2026-10",
      wealthShare: 0,
      debtShare: 0,
      categories: [
        {
          id: "cat-a",
          categoryName: "A",
          plannedAmount: 100,
          isEssential: true,
        },
      ],
    });
    const result = derivePaycheckFundingPlan(revision, [
      payday({ date: "2026-10-02", scheduleId: "s1" }),
      payday({ date: "2026-10-02", scheduleId: "s1" }),
    ]);
    expect(result).toEqual({
      ok: false,
      reason: "duplicate_expected_payday",
      message: "Duplicate expected payday occurrences are not allowed.",
    });
  });

  it("L2: same civil date from distinct schedules remains two opportunities", () => {
    const revision = plan({
      periodKey: "2026-10",
      wealthShare: 0,
      debtShare: 0,
      categories: [
        {
          id: "cat-a",
          categoryName: "A",
          plannedAmount: 100,
          isEssential: true,
        },
      ],
    });
    const amounts = amountsForPurpose(
      derivePaycheckFundingPlan(revision, [
        payday({ date: "2026-10-02", scheduleId: "s1" }),
        payday({ date: "2026-10-02", scheduleId: "s2" }),
      ]),
      "cat-a"
    );
    expect(amounts).toEqual([50, 50]);
  });

  it("M: foreign-period payday is rejected", () => {
    const revision = plan({
      periodKey: "2026-10",
      wealthShare: 0,
      debtShare: 0,
      categories: [
        {
          id: "cat-a",
          categoryName: "A",
          plannedAmount: 100,
          isEssential: true,
        },
      ],
    });
    const result = derivePaycheckFundingPlan(revision, [
      payday({ date: "2026-10-02" }),
      payday({ date: "2026-11-01", periodKey: "2026-11" }),
    ]);
    expect(result).toMatchObject({
      ok: false,
      reason: "foreign_period_payday",
    });
  });

  it("N: expectedAmount differences do not affect equal distribution", () => {
    const revision = plan({
      periodKey: "2026-10",
      wealthShare: 0,
      debtShare: 0,
      categories: [
        {
          id: "cat-a",
          categoryName: "A",
          plannedAmount: 300,
          isEssential: true,
        },
      ],
    });
    const equal = amountsForPurpose(
      derivePaycheckFundingPlan(revision, [
        payday({ date: "2026-10-02", expectedAmount: 50 }),
        payday({ date: "2026-10-16", expectedAmount: 5000 }),
        payday({ date: "2026-10-30" }),
      ]),
      "cat-a"
    );
    expect(equal).toEqual([100, 100, 100]);
  });

  it("O: inputs remain unchanged after derivation", () => {
    const revision = plan({
      periodKey: "2026-10",
      wealthShare: 300,
      debtShare: 600,
      categories: [
        {
          id: "cat-a",
          categoryName: "A",
          plannedAmount: 2100,
          isEssential: true,
        },
      ],
      debts: [
        {
          id: "debt-a",
          creditor: "Card",
          monthlyAllocation: 200,
          remainingDebt: 900,
        },
      ],
      obligations: [
        {
          id: "obl-1",
          name: "Rent",
          amount: 1200,
          category: "need",
          budgetCategoryId: "cat-a",
          dueDay: 1,
          intervalMonths: 1,
          dueDate: "2026-10-01",
        },
      ],
    });
    const paydays = [
      payday({ date: "2026-10-30", expectedAmount: 1111, label: "late" }),
      payday({ date: "2026-10-02", expectedAmount: 2222, label: "early" }),
    ];
    const planBefore = structuredClone(revision);
    const paydaysBefore = structuredClone(paydays);
    const result = derivePaycheckFundingPlan(revision, paydays);
    expect(result.ok).toBe(true);
    expect(revision).toEqual(planBefore);
    expect(paydays).toEqual(paydaysBefore);
  });

  it("P: sum of responsibilities per purpose equals monthly amount", () => {
    const revision = plan({
      periodKey: "2026-10",
      wealthShare: 333.33,
      debtShare: 666.67,
      categories: [
        {
          id: "cat-a",
          categoryName: "A",
          plannedAmount: 500.01,
          isEssential: true,
        },
        {
          id: "cat-b",
          categoryName: "B",
          plannedAmount: 99.99,
          isEssential: false,
        },
      ],
    });
    const result = derivePaycheckFundingPlan(revision, [
      payday({ date: "2026-10-05" }),
      payday({ date: "2026-10-12" }),
      payday({ date: "2026-10-19" }),
      payday({ date: "2026-10-26" }),
    ]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    for (const purpose of result.plan.purposes) {
      const amounts = amountsForPurpose(result, purpose.purposeId);
      expect(sumAmounts(amounts)).toBe(purpose.monthlyPlannedAmount);
    }
  });

  it("does not use obligation due dates to alter distribution", () => {
    const withDue = plan({
      periodKey: "2026-10",
      wealthShare: 0,
      debtShare: 0,
      categories: [
        {
          id: "cat-a",
          categoryName: "A",
          plannedAmount: 300,
          isEssential: true,
        },
      ],
      obligations: [
        {
          id: "obl-rent",
          name: "Rent",
          amount: 1200,
          category: "need",
          budgetCategoryId: "cat-a",
          dueDay: 3,
          intervalMonths: 1,
          dueDate: "2026-10-03",
        },
      ],
    });
    const withoutDue = { ...withDue, obligations: [] };
    const paydays = [
      payday({ date: "2026-10-02" }),
      payday({ date: "2026-10-16" }),
      payday({ date: "2026-10-30" }),
    ];
    expect(amountsForPurpose(derivePaycheckFundingPlan(withDue, paydays), "cat-a")).toEqual(
      amountsForPurpose(derivePaycheckFundingPlan(withoutDue, paydays), "cat-a")
    );
  });

  it("rejects periodKey/date mismatch on payday", () => {
    const revision = plan({
      periodKey: "2026-10",
      wealthShare: 0,
      debtShare: 0,
      categories: [],
    });
    const result = derivePaycheckFundingPlan(revision, [
      {
        scheduleId: "s",
        date: "2026-10-02",
        periodKey: "2026-09",
      },
    ]);
    expect(result).toMatchObject({ ok: false, reason: "period_date_mismatch" });
  });
});

describe("paycheck funding isolation", () => {
  it("does not create IncomeEntry or AllocationEvent and does not mutate position", () => {
    const accounts = [
      {
        id: "acc-1",
        name: "Checking",
        kind: "checking" as const,
        balance: 2500,
        asOf: "2026-10-01",
        restrictedAmount: 400,
      },
    ];
    const positions = [
      {
        accountId: "acc-1",
        balance: 2500,
        source: "declared" as const,
        asOf: "2026-10-01",
      },
    ];
    const schedules: PaySchedule[] = [
      {
        id: "sched-1",
        cadence: "biweekly",
        anchorDate: "2026-10-02",
        createdAt: "2026-01-01",
      },
    ];
    const revision = plan({
      periodKey: "2026-10",
      wealthShare: 300,
      debtShare: 600,
      categories: [
        {
          id: "cat-a",
          categoryName: "A",
          plannedAmount: 2100,
          isEssential: true,
        },
      ],
      debts: [
        {
          id: "debt-a",
          creditor: "Card",
          monthlyAllocation: 200,
          remainingDebt: 1500,
        },
      ],
    });
    const paydays = [
      payday({ date: "2026-10-02" }),
      payday({ date: "2026-10-16" }),
      payday({ date: "2026-10-30" }),
    ];

    const incomesBefore = EMPTY_STATE.incomes.length;
    const allocationsBefore = EMPTY_STATE.allocations.length;
    const attributionsBefore = EMPTY_STATE.debtPurposeAttributions.length;
    const accountsBefore = structuredClone(accounts);
    const revisionBefore = structuredClone(revision);
    const paydaysBefore = structuredClone(paydays);
    const schedulesBefore = structuredClone(schedules);

    const liquidBefore = sumAccountBalances(accounts);
    const unavailableBefore = deriveRestrictedEffectiveTotal(accounts, positions);
    const deployableBefore = deriveDeployablePosition(accounts, positions);
    const protectedBefore = totalProtectedMoney(0, 0);
    const aapnBefore = deriveAvailableAfterPlannedNeeds({
      deployablePosition: deployableBefore,
      deployableProtected: 0,
      upcomingNeeds: 100,
    });
    const splitBefore = allocateIncome(3000, true);

    const result = derivePaycheckFundingPlan(revision, paydays);
    expect(result.ok).toBe(true);

    expect(EMPTY_STATE.incomes).toHaveLength(incomesBefore);
    expect(EMPTY_STATE.allocations).toHaveLength(allocationsBefore);
    expect(EMPTY_STATE.debtPurposeAttributions).toHaveLength(attributionsBefore);
    expect(accounts).toEqual(accountsBefore);
    expect(revision).toEqual(revisionBefore);
    expect(paydays).toEqual(paydaysBefore);
    expect(schedules).toEqual(schedulesBefore);
    expect(sumAccountBalances(accounts)).toBe(liquidBefore);
    expect(deriveRestrictedEffectiveTotal(accounts, positions)).toBe(
      unavailableBefore
    );
    expect(deriveDeployablePosition(accounts, positions)).toBe(deployableBefore);
    expect(totalProtectedMoney(0, 0)).toBe(protectedBefore);
    expect(
      deriveAvailableAfterPlannedNeeds({
        deployablePosition: deployableBefore,
        deployableProtected: 0,
        upcomingNeeds: 100,
      })
    ).toEqual(aapnBefore);
    expect(allocateIncome(3000, true)).toEqual(splitBefore);
    expect(revision.debts[0].remainingDebt).toBe(1500);
    expect(LEDGER_BACKUP_VERSION).toBe(10);
    expect(CLOUD_VAULT_SCHEMA_VERSION).toBe(6);
    expect(INTELLIGENCE_CONTRACT_VERSION).toBe("3");
  });
});
