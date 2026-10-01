import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { deriveAvailableAfterPlannedNeeds } from "@/lib/babylon/available-after-planned-needs";
import {
  composeFinancialAttention,
  deriveDueAttention,
  deriveMonthCloseAttention,
  financialAttentionEpistemic,
} from "@/lib/babylon/attention";
import { composeRecordedAdministrationQuiet } from "@/lib/babylon/financial-quiet";
import {
  protectedExceedsAvailable,
  protectedOverflowExceeds,
} from "@/lib/babylon/protected-money";
import { serializeCloudVaultData } from "@/lib/babylon/cloud-vault";
import { EMPTY_STATE, DEBT_RATE, EXPENDITURE_RATE, WEALTH_RATE } from "@/lib/babylon/constants";
import { allocateIncome, totalOriginalDebt, totalRemainingDebt } from "@/lib/babylon/engine";
import {
  assembleIntelligenceContract,
  intelligenceCents,
  INTELLIGENCE_CONTRACT_VERSION,
} from "@/lib/babylon/intelligence-contract";
import {
  totalEmergencyFund,
  totalProtectedMoney,
  totalWealthBuilding,
} from "@/lib/babylon/protected-money";
import type {
  AllocationEvent,
  BudgetTarget,
  DebtEntry,
  ExpenseEntry,
  FinancialAccount,
  IncomeEntry,
  PersistedState,
  RecurringObligation,
} from "@/types/babylon";

vi.mock("server-only", () => ({}));

const getSupabaseServiceClient = vi.fn();
vi.mock("@/lib/supabase/server", () => ({
  getSupabaseServiceClient: () => getSupabaseServiceClient(),
}));

const { GET } = await import("@/app/api/intelligence/route");

const SECRET = "intelligence-read-secret";
const NOW = new Date("2026-01-15T18:00:00.000Z");
const GENERATED = "2026-01-15T18:00:00.000Z";
const READY_EMPTY = {
  status: "ready" as const,
  plaidAccounts: [],
  observations: [],
  associations: [],
};

function state(partial: Partial<PersistedState> = {}): PersistedState {
  return { ...EMPTY_STATE, ...partial };
}

function income(amount: number, date: string): IncomeEntry {
  return {
    id: "inc-1",
    source: "Pay",
    amount,
    date,
    interval: "monthly",
    kind: "primary",
    wealthShare: 10,
    debtShare: 20,
    expenditureShare: 70,
    debtRedirected: false,
  };
}

function allocation(partial: Partial<AllocationEvent> = {}): AllocationEvent {
  return {
    id: "alloc-1",
    incomeId: "inc-1",
    date: "2026-01-02",
    monthKey: "2026-01",
    gross: 100,
    wealth: 10,
    debt: 20,
    expenditure: 70,
    ...partial,
  };
}

function expense(partial: Partial<ExpenseEntry> = {}): ExpenseEntry {
  return {
    id: "exp-rent",
    name: "Rent",
    category: "need",
    amount: 100,
    date: "2026-01-10",
    dueDate: "2026-01-10",
    isSettled: false,
    ...partial,
  };
}

function debt(partial: Partial<DebtEntry> = {}): DebtEntry {
  return {
    id: "debt-1",
    creditor: "Card",
    totalDebt: 100,
    remainingDebt: 40,
    monthlyAllocation: 25,
    createdAt: "2026-01-01",
    interestRate: 6.5,
    ...partial,
  };
}

function account(): FinancialAccount {
  return {
    id: "acct-1",
    name: "Checking",
    kind: "checking",
    balance: 1000,
    asOf: "2026-01-01",
  };
}

function target(): BudgetTarget {
  return {
    id: "food",
    categoryName: "Food",
    plannedAmount: 200,
    isEssential: true,
  };
}

function rule(): RecurringObligation {
  return {
    id: "phone-rule",
    name: "Phone",
    amount: 85,
    category: "need",
    budgetCategoryId: "utilities",
    dueDay: 10,
    startMonth: "2026-01",
    isActive: true,
    createdAt: "2026-01-01",
    skippedMonths: [],
  };
}

function assemble(
  partial: Partial<PersistedState> = {},
  zone: string | null = "America/Boise",
  now = NOW
) {
  return assembleIntelligenceContract({
    state: state({
      ...(zone ? { financialTimeZone: zone } : {}),
      ...partial,
    }),
    ianaTimeZone: zone,
    now,
    generatedAt: GENERATED,
      balanceEvidence: READY_EMPTY,
  });
}

