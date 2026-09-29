import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { EMPTY_STATE } from "@/lib/babylon/constants";
import { allocateIncome } from "@/lib/babylon/engine";
import {
  composeFundThisMonthView,
  fundingResponsibilityLabel,
} from "@/lib/babylon/paycheck-planner-ui";
import { derivePaycheckFundingPlan } from "@/lib/babylon/paycheck-funding";
import { deriveExpectedPaydaysForSchedules } from "@/lib/babylon/pay-schedule";
import { LEDGER_BACKUP_VERSION } from "@/lib/babylon/persistence";
import { CLOUD_VAULT_SCHEMA_VERSION } from "@/lib/babylon/cloud-vault";
import { INTELLIGENCE_CONTRACT_VERSION } from "@/lib/babylon/intelligence-contract";
import type {
  MonthlyPlanObligationEvidence,
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

function obligation(
  partial: Partial<MonthlyPlanObligationEvidence> &
    Pick<MonthlyPlanObligationEvidence, "id" | "name" | "amount" | "dueDate">
): MonthlyPlanObligationEvidence {
  return {
    id: partial.id,
    name: partial.name,
    amount: partial.amount,
    category: partial.category ?? "need",
    budgetCategoryId: partial.budgetCategoryId ?? "cat-bills",
    dueDay: partial.dueDay ?? Number(partial.dueDate.slice(8, 10)),
    intervalMonths: partial.intervalMonths ?? 1,
    dueDate: partial.dueDate,
  };
}

const biweekly: PaySchedule = {
  id: "sched-bi",
  cadence: "biweekly",
  anchorDate: "2026-10-02",
  createdAt: "2026-01-01",
  label: "Lowe's",
};

describe("composeFundThisMonthView", () => {
  it("A: finalized plan + 3 expected paydays yields 3 funding opportunities", () => {
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
    const view = composeFundThisMonthView(revision, [biweekly]);
    expect(view.status).toBe("path");
    expect(view.expectedPaydayCount).toBe(3);
    expect(view.uniquePaydayDateCount).toBe(3);
    expect(view.dateGroups).toHaveLength(3);
  });

  it("B: $600 Groceries renders $200 / $200 / $200", () => {
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
    const view = composeFundThisMonthView(revision, [biweekly]);
    expect(view.status).toBe("path");
    if (view.status !== "path") return;
    const grocery = view.dateGroups.map((group) => {
      const row = group.fundingSlots[0]?.responsibilities.find(
        (item) => item.purposeId === "cat-groceries"
      );
      return row?.amount;
    });
    expect(grocery).toEqual([200, 200, 200]);
  });

  it("C: temporal obligation before next payday appears as context", () => {
    const revision = plan({
      periodKey: "2026-10",
      wealthShare: 0,
      debtShare: 0,
      categories: [
        {
          id: "cat-a",
          categoryName: "A",
          plannedAmount: 600,
          isEssential: true,
        },
      ],
      obligations: [
        obligation({
          id: "obl-internet",
          name: "Internet",
          amount: 80,
          dueDate: "2026-10-08",
        }),
      ],
    });
    const view = composeFundThisMonthView(revision, [biweekly]);
    expect(view.status).toBe("path");
    if (view.status !== "path") return;
    expect(view.dateGroups[0].dueBeforeNextPayday).toEqual([
      expect.objectContaining({
        obligationId: "obl-internet",
        relationship: "due_before_next_payday",
        amount: 80,
      }),
    ]);
  });

  it("D: temporal obligation amount is not included in funding total", () => {
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
      obligations: [
        obligation({
          id: "obl-internet",
          name: "Internet",
          amount: 80,
          dueDate: "2026-10-08",
        }),
      ],
    });
    const view = composeFundThisMonthView(revision, [biweekly]);
    expect(view.status).toBe("path");
    if (view.status !== "path") return;
    expect(view.dateGroups[0].fundingSlots[0].plannedResponsibilityTotal).toBe(
      200 + 100 + 200
    );
    expect(view.dateGroups[0].fundingSlots[0].plannedResponsibilityTotal).not.toBe(
      200 + 100 + 200 + 80
    );
  });

  it("E/F/G: due-on / before-first / after-final placements", () => {
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
      obligations: [
        obligation({
          id: "obl-early",
          name: "Early",
          amount: 10,
          dueDate: "2026-10-01",
        }),
        obligation({
          id: "obl-on",
          name: "On",
          amount: 20,
          dueDate: "2026-10-02",
        }),
        obligation({
          id: "obl-late",
          name: "Late",
          amount: 30,
          dueDate: "2026-10-31",
        }),
      ],
    });
    const view = composeFundThisMonthView(revision, [biweekly]);
    expect(view.status).toBe("path");
    if (view.status !== "path") return;
    expect(view.beforeFirstPayday[0].obligationId).toBe("obl-early");
    expect(view.dateGroups[0].dueOnPayday[0].obligationId).toBe("obl-on");
    expect(view.dateGroups[0].dueOnPayday[0].relationship).toBe("due_on_payday");
    expect(view.afterFinalPayday[0].obligationId).toBe("obl-late");
    expect(
      view.dateGroups[0].fundingSlots.some((slot) =>
        slot.responsibilities.some((row) => row.purposeId === "obl-early")
      )
    ).toBe(false);
  });

  it("H: no schedule produces truthful empty state", () => {
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
    });
    const view = composeFundThisMonthView(revision, []);
    expect(view).toMatchObject({
      status: "no_schedule",
      expectedPaydayCount: 0,
      dateGroups: [],
    });
  });

  it("J: same-date multiple schedules do not duplicate temporal facts", () => {
    const schedules: PaySchedule[] = [
      {
        id: "a",
        cadence: "semimonthly",
        firstDay: 2,
        secondDay: 16,
        createdAt: "2026-01-01",
        label: "A",
      },
      {
        id: "b",
        cadence: "monthly",
        dayOfMonth: 16,
        createdAt: "2026-01-01",
        label: "B",
      },
    ];
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
      obligations: [
        obligation({
          id: "obl-mid",
          name: "Mid",
          amount: 10,
          dueDate: "2026-10-10",
        }),
      ],
    });
    const view = composeFundThisMonthView(revision, schedules);
    expect(view.status).toBe("path");
    if (view.status !== "path") return;
    const oct16 = view.dateGroups.find((group) => group.date === "2026-10-16");
    expect(oct16?.fundingSlots.length).toBeGreaterThan(1);
    expect(oct16?.dueBeforeNextPayday ?? []).toEqual([]);
    const beforeNext = view.dateGroups.flatMap(
      (group) => group.dueBeforeNextPayday
    );
    expect(beforeNext.filter((fact) => fact.obligationId === "obl-mid")).toHaveLength(
      1
    );
  });

  it("K/L/M: Wealth + aggregate Debt appear; no per-creditor funding", () => {
    const revision = plan({
      periodKey: "2026-10",
      wealthShare: 300,
      debtShare: 600,
      categories: [],
      debts: [
        {
          id: "debt-a",
          creditor: "Card A",
          monthlyAllocation: 200,
          remainingDebt: 1000,
        },
      ],
    });
    const view = composeFundThisMonthView(revision, [biweekly]);
    expect(view.status).toBe("path");
    if (view.status !== "path") return;
    const first = view.dateGroups[0].fundingSlots[0].responsibilities;
    expect(
      first.some(
        (row) =>
          row.purposeId === "wealth" &&
          fundingResponsibilityLabel(row) === "Wealth Building"
      )
    ).toBe(true);
    expect(
      first.some(
        (row) =>
          row.purposeId === "debt" && fundingResponsibilityLabel(row) === "Debt Payoff"
      )
    ).toBe(true);
    expect(first.some((row) => row.purposeId === "debt-a")).toBe(false);
  });

  it("Q: composed totals match domain funding output exactly", () => {
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
    const paydays = deriveExpectedPaydaysForSchedules([biweekly], "2026-10");
    const funding = derivePaycheckFundingPlan(revision, paydays);
    const view = composeFundThisMonthView(revision, [biweekly]);
    expect(funding.ok && view.status === "path").toBe(true);
    if (!funding.ok || view.status !== "path") return;
    expect(view.expectedPaydayCount).toBe(funding.plan.fundingOpportunityCount);
    for (let index = 0; index < funding.plan.paydays.length; index += 1) {
      const domain = funding.plan.paydays[index];
      const composed = view.dateGroups
        .flatMap((group) => group.fundingSlots)
        .find(
          (slot) =>
            slot.expectedPayday.scheduleId === domain.expectedPayday.scheduleId &&
            slot.expectedPayday.date === domain.expectedPayday.date
        );
      expect(composed?.responsibilities).toEqual(domain.responsibilities);
    }
  });
});

