import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { operationalMoneyAvailable } from "@/lib/babylon/balance-evidence-load";
import { NAV_ITEMS } from "@/lib/babylon/constants";
import { EMPTY_STATE } from "@/lib/babylon/constants";
import { allocateIncome } from "@/lib/babylon/engine";
import { MOBILE_NAV_ITEMS } from "@/lib/babylon/constants";
import {
  finalizeMonthlyPlanOnState,
  monthlyPlanCents,
  previewMonthlyPlan,
  seedMonthlyPlanFromRevision,
  seedMonthlyPlanFromTargets,
  type MonthlyPlanPreviewInput,
} from "@/lib/babylon/monthly-plan";
import { buildRecurringObligation } from "@/lib/babylon/recurring-obligations";
import type {
  AllocationEvent,
  BudgetTarget,
  DebtEntry,
  FinancialAccount,
  IncomeEntry,
  MonthlyPlanCategoryPurpose,
  PersistedState,
  RecurringObligation,
} from "@/types/babylon";

function debt(partial: Partial<DebtEntry> = {}): DebtEntry {
  return {
    id: "debt-card",
    creditor: "Card",
    totalDebt: 800,
    remainingDebt: 500,
    monthlyAllocation: 40,
    createdAt: "2026-01-01",
    interestRate: 12,
    ...partial,
  };
}

function target(partial: Partial<BudgetTarget> = {}): BudgetTarget {
  return {
    id: partial.id ?? "rent",
    categoryName: partial.categoryName ?? "Rent",
    plannedAmount: partial.plannedAmount ?? 400,
    isEssential: partial.isEssential ?? true,
  };
}

function purpose(
  plannedAmount: number,
  partial: Partial<MonthlyPlanCategoryPurpose> = {}
): MonthlyPlanCategoryPurpose {
  return {
    id: partial.id ?? "rent",
    categoryName: partial.categoryName ?? "Rent",
    plannedAmount,
    isEssential: partial.isEssential ?? true,
  };
}

function rule(
  partial: Partial<RecurringObligation> & { firstDueDate?: string } = {}
): RecurringObligation {
  const built = buildRecurringObligation(
    {
      name: partial.name ?? "Phone",
      amount: partial.amount ?? 50,
      category: partial.category ?? "need",
      budgetCategoryId: partial.budgetCategoryId ?? "rent",
      firstDueDate: partial.firstDueDate ?? "2026-10-15",
      intervalMonths: partial.intervalMonths,
    },
    partial.id ?? "rule-phone",
    partial.createdAt ?? "2026-09-01"
  );
  if (!built) throw new Error("rule");
  return {
    ...built,
    isActive: partial.isActive ?? true,
    skippedMonths: partial.skippedMonths ?? [],
  };
}

function preview(
  partial: Partial<MonthlyPlanPreviewInput> = {}
): ReturnType<typeof previewMonthlyPlan> {
  const planningBasis = partial.planningBasis ?? 1000;
  const debts = partial.debts ?? [debt()];
  const active = debts.some((row) => row.remainingDebt > 0);
  const living = allocateIncome(planningBasis, active).expenditureShare;
  return previewMonthlyPlan({
    periodKey: partial.periodKey ?? "2026-10",
    planningBasis,
    debts,
    obligations: partial.obligations ?? [],
    categories: partial.categories ?? [purpose(living)],
  });
}

function income(): IncomeEntry {
  return {
    id: "income-1",
    source: "Wages",
    amount: 1000,
    date: "2026-10-01",
    interval: "monthly",
    kind: "primary",
    wealthShare: 100,
    debtShare: 200,
    expenditureShare: 700,
    debtRedirected: false,
  };
}

function allocation(): AllocationEvent {
  return {
    id: "alloc-1",
    incomeId: "income-1",
    date: "2026-10-01",
    monthKey: "2026-10",
    gross: 1000,
    wealth: 100,
    debt: 200,
    expenditure: 700,
  };
}

