import { describe, expect, it } from "vitest";
import { cloudSetupCopy, hydrateEmptyDevice } from "@/lib/babylon/cloud-setup";
import {
  CLOUD_VAULT_SCHEMA_VERSION,
  financialVaultFingerprint,
  getCloudVault,
  parseCloudVaultData,
  parseSchema5VaultData,
  serializeCloudVaultData,
  specifiedSchema5To6Upgrade,
  specifiedVaultWriteOutcome,
  updateCloudVault,
  type CloudVaultGateway,
} from "@/lib/babylon/cloud-vault";
import { EMPTY_STATE } from "@/lib/babylon/constants";
import { allocateIncome } from "@/lib/babylon/engine";
import { finalizeMonthlyPlanRevision } from "@/lib/babylon/monthly-plan";
import { runCloudRevisionCycle, vaultSyncCopy } from "@/lib/babylon/vault-sync";
import type { CloudSyncBaseline } from "@/lib/babylon/vault-sync";
import type { PersistedState } from "@/types/babylon";

const OWNER_A = "11111111-1111-4111-8111-111111111111";
const OWNER_B = "22222222-2222-4222-8222-222222222222";

function populated(): PersistedState {
  return {
    ...EMPTY_STATE,
    // Legacy vault with debts: stay pre-epoch until steward rebase.
    debtSemanticsVersion: 1,
    debtPositionEpochAt: null,
    debtPurposeAttributions: [],
    displayName: "Ada",
    openingWealthBuilding: 40,
    openingEmergencyFund: 10,
    accounts: [
      {
        id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        name: "Checking",
        kind: "checking",
        balance: 500,
        asOf: "2026-09-25",
      },
    ],
    incomes: [
      {
        id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
        source: "Payroll",
        amount: 1000,
        date: "2026-09-01",
        interval: "monthly",
        kind: "primary",
        wealthShare: 300,
        debtShare: 0,
        expenditureShare: 700,
        debtRedirected: true,
      },
    ],
    expenses: [
      {
        id: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
        name: "Rent",
        category: "need",
        amount: 400,
        date: "2026-09-01",
        dueDate: "2026-09-01",
        isSettled: false,
      },
    ],
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
    allocations: [
      {
        id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
        incomeId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
        date: "2026-09-01",
        monthKey: "2026-09",
        gross: 1000,
        wealth: 300,
        debt: 0,
        expenditure: 700,
      },
    ],
    budgetTargets: [
      {
        id: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
        categoryName: "Rent",
        plannedAmount: 400,
        isEssential: true,
      },
    ],
    recurringObligations: [
      {
        id: "rule-phone",
        name: "Phone",
        amount: 50,
        category: "need",
        budgetCategoryId: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
        dueDay: 15,
        startMonth: "2026-10",
        isActive: true,
        createdAt: "2026-09-01",
        skippedMonths: [],
      },
    ],
  };
}

function omitMonthlyPlans(state: PersistedState): Record<string, unknown> {
  const document: Record<string, unknown> = {
    ...serializeCloudVaultData(state),
  };
  delete document.monthlyPlans;
  // Pre-debt-position schema-5/6 documents omit these soft-added keys.
  delete document.debtSemanticsVersion;
  delete document.debtPositionEpochAt;
  delete document.debtPurposeAttributions;
  return document;
}

function schema5Document(state: PersistedState = populated()): Record<string, unknown> {
  const document = serializeCloudVaultData(state);
  expect(document.monthlyPlans).toEqual([]);
  return omitMonthlyPlans(state);
}

type StoredVault = {
  schemaVersion: number;
  revision: number;
  updatedAt: string;
  vaultData: unknown;
};

