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
import { derivePaycheckFundingPlan } from "@/lib/babylon/paycheck-funding";
import {
  derivePaycheckTemporalPlan,
  uniqueCivilPaydayDates,
} from "@/lib/babylon/paycheck-temporal";
import { LEDGER_BACKUP_VERSION } from "@/lib/babylon/persistence";
import { totalProtectedMoney } from "@/lib/babylon/protected-money";
import type {
  ExpectedPayday,
  MonthlyPlanObligationEvidence,
  MonthlyPlanRevision,
} from "@/types/babylon";

function plan(
  partial: Partial<MonthlyPlanRevision> &
    Pick<MonthlyPlanRevision, "periodKey" | "obligations">
): MonthlyPlanRevision {
  return {
    id: partial.id ?? "plan-rev-1",
    periodKey: partial.periodKey,
    revision: partial.revision ?? 1,
    finalizedAt: partial.finalizedAt ?? "2026-10-01T12:00:00.000Z",
    supersedesId: partial.supersedesId ?? null,
    planningBasis: partial.planningBasis ?? 3000,
    wealthShare: partial.wealthShare ?? 300,
    debtShare: partial.debtShare ?? 600,
    expenditureShare: partial.expenditureShare ?? 2100,
    debtRedirected: partial.debtRedirected ?? false,
    categories: partial.categories ?? [
      {
        id: "cat-groceries",
        categoryName: "Groceries",
        plannedAmount: 600,
        isEssential: true,
      },
    ],
    debts: partial.debts ?? [],
    obligations: partial.obligations,
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

const OCT_PAYDAYS = [
  payday({ date: "2026-10-02" }),
  payday({ date: "2026-10-16" }),
  payday({ date: "2026-10-30" }),
];

describe("uniqueCivilPaydayDates", () => {
  it("collapses same-date funding opportunities to one civil moment", () => {
    expect(
      uniqueCivilPaydayDates([
        payday({ date: "2026-10-16", scheduleId: "a" }),
        payday({ date: "2026-10-02", scheduleId: "a" }),
        payday({ date: "2026-10-16", scheduleId: "b" }),
      ])
    ).toEqual(["2026-10-02", "2026-10-16"]);
  });
});

describe("derivePaycheckTemporalPlan", () => {
  it("A: Internet due Oct 8 belongs to Oct 2→16 before-next window", () => {
    const revision = plan({
      periodKey: "2026-10",
      obligations: [
        obligation({
          id: "obl-internet",
          name: "Internet",
          amount: 80,
          dueDate: "2026-10-08",
        }),
      ],
    });
    const result = derivePaycheckTemporalPlan(revision, OCT_PAYDAYS);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.plan.windows[0]).toMatchObject({
      paydayDate: "2026-10-02",
      nextPaydayDate: "2026-10-16",
    });
    expect(result.plan.windows[0].obligationsDueBeforeNextPayday).toEqual([
      expect.objectContaining({
        obligationId: "obl-internet",
        amount: 80,
        dueDate: "2026-10-08",
        relationship: "due_before_next_payday",
        paydayDate: "2026-10-02",
        nextPaydayDate: "2026-10-16",
      }),
    ]);
  });

  it("B: Electricity due Oct 20 belongs to Oct 16→30 window", () => {
    const revision = plan({
      periodKey: "2026-10",
      obligations: [
        obligation({
          id: "obl-electric",
          name: "Electricity",
          amount: 150,
          dueDate: "2026-10-20",
        }),
      ],
    });
    const result = derivePaycheckTemporalPlan(revision, OCT_PAYDAYS);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.plan.windows[1].obligationsDueBeforeNextPayday).toEqual([
      expect.objectContaining({
        obligationId: "obl-electric",
        dueDate: "2026-10-20",
        relationship: "due_before_next_payday",
        paydayDate: "2026-10-16",
        nextPaydayDate: "2026-10-30",
      }),
    ]);
  });

  it("C: due exactly Oct 16 is due_on_payday (payday coincidence elevated)", () => {
    const revision = plan({
      periodKey: "2026-10",
      obligations: [
        obligation({
          id: "obl-mid",
          name: "Mid",
          amount: 40,
          dueDate: "2026-10-16",
        }),
      ],
    });
    const result = derivePaycheckTemporalPlan(revision, OCT_PAYDAYS);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.plan.windows[0].obligationsDueBeforeNextPayday).toEqual([]);
    expect(result.plan.windows[1].obligationsDueOnPayday).toEqual([
      expect.objectContaining({
        obligationId: "obl-mid",
        relationship: "due_on_payday",
        paydayDate: "2026-10-16",
      }),
    ]);
  });

  it("D: due exactly current payday is due_on_payday, not before-next", () => {
    const revision = plan({
      periodKey: "2026-10",
      obligations: [
        obligation({
          id: "obl-first",
          name: "First",
          amount: 10,
          dueDate: "2026-10-02",
        }),
      ],
    });
    const result = derivePaycheckTemporalPlan(revision, OCT_PAYDAYS);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.plan.windows[0].obligationsDueOnPayday).toEqual([
      expect.objectContaining({
        obligationId: "obl-first",
        relationship: "due_on_payday",
        paydayDate: "2026-10-02",
      }),
    ]);
    expect(result.plan.windows[0].obligationsDueBeforeNextPayday).toEqual([]);
    expect(result.plan.obligationsDueBeforeFirstPayday).toEqual([]);
  });

  it("E: obligation before first payday is due_before_first_payday", () => {
    const revision = plan({
      periodKey: "2026-10",
      obligations: [
        obligation({
          id: "obl-early",
          name: "Internet",
          amount: 80,
          dueDate: "2026-10-01",
        }),
      ],
    });
    const result = derivePaycheckTemporalPlan(revision, OCT_PAYDAYS);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.plan.obligationsDueBeforeFirstPayday).toEqual([
      expect.objectContaining({
        obligationId: "obl-early",
        relationship: "due_before_first_payday",
        dueDate: "2026-10-01",
      }),
    ]);
    expect(
      result.plan.windows.every(
        (window) =>
          window.obligationsDueOnPayday.length === 0 &&
          window.obligationsDueBeforeNextPayday.length === 0
      )
    ).toBe(true);
  });

  it("F: obligation after final payday is due_after_final_payday", () => {
    const revision = plan({
      periodKey: "2026-10",
      obligations: [
        obligation({
          id: "obl-late",
          name: "Late bill",
          amount: 25,
          dueDate: "2026-10-31",
        }),
      ],
    });
    const result = derivePaycheckTemporalPlan(revision, OCT_PAYDAYS);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.plan.obligationsDueAfterFinalPayday).toEqual([
      expect.objectContaining({
        obligationId: "obl-late",
        relationship: "due_after_final_payday",
        dueDate: "2026-10-31",
      }),
    ]);
    expect(result.plan.windows[2].nextPaydayDate).toBeNull();
    expect(result.plan.windows[2].obligationsDueBeforeNextPayday).toEqual([]);
  });

  it("G: zero paydays → no fabricated windows", () => {
    const revision = plan({
      periodKey: "2026-10",
      obligations: [
        obligation({
          id: "obl-a",
          name: "A",
          amount: 10,
          dueDate: "2026-10-08",
        }),
      ],
    });
    const result = derivePaycheckTemporalPlan(revision, []);
    expect(result).toEqual({
      ok: true,
      plan: {
        periodKey: "2026-10",
        monthlyPlanRevisionId: "plan-rev-1",
        status: "no_expected_funding",
        uniquePaydayDates: [],
        obligationsDueBeforeFirstPayday: [],
        windows: [],
        obligationsDueAfterFinalPayday: [],
      },
    });
  });

  it("H: one payday → no fabricated next; before/on/after still classify", () => {
    const revision = plan({
      periodKey: "2026-10",
      obligations: [
        obligation({
          id: "obl-before",
          name: "Before",
          amount: 1,
          dueDate: "2026-10-01",
        }),
        obligation({
          id: "obl-on",
          name: "On",
          amount: 2,
          dueDate: "2026-10-15",
        }),
        obligation({
          id: "obl-after",
          name: "After",
          amount: 3,
          dueDate: "2026-10-20",
        }),
      ],
    });
    const result = derivePaycheckTemporalPlan(revision, [
      payday({ date: "2026-10-15" }),
    ]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.plan.windows).toHaveLength(1);
    expect(result.plan.windows[0].nextPaydayDate).toBeNull();
    expect(result.plan.windows[0].obligationsDueBeforeNextPayday).toEqual([]);
    expect(result.plan.obligationsDueBeforeFirstPayday[0].obligationId).toBe(
      "obl-before"
    );
    expect(result.plan.windows[0].obligationsDueOnPayday[0].obligationId).toBe(
      "obl-on"
    );
    expect(result.plan.obligationsDueAfterFinalPayday[0].obligationId).toBe(
      "obl-after"
    );
  });

  it("I: same-date paydays from distinct schedules → one civil window", () => {
    const revision = plan({
      periodKey: "2026-10",
      obligations: [
        obligation({
          id: "obl-mid",
          name: "Mid",
          amount: 10,
          dueDate: "2026-10-10",
        }),
      ],
    });
    const result = derivePaycheckTemporalPlan(revision, [
      payday({ date: "2026-10-02", scheduleId: "a" }),
      payday({ date: "2026-10-16", scheduleId: "a" }),
      payday({ date: "2026-10-16", scheduleId: "b" }),
    ]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.plan.uniquePaydayDates).toEqual(["2026-10-02", "2026-10-16"]);
    expect(result.plan.windows).toHaveLength(2);
    expect(result.plan.windows[1].paydayOccurrences).toHaveLength(2);
    expect(result.plan.windows[0].nextPaydayDate).toBe("2026-10-16");
    expect(result.plan.windows[0].obligationsDueBeforeNextPayday).toHaveLength(1);
  });

  it("J: foreign-period payday fails safely", () => {
    const revision = plan({
      periodKey: "2026-10",
      obligations: [],
    });
    const result = derivePaycheckTemporalPlan(revision, [
      payday({ date: "2026-10-02" }),
      payday({ date: "2026-11-01", periodKey: "2026-11" }),
    ]);
    expect(result).toMatchObject({
      ok: false,
      reason: "foreign_period_payday",
    });
  });

  it("K: multiple obligations in same interval, due-date ordered", () => {
    const revision = plan({
      periodKey: "2026-10",
      obligations: [
        obligation({
          id: "obl-b",
          name: "B",
          amount: 20,
          dueDate: "2026-10-12",
        }),
        obligation({
          id: "obl-a",
          name: "A",
          amount: 10,
          dueDate: "2026-10-05",
        }),
      ],
    });
    const result = derivePaycheckTemporalPlan(revision, OCT_PAYDAYS);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(
      result.plan.windows[0].obligationsDueBeforeNextPayday.map((f) => f.obligationId)
    ).toEqual(["obl-a", "obl-b"]);
  });

  it("L: same due date uses stable obligationId ordering", () => {
    const revision = plan({
      periodKey: "2026-10",
      obligations: [
        obligation({
          id: "obl-z",
          name: "Z",
          amount: 1,
          dueDate: "2026-10-08",
        }),
        obligation({
          id: "obl-a",
          name: "A",
          amount: 2,
          dueDate: "2026-10-08",
        }),
      ],
    });
    const result = derivePaycheckTemporalPlan(revision, OCT_PAYDAYS);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(
      result.plan.windows[0].obligationsDueBeforeNextPayday.map((f) => f.obligationId)
    ).toEqual(["obl-a", "obl-z"]);
  });

  it("M: Need/Want does not change classification", () => {
    const needPlan = plan({
      periodKey: "2026-10",
      obligations: [
        obligation({
          id: "obl-x",
          name: "X",
          amount: 50,
          dueDate: "2026-10-08",
          category: "need",
        }),
      ],
    });
    const desirePlan = plan({
      periodKey: "2026-10",
      obligations: [
        obligation({
          id: "obl-x",
          name: "X",
          amount: 50,
          dueDate: "2026-10-08",
          category: "desire",
        }),
      ],
    });
    const need = derivePaycheckTemporalPlan(needPlan, OCT_PAYDAYS);
    const desire = derivePaycheckTemporalPlan(desirePlan, OCT_PAYDAYS);
    expect(need.ok && desire.ok).toBe(true);
    if (!need.ok || !desire.ok) return;
    expect(need.plan.windows[0].obligationsDueBeforeNextPayday[0].relationship).toBe(
      desire.plan.windows[0].obligationsDueBeforeNextPayday[0].relationship
    );
    expect(need.plan.windows[0].obligationsDueBeforeNextPayday[0].category).toBe(
      "need"
    );
    expect(desire.plan.windows[0].obligationsDueBeforeNextPayday[0].category).toBe(
      "desire"
    );
  });

  it("N: amount does not change classification", () => {
    const small = derivePaycheckTemporalPlan(
      plan({
        periodKey: "2026-10",
        obligations: [
          obligation({
            id: "obl-x",
            name: "X",
            amount: 1,
            dueDate: "2026-10-08",
          }),
        ],
      }),
      OCT_PAYDAYS
    );
    const large = derivePaycheckTemporalPlan(
      plan({
        periodKey: "2026-10",
        obligations: [
          obligation({
            id: "obl-x",
            name: "X",
            amount: 9999,
            dueDate: "2026-10-08",
          }),
        ],
      }),
      OCT_PAYDAYS
    );
    expect(small.ok && large.ok).toBe(true);
    if (!small.ok || !large.ok) return;
    expect(small.plan.windows[0].obligationsDueBeforeNextPayday[0].relationship).toBe(
      "due_before_next_payday"
    );
    expect(large.plan.windows[0].obligationsDueBeforeNextPayday[0].relationship).toBe(
      "due_before_next_payday"
    );
  });

  it("O: funding responsibility amounts unchanged by temporal derivation", () => {
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
    const fundingBefore = derivePaycheckFundingPlan(revision, OCT_PAYDAYS);
    expect(fundingBefore.ok).toBe(true);
    const fundingSnapshot = structuredClone(fundingBefore);

    const temporal = derivePaycheckTemporalPlan(revision, OCT_PAYDAYS);
    expect(temporal.ok).toBe(true);

    const fundingAfter = derivePaycheckFundingPlan(revision, OCT_PAYDAYS);
    expect(fundingAfter).toEqual(fundingBefore);
    expect(fundingBefore).toEqual(fundingSnapshot);
    if (!fundingAfter.ok) return;
    const grocery = fundingAfter.plan.paydays.map(
      (slot) =>
        slot.responsibilities.find((row) => row.purposeId === "cat-groceries")
          ?.amount
    );
    expect(grocery).toEqual([200, 200, 200]);
  });

  it("P: inputs remain unchanged after derivation", () => {
    const revision = plan({
      periodKey: "2026-10",
      obligations: [
        obligation({
          id: "obl-internet",
          name: "Internet",
          amount: 80,
          dueDate: "2026-10-08",
          category: "need",
        }),
        obligation({
          id: "obl-fun",
          name: "Fun",
          amount: 40,
          dueDate: "2026-10-20",
          category: "desire",
        }),
      ],
    });
    const paydays = [
      payday({ date: "2026-10-30", expectedAmount: 111 }),
      payday({ date: "2026-10-02", expectedAmount: 222 }),
      payday({ date: "2026-10-16" }),
    ];
    const planBefore = structuredClone(revision);
    const paydaysBefore = structuredClone(paydays);
    const result = derivePaycheckTemporalPlan(revision, paydays);
    expect(result.ok).toBe(true);
    expect(revision).toEqual(planBefore);
    expect(paydays).toEqual(paydaysBefore);
  });

  it("rejects foreign-period obligation due dates", () => {
    const revision = plan({
      periodKey: "2026-10",
      obligations: [
        {
          id: "obl-x",
          name: "X",
          amount: 10,
          category: "need",
          budgetCategoryId: "cat",
          dueDay: 1,
          intervalMonths: 1,
          dueDate: "2026-11-01",
        },
      ],
    });
    const result = derivePaycheckTemporalPlan(revision, OCT_PAYDAYS);
    expect(result).toMatchObject({
      ok: false,
      reason: "foreign_period_obligation",
    });
  });

  it("expectedAmount differences do not alter temporal classification", () => {
    const revision = plan({
      periodKey: "2026-10",
      obligations: [
        obligation({
          id: "obl-x",
          name: "X",
          amount: 10,
          dueDate: "2026-10-08",
        }),
      ],
    });
    const a = derivePaycheckTemporalPlan(revision, [
      payday({ date: "2026-10-02", expectedAmount: 50 }),
      payday({ date: "2026-10-16", expectedAmount: 5000 }),
      payday({ date: "2026-10-30" }),
    ]);
    const b = derivePaycheckTemporalPlan(revision, OCT_PAYDAYS);
    expect(a.ok && b.ok).toBe(true);
    if (!a.ok || !b.ok) return;
    expect(a.plan.windows[0].obligationsDueBeforeNextPayday).toEqual(
      b.plan.windows[0].obligationsDueBeforeNextPayday
    );
  });
});

