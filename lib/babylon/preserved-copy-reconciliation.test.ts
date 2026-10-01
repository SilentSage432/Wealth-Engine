import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { EMPTY_STATE } from "@/lib/babylon/constants";
import {
  CLOUD_VAULT_SCHEMA_VERSION,
  financialVaultFingerprint,
  type CloudVaultGetResult,
  type CloudVaultUpdateResult,
} from "@/lib/babylon/cloud-vault";
import { monthlyPlanRevisionHistoryError } from "@/lib/babylon/monthly-plan";
import { shouldLaunchQueuedCloudCheck } from "@/lib/babylon/cloud-sync-check";
import {
  canConfirmPreservedCopies,
  confirmPreservedCopyReconciliation,
  CURRENT_BACKUP_CONFIRMATION_LABEL,
  CURRENT_BACKUP_PROMPT,
  evaluatePreservedCopyCandidate,
  legacyOccurrencePreviewCopy,
  logReconciliationDiagnostic,
  previewPreservedCopyReconciliation,
  RECONCILIATION_DIAGNOSTIC_TYPES,
  type ReconciliationDeps,
  type ReconciliationDiagnosticType,
  type ReconciliationStopCode,
} from "@/lib/babylon/preserved-copy-reconciliation";
import { recurringOccurrenceId } from "@/lib/babylon/recurring-obligations";
import { canonicalDurableJson } from "@/lib/babylon/vault-structural-diff";
import type { CloudSyncBaseline } from "@/lib/babylon/vault-sync";
import type {
  ActivityEvent,
  ExpenseEntry,
  MonthlyPlanRevision,
  PersistedState,
  RecurringObligation,
} from "@/types/babylon";

function plan(
  overrides: Partial<MonthlyPlanRevision> & Pick<MonthlyPlanRevision, "id" | "periodKey">
): MonthlyPlanRevision {
  const periodKey = overrides.periodKey;
  return {
    revision: 1,
    finalizedAt: `${periodKey}-01T12:00:00.000Z`,
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
    debts: [],
    obligations: [
      {
        id: "ob-1",
        name: "Rent",
        amount: 1200,
        category: "need",
        budgetCategoryId: "cat-1",
        dueDay: 1,
        intervalMonths: 1,
        dueDate: `${periodKey}-01`,
      },
    ],
    protectedContext: {
      openingWealthBuilding: 10,
      openingEmergencyFund: 20,
    },
    ...overrides,
  };
}

function activity(id: string, title: string): ActivityEvent {
  return {
    id,
    kind: "budget",
    title,
    createdAt: "2026-09-30T12:00:00.000Z",
  };
}

function account(id: string, name: string) {
  return {
    id,
    name,
    kind: "checking" as const,
    balance: 100,
    asOf: "2026-09-25",
  };
}

function incident() {
  const shared = account("acct-shared", "Checking");
  const expense = {
    id: "exp-shared",
    name: "Rent",
    category: "need" as const,
    amount: 50,
    date: "2026-09-01",
    dueDate: "2026-09-01",
    isSettled: false,
  };
  const september = plan({ id: "plan-sep", periodKey: "2026-09" });
  const octoberFirst = plan({ id: "plan-oct-1", periodKey: "2026-10" });
  const octoberSecond = plan({
    id: "plan-oct-2",
    periodKey: "2026-10",
    revision: 2,
    supersedesId: "plan-oct-1",
    planningBasis: 3200,
    wealthShare: 320,
    debtShare: 640,
    expenditureShare: 2240,
  });
  const local: PersistedState = {
    ...EMPTY_STATE,
    displayName: "Ada",
    accounts: [shared],
    expenses: [expense],
    monthlyPlans: [octoberFirst, octoberSecond],
    activityLog: [activity("act-shared", "Shared note"), activity("act-phone", "Phone note")],
    debtPositionEpochAt: "2026-08-01T00:00:00.000Z",
  };
  const cloud: PersistedState = {
    ...local,
    accounts: [
      shared,
      account("acct-c1", "Cloud One"),
      account("acct-c2", "Cloud Two"),
      account("acct-c3", "Cloud Three"),
      account("acct-c4", "Cloud Four"),
    ],
    monthlyPlans: [september, octoberFirst],
    activityLog: [
      activity("act-shared", "Shared note"),
      activity("act-cloud", "Cloud note"),
    ],
    debtPositionEpochAt: "2026-09-15T00:00:00.000Z",
  };
  return { local, cloud };
}

function present(
  vaultData: PersistedState,
  revision: number
): CloudVaultGetResult {
  return {
    status: "present",
    schemaVersion: CLOUD_VAULT_SCHEMA_VERSION,
    revision,
    updatedAt: "2026-09-30T00:00:00.000Z",
    vaultData,
  };
}

