import { describe, expect, it } from "vitest";
import { EMPTY_STATE } from "@/lib/babylon/constants";
import { financialVaultFingerprint } from "@/lib/babylon/cloud-vault";
import {
  canonicalDurableJson,
  compareVaultStructure,
  isLayer1SafeStructuralDiff,
} from "@/lib/babylon/vault-structural-diff";
import type { PersistedState } from "@/types/babylon";

function base(): PersistedState {
  return {
    ...EMPTY_STATE,
    displayName: "Ada",
    accounts: [
      {
        id: "acc-1",
        name: "Checking",
        kind: "checking",
        balance: 100,
        asOf: "2026-09-25",
      },
    ],
    expenses: [
      {
        id: "exp-1",
        name: "Rent",
        category: "need",
        amount: 50,
        date: "2026-09-01",
        dueDate: "2026-09-01",
        isSettled: false,
      },
    ],
  };
}

describe("compareVaultStructure", () => {
  it("A: identical vaults", () => {
    const a = base();
    const b = structuredClone(a);
    const diff = compareVaultStructure(a, b);
    expect(diff.documentIdentity).toBe("same");
    expect(diff.summary.hasFinancialOrPlanningDifferences).toBe(false);
    expect(diff.summary.hasSystemOrMetadataDifferences).toBe(false);
    expect(diff.summary.documentRepresentationAlsoDiffers).toBe(false);
    expect(isLayer1SafeStructuralDiff(diff)).toBe(true);
  });

  it("B: local-only record", () => {
    const local = base();
    local.accounts.push({
      id: "acc-local",
      name: "Cash",
      kind: "cash",
      balance: 20,
      asOf: "2026-09-25",
    });
    const cloud = base();
    const diff = compareVaultStructure(local, cloud);
    const accounts = diff.collections.find((row) => row.key === "accounts");
    expect(accounts).toMatchObject({
      localOnly: 1,
      cloudOnly: 0,
      sharedSame: 1,
      sharedDifferent: 0,
    });
    expect(diff.summary.localOnlyFinancial).toBe(1);
    expect(diff.summaryLines.some((line) => line.includes("This device contains"))).toBe(
      true
    );
  });

  it("C: cloud-only record", () => {
    const local = base();
    const cloud = base();
    cloud.incomes = [
      {
        id: "inc-cloud",
        source: "Job",
        amount: 3000,
        date: "2026-09-15",
        interval: "monthly",
        kind: "primary",
        wealthShare: 300,
        debtShare: 600,
        expenditureShare: 2100,
        debtRedirected: false,
      },
    ];
    const diff = compareVaultStructure(local, cloud);
    const incomes = diff.collections.find((row) => row.key === "incomes");
    expect(incomes?.cloudOnly).toBe(1);
    expect(diff.summary.cloudOnlyFinancial).toBe(1);
  });

  it("D–E: shared identical and shared changed", () => {
    const local = base();
    const same = structuredClone(local);
    expect(
      compareVaultStructure(local, same).collections.find((r) => r.key === "expenses")
        ?.sharedSame
    ).toBe(1);

    const changed = structuredClone(local);
    changed.expenses[0] = { ...changed.expenses[0]!, amount: 99 };
    const diff = compareVaultStructure(local, changed);
    expect(
      diff.collections.find((r) => r.key === "expenses")?.sharedDifferent
    ).toBe(1);
    expect(diff.summary.sharedDifferentFinancial).toBe(1);
  });

  it("F: multiple collections", () => {
    const local = base();
    local.paySchedules = [
      {
        id: "sched-1",
        createdAt: "2026-01-15",
        cadence: "biweekly",
        anchorDate: "2026-01-03",
      },
    ];
    const cloud = base();
    cloud.debts = [
      {
        id: "debt-1",
        creditor: "Card",
        totalDebt: 200,
        remainingDebt: 200,
        monthlyAllocation: 25,
        createdAt: "2026-01-01",
        interestRate: 20,
      },
    ];
    const diff = compareVaultStructure(local, cloud);
    expect(diff.collections.find((r) => r.key === "paySchedules")?.localOnly).toBe(1);
    expect(diff.collections.find((r) => r.key === "debts")?.cloudOnly).toBe(1);
  });

  it("G: canonical equality independent of object key order", () => {
    const a = { id: "x", amount: 1, name: "A" };
    const b = { name: "A", id: "x", amount: 1 };
    expect(canonicalDurableJson(a)).toBe(canonicalDurableJson(b));
  });

  it("H: activityLog is system group, separated from financial", () => {
    const local = base();
    local.activityLog = [
      {
        id: "act-1",
        kind: "income",
        title: "Secret title",
        createdAt: "2026-09-25T00:00:00.000Z",
        amount: 12,
      },
    ];
    const cloud = base();
    const diff = compareVaultStructure(local, cloud);
    const activity = diff.collections.find((r) => r.key === "activityLog");
    expect(activity?.group).toBe("system");
    expect(activity?.label).toBe("System history");
    expect(activity?.localOnly).toBe(1);
    expect(diff.summary.hasFinancialOrPlanningDifferences).toBe(false);
    expect(diff.summary.hasSystemOrMetadataDifferences).toBe(true);
    expect(diff.summaryLines[0]).toContain(
      "No financial or planning record differences"
    );
    expect(JSON.stringify(diff)).not.toContain("Secret title");
  });

  it("I: scalar same/different without values", () => {
    const local = base();
    const cloud = { ...base(), displayName: "Other", openingWealthBuilding: 50 };
    const diff = compareVaultStructure(local, cloud);
    expect(
      diff.scalars.find((r) => r.key === "displayName")?.status
    ).toBe("different");
    expect(
      diff.scalars.find((r) => r.key === "openingWealthBuilding")?.status
    ).toBe("different");
    expect(
      diff.scalars.find((r) => r.key === "emergencyShield")?.status
    ).toBe("same");
    expect(JSON.stringify(diff.scalars)).not.toContain("Other");
    expect(JSON.stringify(diff.scalars)).not.toContain("50");
  });

  it("J–K: Layer-1 result omits financial values and raw ids", () => {
    const local = base();
    local.accounts.push({
      id: "acc-local-only-uuid",
      name: "Hidden Name",
      kind: "savings",
      balance: 9999,
      asOf: "2026-09-25",
    });
    const diff = compareVaultStructure(local, base());
    expect(isLayer1SafeStructuralDiff(diff)).toBe(true);
    const raw = JSON.stringify(diff);
    expect(raw).not.toContain("acc-local-only-uuid");
    expect(raw).not.toContain("Hidden Name");
    expect(raw).not.toContain("9999");
  });

  it("L–N: absent/default soft fields via serialize (paySchedules [], restrictedAmount)", () => {
    const local = { ...EMPTY_STATE, displayName: "A" };
    const cloud = {
      ...EMPTY_STATE,
      displayName: "A",
      paySchedules: [],
      accounts: [
        {
          id: "acc-1",
          name: "C",
          kind: "checking" as const,
          balance: 1,
          asOf: "2026-09-25",
        },
      ],
    };
    const localWithAccount: PersistedState = {
      ...local,
      accounts: [
        {
          id: "acc-1",
          name: "C",
          kind: "checking",
          balance: 1,
          asOf: "2026-09-25",
        },
      ],
    };
    // Both serialize paySchedules as []. Same account without restrictedAmount.
    const diff = compareVaultStructure(localWithAccount, cloud);
    expect(diff.collections.find((r) => r.key === "paySchedules")).toMatchObject({
      localOnly: 0,
      cloudOnly: 0,
      sharedSame: 0,
      sharedDifferent: 0,
    });
    expect(diff.collections.find((r) => r.key === "accounts")?.sharedSame).toBe(1);

    const withZero: PersistedState = {
      ...localWithAccount,
      accounts: [
        {
          ...localWithAccount.accounts[0]!,
          restrictedAmount: 0,
        },
      ],
    };
    const vsAbsent = compareVaultStructure(withZero, cloud);
    // Current domain: absent vs explicit 0 are different durable representations.
    expect(vsAbsent.collections.find((r) => r.key === "accounts")?.sharedDifferent).toBe(
      1
    );
  });

  it("O: document fingerprint same/different", () => {
    const a = base();
    const b = structuredClone(a);
    expect(compareVaultStructure(a, b).documentIdentity).toBe("same");
    b.expenses[0] = { ...b.expenses[0]!, amount: 1 };
    expect(compareVaultStructure(a, b).documentIdentity).toBe("different");
    expect(financialVaultFingerprint(a)).not.toBe(financialVaultFingerprint(b));
  });

  it("P: semantic ID match but array-order representation differs", () => {
    const local = base();
    local.accounts = [
      {
        id: "a",
        name: "One",
        kind: "checking",
        balance: 1,
        asOf: "2026-09-25",
      },
      {
        id: "b",
        name: "Two",
        kind: "savings",
        balance: 2,
        asOf: "2026-09-25",
      },
    ];
    const cloud = structuredClone(local);
    cloud.accounts = [local.accounts[1]!, local.accounts[0]!];
    const diff = compareVaultStructure(local, cloud);
    expect(diff.collections.find((r) => r.key === "accounts")).toMatchObject({
      localOnly: 0,
      cloudOnly: 0,
      sharedSame: 2,
      sharedDifferent: 0,
    });
    expect(diff.documentIdentity).toBe("different");
    expect(diff.summary.documentRepresentationAlsoDiffers).toBe(true);
    expect(diff.summaryLines).toContain("Document representation also differs.");
  });
});
