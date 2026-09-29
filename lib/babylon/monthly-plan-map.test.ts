import { describe, expect, it } from "vitest";
import { allocateIncome } from "@/lib/babylon/engine";
import {
  formatPlanMonthTitle,
  livingPurposeMapState,
  mergeFirstDraftAmountFields,
  mergeFirstDraftPurposes,
  planResultWealthBuilding,
  planSplitProportions,
  totalRemainingDebtCents,
} from "@/lib/babylon/monthly-plan-map";
import {
  monthlyPlanCents,
  previewMonthlyPlan,
} from "@/lib/babylon/monthly-plan";

describe("monthly plan map helpers", () => {
  it("titles the selected period without inventing clock time", () => {
    expect(formatPlanMonthTitle("2026-10")).toBe("October 2026");
    expect(formatPlanMonthTitle("2027-02")).toBe("February 2027");
  });

  it("derives Living map states from preview arithmetic only", () => {
    expect(livingPurposeMapState(null, null)).toEqual({ kind: "awaiting_basis" });
    expect(livingPurposeMapState(70000, 0)).toEqual({
      kind: "unmapped",
      remainingCents: 70000,
    });
    expect(livingPurposeMapState(2500, 67500)).toEqual({
      kind: "partial",
      remainingCents: 2500,
    });
    expect(livingPurposeMapState(0, 70000)).toEqual({ kind: "complete" });
    expect(livingPurposeMapState(-1200, 71200)).toEqual({
      kind: "overcommitted",
      overCents: 1200,
    });
  });

  it("builds a Wealth intention overlay without Emergency Fund or tracked wealth", () => {
    expect(planResultWealthBuilding(250, 100)).toEqual({
      alreadyProtected: 250,
      thisPlan: 100,
      ifExecuted: 350,
    });
    expect(planResultWealthBuilding(0, 300)).toEqual({
      alreadyProtected: 0,
      thisPlan: 300,
      ifExecuted: 300,
    });
  });

  it("keeps 10/20/70 proportions penny-exact and debt-free redirect intact", () => {
    const withDebt = allocateIncome(1000, true);
    const proportions = planSplitProportions(withDebt, 1000);
    expect(withDebt).toEqual({
      wealthShare: 100,
      debtShare: 200,
      expenditureShare: 700,
      debtRedirected: false,
    });
    expect(proportions.wealthRatio).toBeCloseTo(0.1, 10);
    expect(proportions.debtRatio).toBeCloseTo(0.2, 10);
    expect(proportions.livingRatio).toBeCloseTo(0.7, 10);

    const debtFree = allocateIncome(1000, false);
    expect(debtFree).toEqual({
      wealthShare: 300,
      debtShare: 0,
      expenditureShare: 700,
      debtRedirected: true,
    });
    const redirected = planSplitProportions(debtFree, 1000);
    expect(redirected.wealthRatio).toBeCloseTo(0.3, 10);
    expect(redirected.debtRatio).toBe(0);
    expect(redirected.livingRatio).toBeCloseTo(0.7, 10);
  });

  it("sums remaining debt in cents for display context", () => {
    expect(
      totalRemainingDebtCents([
        { remainingDebt: 500 },
        { remainingDebt: 250.5 },
      ])
    ).toBe(75050);
  });
});