function account(): FinancialAccount {
  return {
    id: "checking",
    name: "Checking",
    kind: "checking",
    balance: 2500,
    asOf: "2026-10-01",
  };
}

function vault(partial: Partial<PersistedState> = {}): PersistedState {
  return { ...EMPTY_STATE, ...partial };
}

describe("monthly plan draft seed", () => {
  it("seeds a first plan from live category rows", () => {
    const targets = [
      target({ id: "rent", categoryName: "Rent", plannedAmount: 400, isEssential: true }),
      target({
        id: "fun",
        categoryName: "Fun",
        plannedAmount: 80,
        isEssential: false,
      }),
    ];
    expect(seedMonthlyPlanFromTargets(targets)).toEqual([
      purpose(400, { id: "rent", categoryName: "Rent", isEssential: true }),
      purpose(80, { id: "fun", categoryName: "Fun", isEssential: false }),
    ]);
  });

  it("copies category rows so opening a draft leaves BudgetTargets unchanged", () => {
    const targets = [target({ plannedAmount: 400 })];
    const draft = seedMonthlyPlanFromTargets(targets);
    expect(draft[0]).not.toBe(targets[0]);
    expect(targets[0]).toEqual(target({ plannedAmount: 400 }));
  });

  it("keeps live caps unchanged when a draft amount is edited", () => {
    const targets = [target({ plannedAmount: 400 })];
    const draft = seedMonthlyPlanFromTargets(targets);
    draft[0].plannedAmount = 125;
    expect(targets[0].plannedAmount).toBe(400);
  });

  it("leaves the vault unchanged when a draft is discarded", () => {
    const state = vault({
      budgetTargets: [target()],
      debts: [debt()],
      incomes: [income()],
      allocations: [allocation()],
      accounts: [account()],
      openingWealthBuilding: 80,
      openingEmergencyFund: 20,
    });
    const before = structuredClone(state);
    const draft = seedMonthlyPlanFromTargets(state.budgetTargets);
    draft[0].plannedAmount = 1;
    preview({
      categories: draft,
      debts: state.debts,
      planningBasis: 1000,
    });
    expect(state).toEqual(before);
  });

  it("seeds a revision from the latest intention when live caps have drifted", () => {
    const targets = [target({ plannedAmount: 700, categoryName: "Rent" })];
    const state = vault({
      budgetTargets: targets,
      debts: [debt()],
    });
    const first = finalizeMonthlyPlanOnState(state, {
      id: "plan-1",
      periodKey: "2026-11",
      finalizedAt: "2026-10-01T15:00:00.000Z",
      planningBasis: 1000,
      categories: [purpose(700, { categoryName: "Rent" })],
    });
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    const drifted = {
      ...first.state,
      budgetTargets: [{ ...targets[0], plannedAmount: 5, categoryName: "Rent now" }],
    };
    const seed = seedMonthlyPlanFromRevision(first.revision);
    expect(seed.planningBasis).toBe(1000);
    expect(seed.categories).toEqual([
      purpose(700, { categoryName: "Rent" }),
    ]);
    expect(drifted.budgetTargets[0].plannedAmount).toBe(5);
    expect(seed.categories[0]).not.toBe(drifted.budgetTargets[0]);
  });
});