function harness(input?: {
  local?: PersistedState;
  cloud?: PersistedState;
  baseline?: CloudSyncBaseline | null;
  kind?: string;
  hold?: "clear" | "sync" | "reconciliation";
  conflictFingerprint?: string | null;
  sessionUserId?: string | null;
  owner?: string | null;
}) {
  const built = incident();
  let local = input?.local ?? built.local;
  let cloud = input?.cloud ?? built.cloud;
  let baseline =
    input && "baseline" in input
      ? input.baseline ?? null
      : ({ revision: 30, fingerprint: "baseline-fp" } satisfies CloudSyncBaseline);
  let kind = input?.kind ?? "conflict";
  let hold = input?.hold ?? "clear";
  let conflictFingerprint =
    input && "conflictFingerprint" in input
      ? input.conflictFingerprint ?? null
      : financialVaultFingerprint(local);
  let sessionUserId =
    input && "sessionUserId" in input ? input.sessionUserId ?? null : "user-1";
  let owner = input && "owner" in input ? input.owner ?? null : "user-1";
  let revision = 39;
  let phone = local;
  let applyOk = true;
  let baselineOk = true;
  let pushResult: CloudVaultUpdateResult | null = null;
  let readback: CloudVaultGetResult | "sent" | null = null;
  let mutateDuringRead: (() => void) | null = null;
  const pushes: { revision: number; state: PersistedState }[] = [];
  const baselines: CloudSyncBaseline[] = [];
  const order: string[] = [];
  const logs: ReconciliationDiagnosticType[] = [];
  let reads = 0;

  const deps: ReconciliationDeps = {
    sessionUserId,
    readOwner: () => owner,
    readSyncKind: () => kind,
    readBaseline: () => baseline,
    readLocal: () => local,
    readConflictLocalFingerprint: () => conflictFingerprint,
    readOccupied: () => hold,
    reserve: () => {
      if (hold === "sync") return "sync_occupied";
      if (hold === "reconciliation") return "reconciliation_occupied";
      hold = "reconciliation";
      return "reserved";
    },
    release: () => {
      hold = "clear";
    },
    readCloud: async () => {
      reads += 1;
      mutateDuringRead?.();
      order.push(reads >= 3 ? "readback" : "read");
      if (reads >= 3 && readback) {
        if (readback === "sent") {
          return present(pushes[0].state, revision + 1);
        }
        return readback;
      }
      return present(cloud, revision);
    },
    pushCloud: async (expectedRevision, state) => {
      if (pushes.length > 0) {
        throw new Error("second CAS");
      }
      pushes.push({ revision: expectedRevision, state });
      order.push("cas");
      if (pushResult) return pushResult;
      return {
        status: "updated",
        schemaVersion: CLOUD_VAULT_SCHEMA_VERSION,
        revision: expectedRevision + 1,
        updatedAt: "2026-09-30T01:00:00.000Z",
      };
    },
    applyLocal: (state) => {
      order.push("apply");
      if (!applyOk) return false;
      phone = state;
      return true;
    },
    writeBaseline: (next) => {
      order.push("baseline");
      baselines.push(next);
      if (!baselineOk) return false;
      baseline = next;
      return true;
    },
    log: (type) => {
      logs.push(type);
    },
  };

  return {
    deps,
    pushes,
    baselines,
    order,
    logs,
    get phone() {
      return phone;
    },
    get local() {
      return local;
    },
    get hold() {
      return hold;
    },
    setLocal(next: PersistedState) {
      local = next;
    },
    setCloud(next: PersistedState) {
      cloud = next;
    },
    setBaseline(next: CloudSyncBaseline | null) {
      baseline = next;
    },
    setKind(next: string) {
      kind = next;
    },
    setRevision(next: number) {
      revision = next;
    },
    setConflictFingerprint(next: string | null) {
      conflictFingerprint = next;
    },
    setPushResult(next: CloudVaultUpdateResult) {
      pushResult = next;
    },
    setReadback(next: CloudVaultGetResult | "sent") {
      readback = next;
    },
    setApplyOk(next: boolean) {
      applyOk = next;
    },
    setBaselineOk(next: boolean) {
      baselineOk = next;
    },
    setMutateDuringRead(fn: () => void) {
      mutateDuringRead = fn;
    },
    setSession(next: string | null) {
      sessionUserId = next;
      deps.sessionUserId = next;
    },
    setOwner(next: string | null) {
      owner = next;
    },
  };
}

describe("preserved copy candidate", () => {
  it("builds the incident shape from fresh copies", () => {
    const { local, cloud } = incident();
    const evaluated = evaluatePreservedCopyCandidate(local, cloud);
    expect(evaluated.ok).toBe(true);
    if (!evaluated.ok) return;

    expect(evaluated.candidate.accounts).toEqual(cloud.accounts);
    expect(evaluated.candidate.accounts).toHaveLength(5);
    expect(evaluated.candidate.monthlyPlans.map((row) => row.id)).toEqual([
      "plan-sep",
      "plan-oct-1",
      "plan-oct-2",
    ]);
    expect(evaluated.candidate.monthlyPlans[2]).toMatchObject({
      id: "plan-oct-2",
      revision: 2,
      supersedesId: "plan-oct-1",
      periodKey: "2026-10",
    });
    expect(evaluated.candidate.activityLog.map((row) => row.id)).toEqual([
      "act-shared",
      "act-cloud",
      "act-phone",
    ]);
    expect(evaluated.candidate.debtPositionEpochAt).toBe(cloud.debtPositionEpochAt);
    expect(evaluated.candidate.expenses).toEqual(cloud.expenses);
    expect(evaluated.candidate.openingWealthBuilding).toBe(cloud.openingWealthBuilding);
    expect(monthlyPlanRevisionHistoryError(evaluated.candidate.monthlyPlans)).toBeNull();
    expect(evaluated.cloudMonthLabels).toEqual(["September 2026"]);
    expect(evaluated.localMonthLabels).toEqual(["October 2026"]);
    expect(evaluated.candidate.activityLog).toHaveLength(3);
    expect(evaluated.shape).toBe("plan-incident");
  });

  it("keeps an unknown cloud field and does not take the phone field", () => {
    const { local, cloud } = incident();
    const cloudMarked = { ...cloud, marker: "from-cloud" } as PersistedState & {
      marker?: string;
    };
    const localMarked = { ...local, marker: "from-phone" } as PersistedState & {
      marker?: string;
    };
    const evaluated = evaluatePreservedCopyCandidate(localMarked, cloudMarked);
    expect(evaluated.ok).toBe(true);
    if (!evaluated.ok) return;
    expect((evaluated.candidate as PersistedState & { marker?: string }).marker).toBe(
      "from-cloud"
    );
    expect(evaluated.candidate.accounts).toEqual(cloud.accounts);
    expect(evaluated.candidate.displayName).toBe(cloud.displayName);
  });

  it("accepts one cloud-only account and refuses zero", () => {
    const { local, cloud } = incident();
    const one = {
      ...cloud,
      accounts: [cloud.accounts[0], cloud.accounts[1]],
    };
    expect(evaluatePreservedCopyCandidate(local, one).ok).toBe(true);
    const none = { ...cloud, accounts: [cloud.accounts[0]] };
    const refused = evaluatePreservedCopyCandidate(local, none);
    expect(refused.ok).toBe(false);
    if (refused.ok) return;
    expect(refused.code).toBe("unsupported_shape");
  });

  it("derives month labels from the fresh plans", () => {
    const { local, cloud } = incident();
    const november = plan({ id: "plan-nov", periodKey: "2026-11" });
    const december = plan({ id: "plan-dec", periodKey: "2026-12" });
    const evaluated = evaluatePreservedCopyCandidate(
      { ...local, monthlyPlans: [november] },
      { ...cloud, monthlyPlans: [december] }
    );
    expect(evaluated.ok).toBe(true);
    if (!evaluated.ok) return;
    expect(evaluated.localMonthLabels).toEqual(["November 2026"]);
    expect(evaluated.cloudMonthLabels).toEqual(["December 2026"]);
    expect(evaluated.cloudMonthLabels.join(" ")).not.toContain("September");
  });
});

/**
 * Preserved rev42/rev43 occurrence identities.
 * Amounts and names here are not the production values.
 * The pair relationship is: same document, plus four November rows that match
 * in every persisted field except the generated expense id.
 */