function memoryGateway(seed: StoredVault, sessionUserId: string | null = OWNER_A) {
  let row: StoredVault | null = structuredClone(seed);
  const calls: string[] = [];
  const gateway: CloudVaultGateway = {
    async sessionUserId() {
      return sessionUserId;
    },
    async readVault() {
      calls.push("read");
      return { ok: true, row: row ? structuredClone(row) : null };
    },
    async initializeVault() {
      calls.push("initialize");
      return { ok: true, body: { status: "rejected", reason: "not_used" } };
    },
    async compareAndSwapVault(expectedRevision, schemaVersion, vaultData) {
      calls.push("cas");
      const outcome = specifiedVaultWriteOutcome({
        stored: row
          ? { revision: row.revision, schemaVersion: row.schemaVersion }
          : null,
        expectedRevision,
        knownSchemaVersion: schemaVersion,
      });
      if (outcome.status === "updated" && row) {
        row = {
          schemaVersion,
          revision: outcome.revision,
          updatedAt: "2026-09-27T01:00:00.000Z",
          vaultData,
        };
        return {
          ok: true,
          body: {
            status: "updated",
            revision: outcome.revision,
            schema_version: schemaVersion,
            updated_at: row.updatedAt,
          },
        };
      }
      if (outcome.status === "unsupported_schema") {
        return {
          ok: true,
          body: {
            status: "unsupported_schema",
            schema_version: outcome.schemaVersion,
            revision: outcome.revision,
          },
        };
      }
      if (outcome.status === "conflict") {
        return {
          ok: true,
          body: {
            status: "conflict",
            stored_revision: outcome.storedRevision,
            schema_version: outcome.schemaVersion,
          },
        };
      }
      return {
        ok: true,
        body: {
          status: outcome.status === "absent" ? "absent" : "rejected",
          reason: outcome.status === "rejected" ? outcome.reason : undefined,
        },
      };
    },
    async upgradeSchema5Vault(expectedRevision) {
      calls.push("upgrade");
      const before = structuredClone(row);
      const outcome = specifiedSchema5To6Upgrade({
        stored: row,
        expectedRevision,
      });
      if (outcome.status === "updated") {
        row = {
          schemaVersion: outcome.schemaVersion,
          revision: outcome.revision,
          updatedAt: "2026-09-27T00:00:00.000Z",
          vaultData: outcome.vaultData,
        };
        return {
          ok: true,
          body: {
            status: "updated",
            revision: outcome.revision,
            schema_version: outcome.schemaVersion,
            updated_at: row.updatedAt,
          },
        };
      }
      expect(row).toEqual(before);
      if (outcome.status === "already_current") {
        return {
          ok: true,
          body: {
            status: "already_current",
            revision: outcome.revision,
            schema_version: outcome.schemaVersion,
          },
        };
      }
      if (outcome.status === "conflict") {
        return {
          ok: true,
          body: {
            status: "conflict",
            stored_revision: outcome.storedRevision,
            schema_version: outcome.schemaVersion,
          },
        };
      }
      if (outcome.status === "unsupported_schema") {
        return {
          ok: true,
          body: {
            status: "unsupported_schema",
            schema_version: outcome.schemaVersion,
            revision: outcome.revision,
          },
        };
      }
      if (outcome.status === "absent") return { ok: true, body: { status: "absent" } };
      return { ok: true, body: { status: "rejected", reason: outcome.reason } };
    },
  };
  return {
    gateway,
    calls,
    snapshot: () => (row ? structuredClone(row) : null),
  };
}

function realPlan() {
  const living = allocateIncome(1000, true).expenditureShare;
  const finalized = finalizeMonthlyPlanRevision([], {
    id: "plan-1",
    periodKey: "2026-10",
    finalizedAt: "2026-10-01T15:00:00.000Z",
    planningBasis: 1000,
    categories: [
      {
        id: "rent",
        categoryName: "Rent",
        plannedAmount: living,
        isEssential: true,
      },
    ],
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
    openingWealthBuilding: 40,
    openingEmergencyFund: 10,
  });
  if (!finalized.ok) throw new Error(finalized.reason);
  return finalized.revision;
}

