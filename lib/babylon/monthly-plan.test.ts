import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { isFinancialVaultEmpty } from "@/lib/babylon/cloud-setup";
import {
  CLOUD_VAULT_DATA_KEYS,
  parseCloudVaultData,
  serializeCloudVaultData,
} from "@/lib/babylon/cloud-vault";
import { EMPTY_STATE, STORAGE_KEY } from "@/lib/babylon/constants";
import { allocateIncome } from "@/lib/babylon/engine";
import {
  finalizeMonthlyPlanOnState,
  finalizeMonthlyPlanRevision,
  type MonthlyPlanFinalizeInput,
} from "@/lib/babylon/monthly-plan";
import {
  buildLedgerBackup,
  loadPersistedState,
  normalizePersistedState,
  savePersistedState,
  validateLedgerBackup,
} from "@/lib/babylon/persistence";
import { buildRecurringObligation } from "@/lib/babylon/recurring-obligations";
import type {
  DebtEntry,
  MonthlyPlanCategoryPurpose,
  MonthlyPlanRevision,
  PersistedState,
  RecurringObligation,
} from "@/types/babylon";

function cents(value: number): number {
  return Math.round(value * 100);
}

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

function input(
  partial: Partial<MonthlyPlanFinalizeInput> = {}
): MonthlyPlanFinalizeInput {
  const planningBasis = partial.planningBasis ?? 1000;
  const active = (partial.debts ?? [debt()]).some((row) => row.remainingDebt > 0);
  const living = allocateIncome(planningBasis, active).expenditureShare;
  return {
    id: "plan-1",
    periodKey: "2026-10",
    finalizedAt: "2026-10-01T15:00:00.000Z",
    planningBasis,
    debts: partial.debts ?? [debt()],
    obligations: partial.obligations ?? [],
    openingWealthBuilding: partial.openingWealthBuilding ?? 0,
    openingEmergencyFund: partial.openingEmergencyFund ?? 0,
    ...partial,
    categories: partial.categories ?? [purpose(living)],
  };
}

function state(partial: Partial<PersistedState> = {}): PersistedState {
  return { ...EMPTY_STATE, ...partial };
}