describe("intelligence contract", () => {
  it("is version 4 and reports integer cents", () => {
    const contract = assemble({
      incomes: [income(10.1, "2026-01-02"), income(0.2, "2026-01-03")],
    });
    expect(contract.meta.contract_version).toBe(INTELLIGENCE_CONTRACT_VERSION);
    expect(contract.meta.contract_version).toBe("4");
    expect(contract.purpose.current_month_recorded_income_cents).toBe(1030);
    expect(Number.isInteger(contract.purpose.current_month_recorded_income_cents)).toBe(
      true
    );
    expect(intelligenceCents(10.1)).toBe(1010);
  });

  it("represents the standing split and this month's recorded allocation", () => {
    const withDebt = assemble({
      debts: [debt()],
      incomes: [income(100, "2026-01-02")],
      allocations: [allocation()],
    });
    expect(withDebt.purpose.wealth_rate_bps).toBe(Math.round(WEALTH_RATE * 10_000));
    expect(withDebt.purpose.debt_rate_bps).toBe(Math.round(DEBT_RATE * 10_000));
    expect(withDebt.purpose.expenditure_rate_bps).toBe(
      Math.round(EXPENDITURE_RATE * 10_000)
    );
    expect(withDebt.purpose.debt_share_redirects_to_wealth).toBe(
      allocateIncome(1, true).debtRedirected
    );
    expect(withDebt.purpose.current_month_recorded_income_cents).toBe(10_000);
    expect(withDebt.purpose.current_month_allocated_wealth_cents).toBe(1000);
    expect(withDebt.purpose.current_month_allocated_debt_cents).toBe(2000);
    expect(withDebt.purpose.current_month_allocated_expenditure_cents).toBe(7000);

    const debtFree = assemble();
    expect(debtFree.purpose.debt_share_redirects_to_wealth).toBe(
      allocateIncome(1, false).debtRedirected
    );
    expect(debtFree.purpose.debt_share_redirects_to_wealth).toBe(true);
  });

  it("exposes living-budget shortfall when the floored remaining is zero", () => {
    const contract = assemble({
      allocations: [allocation({ expenditure: 100, wealth: 0, debt: 0, gross: 100 })],
      expenses: [expense({ amount: 150, isSettled: true, category: "desire" })],
      budgetTargets: [target()],
    });
    expect(contract.budget.living_budget_pool_cents).toBe(10_000);
    expect(contract.budget.living_budget_spent_cents).toBe(15_000);
    expect(contract.budget.living_budget_remaining_cents).toBe(0);
    expect(contract.budget.living_budget_shortfall_cents).toBe(5000);
    expect(contract.budget.categories[0]).toMatchObject({
      subject_ref: "food",
      name: "Food",
      planned_cents: 20_000,
      is_essential: true,
      settled_cents: 0,
    });
  });

  it("matches Available After Planned Needs and protected totals", () => {
    const fixture = state({
      financialTimeZone: "America/Boise",
      accounts: [account()],
      openingWealthBuilding: 15,
      openingEmergencyFund: 5,
      emergencyShield: 4,
      allocations: [allocation({ wealth: 10 })],
      expenses: [expense({ amount: 100, category: "need" })],
    });
    const contract = assembleIntelligenceContract({
      state: fixture,
      ianaTimeZone: "America/Boise",
      now: NOW,
      generatedAt: GENERATED,
      balanceEvidence: READY_EMPTY,
    });
    const available = deriveAvailableAfterPlannedNeeds({
      deployablePosition: 1000,
      deployableProtected: totalProtectedMoney(15, 5),
      upcomingNeeds: 100,
    });
    expect(contract.available_after_planned_needs.available_cents).toBe(
      intelligenceCents(available.availableAfterPlannedNeeds)
    );
    expect(contract.available_after_planned_needs.shortfall_cents).toBe(
      intelligenceCents(available.plannedNeedsShortfall)
    );
    expect(contract.available_after_planned_needs.raw_difference_cents).toBe(
      intelligenceCents(available.rawDifference)
    );
    expect(contract.available_after_planned_needs.upcoming_needs_cents).toBe(10_000);
    expect(contract.protected_money.wealth_building_total_cents).toBe(
      intelligenceCents(totalWealthBuilding(15, 10))
    );
    expect(contract.protected_money.emergency_fund_total_cents).toBe(
      intelligenceCents(totalEmergencyFund(5, 4))
    );
    expect(contract.protected_money.opening_protected_cents).toBe(
      intelligenceCents(totalProtectedMoney(15, 5))
    );
    expect(contract.position.accounts[0]).toEqual({
      name: "Checking",
      kind: "checking",
      declared_balance_cents: 100_000,
      declared_as_of: "2026-01-01",
      effective_balance_cents: 100_000,
      effective_source: "declared",
      observed_current_cents: null,
      observed_at: null,
      observation_kind: null,
      institution_reading_age: null,
    });
    expect(contract.position.money_available_cents).toBe(100_000);
  });

  it("keeps an empty unpaid list empty", () => {
    expect(assemble().obligations.unpaid).toEqual([]);
  });

  it("does not materialize a longer interval as monthly", () => {
    const contract = assemble({
      recurringObligations: [{ ...rule(), intervalMonths: 3 }],
      expenses: [],
    });
    const months = contract.obligations.unpaid.map((item) => item.due_date.slice(0, 7));
    expect(months).toContain("2026-01");
    expect(months).not.toContain("2026-02");
    expect(
      contract.obligations.unpaid.every((item) => item.origin === "derived_from_rule")
    ).toBe(true);
  });

  it("marks an in-memory rule occurrence without changing the input", () => {
    const fixture = state({
      financialTimeZone: "America/Boise",
      recurringObligations: [rule()],
      expenses: [],
    });
    const before = structuredClone(fixture);
    const contract = assembleIntelligenceContract({
      state: fixture,
      ianaTimeZone: "America/Boise",
      now: NOW,
      generatedAt: GENERATED,
      balanceEvidence: READY_EMPTY,
    });
    expect(fixture).toEqual(before);
    const derived = contract.obligations.unpaid.filter(
      (item) => item.origin === "derived_from_rule"
    );
    expect(derived.length).toBeGreaterThan(0);
    expect(derived.every((item) => item.subject_ref.startsWith("occ."))).toBe(true);
    expect(derived.some((item) => item.name === "Phone" && item.amount_cents === 8500)).toBe(
      true
    );
    expect(fixture.expenses).toEqual([]);
  });

  it("does not publish a partial obligation list when recurrence evidence is invalid", () => {
    const contract = assemble({
      recurringObligations: [rule(), rule()],
      expenses: [expense()],
    });
    expect(contract.boundaries.unknowns).toContain("recurrence_unreadable");
    expect(contract.obligations.unpaid).toEqual([]);
    expect(contract.available_after_planned_needs.upcoming_needs_cents).toBeNull();
    expect(contract.attention.epistemic).toBe("unknown");
    expect(contract.recorded_administration.status).toBe("unknown");
  });

  it("matches established Attention and adds no other kind", () => {
    const dueState = state({
      financialTimeZone: "America/Boise",
      expenses: [expense()],
    });
    const dueContract = assembleIntelligenceContract({
      state: dueState,
      ianaTimeZone: "America/Boise",
      now: NOW,
      generatedAt: GENERATED,
      balanceEvidence: READY_EMPTY,
    });
    const due = deriveDueAttention(dueState.expenses, "2026-01-15");
    expect(dueContract.attention.items).toEqual(
      due.map((item) => ({
        kind: "due_obligation",
        civil_date: "2026-01-15",
        subject_ref: item.id,
      }))
    );

    const closeNow = new Date("2026-01-31T18:00:00.000Z");
    const closeContract = assemble({ lastClosedMonthKey: null }, "America/Boise", closeNow);
    const close = deriveMonthCloseAttention({
      today: "2026-01-31",
      currentMonthKey: "2026-01",
      lastClosedMonthKey: null,
    });
    expect(close).not.toBeNull();
    expect(closeContract.attention.items).toEqual([
      {
        kind: "month_close",
        civil_date: "2026-01-31",
        month_key: "2026-01",
        statement: close?.message,
      },
    ]);
    const kinds = new Set(closeContract.attention.items.map((item) => item.kind));
    expect(kinds).toEqual(new Set(["month_close"]));
    expect(dueContract.attention.epistemic).toBe("present");
    expect(closeContract.attention.epistemic).toBe("present");
  });

  it("uses the canonical attention composer for quiet and unknown", () => {
    const quiet = assemble({}, "America/Boise", NOW);
    const quietComposed = composeFinancialAttention({
      expenses: [],
      today: "2026-01-15",
      currentMonthKey: "2026-01",
      lastClosedMonthKey: null,
    });
    expect(quiet.attention.items).toEqual([]);
    expect(quiet.attention.epistemic).toBe("quiet");
    expect(quiet.attention.epistemic).toBe(financialAttentionEpistemic(quietComposed));
    expect(quiet.boundaries.unknowns).not.toContain("invalid_attention_due_date");
    expect(quiet.boundaries.unknowns).not.toContain("civil_date_unknown");

    const invalidDue = assemble({
      expenses: [expense({ id: "bad", dueDate: "2026-02-31" })],
    });
    const invalidComposed = composeFinancialAttention({
      expenses: [expense({ id: "bad", dueDate: "2026-02-31" })],
      today: "2026-01-15",
      currentMonthKey: "2026-01",
      lastClosedMonthKey: EMPTY_STATE.lastClosedMonthKey,
    });
    expect(invalidDue.attention.items).toEqual([]);
    expect(invalidDue.attention.epistemic).toBe("unknown");
    expect(invalidDue.attention.epistemic).toBe(
      financialAttentionEpistemic(invalidComposed)
    );
    expect(invalidDue.boundaries.unknowns).toContain("invalid_attention_due_date");
    expect(invalidDue.attention.epistemic).not.toBe("quiet");

    const mixed = assemble({
      expenses: [
        expense({ id: "rent", dueDate: "2026-01-10" }),
        expense({ id: "bad", dueDate: "2026-02-31" }),
      ],
    });
    expect(mixed.attention.items).toEqual([
      {
        kind: "due_obligation",
        civil_date: "2026-01-15",
        subject_ref: "rent",
      },
    ]);
    expect(mixed.attention.epistemic).toBe("unknown");
    expect(mixed.boundaries.unknowns).toContain("invalid_attention_due_date");
  });

  it("shares protected overflow and recorded-administration quiet with the canonical composers", () => {
    const purpose = account();
    purpose.purpose = "wealth_building";
    purpose.balance = 800;
    const fixture = state({
      financialTimeZone: "America/Boise",
      accounts: [purpose],
      openingWealthBuilding: 300,
      openingEmergencyFund: 0,
    });
    const contract = assembleIntelligenceContract({
      state: fixture,
      ianaTimeZone: "America/Boise",
      now: NOW,
      generatedAt: GENERATED,
      balanceEvidence: READY_EMPTY,
    });
    const positions = contract.position.accounts.map((row, index) => ({
      accountId: fixture.accounts[index]!.id,
      balance: row.effective_balance_cents / 100,
      source: "declared" as const,
      asOf: row.declared_as_of,
    }));
    expect(protectedExceedsAvailable(300, 0, 800)).toBe(false);
    expect(
      protectedOverflowExceeds({
        openingWealthBuilding: 300,
        openingEmergencyFund: 0,
        moneyAvailable: 800,
        accounts: fixture.accounts,
        positions,
      })
    ).toBe(true);
    expect(contract.position.protected_exceeds_money_available).toBe(true);
    expect(contract.recorded_administration).toEqual(
      composeRecordedAdministrationQuiet({
        expenses: [],
        today: "2026-01-15",
        currentMonthKey: "2026-01",
        lastClosedMonthKey: null,
        debtSemanticsVersion: fixture.debtSemanticsVersion,
        debts: fixture.debts,
        openingWealthBuilding: 300,
        openingEmergencyFund: 0,
        moneyAvailable: 800,
        accounts: fixture.accounts,
        positionTruth: { status: "knowable", positions },
        cloudConflict: false,
      })
    );
    expect(contract.recorded_administration.status).toBe("action_outstanding");
    expect(contract.meta.contract_version).toBe("4");

    const screen = readFileSync("hooks/useBabylonEngine.ts", "utf8");
    const assembler = readFileSync("lib/babylon/intelligence-contract.ts", "utf8");
    const quiet = readFileSync("lib/babylon/financial-quiet.ts", "utf8");
    expect(screen).toContain("protectedOverflowExceeds");
    expect(assembler).toContain("protectedOverflowExceeds");
    expect(quiet).toContain("protectedOverflowExceeds");
    expect(assembler).toContain("composeRecordedAdministrationQuiet");
  });

  it("does not invent a financial civil date when the financial timezone is unusable", () => {
    const utcEvening = new Date("2026-01-15T06:30:00.000Z");
    const boise = assemble({}, "America/Boise", utcEvening);
    expect(boise.meta.contract_version).toBe("4");
    expect(boise.meta.civil_date).toBe("2026-01-14");
    expect(boise.meta.civil_date).not.toBe(utcEvening.toISOString().slice(0, 10));

    for (const zone of [undefined, "Not/A/Zone", "UTC+6"]) {
      const contract = assembleIntelligenceContract({
        state: state({
          financialTimeZone: zone,
          budgetTargets: [target()],
        }),
        ianaTimeZone: "America/New_York",
        now: utcEvening,
        generatedAt: GENERATED,
        balanceEvidence: READY_EMPTY,
      });
      expect(contract.meta.iana_timezone).toBe("America/New_York");
      expect(contract.meta.civil_date).toBeNull();
      expect(contract.meta.current_month_key).toBeNull();
      expect(contract.meta.month_closed).toBeNull();
      expect(contract.purpose.current_month_recorded_income_cents).toBeNull();
      expect(contract.budget.living_budget_remaining_cents).toBeNull();
      expect(contract.budget.categories[0].settled_cents).toBeNull();
      expect(contract.attention.items).toEqual([]);
      expect(contract.recorded_administration.status).toBe("unknown");
      expect(contract.boundaries.unknowns).toContain("civil_date_unknown");
    }
  });

  it("resolves financial civil time independently of the notification timezone", () => {
    const utcEvening = new Date("2026-01-15T06:30:00.000Z");
    const split = assembleIntelligenceContract({
      state: state({
        financialTimeZone: "America/Boise",
        expenses: [expense({ dueDate: "2026-01-14", date: "2026-01-14" })],
      }),
      ianaTimeZone: "America/New_York",
      now: utcEvening,
      generatedAt: GENERATED,
      balanceEvidence: READY_EMPTY,
    });
    expect(split.meta.contract_version).toBe("4");
    expect(split.meta.iana_timezone).toBe("America/New_York");
    expect(split.meta.civil_date).toBe("2026-01-14");
    expect(split.meta.current_month_key).toBe("2026-01");
    expect(split.attention.items.length).toBeGreaterThan(0);
    expect(
      split.attention.items.every((item) => item.civil_date === split.meta.civil_date)
    ).toBe(true);

    for (const zone of [null, "Not/A/Zone", "UTC+6"]) {
      const contract = assembleIntelligenceContract({
        state: state({ financialTimeZone: "America/Boise" }),
        ianaTimeZone: zone,
        now: utcEvening,
        generatedAt: GENERATED,
        balanceEvidence: READY_EMPTY,
      });
      expect(contract.meta.iana_timezone).toBe(zone);
      expect(contract.meta.civil_date).toBe("2026-01-14");
      expect(contract.meta.current_month_key).toBe("2026-01");
      expect(contract.boundaries.unknowns).not.toContain("civil_date_unknown");
    }

    const yearBoundary = new Date("2026-01-01T06:30:00.000Z");
    const december = assembleIntelligenceContract({
      state: state({
        financialTimeZone: "America/Boise",
        incomes: [income(50, "2025-12-15"), income(100, "2026-01-01")],
        lastClosedMonthKey: null,
      }),
      ianaTimeZone: "America/New_York",
      now: yearBoundary,
      generatedAt: GENERATED,
      balanceEvidence: READY_EMPTY,
    });
    expect(december.meta.iana_timezone).toBe("America/New_York");
    expect(december.meta.civil_date).toBe("2025-12-31");
    expect(december.meta.current_month_key).toBe("2025-12");
    expect(december.meta.month_closed).toBe(false);
    expect(december.purpose.current_month_recorded_income_cents).toBe(5000);
    expect(december.attention.items).toEqual([
      expect.objectContaining({
        kind: "month_close",
        civil_date: "2025-12-31",
        month_key: "2025-12",
      }),
    ]);
    expect(december.recorded_administration.status).toBe("action_outstanding");
  });

  it("loads the notification timezone and does not use it as the financial clock", () => {
    const route = readFileSync("app/api/intelligence/route.ts", "utf8");
    const assembler = readFileSync("lib/babylon/intelligence-contract.ts", "utf8");
    expect(route).toContain("ianaTimeZone: owned[0]?.iana_timezone ?? null");
    expect(route).not.toContain("financialCivilDate");
    expect(assembler).toContain(
      "financialCivilDate(input.now, state.financialTimeZone)"
    );
    expect(assembler).not.toContain("civilDateInTimeZone(");
  });

  it("withholds a soft-migrated zero APR and keeps a recorded rate", () => {
    const unverified = assemble({ debts: [debt({ interestRate: 0 })] });
    expect(unverified.debts.debts[0].interest_rate_ppm).toBeNull();
    expect(unverified.boundaries.unknowns).toContain("apr_unverified");

    const recorded = assemble({ debts: [debt({ interestRate: 6.5 })] });
    expect(recorded.debts.debts[0].interest_rate_ppm).toBe(65_000);
    expect(recorded.boundaries.unknowns).not.toContain("apr_unverified");
    expect(recorded.debts.original_total_cents).toBe(
      intelligenceCents(totalOriginalDebt([debt()]))
    );
    expect(recorded.debts.remaining_total_cents).toBe(
      intelligenceCents(totalRemainingDebt([debt()]))
    );
    expect(recorded.debts.cleared_cents).toBe(6000);
  });

  it("keeps the v1 boundary, origin, and attention vocabularies", () => {
    const contract = assemble(
      {
        expenses: [expense()],
        recurringObligations: [rule()],
        lastClosedMonthKey: null,
      },
      "America/Boise",
      new Date("2026-01-31T18:00:00.000Z")
    );
    expect(contract.boundaries.unknowns).toContain(
      "internal_observational_reasoners_excluded"
    );
    expect(contract.boundaries.unknowns).not.toContain(
      "observational_reasoners_unwired"
    );
    expect(JSON.stringify(contract)).not.toContain("observational_reasoners_unwired");

    const origins = [...new Set(contract.obligations.unpaid.map((item) => item.origin))].sort();
    expect(origins).toEqual(["derived_from_rule", "recorded"]);

    const kinds = [...new Set(contract.attention.items.map((item) => item.kind))].sort();
    expect(kinds).toEqual(["due_obligation", "month_close"]);
    for (const item of contract.attention.items) {
      if (item.kind === "due_obligation") {
        expect(item.civil_date).toBe(contract.meta.civil_date);
        expect(Object.keys(item).sort()).toEqual(["civil_date", "kind", "subject_ref"]);
      } else {
        expect(item.kind).toBe("month_close");
        expect(item.civil_date).toBe(contract.meta.civil_date);
        expect(Object.keys(item).sort()).toEqual([
          "civil_date",
          "kind",
          "month_key",
          "statement",
        ]);
      }
    }
  });

  it("keeps standing unknowns explicit and omits excluded surfaces", () => {
    const contract = assemble({
      accounts: [account()],
      expenses: [expense()],
      debts: [debt()],
    });
    expect(contract.boundaries.unknowns).toEqual(
      expect.arrayContaining([
        "no_expected_payday",
        "plaid_is_not_vault_truth",
        "balance_change_cause_unknown",
        "internal_observational_reasoners_excluded",
      ])
    );
    expect(contract.boundaries.unknowns).not.toContain("cached_accounts_get_balance");
    expect(contract.boundaries.unknowns).not.toContain("balances_are_manual");
    expect(contract.boundaries.unknowns).not.toContain("no_reconciliation");
    expect(contract.boundaries.unknowns).not.toContain("balance_evidence_unavailable");
    expect(contract.boundaries.unknowns).not.toContain(
      "observational_reasoners_unwired"
    );
    const serialized = JSON.stringify(contract);
    for (const forbidden of [
      "vault_data",
      "access_token",
      "accessToken",
      "p256dh",
      "CRON_SECRET",
      "VAPID",
      "service_role",
      "revision",
      "fingerprint",
      "activityLog",
      "displayName",
      "plaid_transaction",
      "user_id",
      "safe to spend",
      "recommended_action",
    ]) {
      expect(serialized.toLowerCase()).not.toContain(forbidden.toLowerCase());
    }
    expect(serialized).toContain("plaid_is_not_vault_truth");
  });

  it("does not mutate the fixture", () => {
    const fixture = state({
      financialTimeZone: "America/Boise",
      expenses: [expense()],
      recurringObligations: [rule()],
      debts: [debt()],
      accounts: [account()],
    });
    const before = structuredClone(fixture);
    assembleIntelligenceContract({
      state: fixture,
      ianaTimeZone: "America/Boise",
      now: NOW,
      generatedAt: GENERATED,
      balanceEvidence: READY_EMPTY,
    });
    expect(fixture).toEqual(before);
  });
});

