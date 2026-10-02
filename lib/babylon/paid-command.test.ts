import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { EMPTY_STATE } from "@/lib/babylon/constants";
import {
  serializeCloudVaultData,
  type CloudVaultGateway,
} from "@/lib/babylon/cloud-vault";
import {
  executePaidCommand,
  PAID_COMMAND_MAX_ATTEMPTS,
  PAID_UNCHANGED_DOCUMENT_KEYS,
  paidDocumentChangeIsBounded,
  parsePaidCommandBody,
} from "@/lib/babylon/paid-command";
import { transitionOccurrencePaid, type PaidPreimage } from "@/lib/babylon/paid-transition";
import {
  dueDateForMonth,
  recurringOccurrenceId,
} from "@/lib/babylon/recurring-obligations";
import type { ExpenseEntry, PersistedState, RecurringObligation } from "@/types/babylon";

const OWNER = "11111111-1111-4111-8111-111111111111";
const OTHER = "22222222-2222-4222-8222-222222222222";
const ZONE = "America/Denver";
const OCTOBER_FIRST = new Date("2026-10-02T02:30:00.000Z");
const OCTOBER_SECOND = new Date("2026-10-02T06:30:00.000Z");

function rule(): RecurringObligation {
  return {
    id: "phone-rule",
    name: "Phone",
    amount: 85,
    category: "need",
    budgetCategoryId: "utilities",
    dueDay: 15,
    startMonth: "2026-01",
    isActive: true,
    createdAt: "2026-01-02",
    skippedMonths: [],
  };
}

function expense(partial: Partial<ExpenseEntry> = {}): ExpenseEntry {
  return {
    id: "groceries",
    name: "Groceries",
    category: "need",
    amount: 40,
    date: "2026-01-03",
    dueDate: "2026-01-03",
    budgetCategoryId: "food",
    isSettled: false,
    ...partial,
  };
}