describe("monthly plan finalization", () => {
  it("finalizes revision 1 for an explicit period and keeps the planning basis", () => {
    const request = input();
    const result = finalizeMonthlyPlanRevision([], request);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.revision.revision).toBe(1);
    expect(result.revision.supersedesId).toBeNull();
    expect(result.revision.periodKey).toBe("2026-10");
    expect(result.revision.planningBasis).toBe(1000);
    expect(result.revision.finalizedAt).toBe(request.finalizedAt);
    expect(result.plans).toEqual([result.revision]);
  });

  it("snapshots the canonical 10/20/70 shares at penny precision", () => {
    const withDebt = finalizeMonthlyPlanRevision(
      [],
      input({ planningBasis: 1.15, categories: [purpose(0.8)], debts: [debt({ monthlyAllocation: 0.23 })] })
    );
    const split = allocateIncome(1.15, true);
    expect(withDebt.ok).toBe(true);
    if (!withDebt.ok) return;
    expect(withDebt.revision.wealthShare).toBe(split.wealthShare);
    expect(withDebt.revision.debtShare).toBe(split.debtShare);
    expect(withDebt.revision.expenditureShare).toBe(split.expenditureShare);
    expect(withDebt.revision.debtRedirected).toBe(false);
    expect(cents(withDebt.revision.wealthShare)).toBe(12);
    expect(cents(withDebt.revision.debtShare)).toBe(23);
    expect(cents(withDebt.revision.expenditureShare)).toBe(80);
    expect(
      cents(withDebt.revision.wealthShare) +
        cents(withDebt.revision.debtShare) +
        cents(withDebt.revision.expenditureShare)
    ).toBe(115);
  });

  it("redirects the debt share to wealth when no debt balance remains", () => {
    const result = finalizeMonthlyPlanRevision(
      [],
      input({ debts: [], categories: [purpose(700)] })
    );
    const split = allocateIncome(1000, false);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.revision.debtRedirected).toBe(true);
    expect(result.revision).toMatchObject({
      wealthShare: split.wealthShare,
      debtShare: 0,
      expenditureShare: split.expenditureShare,
    });
    expect(result.revision.wealthShare).toBe(300);
  });

  it("rejects a period that is not an explicit YYYY-MM", () => {
    expect(finalizeMonthlyPlanRevision([], input({ periodKey: "2026-13" })).ok).toBe(false);
    expect(finalizeMonthlyPlanRevision([], input({ periodKey: "October" })).ok).toBe(false);
    const source = readFileSync(resolve(process.cwd(), "lib/babylon/monthly-plan.ts"), "utf8");
    expect(source).not.toContain("todayIso");
    expect(source).not.toContain("materializeRecurringObligations");
    expect(source).toContain("allocateIncome");
    expect(source).not.toContain("budget_targets");
    expect(source).not.toContain("period_archives");
    expect(source).not.toContain("supabase");
  });

  it("rejects a negative, infinite, or missing planning basis", () => {
    for (const planningBasis of [-1, Number.NaN, Number.POSITIVE_INFINITY]) {
      const result = finalizeMonthlyPlanRevision([], input({ planningBasis }));
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.reason).toBe("malformed_planning_basis");
    }
  });

  it("requires planned purposes to equal the living share exactly", () => {
    const under = finalizeMonthlyPlanRevision([], input({ categories: [purpose(699.99)] }));
    const over = finalizeMonthlyPlanRevision([], input({ categories: [purpose(700.01)] }));
    const exact = finalizeMonthlyPlanRevision(
      [],
      input({
        categories: [
          purpose(400, { id: "rent", categoryName: "Rent" }),
          purpose(300, { id: "food", categoryName: "Groceries", isEssential: false }),
        ],
      })
    );
    expect(under.ok).toBe(false);
    expect(over.ok).toBe(false);
    if (!under.ok) expect(under.reason).toBe("living_under_allocated");
    if (!over.ok) expect(over.reason).toBe("living_over_allocated");
    expect(exact.ok).toBe(true);
    if (!exact.ok) return;
    expect(
      cents(exact.revision.categories[0].plannedAmount) +
        cents(exact.revision.categories[1].plannedAmount)
    ).toBe(cents(exact.revision.expenditureShare));
  });

  it("rejects a negative planned purpose", () => {
    const result = finalizeMonthlyPlanRevision([], input({ categories: [purpose(-1)] }));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe("negative_planned_amount");
  });

  it("copies protected context and leaves it out of the planning basis", () => {
    const result = finalizeMonthlyPlanRevision(
      [],
      input({ openingWealthBuilding: 800, openingEmergencyFund: 400 })
    );
    const fromBasis = allocateIncome(1000, true);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.revision.protectedContext).toEqual({
      openingWealthBuilding: 800,
      openingEmergencyFund: 400,
    });
    expect(result.revision.planningBasis).toBe(1000);
    expect(result.revision.wealthShare).toBe(fromBasis.wealthShare);
    expect(result.revision.debtShare).toBe(fromBasis.debtShare);
    expect(result.revision.expenditureShare).toBe(fromBasis.expenditureShare);
  });

  it("copies debt context and rejects minimums above the debt share", () => {
    const fitting = finalizeMonthlyPlanRevision(
      [],
      input({ debts: [debt({ monthlyAllocation: 200, remainingDebt: 500 })] })
    );
    expect(fitting.ok).toBe(true);
    if (!fitting.ok) return;
    expect(fitting.revision.debts).toEqual([
      {
        id: "debt-card",
        creditor: "Card",
        monthlyAllocation: 200,
        remainingDebt: 500,
      },
    ]);
    expect(fitting.revision.debtShare).toBe(200);

    const plans: MonthlyPlanRevision[] = [];
    const tooHigh = finalizeMonthlyPlanRevision(
      plans,
      input({ debts: [debt({ monthlyAllocation: 250, remainingDebt: 500 })] })
    );
    expect(tooHigh.ok).toBe(false);
    if (tooHigh.ok) return;
    expect(tooHigh.reason).toBe("debt_minimums_exceed_debt_share");
    expect(tooHigh.message).toContain("250.00");
    expect(tooHigh.message).toContain("200.00");
    expect(plans).toEqual([]);
  });

  it("rejects a debt-free plan whose leftover minimum exceeds the redirected debt share", () => {
    const result = finalizeMonthlyPlanRevision(
      [],
      input({
        debts: [debt({ remainingDebt: 0, monthlyAllocation: 40 })],
        categories: [purpose(700)],
      })
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe("debt_minimums_exceed_debt_share");
    expect(result.message).toContain("0.00");
  });

  it("copies a due obligation and leaves a non-due one out", () => {
    const phone = rule({ id: "rule-phone", firstDueDate: "2026-10-31", intervalMonths: 1 });
    const quarterly = rule({
      id: "rule-tax",
      name: "Tax",
      firstDueDate: "2026-02-15",
      intervalMonths: 3,
      category: "desire",
    });
    const skipped = rule({
      id: "rule-skip",
      name: "Skipped",
      firstDueDate: "2026-10-02",
      skippedMonths: ["2026-10"],
    });
    const inactive = rule({
      id: "rule-off",
      name: "Stopped",
      firstDueDate: "2026-10-03",
      isActive: false,
    });
    const result = finalizeMonthlyPlanRevision(
      [],
      input({ obligations: [quarterly, phone, skipped, inactive] })
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.revision.obligations.map((row) => row.id)).toEqual(["rule-phone"]);
    expect(result.revision.obligations[0]).toMatchObject({
      name: "Phone",
      amount: 50,
      category: "need",
      budgetCategoryId: "rent",
      dueDay: 31,
      intervalMonths: 1,
      dueDate: "2026-10-31",
    });

    const may = finalizeMonthlyPlanRevision(
      [],
      input({
        id: "plan-may",
        periodKey: "2026-05",
        obligations: [quarterly],
      })
    );
    expect(may.ok).toBe(true);
    if (!may.ok) return;
    expect(may.revision.obligations).toEqual([
      expect.objectContaining({
        id: "rule-tax",
        intervalMonths: 3,
        dueDate: "2026-05-15",
      }),
    ]);
  });

  it("appends revision 2 without rewriting revision 1, and starts another period at 1", () => {
    const first = finalizeMonthlyPlanRevision([], input());
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    const original = first.revision;
    const frozen = JSON.stringify(original);
    const second = finalizeMonthlyPlanRevision(first.plans, input({
      id: "plan-2",
      finalizedAt: "2026-10-20T12:00:00.000Z",
    }));
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    expect(second.plans[0]).toBe(original);
    expect(JSON.stringify(second.plans[0])).toBe(frozen);
    expect(second.revision.revision).toBe(2);
    expect(second.revision.supersedesId).toBe(original.id);

    const november = finalizeMonthlyPlanRevision(
      second.plans,
      input({ id: "plan-nov", periodKey: "2026-11" })
    );
    expect(november.ok).toBe(true);
    if (!november.ok) return;
    expect(november.revision.revision).toBe(1);
    expect(november.revision.supersedesId).toBeNull();
    expect(november.revision.periodKey).toBe("2026-11");
    expect(november.plans).toHaveLength(3);
  });

  it("refuses a broken revision chain instead of repairing it", () => {
    const broken = [
      {
        id: "orphan",
        periodKey: "2026-10",
        revision: 2,
        supersedesId: "missing",
      },
    ] as MonthlyPlanRevision[];
    const result = finalizeMonthlyPlanRevision(broken, input({ id: "plan-new" }));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe("revision_history_invalid");
    expect(broken).toHaveLength(1);
    expect(broken[0]?.revision).toBe(2);
  });
});