describe("monthly plan preview", () => {
  it("matches allocateIncome for an active debt and for the debt-free redirect", () => {
    const active = preview({ planningBasis: 1000, debts: [debt()] });
    expect(active.split).toEqual(allocateIncome(1000, true));
    expect(active.split?.debtRedirected).toBe(false);
    expect(active.split).toMatchObject({
      wealthShare: 100,
      debtShare: 200,
      expenditureShare: 700,
    });

    const clear = preview({
      planningBasis: 1000,
      debts: [debt({ remainingDebt: 0, monthlyAllocation: 0 })],
      categories: [purpose(700)],
    });
    expect(clear.split).toEqual(allocateIncome(1000, false));
    expect(clear.split?.debtRedirected).toBe(true);
    expect(clear.split).toMatchObject({
      wealthShare: 300,
      debtShare: 0,
      expenditureShare: 700,
    });
  });

  it("measures assigned and remaining in the same cents finalization uses", () => {
    const under = preview({ categories: [purpose(699.99)] });
    const over = preview({ categories: [purpose(700.01)] });
    const exact = preview({
      categories: [
        purpose(400, { id: "rent", categoryName: "Rent" }),
        purpose(300, { id: "food", categoryName: "Groceries", isEssential: false }),
      ],
    });
    expect(under.assignedCents).toBe(monthlyPlanCents(699.99));
    expect(under.livingCents).toBe(70000);
    expect(under.remainingCents).toBe(1);
    expect(under.canFinalize).toBe(false);
    expect(under.assignmentMessage).toBe(
      "Planned purposes total 699.99. The Living Budget share is 700.00."
    );
    expect(over.remainingCents).toBe(-1);
    expect(over.canFinalize).toBe(false);
    expect(over.assignmentMessage).toBe(
      "Planned purposes total 700.01. The Living Budget share is 700.00."
    );
    expect(exact.remainingCents).toBe(0);
    expect(exact.canFinalize).toBe(true);
    expect(exact.assignmentMessage).toBeNull();
  });

  it("blocks when debt minimums exceed the debt share, including a zero balance", () => {
    const debts = [
      debt({
        id: "old",
        creditor: "Old card",
        remainingDebt: 0,
        monthlyAllocation: 50,
      }),
      debt({
        id: "live",
        creditor: "Card",
        remainingDebt: 400,
        monthlyAllocation: 160,
      }),
    ];
    const picture = preview({ debts, categories: [purpose(700)] });
    expect(picture.debtMinimumCents).toBe(21000);
    expect(picture.debtShareCents).toBe(20000);
    expect(picture.canFinalize).toBe(false);
    expect(picture.debtMessage).toBe(
      "Debt minimums total 210.00. The Debt share is 200.00."
    );
    const withoutZeroBalance = preview({
      debts: [debts[1]],
      categories: [purpose(700)],
    });
    expect(withoutZeroBalance.debtMinimumCents).toBe(16000);
    expect(withoutZeroBalance.canFinalize).toBe(true);
  });

  it("snapshots only rules that finalization would copy for the selected period", () => {
    const due = rule({ id: "phone", name: "Phone", amount: 50 });
    const skipped = rule({
      id: "skipped",
      name: "Skipped",
      skippedMonths: ["2026-10"],
    });
    const inactive = rule({ id: "paused", name: "Paused", isActive: false });
    const later = rule({
      id: "quarterly",
      name: "Insurance",
      firstDueDate: "2026-05-15",
      intervalMonths: 3,
      budgetCategoryId: "rent",
    });
    const selected = preview({
      periodKey: "2026-10",
      obligations: [due, skipped, inactive, later],
      categories: [purpose(700)],
    });
    expect(selected.obligations.map((item) => item.id)).toEqual(["phone"]);
    expect(selected.obligations[0]).toMatchObject({
      name: "Phone",
      amount: 50,
      budgetCategoryId: "rent",
      dueDate: "2026-10-15",
      intervalMonths: 1,
    });

    const may = preview({
      periodKey: "2026-05",
      obligations: [later],
      categories: [purpose(700)],
    });
    expect(may.obligations.map((item) => item.name)).toEqual(["Insurance"]);
  });

  it("does not add due bills to the Living share or block a smaller purpose", () => {
    const quiet = preview({ obligations: [], categories: [purpose(700)] });
    const billed = preview({
      obligations: [rule({ amount: 900, budgetCategoryId: "rent" })],
      categories: [purpose(700)],
    });
    expect(billed.assignedCents).toBe(quiet.assignedCents);
    expect(billed.remainingCents).toBe(quiet.remainingCents);
    expect(billed.livingCents).toBe(quiet.livingCents);
    expect(billed.canFinalize).toBe(true);
    expect(billed.obligationCentsByCategoryId.rent).toBe(90000);
    expect(billed.obligationCentsByCategoryId.rent).toBeGreaterThan(
      monthlyPlanCents(700)
    );
  });

  it("keeps Protected Money out of the Planning Basis and the Living share", () => {
    const picture = preview({ planningBasis: 1000, categories: [purpose(700)] });
    expect(picture.split?.expenditureShare).toBe(
      allocateIncome(1000, true).expenditureShare
    );
    expect(picture).not.toHaveProperty("openingWealthBuilding");
    expect(picture).not.toHaveProperty("protectedContext");
    const finalized = finalizeMonthlyPlanOnState(
      vault({
        debts: [debt()],
        openingWealthBuilding: 5000,
        openingEmergencyFund: 2000,
      }),
      {
        id: "plan-protected",
        periodKey: "2026-10",
        finalizedAt: "2026-10-01T15:00:00.000Z",
        planningBasis: 1000,
        categories: [purpose(700)],
      }
    );
    expect(finalized.ok).toBe(true);
    if (!finalized.ok) return;
    expect(finalized.revision.planningBasis).toBe(1000);
    expect(finalized.revision.expenditureShare).toBe(picture.split?.expenditureShare);
    expect(finalized.revision.protectedContext).toEqual({
      openingWealthBuilding: 5000,
      openingEmergencyFund: 2000,
    });
    expect(finalized.state.openingWealthBuilding).toBe(5000);
  });
});