describe("schema 5 to schema 6 cloud transition", () => {
  it("upgrades a valid schema-5 vault by adding an empty monthly plan list", async () => {
    const financial = schema5Document();
    const memory = memoryGateway({
      schemaVersion: 5,
      revision: 4,
      updatedAt: "2026-09-01T00:00:00.000Z",
      vaultData: financial,
    });

    const read = await getCloudVault(OWNER_A, memory.gateway);
    expect(read.status).toBe("present");
    if (read.status !== "present") return;
    expect(read.schemaVersion).toBe(CLOUD_VAULT_SCHEMA_VERSION);
    expect(read.revision).toBe(5);
    expect(read.vaultData.monthlyPlans).toEqual([]);

    const stored = memory.snapshot();
    expect(stored?.schemaVersion).toBe(6);
    expect(stored?.revision).toBe(5);
    for (const key of Object.keys(financial)) {
      expect(stored?.vaultData).toMatchObject({ [key]: financial[key] });
    }
    expect(read.vaultData.incomes).toEqual(populated().incomes);
    expect(read.vaultData.expenses).toEqual(populated().expenses);
    expect(read.vaultData.debts).toEqual(populated().debts);
    expect(read.vaultData.allocations).toEqual(populated().allocations);
    expect(read.vaultData.budgetTargets).toEqual(populated().budgetTargets);
    expect(read.vaultData.accounts).toEqual(populated().accounts);
    expect(read.vaultData.recurringObligations).toEqual(populated().recurringObligations);
    expect(read.vaultData.openingWealthBuilding).toBe(40);
    expect(read.vaultData.openingEmergencyFund).toBe(10);
    expect(read.vaultData.activityLog).toEqual([]);
    expect(read.vaultData.periodArchives).toEqual([]);
    expect(read.vaultData.monthlyPlans).toEqual([]);
    expect(JSON.stringify(read.vaultData.monthlyPlans)).toBe("[]");
  });

  it("does not infer a plan from current caps, debts, or obligations", async () => {
    const memory = memoryGateway({
      schemaVersion: 5,
      revision: 2,
      updatedAt: "2026-09-01T00:00:00.000Z",
      vaultData: schema5Document(),
    });
    const read = await getCloudVault(OWNER_A, memory.gateway);
    expect(read.status).toBe("present");
    if (read.status !== "present") return;
    expect(read.vaultData.monthlyPlans).toEqual([]);
    expect(read.vaultData.budgetTargets).toHaveLength(1);
    expect(read.vaultData.debts).toHaveLength(1);
    expect(read.vaultData.recurringObligations).toHaveLength(1);
  });

  it("leaves a schema-5 vault unchanged when the document is not an exact predecessor", async () => {
    const financial = schema5Document();
    delete financial.incomes;
    const memory = memoryGateway({
      schemaVersion: 5,
      revision: 4,
      updatedAt: "2026-09-01T00:00:00.000Z",
      vaultData: financial,
    });
    const read = await getCloudVault(OWNER_A, memory.gateway);
    expect(read.status).toBe("invalid_vault");
    expect(memory.calls).toEqual(["read"]);
    expect(memory.snapshot()).toMatchObject({ schemaVersion: 5, revision: 4, vaultData: financial });
  });

  it("leaves a schema-5 vault unchanged when the upgrade conflicts twice", async () => {
    const financial = schema5Document();
    const memory = memoryGateway({
      schemaVersion: 5,
      revision: 4,
      updatedAt: "2026-09-01T00:00:00.000Z",
      vaultData: financial,
    });
    memory.gateway.upgradeSchema5Vault = async () => {
      memory.calls.push("upgrade");
      return {
        ok: true,
        body: { status: "conflict", stored_revision: 9, schema_version: 5 },
      };
    };
    const read = await getCloudVault(OWNER_A, memory.gateway);
    expect(read.status).toBe("error");
    expect(memory.snapshot()).toMatchObject({ schemaVersion: 5, revision: 4 });
    expect(memory.calls.filter((call) => call === "upgrade")).toHaveLength(2);
  });

  it("applies one upgrade when two schema-6 clients race on the same revision", () => {
    const financial = schema5Document();
    let stored: StoredVault = {
      schemaVersion: 5,
      revision: 4,
      updatedAt: "2026-09-01T00:00:00.000Z",
      vaultData: structuredClone(financial),
    };
    const first = specifiedSchema5To6Upgrade({
      stored,
      expectedRevision: 4,
    });
    expect(first.status).toBe("updated");
    if (first.status !== "updated") return;
    stored = {
      schemaVersion: first.schemaVersion,
      revision: first.revision,
      updatedAt: "2026-09-27T00:00:00.000Z",
      vaultData: first.vaultData,
    };
    const second = specifiedSchema5To6Upgrade({
      stored,
      expectedRevision: 4,
    });
    expect(second.status).toBe("already_current");
    expect(stored.revision).toBe(5);
    expect(stored.schemaVersion).toBe(6);
    expect(stored.vaultData).toMatchObject({ ...financial, monthlyPlans: [] });
  });

  it("keeps a schema-5 edit that wins the race, then adds an empty plan list", async () => {
    const financial = schema5Document();
    let row: StoredVault = {
      schemaVersion: 5,
      revision: 4,
      updatedAt: "2026-09-01T00:00:00.000Z",
      vaultData: financial,
    };
    let raced = false;
    const gateway: CloudVaultGateway = {
      async sessionUserId() {
        return OWNER_A;
      },
      async readVault() {
        return { ok: true, row: structuredClone(row) };
      },
      async initializeVault() {
        return { ok: true, body: { status: "rejected", reason: "not_used" } };
      },
      async compareAndSwapVault() {
        return { ok: true, body: { status: "rejected", reason: "not_used" } };
      },
      async upgradeSchema5Vault(expectedRevision) {
        if (!raced && expectedRevision === 4) {
          raced = true;
          const current = row.vaultData as Record<string, unknown>;
          row = {
            ...row,
            revision: 5,
            vaultData: { ...current, displayName: "Edited on schema 5" },
          };
          return {
            ok: true,
            body: { status: "conflict", stored_revision: 5, schema_version: 5 },
          };
        }
        const outcome = specifiedSchema5To6Upgrade({ stored: row, expectedRevision });
        if (outcome.status === "updated") {
          row = {
            schemaVersion: outcome.schemaVersion,
            revision: outcome.revision,
            updatedAt: "2026-09-27T00:00:00.000Z",
            vaultData: outcome.vaultData,
          };
          return {
            ok: true,
            body: {
              status: "updated",
              revision: outcome.revision,
              schema_version: outcome.schemaVersion,
              updated_at: row.updatedAt,
            },
          };
        }
        return { ok: true, body: { status: outcome.status } };
      },
    };

    const read = await getCloudVault(OWNER_A, gateway);
    expect(read.status).toBe("present");
    if (read.status !== "present") return;
    expect(read.revision).toBe(6);
    expect(read.schemaVersion).toBe(6);
    expect(read.vaultData.displayName).toBe("Edited on schema 5");
    expect(read.vaultData.incomes).toEqual(populated().incomes);
    expect(read.vaultData.monthlyPlans).toEqual([]);
    expect(row.schemaVersion).toBe(6);
  });

  it("refuses a schema-5 client write against a schema-6 vault", async () => {
    const plan = realPlan();
    const state = { ...populated(), monthlyPlans: [plan] };
    const memory = memoryGateway({
      schemaVersion: 6,
      revision: 8,
      updatedAt: "2026-09-27T00:00:00.000Z",
      vaultData: serializeCloudVaultData(state),
    });
    const before = memory.snapshot();
    const outcome = specifiedVaultWriteOutcome({
      stored: { revision: 8, schemaVersion: 6 },
      expectedRevision: 8,
      knownSchemaVersion: 5,
    });
    expect(outcome).toEqual({
      status: "unsupported_schema",
      schemaVersion: 6,
      revision: 8,
    });
    const dropped = omitMonthlyPlans(state);
    expect(parseCloudVaultData(dropped)).toBeNull();
    const write = await updateCloudVault(OWNER_A, 8, 5, state, memory.gateway);
    expect(write).toEqual({ status: "rejected", reason: "unsupported_schema" });
    expect(memory.calls).not.toContain("cas");
    expect(memory.calls).not.toContain("upgrade");
    expect(memory.snapshot()).toEqual(before);

    const cas = await memory.gateway.compareAndSwapVault(8, 5, serializeCloudVaultData(state));
    expect(cas.ok).toBe(true);
    if (!cas.ok) return;
    expect(cas.body).toMatchObject({ status: "unsupported_schema", schema_version: 6 });
    expect(memory.snapshot()?.vaultData).toMatchObject({ monthlyPlans: [plan] });
  });

  it("does not clear real monthly plans on a schema-6 vault", () => {
    const plan = realPlan();
    const stored = {
      schemaVersion: 6,
      revision: 8,
      vaultData: serializeCloudVaultData({ ...populated(), monthlyPlans: [plan] }),
    };
    const outcome = specifiedSchema5To6Upgrade({ stored, expectedRevision: 8 });
    expect(outcome.status).toBe("already_current");
    expect(stored.vaultData.monthlyPlans).toEqual([plan]);
    expect(stored.revision).toBe(8);
    expect(stored.schemaVersion).toBe(6);
  });

  it("still compare-and-swaps a schema-6 vault without dropping monthly plans", async () => {
    const plan = realPlan();
    const state = { ...populated(), monthlyPlans: [plan] };
    const memory = memoryGateway({
      schemaVersion: 6,
      revision: 8,
      updatedAt: "2026-09-27T00:00:00.000Z",
      vaultData: serializeCloudVaultData(state),
    });
    const next = { ...state, displayName: "Ada updated" };
    const write = await updateCloudVault(
      OWNER_A,
      8,
      CLOUD_VAULT_SCHEMA_VERSION,
      next,
      memory.gateway
    );
    expect(write).toMatchObject({ status: "updated", revision: 9, schemaVersion: 6 });
    expect(memory.snapshot()?.vaultData).toMatchObject({
      displayName: "Ada updated",
      monthlyPlans: [plan],
      incomes: state.incomes,
    });
    expect(memory.calls).not.toContain("upgrade");
  });

  it("does not upgrade any generation other than schema 5", async () => {
    for (const schemaVersion of [4, 7]) {
      const memory = memoryGateway({
        schemaVersion,
        revision: 3,
        updatedAt: "2026-09-01T00:00:00.000Z",
        vaultData: schema5Document(),
      });
      const read = await getCloudVault(OWNER_A, memory.gateway);
      expect(read).toMatchObject({ status: "unsupported_schema", schemaVersion });
      expect(memory.calls).toEqual(["read"]);
      expect(memory.snapshot()?.schemaVersion).toBe(schemaVersion);
    }
    const foreign = specifiedSchema5To6Upgrade({
      stored: { schemaVersion: 4, revision: 3, vaultData: schema5Document() },
      expectedRevision: 3,
    });
    expect(foreign.status).toBe("unsupported_schema");
  });

  it("upgrades only the signed-in owner's vault", async () => {
    const financial = schema5Document();
    const memory = memoryGateway(
      {
        schemaVersion: 5,
        revision: 4,
        updatedAt: "2026-09-01T00:00:00.000Z",
        vaultData: financial,
      },
      OWNER_B
    );
    const read = await getCloudVault(OWNER_A, memory.gateway);
    expect(read.status).toBe("forbidden");
    expect(memory.calls).toEqual([]);
    expect(memory.snapshot()).toMatchObject({ schemaVersion: 5, vaultData: financial });
  });

  it("hydrates an empty device from the upgraded cloud vault and does not upload empty local state", async () => {
    const financial = schema5Document();
    const memory = memoryGateway({
      schemaVersion: 5,
      revision: 4,
      updatedAt: "2026-09-01T00:00:00.000Z",
      vaultData: structuredClone(financial),
    });
    let local = EMPTY_STATE;
    const hydrated = await hydrateEmptyDevice({
      sessionUserId: OWNER_A,
      local,
      ownerUserId: null,
      readCloud: () => getCloudVault(OWNER_A, memory.gateway),
      readLocal: () => local,
      writeLocal: (state) => {
        local = state;
      },
      bindOwner: () => true,
    });
    expect(hydrated.ok).toBe(true);
    if (!hydrated.ok) return;
    expect(hydrated.revision).toBe(5);
    expect(local.incomes).toEqual(populated().incomes);
    expect(local.debts).toEqual(populated().debts);
    expect(local.monthlyPlans).toEqual([]);
    expect(local.displayName).toBe("Ada");
    expect(memory.snapshot()?.schemaVersion).toBe(6);
    expect(memory.calls).not.toContain("initialize");
    expect(memory.calls).not.toContain("cas");
  });

  it("offers hydrate for an empty device and does not push over a populated schema-5 cloud vault", async () => {
    const memory = memoryGateway({
      schemaVersion: 5,
      revision: 4,
      updatedAt: "2026-09-01T00:00:00.000Z",
      vaultData: schema5Document(),
    });
    const cycle = await runCloudRevisionCycle({
      sessionUserId: OWNER_A,
      readOwner: () => null,
      readBaseline: () => null,
      writeBaseline: () => true,
      readMemory: () => EMPTY_STATE,
      readStored: () => EMPTY_STATE,
      writeStored: () => {
        throw new Error("local write");
      },
      readCloud: () => getCloudVault(OWNER_A, memory.gateway),
      pushCloud: async () => {
        throw new Error("push");
      },
      bindOwner: () => true,
    });
    expect(cycle.view.kind).toBe("offer_hydrate");
    expect(cycle.pushed).toBe(false);
    expect(memory.snapshot()?.schemaVersion).toBe(6);
    expect(memory.snapshot()?.vaultData).toMatchObject({
      displayName: "Ada",
      monthlyPlans: [],
    });
    expect(memory.calls).not.toContain("cas");
  });

  it("adopts the upgraded revision when local financial state already matches", async () => {
    const state = populated();
    const memory = memoryGateway({
      schemaVersion: 5,
      revision: 4,
      updatedAt: "2026-09-01T00:00:00.000Z",
      vaultData: schema5Document(state),
    });
    const held: { baseline: CloudSyncBaseline | null } = { baseline: null };
    const cycle = await runCloudRevisionCycle({
      sessionUserId: OWNER_A,
      readOwner: () => OWNER_A,
      readBaseline: () => held.baseline,
      writeBaseline: (next) => {
        held.baseline = next;
        return true;
      },
      readMemory: () => state,
      readStored: () => state,
      writeStored: () => {
        throw new Error("local write");
      },
      readCloud: () => getCloudVault(OWNER_A, memory.gateway),
      pushCloud: async () => {
        throw new Error("push");
      },
      bindOwner: () => true,
    });
    expect(cycle.view).toEqual({ kind: "clean", revision: 5 });
    expect(held.baseline?.revision).toBe(5);
    expect(held.baseline?.fingerprint).toBe(financialVaultFingerprint(state));
    expect(parseSchema5VaultData(schema5Document(state))?.monthlyPlans).toEqual([]);
  });

  it("describes an unsupported generation without calling it newer", () => {
    const setup = cloudSetupCopy({ kind: "unsupported_schema" });
    const sync = vaultSyncCopy({ kind: "unsupported_schema" });
    expect(`${setup.title} ${setup.detail}`.toLowerCase()).not.toContain("newer");
    expect(`${sync.title} ${sync.detail ?? ""}`.toLowerCase()).not.toContain("newer");
    expect(setup.title).toBe("Cloud vault generation is not supported");
    expect(sync.title).toBe("Cloud vault generation is not supported");
  });
});