describe("monthly plan vault boundary", () => {
  const request = {
    id: "plan-1",
    periodKey: "2026-10",
    finalizedAt: "2026-10-01T15:00:00.000Z",
    planningBasis: 1000,
    categories: [purpose(700)],
  };

  function vault(): PersistedState {
    return state({
      incomes: [
        {
          id: "income-1",
          source: "Payroll",
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
      allocations: [
        {
          id: "alloc-1",
          incomeId: "income-1",
          date: "2026-09-01",
          monthKey: "2026-09",
          gross: 1000,
          wealth: 100,
          debt: 200,
          expenditure: 700,
        },
      ],
      expenses: [
        {
          id: "expense-1",
          name: "Rent",
          category: "need",
          amount: 400,
          date: "2026-10-01",
          dueDate: "2026-10-01",
          budgetCategoryId: "rent",
          isSettled: false,
        },
      ],
      budgetTargets: [purpose(400, { categoryName: "Rent" })],
      debts: [debt()],
      accounts: [
        {
          id: "checking",
          name: "Checking",
          kind: "checking",
          balance: 1500,
          asOf: "2026-10-01",
        },
      ],
      openingWealthBuilding: 200,
      openingEmergencyFund: 50,
      emergencyShield: 15,
      recurringObligations: [rule()],
      periodArchives: [
        {
          id: "archive-1",
          monthKey: "2026-09",
          closedAt: "2026-10-01T00:00:00.000Z",
          totalIncome: 1000,
          totalSpent: 400,
          wealthAllocated: 100,
          debtAllocated: 200,
          expenditurePool: 700,
          expenditureRemaining: 300,
          surplusDisposition: "rollover",
          surplusAmount: 0,
        },
      ],
      lastClosedMonthKey: "2026-09",
    });
  }

  it("changes only monthlyPlans", () => {
    const before = vault();
    const result = finalizeMonthlyPlanOnState(before, request);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.state.monthlyPlans).toHaveLength(1);
    expect(result.state.incomes).toBe(before.incomes);
    expect(result.state.allocations).toBe(before.allocations);
    expect(result.state.expenses).toBe(before.expenses);
    expect(result.state.budgetTargets).toBe(before.budgetTargets);
    expect(result.state.debts).toBe(before.debts);
    expect(result.state.accounts).toBe(before.accounts);
    expect(result.state.openingWealthBuilding).toBe(before.openingWealthBuilding);
    expect(result.state.openingEmergencyFund).toBe(before.openingEmergencyFund);
    expect(result.state.emergencyShield).toBe(before.emergencyShield);
    expect(result.state.recurringObligations).toBe(before.recurringObligations);
    expect(result.state.periodArchives).toBe(before.periodArchives);
    expect(result.state.lastClosedMonthKey).toBe(before.lastClosedMonthKey);
    expect(before.monthlyPlans).toEqual([]);
    expect(before.incomes).toHaveLength(1);
    expect(before.allocations).toHaveLength(1);
  });

  it("leaves the finalized revision unchanged after later working-state edits", () => {
    const before = vault();
    const finalized = finalizeMonthlyPlanOnState(before, request);
    expect(finalized.ok).toBe(true);
    if (!finalized.ok) return;
    const revision = finalized.revision;
    const frozen = JSON.stringify(revision);

    before.budgetTargets[0] = {
      ...before.budgetTargets[0],
      categoryName: "Housing",
      plannedAmount: 10,
    };
    before.budgetTargets.pop();
    before.recurringObligations[0] = {
      ...before.recurringObligations[0],
      name: "Mobile",
      amount: 90,
    };
    before.openingWealthBuilding = 1;
    before.openingEmergencyFund = 2;
    before.debts.pop();
    before.incomes.push({
      ...before.incomes[0],
      id: "income-2",
      amount: 50,
    });
    before.expenses[0] = { ...before.expenses[0], isSettled: true };
    before.periodArchives.push({ ...before.periodArchives[0], id: "archive-2" });

    expect(JSON.stringify(revision)).toBe(frozen);
    expect(revision.categories[0]).toMatchObject({
      id: "rent",
      categoryName: "Rent",
      plannedAmount: 700,
    });
    expect(revision.obligations[0]?.name).toBe("Phone");
    expect(revision.obligations[0]?.amount).toBe(50);
    expect(revision.protectedContext).toEqual({
      openingWealthBuilding: 200,
      openingEmergencyFund: 50,
    });
    expect(revision.debts[0]?.creditor).toBe("Card");
    expect(finalized.state.monthlyPlans).toEqual([revision]);
  });

  it("does not let income, settlement, or month close append a revision from this module", () => {
    const hook = readFileSync(resolve(process.cwd(), "hooks/useBabylonEngine.ts"), "utf8");
    const between = (start: string, end: string) => {
      const from = hook.indexOf(start);
      const to = hook.indexOf(end);
      expect(from).toBeGreaterThan(-1);
      expect(to).toBeGreaterThan(from);
      return hook.slice(from, to);
    };
    for (const slice of [
      between("const addIncome =", "const proposeIncomeSplit ="),
      between("const toggleExpenseSettled =", "const autoScaleBudgetCaps ="),
      between("const updateBudgetTarget =", "const updateBudgetTargetFull ="),
      between("const updateRecurringObligation =", "const deleteDebt ="),
      between("const updateProtectedDesignations =", "const deleteIncome ="),
      between("const deleteDebt =", "const previewAllocation ="),
      between("const closeMonth =", "const clearAllData ="),
    ]) {
      expect(slice).not.toContain("monthlyPlans");
      expect(slice).not.toContain("finalizeMonthlyPlan");
    }
    const finalize = between("const finalizeMonthlyPlan =", "const selectNav =");
    expect(finalize).toContain("finalizeMonthlyPlanOnState");
    expect(finalize).toContain("setMonthlyPlans");
    expect(finalize).not.toContain("setIncomes");
    expect(finalize).not.toContain("setAllocations");
    expect(finalize).not.toContain("setDebts");
    expect(finalize).not.toContain("setBudgetTargets");

    const balance = readFileSync(
      resolve(process.cwd(), "lib/babylon/balance-observation.ts"),
      "utf8"
    );
    const contract = readFileSync(
      resolve(process.cwd(), "lib/babylon/intelligence-contract.ts"),
      "utf8"
    );
    expect(balance).not.toContain("monthlyPlans");
    expect(contract).not.toContain("monthlyPlans");
  });

  it("treats a plan-only vault as financial state", () => {
    const finalized = finalizeMonthlyPlanOnState(state(), request);
    expect(finalized.ok).toBe(true);
    if (!finalized.ok) return;
    expect(isFinancialVaultEmpty(state())).toBe(true);
    expect(isFinancialVaultEmpty(finalized.state)).toBe(false);
  });
});

describe("monthly plan persistence", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function finalizedState(): PersistedState {
    const result = finalizeMonthlyPlanOnState(state({
      debts: [debt()],
      openingWealthBuilding: 20,
      openingEmergencyFund: 5,
      recurringObligations: [rule()],
    }), {
      id: "plan-1",
      periodKey: "2026-10",
      finalizedAt: "2026-10-01T15:00:00.000Z",
      planningBasis: 1000,
      categories: [purpose(700)],
    });
    if (!result.ok) throw new Error(result.reason);
    return result.state;
  }

  it("loads an older vault as an empty plan list and does not invent history", () => {
    const loaded = normalizePersistedState({
      budgetTargets: [
        { id: "rent", categoryName: "Rent", plannedAmount: 400, isEssential: true },
      ],
      debts: [debt()],
      openingWealthBuilding: 80,
      recurringObligations: [rule()],
    });
    expect(loaded.monthlyPlans).toEqual([]);
    expect(loaded.budgetTargets).toHaveLength(1);
    expect(loaded.debts).toHaveLength(1);
  });

  it("round-trips a revision through normalize, backup, and local storage", () => {
    const original = finalizedState();
    expect(normalizePersistedState(JSON.parse(JSON.stringify(original)))).toEqual(original);

    const backup = buildLedgerBackup(original);
    expect(backup.version).toBe(6);
    expect(validateLedgerBackup(backup)?.monthlyPlans).toEqual(original.monthlyPlans);

    const storage = new Map<string, string>();
    vi.stubGlobal("window", {
      localStorage: {
        getItem: (key: string) => storage.get(key) ?? null,
        setItem: (key: string, value: string) => {
          storage.set(key, value);
        },
        removeItem: (key: string) => {
          storage.delete(key);
        },
      },
    });
    savePersistedState(original);
    expect(storage.has(STORAGE_KEY)).toBe(true);
    expect(loadPersistedState().monthlyPlans).toEqual(original.monthlyPlans);
  });

  it("imports versions 1 through 5 with no plans and requires the list on version 6", () => {
    const version1 = validateLedgerBackup({
      version: 1,
      exportedAt: "2026-01-01T00:00:00.000Z",
      incomes: [],
      expenses: [],
      debts: [],
      displayName: "",
      monthlyPlans: [{ id: "stray" }],
    });
    expect(version1?.monthlyPlans).toEqual([]);

    const version5 = validateLedgerBackup({
      version: 5,
      exportedAt: "2026-09-01T00:00:00.000Z",
      incomes: [],
      expenses: [],
      debts: [],
      displayName: "",
      accounts: [],
      openingWealthBuilding: 0,
      openingEmergencyFund: 0,
      recurringObligations: [],
      budgetTargets: [
        { id: "rent", categoryName: "Rent", plannedAmount: 400, isEssential: true },
      ],
    });
    expect(version5?.monthlyPlans).toEqual([]);
    expect(version5?.budgetTargets).toHaveLength(1);

    const missing = validateLedgerBackup({
      ...buildLedgerBackup(EMPTY_STATE),
      monthlyPlans: undefined,
    });
    expect(missing).toBeNull();

    const corrupt = validateLedgerBackup({
      ...buildLedgerBackup(EMPTY_STATE),
      monthlyPlans: [{ id: "broken" }],
    });
    expect(corrupt).toBeNull();
  });

  it("keeps monthly plans in the cloud document and nowhere else", () => {
    const original = finalizedState();
    const document = serializeCloudVaultData(original);
    expect(Object.keys(document).sort()).toEqual([...CLOUD_VAULT_DATA_KEYS].sort());
    expect(parseCloudVaultData(document)).toEqual(original);

    const withoutPlans = { ...document } as Record<string, unknown>;
    delete withoutPlans.monthlyPlans;
    expect(parseCloudVaultData(withoutPlans)).toBeNull();
  });
});