const REV42_OCCURRENCE_PAIRS = [
  {
    ruleId: "1c59d04a-6e20-4367-a65c-29405549eb32",
    dueDay: 9,
    phoneId: "806c3b62-00fd-49c0-850f-380ed6aea769",
    cloudId: "a25873de-7a9a-4458-929a-61eeb99f3ef3",
    budgetCategoryId: "053598ef-5872-43eb-9562-d4ce2d67fd41",
    amount: 11,
  },
  {
    ruleId: "63c087d9-0429-402b-bf51-d3fd115b96f3",
    dueDay: 12,
    phoneId: "19be1ad1-a82b-4784-875d-28a9656f974a",
    cloudId: "9e160643-3eae-450f-acf4-7f0119d7098a",
    budgetCategoryId: "4879522c-f761-4502-8adb-c6f95c21982d",
    amount: 12,
  },
  {
    ruleId: "8d6d13e3-aa8e-4727-abf6-ab165cb4c059",
    dueDay: 16,
    phoneId: "affacf94-7172-4370-aa74-43e34f9b6848",
    cloudId: "9bf67406-352f-45cc-b2e6-28ced1138612",
    budgetCategoryId: "4879522c-f761-4502-8adb-c6f95c21982d",
    amount: 16,
  },
  {
    ruleId: "6c2a41ac-9940-43e8-bc67-8610bca32319",
    dueDay: 26,
    phoneId: "9f08e0ba-ecf8-411a-b3e6-978f7383615a",
    cloudId: "50df9b9e-d2df-4865-8ff1-f996e60bb2c1",
    budgetCategoryId: "4879522c-f761-4502-8adb-c6f95c21982d",
    amount: 26,
  },
] as const;

function dueOn(month: string, dueDay: number): string {
  return `${month}-${String(dueDay).padStart(2, "0")}`;
}

function legacyRule(
  id: string,
  dueDay: number,
  budgetCategoryId: string,
  amount: number,
  startMonth = "2026-10",
  intervalMonths?: number
): RecurringObligation {
  return {
    id,
    name: `Rule ${dueDay}`,
    amount,
    category: "need",
    budgetCategoryId,
    dueDay,
    startMonth,
    ...(intervalMonths ? { intervalMonths } : {}),
    isActive: true,
    createdAt: "2026-09-01",
    skippedMonths: [],
  };
}

function generatedExpense(
  id: string,
  rule: RecurringObligation,
  month: string,
  overrides: Partial<ExpenseEntry> = {}
): ExpenseEntry {
  const dueDate = dueOn(month, rule.dueDay);
  return {
    id,
    name: rule.name,
    category: rule.category,
    amount: rule.amount,
    date: dueDate,
    dueDate,
    budgetCategoryId: rule.budgetCategoryId,
    isSettled: false,
    recurringObligationId: rule.id,
    recurrenceMonth: month,
    ...overrides,
  };
}

function legacyEquivalentIncident() {
  const rules = [
    ...REV42_OCCURRENCE_PAIRS.map((pair) =>
      legacyRule(pair.ruleId, pair.dueDay, pair.budgetCategoryId, pair.amount)
    ),
    legacyRule(
      "rule-quarterly-2026-12",
      26,
      "4879522c-f761-4502-8adb-c6f95c21982d",
      40,
      "2026-12",
      3
    ),
  ];
  const sharedExpenses: ExpenseEntry[] = [
    ...REV42_OCCURRENCE_PAIRS.map((pair) =>
      generatedExpense(
        `oct-${pair.ruleId}`,
        rules.find((rule) => rule.id === pair.ruleId)!,
        "2026-10"
      )
    ),
    ...[1, 2, 3, 4, 5].map(
      (index): ExpenseEntry => ({
        id: `shared-one-off-${index}`,
        name: `Shared ${index}`,
        category: "need",
        amount: index,
        date: "2026-09-02",
        dueDate: "2026-09-02",
        isSettled: true,
      })
    ),
  ];
  const phoneNovember = REV42_OCCURRENCE_PAIRS.map((pair) =>
    generatedExpense(
      pair.phoneId,
      rules.find((rule) => rule.id === pair.ruleId)!,
      "2026-11"
    )
  );
  const cloudNovember = REV42_OCCURRENCE_PAIRS.map((pair) =>
    generatedExpense(
      pair.cloudId,
      rules.find((rule) => rule.id === pair.ruleId)!,
      "2026-11"
    )
  );
  const base: PersistedState = {
    ...EMPTY_STATE,
    displayName: "Ada",
    accounts: [account("acct-shared", "Checking")],
    recurringObligations: rules,
    expenses: sharedExpenses,
    monthlyPlans: [
      plan({ id: "plan-sep", periodKey: "2026-09" }),
      plan({ id: "plan-oct-1", periodKey: "2026-10" }),
      plan({
        id: "plan-oct-2",
        periodKey: "2026-10",
        revision: 2,
        supersedesId: "plan-oct-1",
      }),
    ],
    activityLog: [activity("act-shared", "Shared note")],
    debtPositionEpochAt: "2026-09-29T15:19:22.654Z",
    lastClosedMonthKey: "2026-09",
  };
  return {
    local: { ...base, expenses: [...sharedExpenses, ...phoneNovember] },
    cloud: { ...base, expenses: [...sharedExpenses, ...cloudNovember] },
  };
}

function documentExceptExpenses(state: PersistedState): string {
  const clone = structuredClone(state);
  clone.expenses = [];
  return canonicalDurableJson(clone);
}

function novemberRows(state: PersistedState): ExpenseEntry[] {
  return state.expenses.filter((row) => row.recurrenceMonth === "2026-11");
}

function semanticSurvivorIds(state: PersistedState): string[] {
  return novemberRows(state)
    .map((row) => `${row.recurringObligationId}:${row.recurrenceMonth}:${row.id}`)
    .sort();
}

