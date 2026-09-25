import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { EMPTY_STATE } from "@/lib/babylon/constants";
import { CLOUD_OWNER_STORAGE_KEY } from "@/lib/babylon/cloud-owner";
import {
  bootstrapDesktopVault,
  decideCloudSetup,
  hydrateEmptyDevice,
  isFinancialVaultEmpty,
  verifyCloudVaultDocument,
  type CloudProbe,
} from "@/lib/babylon/cloud-setup";
import {
  buildLedgerBackup,
  LEDGER_BACKUP_VERSION,
  loadPersistedState,
  savePersistedState,
} from "@/lib/babylon/persistence";
import type { PersistedState } from "@/types/babylon";
import type {
  CloudVaultGetResult,
  CloudVaultInitializeResult,
} from "@/lib/babylon/cloud-vault";

const OWNER = "11111111-1111-4111-8111-111111111111";
const OTHER = "22222222-2222-4222-8222-222222222222";

function richState(): PersistedState {
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
  };
}

function ready(result: CloudVaultGetResult): CloudProbe {
  return { status: "ready", result };
}

function absent(): CloudVaultGetResult {
  return { status: "absent" };
}

function present(state: PersistedState, revision = 1): CloudVaultGetResult {
  return {
    status: "present",
    schemaVersion: 5,
    revision,
    updatedAt: "2026-09-25T00:00:00.000Z",
    vaultData: state,
  };
}