function richState(partial: Partial<PersistedState> = {}): PersistedState {
  return {
    ...EMPTY_STATE,
    financialTimeZone: ZONE,
    displayName: "Ada",
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
    debts: [
      {
        id: "debt-1",
        creditor: "Card",
        totalDebt: 200,
        remainingDebt: 80,
        monthlyAllocation: 40,
        createdAt: "2026-01-01",
        interestRate: 12,
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
    budgetTargets: [
      { id: "food", categoryName: "Food", plannedAmount: 200, isEssential: true },
    ],
    accounts: [
      {
        id: "acct-1",
        name: "Checking",
        kind: "checking",
        balance: 500,
        asOf: "2026-09-25",
      },
    ],
    activityLog: [
      {
        id: "act-1",
        kind: "income",
        title: "Payroll",
        createdAt: "2026-09-01T15:00:00.000Z",
      },
    ],
    emergencyShield: 15,
    periodArchives: [
      {
        id: "arch-1",
        monthKey: "2026-08",
        closedAt: "2026-09-01T00:00:00.000Z",
        totalIncome: 1000,
        totalSpent: 40,
        wealthAllocated: 100,
        debtAllocated: 200,
        expenditurePool: 700,
        expenditureRemaining: 660,
        surplusDisposition: "emergency_shield",
        surplusAmount: 15,
      },
    ],
    lastClosedMonthKey: "2026-08",
    openingWealthBuilding: 40,
    openingEmergencyFund: 10,
    recurringObligations: [rule()],
    monthlyPlans: [],
    paySchedules: [],
    expenses: [expense()],
    ...partial,
  };
}

function acknowledged(row: ExpenseEntry): PaidPreimage {
  return {
    name: row.name,
    amount: row.amount,
    category: row.category,
    dueDate: row.dueDate,
    budgetCategoryId: row.budgetCategoryId ?? null,
    recurringObligationId: row.recurringObligationId ?? null,
    recurrenceMonth: row.recurrenceMonth ?? null,
    isSettled: false,
  };
}

type Stored = {
  schemaVersion: number;
  revision: number;
  updatedAt: string;
  vaultData: unknown;
};

function memoryGateway(options?: {
  sessionUserId?: string | null;
  row?: Stored | null;
}) {
  let row = options?.row === undefined ? null : options.row;
  const calls: string[] = [];
  let conflictsRemaining = 0;
  let conflictMutator: ((current: Stored) => Stored) | null = null;
  const gateway: CloudVaultGateway = {
    async sessionUserId() {
      return options?.sessionUserId === undefined ? OWNER : options.sessionUserId;
    },
    async readVault(userId) {
      calls.push(`read:${userId}`);
      return { ok: true, row };
    },
    async initializeVault() {
      throw new Error("initialize is outside Paid");
    },
    async upgradeSchema5Vault() {
      calls.push("upgrade");
      throw new Error("schema upgrade is outside Paid");
    },
    async compareAndSwapVault(expectedRevision, schemaVersion, vaultData) {
      calls.push(`cas:${expectedRevision}`);
      if (!row || row.revision !== expectedRevision || row.schemaVersion !== schemaVersion) {
        return {
          ok: true,
          body: {
            status: "conflict",
            stored_revision: row?.revision ?? expectedRevision,
            schema_version: row?.schemaVersion ?? schemaVersion,
          },
        };
      }
      if (conflictsRemaining > 0) {
        conflictsRemaining -= 1;
        row = conflictMutator
          ? conflictMutator(row)
          : { ...row, revision: row.revision + 1 };
        return {
          ok: true,
          body: {
            status: "conflict",
            stored_revision: row.revision,
            schema_version: row.schemaVersion,
          },
        };
      }
      row = {
        schemaVersion,
        revision: expectedRevision + 1,
        updatedAt: "2026-10-01T12:00:00.000Z",
        vaultData,
      };
      return {
        ok: true,
        body: {
          status: "updated",
          revision: row.revision,
          schema_version: schemaVersion,
          updated_at: row.updatedAt,
        },
      };
    },
  };
  return {
    gateway,
    calls,
    stored: () => row,
    conflict(times: number, mutate?: (current: Stored) => Stored) {
      conflictsRemaining = times;
      conflictMutator = mutate ?? null;
    },
  };
}

function seed(state: PersistedState, revision = 4, schemaVersion = 6): Stored {
  return {
    schemaVersion,
    revision,
    updatedAt: "2026-09-01T00:00:00.000Z",
    vaultData: serializeCloudVaultData(state),
  };
}

describe("parsePaidCommandBody", () => {
  const row = expense();
  const valid = {
    occurrenceId: row.id,
    preimage: acknowledged(row),
  };

  it("accepts only the occurrence id and the acknowledged preimage", () => {
    expect(parsePaidCommandBody(valid)?.occurrenceId).toBe(row.id);
  });

  it("rejects vault data, user id, timezone, payment date, and any other key", () => {
    for (const extra of [
      { vault_data: { expenses: [] } },
      { userId: OTHER },
      { user_id: OTHER },
      { financialTimeZone: ZONE },
      { paymentDate: "2026-10-01" },
      { revision: 4 },
      { idempotencyKey: "k" },
    ]) {
      expect(parsePaidCommandBody({ ...valid, ...extra })).toBeNull();
    }
    expect(parsePaidCommandBody({ ...valid, preimage: { ...valid.preimage, date: "2026-01-03" } })).toBeNull();
    expect(parsePaidCommandBody({ ...valid, preimage: { ...valid.preimage, isSettled: true } })).toBeNull();
    expect(parsePaidCommandBody(null)).toBeNull();
  });
});

describe("paidDocumentChangeIsBounded", () => {
  it("accepts a single settled target and rejects every other document change", () => {
    const state = richState();
    const result = transitionOccurrencePaid({
      state,
      occurrenceId: "groceries",
      preimage: acknowledged(expense()),
      commitInstant: OCTOBER_FIRST,
    });
    expect(result.status).toBe("paid");
    if (result.status !== "paid") return;
    expect(paidDocumentChangeIsBounded(state, result.state, "groceries")).toBe(true);

    for (const key of PAID_UNCHANGED_DOCUMENT_KEYS) {
      const changed = structuredClone(result.state);
      const bag = changed as unknown as Record<string, unknown>;
      if (key === "financialTimeZone") changed.financialTimeZone = "America/Chicago";
      else if (key === "financialDestinations") {
        changed.financialDestinations = [
          {
            id: "dest-1",
            dimension: "owned_emergency_fund",
            relation: "at_least",
            amount: 1,
            declaredAt: "2026-10-01T00:00:00.000Z",
            supersedesId: null,
          },
        ];
      }
      else if (key === "financialDirections") {
        changed.financialDirections = [
          {
            id: "dir-1",
            purpose: "emergency_fund",
            basisPoints: 5000,
            declaredAt: "2026-10-01T00:00:00.000Z",
            supersedesId: null,
          },
        ];
      }
      else if (key === "displayName") changed.displayName = "Changed";
      else if (key === "activityLog") {
        changed.activityLog = [
          ...changed.activityLog,
          {
            id: "act-2",
            kind: "settle",
            title: "Groceries",
            subtitle: "Expense marked paid",
            createdAt: "2026-10-01T00:00:00.000Z",
          },
        ];
      } else if (typeof bag[key] === "number") bag[key] = (bag[key] as number) + 1;
      else if (Array.isArray(bag[key])) bag[key] = [{ id: "sentinel" }];
      else bag[key] = key === "lastClosedMonthKey" ? "1999-01" : "changed";
      expect(paidDocumentChangeIsBounded(state, changed, "groceries"), key).toBe(false);
    }

    const extra = structuredClone(result.state);
    extra.expenses.push(expense({ id: "other" }));
    expect(paidDocumentChangeIsBounded(state, extra, "groceries")).toBe(false);
    const renamed = structuredClone(result.state);
    renamed.expenses[0] = { ...renamed.expenses[0], name: "Other" };
    expect(paidDocumentChangeIsBounded(state, renamed, "groceries")).toBe(false);
  });

  it("preserves an existing direction history when marking one occurrence paid", () => {
    const directions = [
      {
        id: "dir-1",
        purpose: "emergency_fund" as const,
        basisPoints: 4000,
        declaredAt: "2026-10-01T00:00:00.000Z",
        supersedesId: null,
      },
    ];
    const state = richState({ financialDirections: directions });
    const result = transitionOccurrencePaid({
      state,
      occurrenceId: "groceries",
      preimage: acknowledged(expense()),
      commitInstant: OCTOBER_FIRST,
    });
    expect(result.status).toBe("paid");
    if (result.status !== "paid") return;
    expect(result.state.financialDirections).toEqual(directions);
    expect(result.state.financialDirections?.[0]).toBeDefined();
    expect(paidDocumentChangeIsBounded(state, result.state, "groceries")).toBe(true);
  });
});

describe("executePaidCommand", () => {
  it("writes one paid occurrence and leaves the rest of the canonical document", async () => {
    const state = richState();
    const harness = memoryGateway({ row: seed(state) });
    const result = await executePaidCommand({
      gateway: harness.gateway,
      userId: OWNER,
      occurrenceId: "groceries",
      preimage: acknowledged(expense()),
      now: () => OCTOBER_FIRST,
    });
    expect(result).toEqual({
      status: "paid",
      expenseId: "groceries",
      paymentDate: "2026-10-01",
      revision: 5,
    });
    const stored = harness.stored()?.vaultData as PersistedState;
    expect(stored.expenses).toEqual([{ ...expense(), isSettled: true, date: "2026-10-01" }]);
    expect(stored.activityLog).toEqual(state.activityLog);
    expect(stored.incomes).toEqual(state.incomes);
    expect(stored.debts).toEqual(state.debts);
    expect(stored.allocations).toEqual(state.allocations);
    expect(stored.budgetTargets).toEqual(state.budgetTargets);
    expect(stored.accounts).toEqual(state.accounts);
    expect(stored.recurringObligations).toEqual(state.recurringObligations);
    expect(stored.monthlyPlans).toEqual(state.monthlyPlans);
    expect(stored.paySchedules).toEqual(state.paySchedules);
    expect(stored.periodArchives).toEqual(state.periodArchives);
    expect(stored.lastClosedMonthKey).toBe(state.lastClosedMonthKey);
    expect(stored.openingWealthBuilding).toBe(state.openingWealthBuilding);
    expect(stored.openingEmergencyFund).toBe(state.openingEmergencyFund);
    expect(stored.emergencyShield).toBe(state.emergencyShield);
    expect(stored.displayName).toBe(state.displayName);
    expect(stored.financialTimeZone).toBe(ZONE);
    expect(harness.calls).not.toContain("upgrade");
  });

  it("materializes one derived occurrence and keeps an unrelated budget change", async () => {
    const id = recurringOccurrenceId("phone-rule", "2026-03")!;
    const state = richState({ expenses: [expense()] });
    const harness = memoryGateway({ row: seed(state) });
    harness.conflict(1, (current) => {
      const parsed = {
        ...(current.vaultData as PersistedState),
        budgetTargets: [
          { id: "food", categoryName: "Food", plannedAmount: 250, isEssential: true },
        ],
      };
      return {
        ...current,
        revision: current.revision + 1,
        vaultData: serializeCloudVaultData(parsed),
      };
    });
    const derived: ExpenseEntry = {
      id,
      name: "Phone",
      category: "need",
      amount: 85,
      date: dueDateForMonth(15, "2026-03"),
      dueDate: dueDateForMonth(15, "2026-03"),
      budgetCategoryId: "utilities",
      isSettled: false,
      recurringObligationId: "phone-rule",
      recurrenceMonth: "2026-03",
    };
    const result = await executePaidCommand({
      gateway: harness.gateway,
      userId: OWNER,
      occurrenceId: id,
      preimage: acknowledged(derived),
      now: () => OCTOBER_FIRST,
    });
    expect(result).toMatchObject({ status: "paid", paymentDate: "2026-10-01", revision: 6 });
    const stored = harness.stored()?.vaultData as PersistedState;
    expect(stored.budgetTargets[0]?.plannedAmount).toBe(250);
    expect(stored.expenses.map((row) => row.id)).toEqual([id, "groceries"]);
    expect(stored.expenses[0]?.isSettled).toBe(true);
    expect(stored.expenses[1]).toMatchObject({ id: "groceries", isSettled: false });
    expect(stored.activityLog).toEqual(state.activityLog);
  });

  it("does not write when the target, schema, vault, or timezone cannot be paid", async () => {
    const cases: Array<{ row: Stored; reason: string }> = [
      {
        row: seed(richState(), 4, 5),
        reason: "unsupported_schema",
      },
      {
        row: { ...seed(richState()), vaultData: { nope: true } },
        reason: "invalid_vault",
      },
      {
        row: seed(richState({ financialTimeZone: undefined })),
        reason: "financial_calendar_unknown",
      },
      {
        row: seed(richState()),
        reason: "unknown_occurrence",
      },
    ];
    for (const [index, item] of cases.entries()) {
      const harness = memoryGateway({ row: item.row });
      const result = await executePaidCommand({
        gateway: harness.gateway,
        userId: OWNER,
        occurrenceId: index === 3 ? "missing" : "groceries",
        preimage: acknowledged(expense()),
        now: () => OCTOBER_FIRST,
      });
      expect(result, item.reason).toEqual({ status: "rejected", reason: item.reason });
      expect(harness.calls.some((call) => call.startsWith("cas"))).toBe(false);
      expect(harness.calls).not.toContain("upgrade");
    }
  });

  it("does not write a skipped, inactive, legacy, or mismatched occurrence", async () => {
    const canonical = recurringOccurrenceId("phone-rule", "2026-03")!;
    const acknowledgedDerived = acknowledged({
      id: canonical,
      name: "Phone",
      category: "need",
      amount: 85,
      date: "2026-03-15",
      dueDate: "2026-03-15",
      budgetCategoryId: "utilities",
      isSettled: false,
      recurringObligationId: "phone-rule",
      recurrenceMonth: "2026-03",
    });
    const skipped = memoryGateway({
      row: seed(richState({
        recurringObligations: [{ ...rule(), skippedMonths: ["2026-03"] }],
        expenses: [],
      })),
    });
    expect(
      await executePaidCommand({
        gateway: skipped.gateway,
        userId: OWNER,
        occurrenceId: canonical,
        preimage: acknowledgedDerived,
        now: () => OCTOBER_FIRST,
      })
    ).toMatchObject({ status: "rejected", reason: "derived_unavailable" });
    expect(skipped.calls.some((call) => call.startsWith("cas"))).toBe(false);

    const inactive = memoryGateway({
      row: seed(richState({
        recurringObligations: [{ ...rule(), isActive: false }],
        expenses: [],
      })),
    });
    expect(
      await executePaidCommand({
        gateway: inactive.gateway,
        userId: OWNER,
        occurrenceId: canonical,
        preimage: acknowledgedDerived,
        now: () => OCTOBER_FIRST,
      })
    ).toMatchObject({ status: "rejected", reason: "derived_unavailable" });
    expect(inactive.calls.some((call) => call.startsWith("cas"))).toBe(false);

    const legacyId = "legacy-mar";
    const legacy = memoryGateway({
      row: seed(richState({
        expenses: [
          expense({
            id: legacyId,
            name: "Phone",
            amount: 85,
            date: "2026-03-15",
            dueDate: "2026-03-15",
            budgetCategoryId: "utilities",
            recurringObligationId: "phone-rule",
            recurrenceMonth: "2026-03",
          }),
        ],
      })),
    });
    expect(
      await executePaidCommand({
        gateway: legacy.gateway,
        userId: OWNER,
        occurrenceId: canonical,
        preimage: acknowledgedDerived,
        now: () => OCTOBER_FIRST,
      })
    ).toMatchObject({ status: "rejected", reason: "legacy_collision" });
    expect(legacy.calls.some((call) => call.startsWith("cas"))).toBe(false);
    expect((legacy.stored()?.vaultData as PersistedState).expenses).toHaveLength(1);

    const mismatch = memoryGateway({ row: seed(richState()) });
    expect(
      await executePaidCommand({
        gateway: mismatch.gateway,
        userId: OWNER,
        occurrenceId: "groceries",
        preimage: { ...acknowledged(expense()), amount: 41 },
        now: () => OCTOBER_FIRST,
      })
    ).toEqual({ status: "rejected", reason: "preimage_mismatch" });
    expect(mismatch.calls.some((call) => call.startsWith("cas"))).toBe(false);
  });

  it("preserves an established payment date across financial midnight", async () => {
    const paid = expense({ isSettled: true, date: "2026-10-01" });
    const harness = memoryGateway({ row: seed(richState({ expenses: [paid] })) });
    const result = await executePaidCommand({
      gateway: harness.gateway,
      userId: OWNER,
      occurrenceId: paid.id,
      preimage: acknowledged(paid),
      now: () => OCTOBER_SECOND,
    });
    expect(result).toEqual({
      status: "already_paid",
      expenseId: paid.id,
      paymentDate: "2026-10-01",
      revision: 4,
    });
    expect(harness.calls.some((call) => call.startsWith("cas"))).toBe(false);
    expect((harness.stored()?.vaultData as PersistedState).expenses[0]?.date).toBe("2026-10-01");
  });

  it("establishes the later civil date only when the earlier attempt did not commit", async () => {
    const harness = memoryGateway({ row: seed(richState()) });
    const instants = [OCTOBER_FIRST, OCTOBER_SECOND];
    let cursor = 0;
    harness.conflict(1);
    const result = await executePaidCommand({
      gateway: harness.gateway,
      userId: OWNER,
      occurrenceId: "groceries",
      preimage: acknowledged(expense()),
      now: () => instants[Math.min(cursor++, instants.length - 1)] ?? OCTOBER_SECOND,
    });
    expect(result).toMatchObject({ status: "paid", paymentDate: "2026-10-02" });
    expect((harness.stored()?.vaultData as PersistedState).expenses[0]?.date).toBe("2026-10-02");
  });

  it("re-reads after a revision conflict and rejects a target that changed", async () => {
    const harness = memoryGateway({ row: seed(richState()) });
    harness.conflict(1, (current) => {
      const parsed = current.vaultData as PersistedState;
      return {
        ...current,
        revision: current.revision + 1,
        vaultData: serializeCloudVaultData({
          ...parsed,
          expenses: [{ ...parsed.expenses[0], amount: 55 }],
        }),
      };
    });
    const result = await executePaidCommand({
      gateway: harness.gateway,
      userId: OWNER,
      occurrenceId: "groceries",
      preimage: acknowledged(expense()),
      now: () => OCTOBER_FIRST,
    });
    expect(result).toEqual({ status: "rejected", reason: "preimage_mismatch" });
    expect(harness.calls.filter((call) => call.startsWith("cas"))).toEqual(["cas:4"]);
    expect((harness.stored()?.vaultData as PersistedState).expenses[0]).toMatchObject({
      amount: 55,
      isSettled: false,
    });
  });

  it("stops after the bounded number of revision conflicts", async () => {
    const harness = memoryGateway({ row: seed(richState()) });
    harness.conflict(PAID_COMMAND_MAX_ATTEMPTS);
    const result = await executePaidCommand({
      gateway: harness.gateway,
      userId: OWNER,
      occurrenceId: "groceries",
      preimage: acknowledged(expense()),
      now: () => OCTOBER_FIRST,
    });
    expect(result).toEqual({ status: "conflict" });
    expect(harness.calls.filter((call) => call.startsWith("cas"))).toHaveLength(
      PAID_COMMAND_MAX_ATTEMPTS
    );
    expect((harness.stored()?.vaultData as PersistedState).expenses[0]?.isSettled).toBe(false);
  });

  it("does not read or write another user's vault", async () => {
    const harness = memoryGateway({ row: seed(richState()), sessionUserId: OWNER });
    const result = await executePaidCommand({
      gateway: harness.gateway,
      userId: OTHER,
      occurrenceId: "groceries",
      preimage: acknowledged(expense()),
      now: () => OCTOBER_FIRST,
    });
    expect(result).toEqual({ status: "forbidden" });
    expect(harness.calls).toEqual([]);
  });

  it("rejects an unauthenticated gateway before a read", async () => {
    const harness = memoryGateway({ row: seed(richState()), sessionUserId: null });
    const result = await executePaidCommand({
      gateway: harness.gateway,
      userId: OWNER,
      occurrenceId: "groceries",
      preimage: acknowledged(expense()),
    });
    expect(result).toEqual({ status: "unauthenticated" });
    expect(harness.calls).toEqual([]);
  });
});

describe("mobile and desktop paid boundaries", () => {
  it("keeps desktop toggle and reopen, and keeps mobile off the whole-vault toggle", () => {
    const hook = readFileSync("hooks/useBabylonEngine.ts", "utf8");
    const toggle = hook.slice(
      hook.indexOf("const toggleExpenseSettled ="),
      hook.indexOf("const markOccurrencePaid =")
    );
    const mobile = hook.slice(
      hook.indexOf("const markOccurrencePaid ="),
      hook.indexOf("const autoScaleBudgetCaps =")
    );
    expect(toggle).toContain("markExpensePaid");
    expect(toggle).toContain("Reopened as upcoming");
    expect(toggle).toContain("occurrenceForStewardAction");
    expect(mobile).toContain("submitMobilePaid");
    expect(mobile).not.toContain("toggleExpenseSettled");
    expect(mobile).not.toContain("setExpenses");
    expect(mobile).not.toContain("pushActivity");
    expect(mobile).not.toContain("savePersistedState");
    const matrices = readFileSync("components/babylon/ledger-matrices.tsx", "utf8");
    expect(matrices).toContain("onToggleExpenseSettled");
    const route = readFileSync("app/api/vault/mark-occurrence-paid/route.ts", "utf8");
    expect(route).not.toContain("getSupabaseServiceClient");
    expect(route).not.toContain("upgrade_wealth_engine_vault_schema_5");
    expect(route).toContain("createUserSupabaseClient");
    expect(route).toContain("auth.user.id");
  });
});