describe("legacy equivalent generated occurrences", () => {
  it("collapses the rev42/rev43 pair to four November rows", () => {
    const { local, cloud } = legacyEquivalentIncident();
    expect(local.expenses).toHaveLength(13);
    expect(cloud.expenses).toHaveLength(13);
    expect(novemberRows(local)).toHaveLength(4);
    expect(novemberRows(cloud)).toHaveLength(4);

    const evaluated = evaluatePreservedCopyCandidate(local, cloud);
    expect(evaluated.ok).toBe(true);
    if (!evaluated.ok) return;
    expect(evaluated.shape).toBe("legacy-occurrences");
    if (evaluated.shape !== "legacy-occurrences") return;

    expect(evaluated.collapsedPairs).toBe(4);
    expect(evaluated.candidate.expenses).toHaveLength(13);
    expect(novemberRows(evaluated.candidate)).toHaveLength(4);
    expect(evaluated.candidate.expenses).not.toHaveLength(17);
    const survivorIds = novemberRows(evaluated.candidate).map((row) => row.id).sort();
    expect(survivorIds).toEqual([
      "19be1ad1-a82b-4784-875d-28a9656f974a",
      "50df9b9e-d2df-4865-8ff1-f996e60bb2c1",
      "806c3b62-00fd-49c0-850f-380ed6aea769",
      "9bf67406-352f-45cc-b2e6-28ced1138612",
    ]);
    const kept = new Set(survivorIds);
    for (const pair of REV42_OCCURRENCE_PAIRS) {
      const present = [pair.phoneId, pair.cloudId].filter((id) => kept.has(id));
      expect(present).toHaveLength(1);
    }
    for (const row of evaluated.candidate.expenses) {
      const source =
        local.expenses.find((item) => item.id === row.id) ??
        cloud.expenses.find((item) => item.id === row.id);
      expect(source).toEqual(row);
    }
    expect(documentExceptExpenses(evaluated.candidate)).toBe(documentExceptExpenses(local));
    expect(documentExceptExpenses(evaluated.candidate)).toBe(documentExceptExpenses(cloud));
    expect(
      evaluated.candidate.expenses.filter((row) => row.recurrenceMonth === "2026-10")
    ).toHaveLength(4);
    expect(
      evaluated.candidate.expenses.some(
        (row) => row.recurringObligationId === "rule-quarterly-2026-12"
      )
    ).toBe(false);
  });

  it("keeps one row when equal generated occurrences differ only by id", () => {
    const { local, cloud } = legacyEquivalentIncident();
    const evaluated = evaluatePreservedCopyCandidate(local, cloud);
    expect(evaluated.ok).toBe(true);
    if (!evaluated.ok) return;
    const keys = new Set(
      novemberRows(evaluated.candidate).map(
        (row) => `${row.recurringObligationId}:${row.recurrenceMonth}`
      )
    );
    expect(keys.size).toBe(4);
  });

  it("refuses an amount, due date, category, or settled mismatch", () => {
    const mismatches: Array<(row: ExpenseEntry) => ExpenseEntry> = [
      (row) => ({ ...row, amount: row.amount + 1 }),
      (row) => ({ ...row, dueDate: "2026-11-01" }),
      (row) => ({ ...row, category: "desire" }),
      (row) => ({ ...row, isSettled: true }),
    ];
    for (const mismatch of mismatches) {
      const { local, cloud } = legacyEquivalentIncident();
      const cloudExpenses = cloud.expenses.map((row) =>
        row.id === REV42_OCCURRENCE_PAIRS[0].cloudId ? mismatch(row) : row
      );
      const evaluated = evaluatePreservedCopyCandidate(local, {
        ...cloud,
        expenses: cloudExpenses,
      });
      expect(evaluated.ok).toBe(false);
      if (evaluated.ok) continue;
      expect(evaluated.code).toBe("unsupported_shape");
    }
  });

  it("refuses one-off expenses that differ only by id", () => {
    const { local, cloud } = legacyEquivalentIncident();
    const strip = (row: ExpenseEntry): ExpenseEntry => {
      const { recurringObligationId: _rule, recurrenceMonth: _month, ...rest } = row;
      void _rule;
      void _month;
      return rest;
    };
    const phoneId = REV42_OCCURRENCE_PAIRS[0].phoneId;
    const cloudId = REV42_OCCURRENCE_PAIRS[0].cloudId;
    const evaluated = evaluatePreservedCopyCandidate(
      {
        ...local,
        expenses: local.expenses.map((row) => (row.id === phoneId ? strip(row) : row)),
      },
      {
        ...cloud,
        expenses: cloud.expenses.map((row) => (row.id === cloudId ? strip(row) : row)),
      }
    );
    expect(evaluated.ok).toBe(false);
  });

  it("keeps a different rule or month as a distinct occurrence", () => {
    const { local, cloud } = legacyEquivalentIncident();
    const cloudId = REV42_OCCURRENCE_PAIRS[0].cloudId;
    const otherMonth = evaluatePreservedCopyCandidate(local, {
      ...cloud,
      expenses: cloud.expenses.map((row) =>
        row.id === cloudId
          ? {
              ...row,
              recurrenceMonth: "2026-12",
              date: "2026-12-09",
              dueDate: "2026-12-09",
            }
          : row
      ),
    });
    expect(otherMonth.ok).toBe(false);

    const otherRule = evaluatePreservedCopyCandidate(local, {
      ...cloud,
      expenses: cloud.expenses.map((row) =>
        row.id === cloudId
          ? { ...row, recurringObligationId: "rule-quarterly-2026-12" }
          : row
      ),
    });
    expect(otherRule.ok).toBe(false);
  });

  it("refuses duplicate semantic claims on one side", () => {
    const { local, cloud } = legacyEquivalentIncident();
    const pair = REV42_OCCURRENCE_PAIRS[0];
    const rule = local.recurringObligations.find((item) => item.id === pair.ruleId)!;
    const duplicate = generatedExpense("second-phone-id", rule, "2026-11");
    const evaluated = evaluatePreservedCopyCandidate(
      { ...local, expenses: [...local.expenses, duplicate] },
      cloud
    );
    expect(evaluated.ok).toBe(false);
    if (evaluated.ok) return;
    expect(evaluated.code).toBe("unsupported_shape");
  });

  it("selects the same survivor regardless of expense order", () => {
    const { local, cloud } = legacyEquivalentIncident();
    const forward = evaluatePreservedCopyCandidate(local, cloud);
    const reversedLocal = evaluatePreservedCopyCandidate(
      { ...local, expenses: [...local.expenses].reverse() },
      cloud
    );
    const swapped = evaluatePreservedCopyCandidate(cloud, local);
    expect(forward.ok && reversedLocal.ok && swapped.ok).toBe(true);
    if (!forward.ok || !reversedLocal.ok || !swapped.ok) return;
    expect(reversedLocal.candidate).toEqual(forward.candidate);
    expect(semanticSurvivorIds(swapped.candidate)).toEqual(
      semanticSurvivorIds(forward.candidate)
    );
  });

  it("prefers the canonical occurrence id over the lexicographically smaller id", () => {
    const { local, cloud } = legacyEquivalentIncident();
    const pair = REV42_OCCURRENCE_PAIRS[0];
    const canonical = recurringOccurrenceId(pair.ruleId, "2026-11");
    expect(canonical).toBeTruthy();
    const smaller = "00000000-0000-4000-8000-000000000001";
    expect(smaller < (canonical ?? "")).toBe(true);
    const evaluated = evaluatePreservedCopyCandidate(
      {
        ...local,
        expenses: local.expenses.map((row) =>
          row.id === pair.phoneId ? { ...row, id: canonical! } : row
        ),
      },
      {
        ...cloud,
        expenses: cloud.expenses.map((row) =>
          row.id === pair.cloudId ? { ...row, id: smaller } : row
        ),
      }
    );
    expect(evaluated.ok).toBe(true);
    if (!evaluated.ok) return;
    expect(
      novemberRows(evaluated.candidate).some((row) => row.id === canonical)
    ).toBe(true);
    expect(
      novemberRows(evaluated.candidate).some((row) => row.id === smaller)
    ).toBe(false);
  });

  it("previews one row per matching occurrence and does not describe a plan merge", async () => {
    const { local, cloud } = legacyEquivalentIncident();
    const copy = legacyOccurrencePreviewCopy({
      pairCount: 4,
      monthLabels: ["November 2026"],
    });
    expect(copy.bullets[0]).toContain("4 matching recurring occurrences");
    expect(copy.bullets.join(" ")).not.toContain("planning history");
    const box = harness({ local, cloud });
    const preview = await previewPreservedCopyReconciliation(box.deps);
    expect(preview.ok).toBe(true);
    if (!preview.ok) return;
    expect(preview.intro).toBe(copy.intro);
    expect(preview.bullets[0]).toContain("November 2026");
    expect(preview.bullets.join(" ")).not.toContain("planning history");
    expect(preview.bullets.join(" ")).not.toContain("accounts currently stored");
  });
});

