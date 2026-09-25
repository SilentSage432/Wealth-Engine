import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  CLOUD_VAULT_DATA_KEYS,
  CLOUD_VAULT_SCHEMA_VERSION,
  getCloudVault,
  initializeCloudVault,
  parseCloudVaultData,
  serializeCloudVaultData,
  specifiedVaultInitializeOutcome,
  specifiedVaultWriteOutcome,
  updateCloudVault,
  type CloudVaultGateway,
} from "@/lib/babylon/cloud-vault";
import {
  bindCloudOwnerId,
  CLOUD_OWNER_STORAGE_KEY,
  readCloudOwnerId,
  type CloudOwnerStore,
} from "@/lib/babylon/cloud-owner";
import { EMPTY_STATE, STORAGE_KEY } from "@/lib/babylon/constants";
import {
  buildLedgerBackup,
  LEDGER_BACKUP_VERSION,
} from "@/lib/babylon/persistence";
import type { PersistedState } from "@/types/babylon";

const OWNER_A = "11111111-1111-4111-8111-111111111111";
const OWNER_B = "22222222-2222-4222-8222-222222222222";

function occupiedState(): PersistedState {
  return {
    ...EMPTY_STATE,
    displayName: "Ada",
    expenseSemanticsVersion: 2,
    emergencyShield: 15,
    lastClosedMonthKey: "2026-08",
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
    debts: [
      {
        id: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
        creditor: "Card",
        totalDebt: 200,
        remainingDebt: 80,
        monthlyAllocation: 40,
        createdAt: "2026-01-01",
        interestRate: 12,
      },
    ],
    recurringObligations: [
      {
        id: "ffffffff-ffff-4fff-8fff-ffffffffffff",
        name: "Phone",
        amount: 50,
        category: "need",
        budgetCategoryId: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
        dueDay: 31,
        startMonth: "2026-09",
        isActive: true,
        createdAt: "2026-09-01",
        skippedMonths: ["2026-10"],
      },
    ],
    expenses: [
      {
        id: "99999999-9999-4999-8999-999999999999",
        name: "Phone",
        category: "need",
        amount: 50,
        date: "2026-09-12",
        dueDate: "2026-09-30",
        budgetCategoryId: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
        isSettled: true,
        recurringObligationId: "ffffffff-ffff-4fff-8fff-ffffffffffff",
        recurrenceMonth: "2026-09",
      },
      {
        id: "88888888-8888-4888-8888-888888888888",
        name: "Concert",
        category: "desire",
        amount: 20,
        date: "2026-09-20",
        dueDate: "2026-09-28",
        budgetCategoryId: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
        isSettled: false,
      },
    ],
    periodArchives: [
      {
        id: "77777777-7777-4777-8777-777777777777",
        monthKey: "2026-08",
        closedAt: "2026-09-01T00:00:00.000Z",
        totalIncome: 1000,
        totalSpent: 400,
        wealthAllocated: 100,
        debtAllocated: 200,
        expenditurePool: 700,
        expenditureRemaining: 300,
        surplusDisposition: "emergency_shield",
        surplusAmount: 15,
      },
    ],
    activityLog: [
      {
        id: "66666666-6666-4666-8666-666666666666",
        kind: "income",
        title: "Payroll",
        subtitle: "Income added",
        amount: 1000,
        streamKind: "primary",
        createdAt: "2026-09-01T12:00:00.000Z",
      },
    ],
  };
}

type StoredVault = {
  schemaVersion: number;
  revision: number;
  updatedAt: string;
  vaultData: unknown;
};

