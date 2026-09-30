import { describe, expect, it } from "vitest";
import {
  classifyUniqueMonthlyPlans,
  compareMonthlyPlanIntent,
  formatCivilMonthLabel,
  isLayer2PlanEvidenceSafe,
} from "@/lib/babylon/monthly-plan-semantic";
import type { MonthlyPlanRevision } from "@/types/babylon";

function plan(overrides: Partial<MonthlyPlanRevision> = {}): MonthlyPlanRevision {
  return {
    id: "plan-a",
    periodKey: "2026-09",
    revision: 1,
    finalizedAt: "2026-09-01T12:00:00.000Z",
    supersedesId: null,
    planningBasis: 3000,
    wealthShare: 300,
    debtShare: 600,
    expenditureShare: 2100,
    debtRedirected: false,
    categories: [
      {
        id: "cat-1",
        categoryName: "Rent",
        plannedAmount: 1200,
        isEssential: true,
      },
    ],
    debts: [
      {
        id: "debt-1",
        creditor: "Card",
        monthlyAllocation: 50,
        remainingDebt: 200,
      },
    ],
    obligations: [
      {
        id: "ob-1",
        name: "Rent",
        amount: 1200,
        category: "need",
        budgetCategoryId: "cat-1",
        dueDay: 1,
        intervalMonths: 1,
        dueDate: "2026-09-01",
      },
    ],
    protectedContext: {
      openingWealthBuilding: 10,
      openingEmergencyFund: 20,
    },
    ...overrides,
  };
}

describe("compareMonthlyPlanIntent", () => {
  it("A: same month, same intent, different ids", () => {
    expect(
      compareMonthlyPlanIntent(plan({ id: "a" }), plan({ id: "b" }))
    ).toBe("same_month_same_intent");
  });

  it("B: ignores finalizedAt", () => {
    expect(
      compareMonthlyPlanIntent(
        plan({ finalizedAt: "2026-09-01T00:00:00.000Z" }),
        plan({ finalizedAt: "2026-09-02T00:00:00.000Z" })
      )
    ).toBe("same_month_same_intent");
  });

  it("C: ignores supersedesId", () => {
    expect(
      compareMonthlyPlanIntent(
        plan({ supersedesId: null }),
        plan({ supersedesId: "older-plan" })
      )
    ).toBe("same_month_same_intent");
  });

  it("D: ignores revision for intent and still reports revision", () => {
    const local = plan({ id: "local", revision: 1 });
    const cloud = plan({ id: "cloud", revision: 3 });
    expect(compareMonthlyPlanIntent(local, cloud)).toBe("same_month_same_intent");
    const layer = classifyUniqueMonthlyPlans([local], [cloud]);
    expect(layer.status).toBe("compared");
    if (layer.status === "compared" && layer.local && layer.cloud) {
      expect(layer.local.revision).toBe(1);
      expect(layer.cloud.revision).toBe(3);
    } else {
      throw new Error("expected compared sides");
    }
  });

  it("E–M: intent field changes are different intent", () => {
    const cases: Partial<MonthlyPlanRevision>[] = [
      { planningBasis: 1 },
      { wealthShare: 1 },
      { debtShare: 1 },
      { expenditureShare: 1 },
      { debtRedirected: true },
      {
        categories: [
          {
            id: "cat-1",
            categoryName: "Rent",
            plannedAmount: 1,
            isEssential: true,
          },
        ],
      },
      {
        debts: [
          {
            id: "debt-1",
            creditor: "Card",
            monthlyAllocation: 1,
            remainingDebt: 200,
          },
        ],
      },
      {
        obligations: [
          {
            id: "ob-1",
            name: "Rent",
            amount: 1,
            category: "need",
            budgetCategoryId: "cat-1",
            dueDay: 1,
            intervalMonths: 1,
            dueDate: "2026-09-01",
          },
        ],
      },
      {
        protectedContext: { openingWealthBuilding: 0, openingEmergencyFund: 20 },
      },
    ];
    for (const patch of cases) {
      expect(compareMonthlyPlanIntent(plan(), plan(patch))).toBe(
        "same_month_different_intent"
      );
    }
  });

  it("N: different periodKey", () => {
    expect(
      compareMonthlyPlanIntent(plan({ periodKey: "2026-09" }), plan({ periodKey: "2026-10" }))
    ).toBe("different_months");
  });

  it("O: object key order does not change intent", () => {
    const local = plan();
    const cloud = plan();
    cloud.protectedContext = {
      openingEmergencyFund: 20,
      openingWealthBuilding: 10,
    } as MonthlyPlanRevision["protectedContext"];
    expect(compareMonthlyPlanIntent(local, cloud)).toBe("same_month_same_intent");
  });

  it("P: Layer-2 DTO omits ids, names, amounts, and timestamps", () => {
    const layer = classifyUniqueMonthlyPlans(
      [plan({ id: "phone-plan-id" })],
      [plan({ id: "cloud-plan-id", finalizedAt: "2026-09-28T00:00:00.000Z" })]
    );
    expect(isLayer2PlanEvidenceSafe(layer)).toBe(true);
    const raw = JSON.stringify(layer);
    expect(raw).not.toContain("phone-plan-id");
    expect(raw).not.toContain("cloud-plan-id");
    expect(raw).not.toContain("Rent");
    expect(raw).not.toContain("Card");
    expect(raw).not.toContain("1200");
    expect(raw).not.toContain("2026-09-28");
    expect(raw).toContain("September 2026");
  });

  it("Q: malformed input is not comparable", () => {
    expect(compareMonthlyPlanIntent(null, plan())).toBe("not_comparable");
    expect(compareMonthlyPlanIntent(plan({ periodKey: "nope" }), plan())).toBe(
      "not_comparable"
    );
  });

  it("formats civil months without shifting the month", () => {
    expect(formatCivilMonthLabel("2026-09")).toBe("September 2026");
    expect(formatCivilMonthLabel("2026-10")).toBe("October 2026");
  });

  it("hides when there is not exactly one unique plan on each side", () => {
    expect(classifyUniqueMonthlyPlans([plan()], [plan()])).toEqual({
      status: "hidden",
    });
    expect(
      classifyUniqueMonthlyPlans(
        [plan({ id: "a" }), plan({ id: "b", periodKey: "2026-10" })],
        [plan({ id: "c" })]
      )
    ).toEqual({ status: "multiple" });
  });

  it("reports supersedes only as a boolean", () => {
    const layer = classifyUniqueMonthlyPlans(
      [plan({ id: "local", supersedesId: "secret-older-id" })],
      [plan({ id: "cloud", supersedesId: null })]
    );
    expect(layer.status).toBe("compared");
    if (layer.status === "compared" && layer.local && layer.cloud) {
      expect(layer.local.supersedesEarlier).toBe(true);
      expect(layer.cloud.supersedesEarlier).toBe(false);
      expect(layer.relation).toBe("same_month_same_intent");
      expect(JSON.stringify(layer)).not.toContain("secret-older-id");
    }
  });
});