describe("preserved copy preview refusals", () => {
  const cases: {
    name: string;
    code: ReconciliationStopCode;
    mutate: (pair: { local: PersistedState; cloud: PersistedState }) => {
      local: PersistedState;
      cloud: PersistedState;
    };
  }[] = [
    {
      name: "A local-only account",
      code: "unsupported_shape",
      mutate: ({ local, cloud }) => ({
        cloud,
        local: {
          ...local,
          accounts: [...local.accounts, account("acct-local", "Cash")],
        },
      }),
    },
    {
      name: "B shared account differs",
      code: "shared_record_divergence",
      mutate: ({ local, cloud }) => ({
        local,
        cloud: {
          ...cloud,
          accounts: cloud.accounts.map((row) =>
            row.id === "acct-shared" ? { ...row, balance: 999 } : row
          ),
        },
      }),
    },
    {
      name: "C shared income differs",
      code: "shared_record_divergence",
      mutate: ({ local, cloud }) => {
        const row = {
          id: "inc-1",
          source: "Job",
          amount: 100,
          date: "2026-09-01",
          interval: "monthly" as const,
          kind: "primary" as const,
          wealthShare: 10,
          debtShare: 20,
          expenditureShare: 70,
          debtRedirected: false,
        };
        return {
          local: { ...local, incomes: [row] },
          cloud: { ...cloud, incomes: [{ ...row, amount: 80 }] },
        };
      },
    },
    {
      name: "D shared expense differs",
      code: "shared_record_divergence",
      mutate: ({ local, cloud }) => ({
        local,
        cloud: {
          ...cloud,
          expenses: cloud.expenses.map((row) => ({ ...row, amount: 1 })),
        },
      }),
    },
    {
      name: "E shared debt differs",
      code: "shared_record_divergence",
      mutate: ({ local, cloud }) => {
        const row = {
          id: "debt-1",
          creditor: "Card",
          totalDebt: 200,
          remainingDebt: 200,
          monthlyAllocation: 20,
          createdAt: "2026-09-01T00:00:00.000Z",
          interestRate: 0,
        };
        return {
          local: { ...local, debts: [row] },
          cloud: { ...cloud, debts: [{ ...row, remainingDebt: 150 }] },
        };
      },
    },
    {
      name: "F shared allocation differs",
      code: "shared_record_divergence",
      mutate: ({ local, cloud }) => {
        const row = {
          id: "alloc-1",
          incomeId: "inc-1",
          date: "2026-09-01",
          monthKey: "2026-09",
          gross: 100,
          wealth: 10,
          debt: 20,
          expenditure: 70,
        };
        return {
          local: { ...local, allocations: [row] },
          cloud: { ...cloud, allocations: [{ ...row, gross: 90 }] },
        };
      },
    },
    {
      name: "G shared recurring obligation differs",
      code: "shared_record_divergence",
      mutate: ({ local, cloud }) => {
        const row = {
          id: "rule-1",
          name: "Rent",
          amount: 50,
          category: "need" as const,
          budgetCategoryId: "bud-1",
          dueDay: 1,
          startMonth: "2026-09",
          isActive: true,
          createdAt: "2026-09-01",
          skippedMonths: [] as string[],
        };
        return {
          local: { ...local, recurringObligations: [row] },
          cloud: {
            ...cloud,
            recurringObligations: [{ ...row, amount: 40 }],
          },
        };
      },
    },
    {
      name: "H shared expected pay schedule differs",
      code: "shared_record_divergence",
      mutate: ({ local, cloud }) => {
        const row = {
          id: "pay-1",
          cadence: "monthly" as const,
          dayOfMonth: 1,
          createdAt: "2026-09-01",
        };
        return {
          local: { ...local, paySchedules: [row] },
          cloud: { ...cloud, paySchedules: [{ ...row, dayOfMonth: 15 }] },
        };
      },
    },
    {
      name: "I shared period archive differs",
      code: "shared_record_divergence",
      mutate: ({ local, cloud }) => {
        const row = {
          id: "arch-1",
          monthKey: "2026-08",
          closedAt: "2026-09-01T00:00:00.000Z",
          totalIncome: 1,
          totalSpent: 1,
          wealthAllocated: 0,
          debtAllocated: 0,
          expenditurePool: 1,
          expenditureRemaining: 0,
          surplusDisposition: "emergency_shield" as const,
          surplusAmount: 0,
        };
        return {
          local: { ...local, periodArchives: [row] },
          cloud: { ...cloud, periodArchives: [{ ...row, totalIncome: 2 }] },
        };
      },
    },
    {
      name: "shared budget target differs",
      code: "shared_record_divergence",
      mutate: ({ local, cloud }) => {
        const row = {
          id: "bud-1",
          categoryName: "Rent",
          plannedAmount: 50,
          isEssential: true,
        };
        return {
          local: { ...local, budgetTargets: [row] },
          cloud: { ...cloud, budgetTargets: [{ ...row, plannedAmount: 40 }] },
        };
      },
    },
    {
      name: "shared debt purpose attribution differs",
      code: "shared_record_divergence",
      mutate: ({ local, cloud }) => {
        const row = {
          id: "attr-1",
          allocationEventId: "alloc-1",
          debtId: "debt-1",
          amount: 20,
          date: "2026-09-01",
          monthKey: "2026-09",
        };
        return {
          local: { ...local, debtPurposeAttributions: [row] },
          cloud: {
            ...cloud,
            debtPurposeAttributions: [{ ...row, amount: 5 }],
          },
        };
      },
    },
    {
      name: "J financial scalar differs",
      code: "financial_scalar_differs",
      mutate: ({ local, cloud }) => ({
        local,
        cloud: { ...cloud, openingWealthBuilding: 25 },
      }),
    },
    {
      name: "K same monthly-plan id differs",
      code: "same_plan_id_differs",
      mutate: ({ local, cloud }) => ({
        local,
        cloud: {
          ...cloud,
          monthlyPlans: cloud.monthlyPlans.map((row) =>
            row.id === "plan-oct-1" ? { ...row, planningBasis: 1 } : row
          ),
        },
      }),
    },
    {
      name: "L competing same-month plan",
      code: "competing_same_month",
      mutate: ({ local, cloud }) => ({
        local: {
          ...local,
          monthlyPlans: [plan({ id: "plan-oct-a", periodKey: "2026-10" })],
        },
        cloud: {
          ...cloud,
          monthlyPlans: [
            plan({
              id: "plan-oct-b",
              periodKey: "2026-10",
              planningBasis: 1000,
              wealthShare: 100,
              debtShare: 200,
              expenditureShare: 700,
            }),
          ],
        },
      }),
    },
    {
      name: "M monthly-plan chain invalid",
      code: "monthly_plan_chain_invalid",
      mutate: ({ local, cloud }) => {
        const octoberThird = plan({
          id: "plan-oct-3",
          periodKey: "2026-10",
          revision: 3,
          supersedesId: "plan-oct-1",
        });
        return {
          local: {
            ...local,
            monthlyPlans: [
              local.monthlyPlans[0],
              octoberThird,
            ],
          },
          cloud,
        };
      },
    },
    {
      name: "N missing predecessor",
      code: "missing_predecessor",
      mutate: ({ local, cloud }) => ({
        local: {
          ...local,
          monthlyPlans: [
            plan({
              id: "plan-oct-2",
              periodKey: "2026-10",
              revision: 2,
              supersedesId: "plan-missing",
            }),
          ],
        },
        cloud: {
          ...cloud,
          monthlyPlans: [plan({ id: "plan-sep", periodKey: "2026-09" })],
        },
      }),
    },
  ];

  it.each(cases)("$name refuses before any cloud write", async ({ code, mutate }) => {
    const pair = mutate(incident());
    const box = harness({ local: pair.local, cloud: pair.cloud });
    const outcome = await previewPreservedCopyReconciliation(box.deps);
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.code).toBe(code);
    expect(outcome.phase).toBe("before_write");
    expect(box.pushes).toHaveLength(0);
    expect(box.order).not.toContain("apply");
    expect(box.order).not.toContain("baseline");
    expect(box.phone).toBe(box.local);
  });

  it("O pendingRevision refuses before a cloud read", async () => {
    const box = harness({
      baseline: {
        revision: 30,
        fingerprint: "baseline-fp",
        pendingRevision: 31,
        pendingFingerprint: "pending-fp",
      },
    });
    const outcome = await previewPreservedCopyReconciliation(box.deps);
    expect(outcome).toMatchObject({
      ok: false,
      code: "pending_revision",
      phase: "before_write",
    });
    expect(box.order).toHaveLength(0);
    expect(box.pushes).toHaveLength(0);
  });

  it("P cloud read failure writes nothing", async () => {
    const box = harness();
    box.deps.readCloud = async () => {
      box.order.push("read");
      return { status: "error", message: "offline" };
    };
    const outcome = await previewPreservedCopyReconciliation(box.deps);
    expect(outcome).toMatchObject({
      ok: false,
      code: "cloud_read_failed",
      phase: "before_write",
    });
    expect(box.pushes).toHaveLength(0);
    expect(box.phone).toBe(box.local);
  });

  it("T sync occupied refuses before a read", async () => {
    const box = harness({ hold: "sync" });
    const outcome = await previewPreservedCopyReconciliation(box.deps);
    expect(outcome).toMatchObject({ ok: false, code: "sync_occupied" });
    expect(box.order).toHaveLength(0);
    expect(box.pushes).toHaveLength(0);
  });

  it("U reconciliation occupied refuses before a read", async () => {
    const box = harness({ hold: "reconciliation" });
    const outcome = await previewPreservedCopyReconciliation(box.deps);
    expect(outcome).toMatchObject({
      ok: false,
      code: "reconciliation_occupied",
    });
    expect(box.order).toHaveLength(0);
    expect(box.pushes).toHaveLength(0);
  });

  it("refuses when the device changes during the cloud read", async () => {
    const box = harness();
    box.setMutateDuringRead(() => {
      box.setLocal({ ...box.local, displayName: "Changed during read" });
    });
    const outcome = await previewPreservedCopyReconciliation(box.deps);
    expect(outcome).toMatchObject({
      ok: false,
      code: "local_changed_during_preview",
      phase: "before_write",
    });
    expect(box.pushes).toHaveLength(0);
    expect(box.phone.displayName).toBe("Ada");
  });

  it("refuses when the baseline changes during the cloud read", async () => {
    const box = harness();
    box.setMutateDuringRead(() => {
      box.setBaseline({ revision: 31, fingerprint: "moved" });
    });
    const outcome = await previewPreservedCopyReconciliation(box.deps);
    expect(outcome).toMatchObject({
      ok: false,
      code: "baseline_changed_during_preview",
      phase: "before_write",
    });
    expect(box.pushes).toHaveLength(0);
  });

  it("refuses a changed device and asks for a fresh backup", async () => {
    const box = harness({ conflictFingerprint: "older-backup" });
    const outcome = await previewPreservedCopyReconciliation(box.deps);
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.code).toBe("backup_stale");
    expect(outcome.message).toContain("Export a fresh backup");
    expect(box.order).toHaveLength(0);
  });
});