function memoryGateway(options?: {
  sessionUserId?: string | null;
  seed?: StoredVault | null;
}) {
  let row = options?.seed ?? null;
  const calls: string[] = [];
  const gateway: CloudVaultGateway = {
    async sessionUserId() {
      return options?.sessionUserId === undefined ? OWNER_A : options.sessionUserId;
    },
    async readVault() {
      calls.push("read");
      return { ok: true, row };
    },
    async initializeVault(schemaVersion, vaultData) {
      calls.push("initialize");
      const outcome = specifiedVaultInitializeOutcome({
        existing: row
          ? { revision: row.revision, schemaVersion: row.schemaVersion }
          : null,
        knownSchemaVersion: schemaVersion,
      });
      if (outcome.status === "created") {
        row = {
          schemaVersion,
          revision: 1,
          updatedAt: "2026-09-25T00:00:00.000Z",
          vaultData,
        };
      }
      return {
        ok: true,
        body: {
          status: outcome.status,
          revision: outcome.status === "rejected" ? undefined : outcome.revision,
          schema_version:
            outcome.status === "rejected" ? undefined : outcome.schemaVersion,
          updated_at: row?.updatedAt,
          ...(outcome.status === "rejected" ? { reason: outcome.reason } : {}),
        },
      };
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
      if (outcome.status === "updated") {
        row = {
          schemaVersion,
          revision: outcome.revision,
          updatedAt: "2026-09-25T01:00:00.000Z",
          vaultData,
        };
      }
      if (outcome.status === "updated") {
        return {
          ok: true,
          body: {
            status: "updated",
            revision: outcome.revision,
            schema_version: outcome.schemaVersion,
            updated_at: row?.updatedAt,
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

describe("cloud vault foundation", () => {
  it("does not upload a financial ledger when a session appears", () => {
    const hook = readFileSync(
      resolve(process.cwd(), "hooks/useBabylonEngine.ts"),
      "utf8"
    );
    const auth = readFileSync(
      resolve(process.cwd(), "lib/supabase/auth.ts"),
      "utf8"
    );
    expect(hook).not.toContain("migrateLocalLedgerToCloud");
    expect(hook).not.toContain("cloud-hydrate");
    expect(hook).not.toContain("initializeCloudVault");
    expect(hook).not.toContain("updateCloudVault");
    expect(hook).not.toContain("getCloudVault");
    expect(hook).not.toContain("bindCloudOwnerId");
    expect(hook).not.toContain("upsertStewardProfile");
    expect(hook).not.toContain("cloudUpsert");
    expect(hook).not.toContain("queueCloudWrite");
    expect(hook).not.toContain("income_entries");
    expect(hook).not.toContain("expense_entries");
    expect(hook).not.toContain("budget_targets");
    expect(auth).not.toContain("income_entries");
    expect(auth).not.toContain("expense_entries");
    expect(auth).not.toContain("budget_targets");
    expect(auth).toContain('from("profiles")');
  });

  it("creates revision 1 only when no vault exists and refuses a second init", async () => {
    const memory = memoryGateway();
    const vault = occupiedState();
    const created = await initializeCloudVault(
      OWNER_A,
      CLOUD_VAULT_SCHEMA_VERSION,
      vault,
      memory.gateway
    );
    expect(created).toMatchObject({ status: "created", revision: 1, schemaVersion: 5 });
    const before = memory.snapshot();

    const again = await initializeCloudVault(
      OWNER_A,
      CLOUD_VAULT_SCHEMA_VERSION,
      { ...vault, displayName: "Changed" },
      memory.gateway
    );
    expect(again).toMatchObject({ status: "already_exists", revision: 1 });
    expect(memory.snapshot()).toEqual(before);
    expect(specifiedVaultInitializeOutcome({
      existing: { revision: 1, schemaVersion: 5 },
      knownSchemaVersion: 5,
    }).status).toBe("already_exists");
  });

  it("does not write or return a newer schema as a usable vault", async () => {
    const memory = memoryGateway({
      seed: {
        schemaVersion: 6,
        revision: 4,
        updatedAt: "2026-09-25T00:00:00.000Z",
        vaultData: { secret: true },
      },
    });
    const read = await getCloudVault(OWNER_A, memory.gateway);
    expect(read).toEqual({
      status: "unsupported_schema",
      schemaVersion: 6,
      revision: 4,
      updatedAt: "2026-09-25T00:00:00.000Z",
    });
    expect(read).not.toHaveProperty("vaultData");

    const write = await updateCloudVault(
      OWNER_A,
      4,
      6,
      occupiedState(),
      memory.gateway
    );
    expect(write).toEqual({ status: "rejected", reason: "unsupported_schema" });
    expect(memory.calls).toEqual(["read"]);
    expect(memory.snapshot()?.schemaVersion).toBe(6);
  });

  it("refuses another user's vault before reading it", async () => {
    const memory = memoryGateway();
    const result = await getCloudVault(OWNER_B, memory.gateway);
    expect(result.status).toBe("forbidden");
    expect(memory.calls).toEqual([]);
  });

  it("advances revision 17 to 18 and leaves a stale write unchanged", async () => {
    const vault = occupiedState();
    const stored = {
      revision: 17,
      schemaVersion: 5,
    };
    expect(
      specifiedVaultWriteOutcome({
        stored,
        expectedRevision: 17,
        knownSchemaVersion: 5,
      })
    ).toEqual({ status: "updated", revision: 18, schemaVersion: 5 });
    expect(stored).toEqual({ revision: 17, schemaVersion: 5 });

    expect(
      specifiedVaultWriteOutcome({
        stored: { revision: 18, schemaVersion: 5 },
        expectedRevision: 17,
        knownSchemaVersion: 5,
      })
    ).toEqual({ status: "conflict", storedRevision: 18, schemaVersion: 5 });

    const memory = memoryGateway({
      seed: {
        schemaVersion: 5,
        revision: 17,
        updatedAt: "2026-09-25T00:00:00.000Z",
        vaultData: serializeCloudVaultData(vault),
      },
    });
    const next = { ...vault, displayName: "Updated" };
    const updated = await updateCloudVault(
      OWNER_A,
      17,
      CLOUD_VAULT_SCHEMA_VERSION,
      next,
      memory.gateway
    );
    expect(updated).toMatchObject({ status: "updated", revision: 18 });
    expect(memory.snapshot()?.revision).toBe(18);
    expect(memory.snapshot()?.vaultData).toMatchObject({ displayName: "Updated" });

    const staleSeed = memory.snapshot();
    const stale = await updateCloudVault(
      OWNER_A,
      17,
      CLOUD_VAULT_SCHEMA_VERSION,
      { ...vault, displayName: "Stale" },
      memory.gateway
    );
    expect(stale).toEqual({ status: "conflict", storedRevision: 18, schemaVersion: 5 });
    expect(memory.snapshot()).toEqual(staleSeed);
  });

  it("serializes the financial document and leaves derived and device secrets out", () => {
    const state = occupiedState();
    const poisoned = {
      ...state,
      availableAfterPlannedNeeds: 12,
      livingBudgetRemaining: 34,
      pinHash: "secret",
      webauthnCredentialId: "cred",
      discreetMode: true,
      accessToken: "session",
      revision: 9,
      userId: OWNER_A,
    };
    const document = serializeCloudVaultData(poisoned);
    const json = JSON.stringify(document);
    expect(Object.keys(document).sort()).toEqual([...CLOUD_VAULT_DATA_KEYS].sort());
    expect(json).not.toContain("availableAfterPlannedNeeds");
    expect(json).not.toContain("livingBudgetRemaining");
    expect(json).not.toContain("pinHash");
    expect(json).not.toContain("webauthnCredentialId");
    expect(json).not.toContain("discreetMode");
    expect(json).not.toContain("accessToken");
    expect(json).not.toContain("\"revision\"");
    expect(json).not.toContain("userId");

    const parsed = parseCloudVaultData(JSON.parse(json));
    expect(parsed).toEqual(state);
    expect(parsed?.expenses[0]).toMatchObject({
      category: "need",
      isSettled: true,
      date: "2026-09-12",
      dueDate: "2026-09-30",
      recurringObligationId: "ffffffff-ffff-4fff-8fff-ffffffffffff",
      recurrenceMonth: "2026-09",
    });
    expect(parsed?.expenses[1]).toMatchObject({
      category: "desire",
      isSettled: false,
    });
    expect(parsed?.recurringObligations[0]?.skippedMonths).toEqual(["2026-10"]);
    expect(parsed?.accounts[0]).toMatchObject({ balance: 500, asOf: "2026-09-25" });
    expect(parsed?.openingWealthBuilding).toBe(40);
    expect(parsed?.openingEmergencyFund).toBe(10);
    expect(parsed?.incomes[0]).toMatchObject({
      wealthShare: 300,
      debtShare: 0,
      expenditureShare: 700,
      debtRedirected: true,
    });
    expect(parsed?.periodArchives[0]?.surplusDisposition).toBe("emergency_shield");
  });

  it("keeps backup version 5 free of cloud identity", () => {
    const backup = buildLedgerBackup(occupiedState());
    expect(LEDGER_BACKUP_VERSION).toBe(5);
    expect(CLOUD_VAULT_SCHEMA_VERSION).toBe(5);
    expect(backup.version).toBe(5);
    const keys = Object.keys(backup);
    expect(keys).not.toContain("revision");
    expect(keys).not.toContain("userId");
    expect(keys).not.toContain("schemaVersion");
    expect(keys).not.toContain("vault_data");
    expect(JSON.stringify(backup)).not.toContain("availableAfterPlannedNeeds");
  });

  it("keeps the owner binding outside the financial vault", () => {
    const store: CloudOwnerStore & { map: Map<string, string> } = {
      map: new Map(),
      getItem(key) {
        return this.map.get(key) ?? null;
      },
      setItem(key, value) {
        this.map.set(key, value);
      },
      removeItem(key) {
        this.map.delete(key);
      },
    };
    expect(readCloudOwnerId(store)).toBeNull();
    expect(bindCloudOwnerId("not-a-user", store)).toBe(false);
    expect(bindCloudOwnerId(OWNER_A, store)).toBe(true);
    expect(readCloudOwnerId(store)).toBe(OWNER_A);
    expect(store.map.has(STORAGE_KEY)).toBe(false);
    expect(store.map.has(CLOUD_OWNER_STORAGE_KEY)).toBe(true);
    expect(CLOUD_OWNER_STORAGE_KEY).not.toBe(STORAGE_KEY);
  });

  it("locks the vault migration to owner RLS and atomic revision updates", () => {
    const sql = readFileSync(
      resolve(process.cwd(), "supabase/migrations/20260925_wealth_engine_vault.sql"),
      "utf8"
    );
    const client = readFileSync(
      resolve(process.cwd(), "lib/babylon/cloud-vault.ts"),
      "utf8"
    );
    expect(sql).toContain("ENABLE ROW LEVEL SECURITY");
    expect(sql).toContain("USING (auth.uid() = user_id)");
    expect(sql.match(/USING \(auth\.uid\(\) = user_id\)/g)?.length).toBe(2);
    expect(sql).not.toContain("USING (true)");
    expect(sql).not.toContain("ON CONFLICT");
    expect(sql).toContain("unique_violation");
    expect(sql).toContain("AND revision = expected_revision");
    expect(sql).toContain("AND schema_version = known_schema_version");
    expect(sql).toContain("revision = revision + 1");
    expect(sql).toContain("GRANT SELECT, DELETE ON TABLE public.wealth_engine_vaults TO authenticated");
    expect(sql).not.toContain("GRANT INSERT");
    expect(sql).not.toContain("GRANT UPDATE");
    expect(sql).not.toContain("service_role");
    expect(client).toContain("cas_update_wealth_engine_vault");
    expect(client).toContain("initialize_wealth_engine_vault");
    expect(client).not.toContain(".upsert(");
    expect(client).not.toContain(".update(");
  });
});