describe("cloud setup", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("no longer writes the relational ledger from the engine", () => {
    const hook = readFileSync(
      resolve(process.cwd(), "hooks/useBabylonEngine.ts"),
      "utf8"
    );
    const setup = readFileSync(
      resolve(process.cwd(), "lib/babylon/cloud-setup.ts"),
      "utf8"
    );
    const plaid = readFileSync(
      resolve(process.cwd(), "app/api/plaid/exchange-token/route.ts"),
      "utf8"
    );
    expect(existsSync(resolve(process.cwd(), "lib/babylon/cloud-sync.ts"))).toBe(
      false
    );
    expect(hook).not.toContain("cloud-sync");
    expect(hook).not.toContain("cloudUpsert");
    expect(hook).not.toContain("queueCloudWrite");
    expect(hook).not.toContain("income_entries");
    expect(hook).not.toContain("expense_entries");
    expect(hook).not.toContain("budget_targets");
    expect(setup).not.toContain("updateCloudVault");
    expect(setup).not.toContain(".upsert(");
    const authStart = hook.indexOf("supabase.auth.onAuthStateChange");
    const authEnd = hook.indexOf("subscription.unsubscribe()");
    const authBlock = hook.slice(authStart, authEnd);
    expect(authBlock).not.toContain("bootstrap");
    expect(authBlock).not.toContain("hydrate");
    expect(authBlock).not.toContain("initialize");
    expect(plaid).not.toContain("wealth_engine_vaults");
    expect(plaid).not.toContain("cloud-setup");
    expect(buildLedgerBackup(richState()).version).toBe(5);
    expect(LEDGER_BACKUP_VERSION).toBe(5);
  });

  it("treats modern financial state as non-empty", () => {
    expect(isFinancialVaultEmpty(EMPTY_STATE)).toBe(true);
    expect(
      isFinancialVaultEmpty({ ...EMPTY_STATE, displayName: "Ada" })
    ).toBe(true);
    expect(
      isFinancialVaultEmpty({
        ...EMPTY_STATE,
        activityLog: [
          {
            id: "1",
            kind: "close",
            title: "Note",
            createdAt: "2026-09-01T00:00:00.000Z",
          },
        ],
      })
    ).toBe(true);
    expect(
      isFinancialVaultEmpty({
        ...EMPTY_STATE,
        accounts: [
          {
            id: "a",
            name: "Cash",
            kind: "cash",
            balance: 5,
            asOf: "2026-09-25",
          },
        ],
      })
    ).toBe(false);
    expect(
      isFinancialVaultEmpty({
        ...EMPTY_STATE,
        recurringObligations: richState().recurringObligations,
      })
    ).toBe(false);
    expect(
      isFinancialVaultEmpty({ ...EMPTY_STATE, openingWealthBuilding: 1 })
    ).toBe(false);
    expect(
      isFinancialVaultEmpty({ ...EMPTY_STATE, openingEmergencyFund: 1 })
    ).toBe(false);
    expect(isFinancialVaultEmpty({ ...EMPTY_STATE, emergencyShield: 1 })).toBe(
      false
    );
    expect(
      isFinancialVaultEmpty({
        ...EMPTY_STATE,
        periodArchives: richState().periodArchives,
      })
    ).toBe(false);
    expect(
      isFinancialVaultEmpty({ ...EMPTY_STATE, lastClosedMonthKey: "2026-08" })
    ).toBe(false);
  });

  it("offers bootstrap only for a rich local vault and an absent cloud", () => {
    const action = decideCloudSetup({
      sessionUserId: OWNER,
      local: richState(),
      ownerUserId: null,
      probe: ready(absent()),
    });
    expect(action).toEqual({ kind: "offer_bootstrap" });
    expect(
      decideCloudSetup({
        sessionUserId: OWNER,
        local: richState(),
        ownerUserId: OWNER,
        probe: ready(absent()),
      })
    ).toEqual({ kind: "offer_bootstrap" });
  });

  it("creates revision 1 and binds the owner only after a matching read-back", async () => {
    const local = richState();
    let cloud: PersistedState | null = null;
    let bound: string | null = null;
    let initializes = 0;
    const result = await bootstrapDesktopVault({
      sessionUserId: OWNER,
      local,
      ownerUserId: null,
      readCloud: async () => (cloud ? present(cloud) : absent()),
      initialize: async (state) => {
        initializes += 1;
        cloud = state;
        return {
          status: "created",
          schemaVersion: 5,
          revision: 1,
          updatedAt: "2026-09-25T00:00:00.000Z",
        };
      },
      bindOwner: (userId) => {
        bound = userId;
        return true;
      },
    });
    expect(result).toEqual({ ok: true, revision: 1 });
    expect(initializes).toBe(1);
    expect(bound).toBe(OWNER);
    expect(cloud).toEqual(local);
  });

  it("does not bind the owner when verification fails", async () => {
    const local = richState();
    let reads = 0;
    let bound = false;
    const result = await bootstrapDesktopVault({
      sessionUserId: OWNER,
      local,
      ownerUserId: null,
      readCloud: async () => {
        reads += 1;
        return reads === 1 ? absent() : present({ ...local, displayName: "Other" });
      },
      initialize: async () => {
        return {
          status: "created",
          schemaVersion: 5,
          revision: 1,
          updatedAt: "2026-09-25T00:00:00.000Z",
        } satisfies CloudVaultInitializeResult;
      },
      bindOwner: () => {
        bound = true;
        return true;
      },
    });
    expect(result.ok).toBe(false);
    expect(bound).toBe(false);
    expect(local.displayName).toBe("Ada");
  });

  it("refuses initialization when the cloud appears before confirm", async () => {
    let initializes = 0;
    const result = await bootstrapDesktopVault({
      sessionUserId: OWNER,
      local: richState(),
      ownerUserId: null,
      readCloud: async () => present(richState()),
      initialize: async () => {
        initializes += 1;
        return {
          status: "already_exists",
          schemaVersion: 5,
          revision: 1,
          updatedAt: "2026-09-25T00:00:00.000Z",
        };
      },
      bindOwner: () => true,
    });
    expect(result.ok).toBe(false);
    expect(initializes).toBe(0);
  });

  it("hydrates an empty device only when the transfer runs", async () => {
    const cloud = richState();
    const decision = decideCloudSetup({
      sessionUserId: OWNER,
      local: EMPTY_STATE,
      ownerUserId: null,
      probe: ready(present(cloud)),
    });
    expect(decision).toEqual({ kind: "offer_hydrate" });

    let stored = EMPTY_STATE;
    let bound: string | null = null;
    const result = await hydrateEmptyDevice({
      sessionUserId: OWNER,
      local: EMPTY_STATE,
      ownerUserId: null,
      readCloud: async () => present(cloud),
      readLocal: () => stored,
      writeLocal: (state) => {
        stored = state;
      },
      bindOwner: (userId) => {
        bound = userId;
        return true;
      },
    });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.state).toEqual(cloud);
    expect(bound).toBe(OWNER);
    expect(stored).toEqual(cloud);
  });

  it("stops when both the device and the cloud already have data", async () => {
    expect(
      decideCloudSetup({
        sessionUserId: OWNER,
        local: richState(),
        ownerUserId: null,
        probe: ready(present(richState())),
      })
    ).toEqual({ kind: "conflict" });
    let writes = 0;
    const result = await hydrateEmptyDevice({
      sessionUserId: OWNER,
      local: richState(),
      ownerUserId: null,
      readCloud: async () => present(richState()),
      readLocal: () => richState(),
      writeLocal: () => {
        writes += 1;
      },
      bindOwner: () => true,
    });
    expect(result.ok).toBe(false);
    expect(writes).toBe(0);
    let initializes = 0;
    const uploaded = await bootstrapDesktopVault({
      sessionUserId: OWNER,
      local: richState(),
      ownerUserId: null,
      readCloud: async () => present(richState()),
      initialize: async () => {
        initializes += 1;
        return {
          status: "created",
          schemaVersion: 5,
          revision: 1,
          updatedAt: "t",
        };
      },
      bindOwner: () => true,
    });
    expect(uploaded.ok).toBe(false);
    expect(initializes).toBe(0);
  });

  it("does not upload, hydrate, or rebind a different owner", async () => {
    expect(
      decideCloudSetup({
        sessionUserId: OTHER,
        local: richState(),
        ownerUserId: OWNER,
        probe: ready(absent()),
      })
    ).toEqual({ kind: "owner_mismatch" });
    let initializes = 0;
    let writes = 0;
    let binds = 0;
    const uploaded = await bootstrapDesktopVault({
      sessionUserId: OTHER,
      local: richState(),
      ownerUserId: OWNER,
      readCloud: async () => absent(),
      initialize: async () => {
        initializes += 1;
        return {
          status: "created",
          schemaVersion: 5,
          revision: 1,
          updatedAt: "t",
        };
      },
      bindOwner: () => {
        binds += 1;
        return true;
      },
    });
    const loaded = await hydrateEmptyDevice({
      sessionUserId: OTHER,
      local: EMPTY_STATE,
      ownerUserId: OWNER,
      readCloud: async () => present(richState()),
      readLocal: () => EMPTY_STATE,
      writeLocal: () => {
        writes += 1;
      },
      bindOwner: () => {
        binds += 1;
        return true;
      },
    });
    expect(uploaded.ok).toBe(false);
    expect(loaded.ok).toBe(false);
    expect(initializes).toBe(0);
    expect(writes).toBe(0);
    expect(binds).toBe(0);
  });

  it("does not treat an unsupported or invalid cloud vault as empty", async () => {
    expect(
      decideCloudSetup({
        sessionUserId: OWNER,
        local: richState(),
        ownerUserId: null,
        probe: ready({
          status: "unsupported_schema",
          schemaVersion: 6,
          revision: 3,
          updatedAt: "t",
        }),
      })
    ).toEqual({ kind: "unsupported_schema" });
    expect(
      decideCloudSetup({
        sessionUserId: OWNER,
        local: EMPTY_STATE,
        ownerUserId: null,
        probe: ready({
          status: "invalid_vault",
          schemaVersion: 5,
          revision: 1,
          updatedAt: "t",
        }),
      })
    ).toEqual({ kind: "invalid_vault" });
    let initializes = 0;
    const unsupported = await bootstrapDesktopVault({
      sessionUserId: OWNER,
      local: richState(),
      ownerUserId: null,
      readCloud: async () => ({
        status: "unsupported_schema",
        schemaVersion: 6,
        revision: 3,
        updatedAt: "t",
      }),
      initialize: async () => {
        initializes += 1;
        return {
          status: "created",
          schemaVersion: 5,
          revision: 1,
          updatedAt: "t",
        };
      },
      bindOwner: () => true,
    });
    const invalid = await hydrateEmptyDevice({
      sessionUserId: OWNER,
      local: EMPTY_STATE,
      ownerUserId: null,
      readCloud: async () => ({
        status: "invalid_vault",
        schemaVersion: 5,
        revision: 1,
        updatedAt: "t",
      }),
      readLocal: () => EMPTY_STATE,
      writeLocal: () => {
        throw new Error("local write");
      },
      bindOwner: () => true,
    });
    expect(unsupported.ok).toBe(false);
    expect(invalid.ok).toBe(false);
    expect(initializes).toBe(0);
  });

  it("rejects a cloud document that differs in any financial fact", () => {
    const local = richState();
    expect(verifyCloudVaultDocument(local, local)).toBe(true);
    expect(
      verifyCloudVaultDocument(local, {
        ...local,
        expenses: [{ ...local.expenses[0], amount: 51 }, local.expenses[1]],
      })
    ).toBe(false);
    expect(
      verifyCloudVaultDocument(local, {
        ...local,
        expenses: [{ ...local.expenses[1], isSettled: true }, local.expenses[0]],
      })
    ).toBe(false);
    expect(
      verifyCloudVaultDocument(local, {
        ...local,
        expenses: [{ ...local.expenses[0], category: "desire" }, local.expenses[1]],
      })
    ).toBe(false);
    expect(
      verifyCloudVaultDocument(local, {
        ...local,
        accounts: [{ ...local.accounts[0], balance: 499 }],
      })
    ).toBe(false);
    expect(
      verifyCloudVaultDocument(local, { ...local, openingWealthBuilding: 41 })
    ).toBe(false);
    expect(
      verifyCloudVaultDocument(local, {
        ...local,
        recurringObligations: [
          { ...local.recurringObligations[0], skippedMonths: [] },
        ],
      })
    ).toBe(false);
    expect(
      verifyCloudVaultDocument(local, {
        ...local,
        allocations: [{ ...local.allocations[0], wealth: 299 }],
      })
    ).toBe(false);
  });

  it("round-trips the financial document through local persistence", async () => {
    const cloud = richState();
    const map = new Map<string, string>();
    vi.stubGlobal("window", {
      localStorage: {
        getItem: (key: string) => map.get(key) ?? null,
        setItem: (key: string, value: string) => {
          map.set(key, value);
        },
        removeItem: (key: string) => {
          map.delete(key);
        },
      },
    });
    savePersistedState(EMPTY_STATE);
    const result = await hydrateEmptyDevice({
      sessionUserId: OWNER,
      local: loadPersistedState(),
      ownerUserId: null,
      readCloud: async () => present(cloud),
      readLocal: loadPersistedState,
      writeLocal: savePersistedState,
      bindOwner: (userId) => {
        map.set(CLOUD_OWNER_STORAGE_KEY, userId);
        return true;
      },
    });
    expect(result.ok).toBe(true);
    const loaded = loadPersistedState();
    expect(loaded.accounts[0]).toMatchObject({ balance: 500, asOf: "2026-09-25" });
    expect(loaded.incomes[0]).toMatchObject({
      wealthShare: 300,
      debtShare: 0,
      expenditureShare: 700,
      debtRedirected: true,
    });
    expect(loaded.allocations[0]).toMatchObject({ wealth: 300, debt: 0 });
    expect(loaded.expenses[0]).toMatchObject({
      category: "need",
      isSettled: true,
      date: "2026-09-12",
      dueDate: "2026-09-30",
      recurringObligationId: "ffffffff-ffff-4fff-8fff-ffffffffffff",
      recurrenceMonth: "2026-09",
    });
    expect(loaded.expenses[1]).toMatchObject({
      category: "desire",
      isSettled: false,
    });
    expect(loaded.debts[0]?.remainingDebt).toBe(80);
    expect(loaded.budgetTargets[0]?.categoryName).toBe("Rent");
    expect(loaded.openingWealthBuilding).toBe(40);
    expect(loaded.openingEmergencyFund).toBe(10);
    expect(loaded.emergencyShield).toBe(15);
    expect(loaded.recurringObligations[0]?.skippedMonths).toEqual(["2026-10"]);
    expect(loaded.periodArchives[0]?.surplusDisposition).toBe("emergency_shield");
    expect(map.get(CLOUD_OWNER_STORAGE_KEY)).toBe(OWNER);
  });
});