describe("preserved copy confirm", () => {
  it("writes one CAS and converges only after readback", async () => {
    const box = harness();
    box.setReadback("sent");
    const preview = await previewPreservedCopyReconciliation(box.deps);
    expect(preview.ok).toBe(true);
    if (!preview.ok) return;
    expect(preview.bullets[1]).toContain("September 2026");
    expect(preview.bullets[2]).toContain("October 2026");
    expect(preview.closing).toContain("No financial records will be discarded");
    const before = box.phone;
    const outcome = await confirmPreservedCopyReconciliation(box.deps, preview.snapshot);
    expect(outcome).toEqual({ ok: true, revision: 40 });
    expect(box.pushes).toHaveLength(1);
    expect(box.pushes[0].revision).toBe(39);
    expect(box.order).toEqual(["read", "read", "cas", "readback", "apply", "baseline"]);
    expect(box.phone).not.toBe(before);
    expect(financialVaultFingerprint(box.phone)).toBe(preview.snapshot.candidateFingerprint);
    expect(box.baselines[0]).toEqual({
      revision: 40,
      fingerprint: preview.snapshot.candidateFingerprint,
    });
    expect(box.baselines[0]).not.toHaveProperty("pendingRevision");
    expect(box.hold).toBe("clear");
    expect(box.logs).toEqual([
      "reconcile_preview_start",
      "reconcile_preview_ready",
      "reconcile_cas_start",
      "reconcile_cas_success",
      "reconcile_readback_verified",
      "reconcile_local_converged",
    ]);
  });

  it("Q local change after preview does not write", async () => {
    const box = harness();
    const preview = await previewPreservedCopyReconciliation(box.deps);
    expect(preview.ok).toBe(true);
    if (!preview.ok) return;
    box.setLocal({ ...box.local, displayName: "Changed" });
    const outcome = await confirmPreservedCopyReconciliation(box.deps, preview.snapshot);
    expect(outcome).toMatchObject({
      ok: false,
      code: "evidence_changed",
      phase: "before_write",
    });
    expect(box.pushes).toHaveLength(0);
    expect(box.order.filter((step) => step === "read")).toHaveLength(1);
    expect(box.phone.displayName).toBe("Ada");
  });

  it("R baseline change after preview does not write", async () => {
    const box = harness();
    const preview = await previewPreservedCopyReconciliation(box.deps);
    expect(preview.ok).toBe(true);
    if (!preview.ok) return;
    box.setBaseline({ revision: 31, fingerprint: "other" });
    const outcome = await confirmPreservedCopyReconciliation(box.deps, preview.snapshot);
    expect(outcome).toMatchObject({ ok: false, code: "evidence_changed" });
    expect(box.pushes).toHaveLength(0);
    expect(box.order).toEqual(["read"]);
  });

  it("S cloud revision change after preview does not adapt", async () => {
    const box = harness();
    const preview = await previewPreservedCopyReconciliation(box.deps);
    expect(preview.ok).toBe(true);
    if (!preview.ok) return;
    box.setRevision(40);
    const outcome = await confirmPreservedCopyReconciliation(box.deps, preview.snapshot);
    expect(outcome).toMatchObject({
      ok: false,
      code: "evidence_changed",
      phase: "before_write",
    });
    expect(outcome.ok || outcome.message).toContain("Nothing was written");
    expect(box.pushes).toHaveLength(0);
    expect(box.order.filter((step) => step === "apply")).toHaveLength(0);
  });

  it("V CAS loss does not retry or change the device", async () => {
    const box = harness();
    box.setPushResult({
      status: "conflict",
      storedRevision: 40,
      schemaVersion: 6,
    });
    const preview = await previewPreservedCopyReconciliation(box.deps);
    expect(preview.ok).toBe(true);
    if (!preview.ok) return;
    const outcome = await confirmPreservedCopyReconciliation(box.deps, preview.snapshot);
    expect(outcome).toMatchObject({
      ok: false,
      code: "cas_lost",
      phase: "before_write",
    });
    expect(box.pushes).toHaveLength(1);
    expect(box.order).toEqual(["read", "read", "cas"]);
    expect(box.phone).toBe(box.local);
  });

  it("W CAS transport failure does not change the device", async () => {
    const box = harness();
    box.setPushResult({ status: "error", message: "timeout" });
    const preview = await previewPreservedCopyReconciliation(box.deps);
    expect(preview.ok).toBe(true);
    if (!preview.ok) return;
    const outcome = await confirmPreservedCopyReconciliation(box.deps, preview.snapshot);
    expect(outcome).toMatchObject({
      ok: false,
      code: "cas_transport",
      phase: "after_possible_write",
    });
    expect(outcome.ok || outcome.message).toContain("may or may not");
    expect(outcome.ok || outcome.message).not.toContain("both copies are unchanged");
    expect(box.pushes).toHaveLength(1);
    expect(box.order).not.toContain("apply");
    expect(box.baselines).toHaveLength(0);
  });

  it("X readback failure leaves the device unchanged", async () => {
    const box = harness();
    box.setReadback({ status: "error", message: "offline" });
    const preview = await previewPreservedCopyReconciliation(box.deps);
    expect(preview.ok).toBe(true);
    if (!preview.ok) return;
    const outcome = await confirmPreservedCopyReconciliation(box.deps, preview.snapshot);
    expect(outcome).toMatchObject({
      ok: false,
      code: "readback_failed",
      phase: "after_possible_write",
    });
    expect(outcome.ok || outcome.message).toContain("could not be verified");
    expect(outcome.ok || outcome.message).toContain("this device was not changed");
    expect(outcome.ok || outcome.message).not.toContain("both copies are unchanged");
    expect(box.pushes).toHaveLength(1);
    expect(box.order).not.toContain("apply");
    expect(box.baselines).toHaveLength(0);
    expect(box.phone).toBe(box.local);
  });

  it("Y unexpected readback revision does not apply locally", async () => {
    const box = harness();
    const { cloud } = incident();
    box.setReadback(present(cloud, 50));
    const preview = await previewPreservedCopyReconciliation(box.deps);
    expect(preview.ok).toBe(true);
    if (!preview.ok) return;
    const outcome = await confirmPreservedCopyReconciliation(box.deps, preview.snapshot);
    expect(outcome).toMatchObject({
      ok: false,
      code: "readback_revision",
      phase: "after_possible_write",
    });
    expect(box.pushes).toHaveLength(1);
    expect(box.phone).toBe(box.local);
    expect(box.baselines).toHaveLength(0);
  });

  it("Z readback fingerprint mismatch does not apply locally", async () => {
    const box = harness();
    const { cloud } = incident();
    box.setReadback(present(cloud, 40));
    const preview = await previewPreservedCopyReconciliation(box.deps);
    expect(preview.ok).toBe(true);
    if (!preview.ok) return;
    const outcome = await confirmPreservedCopyReconciliation(box.deps, preview.snapshot);
    expect(outcome).toMatchObject({
      ok: false,
      code: "readback_fingerprint",
      phase: "after_possible_write",
    });
    expect(box.pushes).toHaveLength(1);
    expect(box.order).not.toContain("apply");
    expect(box.phone).toBe(box.local);
  });

  it("AA local apply failure does not update the baseline", async () => {
    const box = harness();
    box.setReadback("sent");
    box.setApplyOk(false);
    const preview = await previewPreservedCopyReconciliation(box.deps);
    expect(preview.ok).toBe(true);
    if (!preview.ok) return;
    const outcome = await confirmPreservedCopyReconciliation(box.deps, preview.snapshot);
    expect(outcome).toMatchObject({
      ok: false,
      code: "local_apply_failed",
      phase: "after_possible_write",
    });
    expect(box.pushes).toHaveLength(1);
    expect(box.order).toEqual(["read", "read", "cas", "readback", "apply"]);
    expect(box.baselines).toHaveLength(0);
    expect(box.phone).toBe(box.local);
    expect(outcome.ok || outcome.message).toContain("this device could not save it");
  });
});