describe("paycheck planner UI contracts", () => {
  const fundUi = readFileSync("components/babylon/fund-this-month.tsx", "utf8");
  const scheduleUi = readFileSync(
    "components/babylon/expected-pay-schedule-editor.tsx",
    "utf8"
  );
  const panel = readFileSync("components/babylon/monthly-plan-panel.tsx", "utf8");
  const dashboard = readFileSync(
    "components/babylon/wealth-engine-dashboard.tsx",
    "utf8"
  );
  const composer = readFileSync("lib/babylon/paycheck-planner-ui.ts", "utf8");
  const engine = readFileSync("hooks/useBabylonEngine.ts", "utf8");

  it("I: expected payday language does not imply actual income", () => {
    expect(fundUi).toContain("do not count as\n          income until money is actually recorded");
    expect(fundUi).toContain("Expected payday");
    expect(fundUi).toContain("not recorded income");
    expect(fundUi).not.toContain("guaranteed income");
    expect(fundUi).not.toContain("money coming in");
    expect(fundUi).not.toContain("upcoming income");
    expect(scheduleUi).toContain("Expected paydays are not income");
  });

  it("uses domain composers and does not recalculate splits in React", () => {
    expect(fundUi).toContain("composeFundThisMonthView");
    expect(fundUi).not.toContain("splitCentsEarliestRemainder");
    expect(fundUi).not.toContain("derivePaycheckFundingPlan");
    expect(fundUi).not.toContain("derivePaycheckTemporalPlan");
    expect(composer).toContain("derivePaycheckFundingPlan");
    expect(composer).toContain("derivePaycheckTemporalPlan");
    expect(composer).toContain("deriveExpectedPaydaysForSchedules");
  });

  it("presents Fund this month on finalized plans only", () => {
    expect(panel).toContain("FundThisMonthSection");
    expect(panel).toContain("!drafting && latest");
    const finalizedBranch = panel.slice(
      panel.indexOf("{!drafting && latest ? ("),
      panel.indexOf("{!drafting && !latest ? (")
    );
    expect(finalizedBranch).toContain("<RevisionSummary");
    expect(finalizedBranch).toContain("<FundThisMonthSection");
    expect(finalizedBranch.indexOf("<FundThisMonthSection")).toBeGreaterThan(
      finalizedBranch.indexOf("<RevisionSummary")
    );
  });

  it("N/O: schedule authoring mutates paySchedules only via engine", () => {
    expect(dashboard).toContain("paySchedules={engine.paySchedules}");
    expect(dashboard).toContain("onUpsertPaySchedule={engine.upsertPaySchedule}");
    expect(dashboard).toContain("onRemovePaySchedule={engine.removePaySchedule}");
    expect(engine).toContain("upsertPaySchedule");
    expect(engine).toContain("removePaySchedule");
    expect(engine).toContain("parsePaySchedule");
    expect(engine).toContain("setPaySchedules");
    const upsertBlock = engine.slice(
      engine.indexOf("const upsertPaySchedule"),
      engine.indexOf("const removePaySchedule")
    );
    expect(upsertBlock).not.toContain("setIncomes");
    expect(upsertBlock).not.toContain("setAllocations");
    expect(upsertBlock).not.toContain("setAccounts");
    expect(upsertBlock).not.toContain("setMonthlyPlans");
    expect(fundUi).not.toContain("addIncome");
    expect(fundUi).not.toContain("executePaycheckSplit");
    expect(fundUi).not.toContain("funded");
    expect(fundUi).not.toContain("paid");
    expect(fundUi).not.toContain("received");
    expect(fundUi).not.toContain("transferred");
    expect(fundUi).not.toContain("completed");
  });

  it("P: shared panel serves desktop and phone (no separate funding tree)", () => {
    expect(dashboard).toContain("paySchedules={engine.paySchedules}");
    expect(dashboard.match(/<MonthlyPlanPanel/g)).toHaveLength(1);
    expect(fundUi).toContain("space-y-4");
    expect(fundUi).toContain("sm:p-4");
  });

  it("keeps backup v10 / schema 6 / IC v3", () => {
    expect(LEDGER_BACKUP_VERSION).toBe(10);
    expect(CLOUD_VAULT_SCHEMA_VERSION).toBe(6);
    expect(INTELLIGENCE_CONTRACT_VERSION).toBe("3");
    expect(EMPTY_STATE.paySchedules).toEqual([]);
    expect(allocateIncome(3000, true).wealthShare).toBe(300);
  });
});