describe("monthly plan finalization boundary", () => {
  it("appends revision 1 for the selected period and leaves financial reality in place", () => {
    const targets = [target({ plannedAmount: 400 })];
    const state = vault({
      budgetTargets: targets,
      debts: [debt()],
      incomes: [income()],
      allocations: [allocation()],
      accounts: [account()],
      recurringObligations: [rule()],
      openingWealthBuilding: 80,
      openingEmergencyFund: 20,
    });
    const availableBefore = operationalMoneyAvailable({
      accounts: state.accounts,
      load: undefined,
    });
    const result = finalizeMonthlyPlanOnState(state, {
      id: "plan-1",
      periodKey: "2027-02",
      finalizedAt: "2026-10-01T15:00:00.000Z",
      planningBasis: 1000,
      categories: [purpose(700)],
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.revision.revision).toBe(1);
    expect(result.revision.periodKey).toBe("2027-02");
    expect(result.revision.supersedesId).toBeNull();
    expect(result.state.budgetTargets).toBe(state.budgetTargets);
    expect(result.state.budgetTargets).toEqual(targets);
    expect(result.state.incomes).toBe(state.incomes);
    expect(result.state.allocations).toBe(state.allocations);
    expect(result.state.accounts).toBe(state.accounts);
    expect(result.state.debts).toBe(state.debts);
    expect(result.state.recurringObligations).toBe(state.recurringObligations);
    expect(
      operationalMoneyAvailable({
        accounts: result.state.accounts,
        load: undefined,
      })
    ).toBe(availableBefore);
    expect(result.state.monthlyPlans).toEqual([result.revision]);
  });

  it("appends revision 2 and keeps revision 1", () => {
    const state = vault({
      budgetTargets: [target({ plannedAmount: 5, categoryName: "Rent now" })],
      debts: [debt()],
    });
    const first = finalizeMonthlyPlanOnState(state, {
      id: "plan-1",
      periodKey: "2026-11",
      finalizedAt: "2026-10-01T15:00:00.000Z",
      planningBasis: 1000,
      categories: [purpose(700, { categoryName: "Rent" })],
    });
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    const seed = seedMonthlyPlanFromRevision(first.revision);
    const second = finalizeMonthlyPlanOnState(
      {
        ...first.state,
        budgetTargets: [{ ...state.budgetTargets[0], plannedAmount: 9 }],
      },
      {
        id: "plan-2",
        periodKey: "2026-11",
        finalizedAt: "2026-10-08T15:00:00.000Z",
        planningBasis: seed.planningBasis,
        categories: seed.categories.map((category) =>
          category.id === "rent" ? { ...category, plannedAmount: 700 } : category
        ),
      }
    );
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    expect(second.revision.revision).toBe(2);
    expect(second.revision.supersedesId).toBe("plan-1");
    expect(second.revision.periodKey).toBe("2026-11");
    expect(second.state.monthlyPlans[0]).toEqual(first.revision);
    expect(second.state.monthlyPlans).toHaveLength(2);
    expect(second.state.budgetTargets[0].plannedAmount).toBe(9);
    expect(first.revision.categories[0].plannedAmount).toBe(700);
  });
});

describe("monthly plan placement", () => {
  const dashboard = readFileSync(
    "components/babylon/wealth-engine-dashboard.tsx",
    "utf8"
  );
  const panel = readFileSync(
    "components/babylon/monthly-plan-panel.tsx",
    "utf8"
  );
  const budget = readFileSync("components/babylon/mobile-budget.tsx", "utf8");
  const home = readFileSync("components/babylon/mobile-home.tsx", "utf8");
  const more = readFileSync("components/babylon/mobile-more.tsx", "utf8");
  const ledger = readFileSync("components/babylon/mobile-ledger.tsx", "utf8");
  const blueprint = readFileSync(
    "components/dashboard/BudgetBlueprint.tsx",
    "utf8"
  );
  const domain = readFileSync("lib/babylon/monthly-plan.ts", "utf8");

  const overview = dashboard.slice(
    dashboard.indexOf("{showOverview && ("),
    dashboard.indexOf("{showLedgers && (")
  );
  const ledgers = dashboard.slice(dashboard.indexOf("{showLedgers && ("));
  const phoneHome = dashboard.slice(
    dashboard.indexOf('mobileDestination === "home"'),
    dashboard.indexOf('mobileDestination === "budget"')
  );
  const phoneBudget = dashboard.slice(
    dashboard.indexOf('mobileDestination === "budget"'),
    dashboard.indexOf('mobileDestination === "ledger"')
  );
  const phoneLedger = dashboard.slice(
    dashboard.indexOf('mobileDestination === "ledger"'),
    dashboard.indexOf('mobileDestination === "more"')
  );
  const moreAt = dashboard.indexOf('mobileDestination === "more"');
  const phoneMore = dashboard.slice(
    moreAt,
    dashboard.indexOf("{desktopLayout && (", moreAt)
  );
  const planElement = dashboard.slice(
    dashboard.indexOf("const monthlyPlan"),
    dashboard.indexOf("const budgetBlueprint")
  );
  const blueprintElement = dashboard.slice(
    dashboard.indexOf("const budgetBlueprint"),
    dashboard.indexOf("const ledgers")
  );

  it("puts one planning entry on desktop Overview and not on Ledger", () => {
    expect(overview).toContain("{monthlyPlan}");
    expect(overview).toContain("{budgetBlueprint}");
    expect(overview.indexOf("{monthlyPlan}")).toBeLessThan(
      overview.indexOf("{budgetBlueprint}")
    );
    expect(ledgers).not.toContain("monthlyPlan");
    expect(ledgers).not.toContain("MonthlyPlanPanel");
    expect(ledgers).toContain("{budgetBlueprint}");
  });

  it("puts the same entry on phone Budget and nowhere else in the phone shell", () => {
    expect(phoneBudget).toContain("monthlyPlan={monthlyPlan}");
    expect(budget.indexOf("{monthlyPlan}")).toBeLessThan(
      budget.indexOf("<BudgetBlueprint")
    );
    expect(phoneHome).not.toContain("monthlyPlan");
    expect(phoneLedger).not.toContain("monthlyPlan");
    expect(phoneMore).not.toContain("monthlyPlan");
    expect(home).not.toContain("MonthlyPlan");
    expect(ledger).not.toContain("MonthlyPlan");
    expect(more).not.toContain("MonthlyPlan");
    expect(MOBILE_NAV_ITEMS.map((item) => item.id)).toEqual([
      "home",
      "budget",
      "ledger",
      "more",
    ]);
    expect(NAV_ITEMS.map((item) => item.id)).toEqual([
      "overview",
      "ledgers",
      "wisdom",
    ]);
  });

  it("does not call Plaid or live budget mutations from the ritual", () => {
    expect(planElement).toContain("onFinalize={engine.finalizeMonthlyPlan}");
    expect(planElement).not.toContain("updateBudgetTarget");
    expect(planElement).not.toContain("autoScaleBudgetCaps");
    expect(planElement).not.toContain("addIncome");
    expect(planElement).not.toContain("plaid");
    expect(panel).not.toContain("updateBudgetTarget");
    expect(panel).not.toContain("autoScaleBudgetCaps");
    expect(panel).not.toContain("addIncome");
    expect(panel).not.toContain("allocateIncome");
    expect(panel).not.toContain("GoldenTriad");
    expect(panel).not.toContain("PaycheckSplitter");
    expect(panel).not.toContain("UpcomingNeeds");
    expect(panel).not.toContain("DebtFreedomEngine");
    expect(panel).not.toContain("FinancialPosition");
    expect(panel).not.toContain("plaid");
    expect(panel).not.toContain("usePlaid");
    expect(panel.match(/onFinalize\(/g)).toHaveLength(1);
    expect(domain).not.toContain("plaid");
    expect(domain).not.toContain("todayIso");
  });

  it("presents a financial map, not a Planning Basis form", () => {
    expect(panel).toContain("Plan {monthTitle} around");
    expect(panel).toContain("Every planned dollar has a purpose.");
    expect(panel).toContain("still needs a purpose.");
    expect(panel).toContain("Overcommitted by");
    expect(panel).toContain("If this plan is executed");
    expect(panel).toContain("Canonical purpose");
    expect(panel).toContain("Living purposes");
    expect(panel).toContain("Wealth Building plan result");
    expect(panel).toContain("Known commitments");
    expect(panel).toContain("previewMonthlyPlan");
    expect(panel).toContain("livingPurposeMapState");
    expect(panel).toContain("planResultWealthBuilding");
    expect(panel).toContain("mergeFirstDraftPurposes");
    expect(panel).not.toContain("Planning Basis");
    expect(panel).toContain("Working assumption — not income.");
    expect(panel).toContain("Planned position if this map is followed");
    expect(panel).toContain("Add → Category");
  });

  it("keeps the phone Budget core planning loop wired to the same map", () => {
    expect(budget).toContain("{monthlyPlan}");
    expect(budget.indexOf("{monthlyPlan}")).toBeLessThan(
      budget.indexOf("<BudgetBlueprint")
    );
    expect(panel).toContain('aria-label="Monthly Plan"');
    expect(panel).toContain('aria-label="10/20/70 split"');
    expect(panel).toContain('aria-label="Living purposes"');
    expect(panel).toContain("Finalize map");
  });


  it("leaves Budget Blueprint on its live cap editor", () => {
    expect(blueprint).toContain("onUpdateTargetFull");
    expect(blueprint).toContain("onDeleteTarget");
    expect(blueprint).toContain("onAutoScaleCaps");
    expect(blueprint).not.toContain("MonthlyPlan");
    expect(blueprint).not.toContain("planningBasis");
    expect(blueprint).not.toContain("finalizeMonthlyPlan");
    expect(blueprintElement).toContain("engine.updateBudgetTargetFull");
    expect(blueprintElement).toContain("engine.deleteBudgetTarget");
    expect(blueprintElement).toContain("engine.autoScaleBudgetCaps");
    expect(blueprintElement).not.toContain("finalizeMonthlyPlan");
  });
});