describe("current backup confirmation", () => {
  it("keeps Reconcile copies disabled after a successful preview alone", () => {
    expect(
      canConfirmPreservedCopies({
        previewReady: true,
        currentBackupConfirmed: false,
        busy: false,
      })
    ).toBe(false);
    expect(CURRENT_BACKUP_PROMPT).toBe(
      "Before reconciling, export a current backup of this device's preserved copy."
    );
  });

  it("enables Reconcile copies only after explicit confirmation", () => {
    expect(
      canConfirmPreservedCopies({
        previewReady: true,
        currentBackupConfirmed: true,
        busy: false,
      })
    ).toBe(true);
    expect(
      canConfirmPreservedCopies({
        previewReady: true,
        currentBackupConfirmed: true,
        busy: true,
      })
    ).toBe(false);
    expect(CURRENT_BACKUP_CONFIRMATION_LABEL).toBe(
      "I exported a current backup of this device."
    );
  });

  it("resets confirmation on cancel and reopen", () => {
    const panel = readFileSync(
      "components/babylon/vault-maintenance-panel.tsx",
      "utf8"
    );
    const block = panel.slice(
      panel.indexOf("function ReconcilePreservedCopies"),
      panel.indexOf("function ConflictCopyCompare")
    );
    expect(block.split("setBackupConfirmed(false)").length - 1).toBe(2);
    expect(block).toContain("onClick={onExportBackup}");
    expect(block).not.toContain("setBackupConfirmed(true)");
  });

  it("still refuses a changed local fingerprint after confirmation", async () => {
    const box = harness();
    const preview = await previewPreservedCopyReconciliation(box.deps);
    expect(preview.ok).toBe(true);
    if (!preview.ok) return;
    expect(
      canConfirmPreservedCopies({
        previewReady: true,
        currentBackupConfirmed: true,
        busy: false,
      })
    ).toBe(true);
    box.setLocal({ ...box.local, displayName: "Changed after confirmation" });
    const outcome = await confirmPreservedCopyReconciliation(
      box.deps,
      preview.snapshot
    );
    expect(outcome).toMatchObject({
      ok: false,
      code: "evidence_changed",
      phase: "before_write",
    });
    expect(box.pushes).toHaveLength(0);
    expect(box.phone.displayName).toBe("Ada");
  });

  it("does not write to cloud when the steward confirms a backup", async () => {
    const box = harness();
    const preview = await previewPreservedCopyReconciliation(box.deps);
    expect(preview.ok).toBe(true);
    expect(
      canConfirmPreservedCopies({
        previewReady: true,
        currentBackupConfirmed: true,
        busy: false,
      })
    ).toBe(true);
    expect(box.pushes).toHaveLength(0);
    expect(box.order).toEqual(["read"]);
  });

  it("does not persist the backup confirmation", () => {
    const panel = readFileSync(
      "components/babylon/vault-maintenance-panel.tsx",
      "utf8"
    );
    const reconciliation = readFileSync(
      "lib/babylon/preserved-copy-reconciliation.ts",
      "utf8"
    );
    const hook = readFileSync("hooks/useBabylonEngine.ts", "utf8");
    const block = panel.slice(
      panel.indexOf("function ReconcilePreservedCopies"),
      panel.indexOf("function ConflictCopyCompare")
    );
    expect(block).toContain("useState(false)");
    expect(block).not.toContain("localStorage");
    expect(block).not.toContain("sessionStorage");
    expect(reconciliation).not.toContain("localStorage");
    expect(reconciliation).toContain("Current-session mutation guard");
    expect(hook).toContain("Current-session mutation guard");
    expect(hook).not.toContain("backupConfirmed");
  });
});