describe("paycheck temporal isolation", () => {
  it("does not create Income/Allocation or mutate position / funding", () => {
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
    const revision = plan({
      periodKey: "2026-10",
      obligations: [
        obligation({
          id: "obl-internet",
          name: "Internet",
          amount: 80,
          dueDate: "2026-10-08",
        }),
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

    const incomesBefore = EMPTY_STATE.incomes.length;
    const allocationsBefore = EMPTY_STATE.allocations.length;
    const attributionsBefore = EMPTY_STATE.debtPurposeAttributions.length;
    const accountsBefore = structuredClone(accounts);
    const revisionBefore = structuredClone(revision);
    const paydaysBefore = structuredClone(OCT_PAYDAYS);
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
    const fundingBefore = derivePaycheckFundingPlan(revision, OCT_PAYDAYS);

    const temporal = derivePaycheckTemporalPlan(revision, OCT_PAYDAYS);
    expect(temporal.ok).toBe(true);

    expect(EMPTY_STATE.incomes).toHaveLength(incomesBefore);
    expect(EMPTY_STATE.allocations).toHaveLength(allocationsBefore);
    expect(EMPTY_STATE.debtPurposeAttributions).toHaveLength(attributionsBefore);
    expect(accounts).toEqual(accountsBefore);
    expect(revision).toEqual(revisionBefore);
    expect(OCT_PAYDAYS).toEqual(paydaysBefore);
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
    expect(derivePaycheckFundingPlan(revision, OCT_PAYDAYS)).toEqual(fundingBefore);
    expect(revision.debts[0].remainingDebt).toBe(1500);
    expect(LEDGER_BACKUP_VERSION).toBe(12);
    expect(CLOUD_VAULT_SCHEMA_VERSION).toBe(6);
    expect(INTELLIGENCE_CONTRACT_VERSION).toBe("4");
  });
});