function evidenceRows(
  data: unknown[] | null,
  error: { message: string } | null = null
) {
  const result = { data, error };
  const builder = {
    eq() {
      return builder;
    },
    then(
      onFulfilled?: (value: typeof result) => unknown,
      onRejected?: (reason: unknown) => unknown
    ) {
      return Promise.resolve(result).then(onFulfilled, onRejected);
    },
  };
  return { select: () => builder };
}

describe("GET /api/intelligence", () => {
  const previous: Record<string, string | undefined> = {};

  beforeEach(() => {
    getSupabaseServiceClient.mockReset();
    for (const key of ["INTELLIGENCE_READ_SECRET", "NEXT_PUBLIC_SUPABASE_URL"]) {
      if (!(key in previous)) previous[key] = process.env[key];
    }
    process.env.INTELLIGENCE_READ_SECRET = SECRET;
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://nklmgzxxdhuvqayhcigp.supabase.co";
  });

  function request(url = "https://wealth-engine-zeta.vercel.app/api/intelligence", init?: RequestInit) {
    return new Request(url, init);
  }

  it("rejects a missing or wrong bearer and does not read the database", async () => {
    const missing = await GET(request());
    expect(missing.status).toBe(401);
    expect(missing.headers.get("cache-control")).toBe("no-store");
    expect(await missing.json()).toEqual({ error: "Unauthorized." });

    const wrong = await GET(
      request("https://wealth-engine-zeta.vercel.app/api/intelligence", {
        headers: { Authorization: "Bearer not-the-secret" },
      })
    );
    expect(wrong.status).toBe(401);
    expect(getSupabaseServiceClient).not.toHaveBeenCalled();
  });

  it("rejects a user selector or body without treating it as authority", async () => {
    const selected = await GET(
      request(
        "https://wealth-engine-zeta.vercel.app/api/intelligence?user_id=other-steward",
        { headers: { Authorization: `Bearer ${SECRET}` } }
      )
    );
    expect(selected.status).toBe(400);
    const body = await GET(
      request("https://wealth-engine-zeta.vercel.app/api/intelligence", {
        method: "POST",
        headers: { Authorization: `Bearer ${SECRET}` },
        body: JSON.stringify({ user_id: "other-steward", accounts: [{ balance: 1 }] }),
      })
    );
    expect(body.status).toBe(400);
    expect(getSupabaseServiceClient).not.toHaveBeenCalled();
    expect(JSON.stringify(await body.json())).not.toContain("balance");
  });

  it("returns no-store and no financial details when the contract cannot be assembled", async () => {
    getSupabaseServiceClient.mockReturnValue(null);
    const unavailable = await GET(
      request("https://wealth-engine-zeta.vercel.app/api/intelligence", {
        headers: { Authorization: `Bearer ${SECRET}` },
      })
    );
    expect(unavailable.status).toBe(503);
    expect(unavailable.headers.get("cache-control")).toBe("no-store");
    expect(await unavailable.json()).toEqual({
      error: "Intelligence contract is unavailable.",
    });

    getSupabaseServiceClient.mockReturnValue({
      from(table: string) {
        if (table !== "wealth_engine_vaults") {
          throw new Error(`unexpected table ${table}`);
        }
        return {
          select: () =>
            Promise.resolve({
              data: [
                {
                  user_id: "steward-1",
                  schema_version: 6,
                  vault_data: { displayName: "Hidden Name", balance: 999999 },
                },
              ],
              error: null,
            }),
        };
      },
    });
    const unparsed = await GET(
      request("https://wealth-engine-zeta.vercel.app/api/intelligence", {
        headers: { Authorization: `Bearer ${SECRET}` },
      })
    );
    expect(unparsed.status).toBe(503);
    const text = JSON.stringify(await unparsed.json());
    expect(text).not.toContain("Hidden Name");
    expect(text).not.toContain("999999");
    expect(text).not.toContain("steward-1");
  });

  it("reads the vault, timezone, and owner-scoped balance evidence", async () => {
    const tables: string[] = [];
    getSupabaseServiceClient.mockReturnValue({
      from(table: string) {
        tables.push(table);
        if (table === "wealth_engine_vaults") {
          return {
            select: () =>
              Promise.resolve({
                data: [
                  {
                    user_id: "steward-1",
                    schema_version: 6,
                    vault_data: serializeCloudVaultData(state()),
                  },
                ],
                error: null,
              }),
          };
        }
        if (table === "notification_preferences") {
          return {
            select: () =>
              Promise.resolve({
                data: [{ user_id: "steward-1", iana_timezone: "America/Boise" }],
                error: null,
              }),
          };
        }
        if (
          table === "plaid_accounts" ||
          table === "plaid_balance_observations" ||
          table === "plaid_account_associations"
        ) {
          return evidenceRows([]);
        }
        throw new Error(`unexpected table ${table}`);
      },
    });
    const response = await GET(
      request("https://wealth-engine-zeta.vercel.app/api/intelligence", {
        headers: { Authorization: `Bearer ${SECRET}` },
      })
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    const body = await response.json();
    expect(body.meta.contract_version).toBe("4");
    expect(body.position.operational_balance_fields).toEqual([
      "money_available_cents",
      "effective_balance_cents",
    ]);
    expect(body.position.declared_balance_role).toBe("provenance_fallback");
    expect(body.meta.iana_timezone).toBe("America/Boise");
    expect(body.boundaries.unknowns).not.toContain("balance_evidence_unavailable");
    expect(tables).toEqual([
      "wealth_engine_vaults",
      "notification_preferences",
      "plaid_accounts",
      "plaid_balance_observations",
      "plaid_account_associations",
    ]);
    expect(JSON.stringify(body)).not.toContain("steward-1");
  });

  it("uses an eligible stored observation and falls back when that read fails", async () => {
    getSupabaseServiceClient.mockReturnValue({
      from(table: string) {
        if (table === "wealth_engine_vaults") {
          return {
            select: () =>
              Promise.resolve({
                data: [
                  {
                    user_id: "steward-1",
                    schema_version: 6,
                    vault_data: serializeCloudVaultData(state({ accounts: [account()] })),
                  },
                ],
                error: null,
              }),
          };
        }
        if (table === "notification_preferences") {
          return {
            select: () =>
              Promise.resolve({
                data: [{ user_id: "steward-1", iana_timezone: "America/Boise" }],
                error: null,
              }),
          };
        }
        if (table === "plaid_accounts") {
          return evidenceRows([
            {
              id: "pa-1",
              user_id: "steward-1",
              plaid_item_id: "item-1",
              plaid_account_id: "plaid-secret",
              name: "Checking",
              mask: "1234",
              account_type: "depository",
              subtype: "checking",
            },
          ]);
        }
        if (table === "plaid_balance_observations") {
          return evidenceRows([
            {
              id: "obs-secret",
              user_id: "steward-1",
              plaid_account_id: "plaid-secret",
              current_cents: 184_726,
              available_cents: 1,
              iso_currency_code: "USD",
              unofficial_currency_code: null,
              observed_at: "2026-09-27T08:14:00.000Z",
              source: "accounts_get",
              state: "current",
            },
          ]);
        }
        if (table === "plaid_account_associations") {
          return evidenceRows([
            {
              id: "assoc-secret",
              user_id: "steward-1",
              financial_account_id: "acct-1",
              plaid_account_id: "plaid-secret",
              confirmed_at: "2026-09-27T08:14:00.000Z",
            },
          ]);
        }
        throw new Error(`unexpected table ${table}`);
      },
    });
    const observed = await GET(
      request("https://wealth-engine-zeta.vercel.app/api/intelligence", {
        headers: { Authorization: `Bearer ${SECRET}` },
      })
    );
    expect(observed.status).toBe(200);
    const observedBody = await observed.json();
    expect(observedBody.position.money_available_cents).toBe(184_726);
    expect(observedBody.position.accounts[0]).toMatchObject({
      declared_balance_cents: 100_000,
      declared_as_of: "2026-01-01",
      effective_balance_cents: 184_726,
      effective_source: "observed",
      observed_current_cents: 184_726,
      observed_at: "2026-09-27T08:14:00.000Z",
      observation_kind: "cached_accounts_get",
    });
    expect(observedBody.boundaries.unknowns).toContain("balance_change_cause_unknown");
    expect(observedBody.boundaries.unknowns).toContain("plaid_is_not_vault_truth");
    expect(observedBody.boundaries.unknowns).not.toContain("balance_evidence_unavailable");
    const observedText = JSON.stringify(observedBody);
    expect(observedText).not.toContain("obs-secret");
    expect(observedText).not.toContain("plaid-secret");
    expect(observedText).not.toContain("steward-1");
    expect(observedText).not.toContain("access_token");

    getSupabaseServiceClient.mockReturnValue({
      from(table: string) {
        if (table === "wealth_engine_vaults") {
          return {
            select: () =>
              Promise.resolve({
                data: [
                  {
                    user_id: "steward-1",
                    schema_version: 6,
                    vault_data: serializeCloudVaultData(state({ accounts: [account()] })),
                  },
                ],
                error: null,
              }),
          };
        }
        if (table === "notification_preferences") {
          return {
            select: () =>
              Promise.resolve({
                data: [{ user_id: "steward-1", iana_timezone: "America/Boise" }],
                error: null,
              }),
          };
        }
        if (
          table === "plaid_accounts" ||
          table === "plaid_balance_observations" ||
          table === "plaid_account_associations"
        ) {
          return evidenceRows(null, { message: "read failed" });
        }
        throw new Error(`unexpected table ${table}`);
      },
    });
    const failed = await GET(
      request("https://wealth-engine-zeta.vercel.app/api/intelligence", {
        headers: { Authorization: `Bearer ${SECRET}` },
      })
    );
    expect(failed.status).toBe(200);
    const failedBody = await failed.json();
    expect(failedBody.position.money_available_cents).toBe(100_000);
    expect(failedBody.position.accounts[0].effective_source).toBe("declared");
    expect(failedBody.boundaries.unknowns).toContain("balance_evidence_unavailable");
    expect(failedBody.boundaries.unknowns).toContain("balance_change_cause_unknown");
    expect(JSON.stringify(failedBody)).not.toContain("184726");
  });

  it("does not write, call Plaid, or load transactions", () => {
    const route = readFileSync("app/api/intelligence/route.ts", "utf8");
    const assembler = readFileSync("lib/babylon/intelligence-contract.ts", "utf8");
    expect(route).not.toContain(".insert(");
    expect(route).not.toContain(".update(");
    expect(route).not.toContain(".delete(");
    expect(route).not.toContain(".upsert(");
    expect(route).toContain('.eq("user_id"');
    expect(route).toContain("plaid_accounts");
    expect(route).toContain("plaid_balance_observations");
    expect(route).toContain("plaid_account_associations");
    expect(route).not.toContain("plaid_transactions");
    expect(route).not.toContain("access_token");
    expect(route).not.toContain("/accounts/get");
    expect(route).not.toContain("notification_deliveries");
    expect(route).not.toContain("push_subscriptions");
    expect(route).not.toContain("process.env.CRON_SECRET");
    expect(route).not.toContain("export async function POST");
    expect(route).not.toContain("console.");
    expect(assembler).not.toContain("process.env");
    expect(assembler).not.toContain("INTELLIGENCE_READ_SECRET");
    expect(assembler).not.toContain("plaid_transaction");
    expect(assembler).not.toContain("from \"@/lib/babylon/plaid");
    expect(assembler).not.toContain("muse");
    expect(assembler).not.toContain("notification_deliveries");
    expect(readFileSync("package.json", "utf8").toLowerCase()).not.toContain("muse");
    expect(readFileSync("package.json", "utf8").toLowerCase()).not.toContain("sindarin");
  });
});