describe("reconciliation diagnostics and wiring", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("logs only the event name", () => {
    const spy = vi.spyOn(console, "info").mockImplementation(() => {});
    for (const type of RECONCILIATION_DIAGNOSTIC_TYPES) {
      logReconciliationDiagnostic(type);
    }
    expect(spy).toHaveBeenCalledTimes(RECONCILIATION_DIAGNOSTIC_TYPES.length);
    for (const call of spy.mock.calls) {
      expect(call[0]).toBe("[reconcile]");
      expect(Object.keys(call[1] as object)).toEqual(["type"]);
      expect(JSON.stringify(call[1])).not.toMatch(
        /fingerprint|amount|plan-|acct-|user-1|@/i
      );
    }
  });

  it("keeps the conflict auto-push stop and blocks checks during reconciliation", () => {
    expect(
      shouldLaunchQueuedCloudCheck({ queued: "auto_push", vaultKind: "conflict" })
    ).toBe(false);
    const hook = readFileSync("hooks/useBabylonEngine.ts", "utf8");
    const check = hook.slice(
      hook.indexOf("const requestCloudCheck"),
      hook.indexOf("const confirmCloudBootstrap")
    );
    const guard = check.indexOf("if (reconcilingRef.current) return;");
    const queue = check.indexOf("takeOccupiedCloudCheckQueue");
    expect(guard).toBeGreaterThan(0);
    expect(guard).toBeLessThan(queue);
    expect(hook).toContain("pauseAutoPushRef.current = true");
    expect(hook).toContain("compareAndSwapCurrentVault");
    expect(hook).not.toContain("updateCloudVault");
    const panel = readFileSync(
      "components/babylon/vault-maintenance-panel.tsx",
      "utf8"
    );
    expect(panel).toContain("Reconcile preserved copies");
    expect(panel).toContain("Reconcile copies");
    expect(panel).toContain('vaultSync.kind === "conflict" &&');
    expect(panel).not.toContain("Use local");
    expect(panel).not.toContain("Use cloud");
    expect(panel).not.toContain("Prefer this device");
    expect(panel).not.toContain("Prefer cloud");
    expect(panel).toContain("disabled={cloudBusy || reconciliationActive}");
  });
});