describe("monthly plan map preview boundaries", () => {
  it("recomputes the canonical split when the working amount changes", () => {
    const low = previewMonthlyPlan({
      periodKey: "2026-10",
      planningBasis: 1000,
      categories: [{ id: "rent", categoryName: "Rent", plannedAmount: 700, isEssential: true }],
      debts: [
        {
          id: "debt-card",
          creditor: "Card",
          totalDebt: 800,
          remainingDebt: 500,
          monthlyAllocation: 40,
          createdAt: "2026-01-01",
          interestRate: 12,
        },
      ],
      obligations: [],
    });
    const high = previewMonthlyPlan({
      periodKey: "2026-10",
      planningBasis: 2000,
      categories: [{ id: "rent", categoryName: "Rent", plannedAmount: 1400, isEssential: true }],
      debts: [
        {
          id: "debt-card",
          creditor: "Card",
          totalDebt: 800,
          remainingDebt: 500,
          monthlyAllocation: 40,
          createdAt: "2026-01-01",
          interestRate: 12,
        },
      ],
      obligations: [],
    });
    expect(low.split).toEqual(allocateIncome(1000, true));
    expect(high.split).toEqual(allocateIncome(2000, true));
    expect(low.remainingCents).toBe(0);
    expect(high.remainingCents).toBe(0);
    expect(livingPurposeMapState(low.remainingCents, low.assignedCents)).toEqual({
      kind: "complete",
    });
  });

  it("exposes positive remainder, exact assignment, and overcommit before finalize", () => {
    const partial = previewMonthlyPlan({
      periodKey: "2026-10",
      planningBasis: 1000,
      categories: [{ id: "rent", categoryName: "Rent", plannedAmount: 500, isEssential: true }],
      debts: [
        {
          id: "debt-card",
          creditor: "Card",
          totalDebt: 800,
          remainingDebt: 500,
          monthlyAllocation: 40,
          createdAt: "2026-01-01",
          interestRate: 12,
        },
      ],
      obligations: [],
    });
    expect(partial.remainingCents).toBe(20000);
    expect(partial.canFinalize).toBe(false);
    expect(
      livingPurposeMapState(partial.remainingCents, partial.assignedCents)
    ).toEqual({ kind: "partial", remainingCents: 20000 });

    const over = previewMonthlyPlan({
      periodKey: "2026-10",
      planningBasis: 1000,
      categories: [{ id: "rent", categoryName: "Rent", plannedAmount: 750, isEssential: true }],
      debts: [
        {
          id: "debt-card",
          creditor: "Card",
          totalDebt: 800,
          remainingDebt: 500,
          monthlyAllocation: 40,
          createdAt: "2026-01-01",
          interestRate: 12,
        },
      ],
      obligations: [],
    });
    expect(over.remainingCents).toBe(-5000);
    expect(over.canFinalize).toBe(false);
    expect(livingPurposeMapState(over.remainingCents, over.assignedCents)).toEqual({
      kind: "overcommitted",
      overCents: 5000,
    });
    expect(monthlyPlanCents(750) - monthlyPlanCents(700)).toBe(5000);
  });

  it("keeps known obligation cents as context without changing assigned intent", () => {
    const withBills = previewMonthlyPlan({
      periodKey: "2026-10",
      planningBasis: 1000,
      categories: [{ id: "rent", categoryName: "Rent", plannedAmount: 700, isEssential: true }],
      debts: [
        {
          id: "debt-card",
          creditor: "Card",
          totalDebt: 800,
          remainingDebt: 500,
          monthlyAllocation: 40,
          createdAt: "2026-01-01",
          interestRate: 12,
        },
      ],
      obligations: [
        {
          id: "rule-phone",
          name: "Phone",
          amount: 900,
          category: "need",
          budgetCategoryId: "rent",
          dueDay: 15,
          startMonth: "2026-10",
          intervalMonths: 1,
          isActive: true,
          skippedMonths: [],
          createdAt: "2026-09-01",
        },
      ],
    });
    expect(withBills.assignedCents).toBe(70000);
    expect(withBills.remainingCents).toBe(0);
    expect(withBills.canFinalize).toBe(true);
    expect(withBills.obligationCentsByCategoryId.rent).toBe(90000);
  });

  it("reports immediate overcommit for a $1,000,000 Bills purpose", () => {
    const debts = [
      {
        id: "debt-card",
        creditor: "Card",
        totalDebt: 800,
        remainingDebt: 500,
        monthlyAllocation: 40,
        createdAt: "2026-01-01",
        interestRate: 12,
      },
    ];
    const over = previewMonthlyPlan({
      periodKey: "2026-10",
      planningBasis: 1000,
      categories: [
        {
          id: "bills",
          categoryName: "Bills",
          plannedAmount: 1_000_000,
          isEssential: true,
        },
      ],
      debts,
      obligations: [],
    });
    const livingCents = monthlyPlanCents(allocateIncome(1000, true).expenditureShare);
    const overCents = monthlyPlanCents(1_000_000) - livingCents;
    expect(over.assignedCents).toBe(monthlyPlanCents(1_000_000));
    expect(over.livingCents).toBe(livingCents);
    expect(over.remainingCents).toBe(-overCents);
    expect(over.canFinalize).toBe(false);
    expect(livingPurposeMapState(over.remainingCents, over.assignedCents)).toEqual({
      kind: "overcommitted",
      overCents,
    });

    const restored = previewMonthlyPlan({
      periodKey: "2026-10",
      planningBasis: 1000,
      categories: [
        {
          id: "bills",
          categoryName: "Bills",
          plannedAmount: 700,
          isEssential: true,
        },
      ],
      debts,
      obligations: [],
    });
    expect(restored.remainingCents).toBe(0);
    expect(livingPurposeMapState(restored.remainingCents, restored.assignedCents)).toEqual({
      kind: "complete",
    });
    expect(restored.canFinalize).toBe(true);
  });

  it("keeps existing purpose assignments when the working amount changes", () => {
    const debts = [
      {
        id: "debt-card",
        creditor: "Card",
        totalDebt: 800,
        remainingDebt: 500,
        monthlyAllocation: 40,
        createdAt: "2026-01-01",
        interestRate: 12,
      },
    ];
    const categories = [
      {
        id: "bills",
        categoryName: "Bills",
        plannedAmount: 500,
        isEssential: true,
      },
      {
        id: "gas",
        categoryName: "Gas",
        plannedAmount: 100,
        isEssential: true,
      },
    ];
    const aroundThousand = previewMonthlyPlan({
      periodKey: "2026-10",
      planningBasis: 1000,
      categories,
      debts,
      obligations: [],
    });
    const aroundTwoThousand = previewMonthlyPlan({
      periodKey: "2026-10",
      planningBasis: 2000,
      categories,
      debts,
      obligations: [],
    });
    expect(aroundThousand.assignedCents).toBe(60000);
    expect(aroundTwoThousand.assignedCents).toBe(60000);
    expect(aroundThousand.split).toEqual(allocateIncome(1000, true));
    expect(aroundTwoThousand.split).toEqual(allocateIncome(2000, true));
    expect(
      livingPurposeMapState(
        aroundThousand.remainingCents,
        aroundThousand.assignedCents
      )
    ).toEqual({ kind: "partial", remainingCents: 10000 });
    expect(
      livingPurposeMapState(
        aroundTwoThousand.remainingCents,
        aroundTwoThousand.assignedCents
      )
    ).toEqual({ kind: "partial", remainingCents: 80000 });
  });
});

describe("first-draft purpose merge", () => {
  it("appends newly created BudgetTargets without overwriting steward amounts", () => {
    const current = [
      {
        id: "bills",
        categoryName: "Bills",
        plannedAmount: 250,
        isEssential: true,
      },
    ];
    const targets = [
      {
        id: "bills",
        categoryName: "Bills",
        plannedAmount: 400,
        isEssential: true,
      },
      {
        id: "gas",
        categoryName: "Gas",
        plannedAmount: 80,
        isEssential: true,
      },
    ];
    const merged = mergeFirstDraftPurposes(current, targets);
    expect(merged).toEqual([
      {
        id: "bills",
        categoryName: "Bills",
        plannedAmount: 250,
        isEssential: true,
      },
      {
        id: "gas",
        categoryName: "Gas",
        plannedAmount: 80,
        isEssential: true,
      },
    ]);
    expect(mergeFirstDraftPurposes(merged, targets)).toBe(merged);
    expect(
      mergeFirstDraftAmountFields({ bills: "250" }, targets)
    ).toEqual({ bills: "250", gas: "80" });
  });
});
