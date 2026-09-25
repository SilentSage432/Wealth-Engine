import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { EMPTY_STATE } from "@/lib/babylon/constants";
import {
  buildLedgerBackup,
  LEDGER_BACKUP_VERSION,
  loadPersistedState,
  savePersistedState,
} from "@/lib/babylon/persistence";
import {
  CLOUD_VAULT_DATA_KEYS,
  financialVaultFingerprint,
  type CloudVaultGetResult,
  type CloudVaultUpdateResult,
} from "@/lib/babylon/cloud-vault";
import {
  CLOUD_SYNC_STORAGE_KEY,
  readCloudSyncBaseline,
  runCloudRevisionCycle,
  vaultSyncCopy,
  writeCloudSyncBaseline,
  type CloudRevisionCycleDeps,
  type CloudSyncBaseline,
} from "@/lib/babylon/vault-sync";
import type { PersistedState } from "@/types/babylon";

const OWNER = "11111111-1111-4111-8111-111111111111";
const OTHER = "22222222-2222-4222-8222-222222222222";

function state(amount = 20): PersistedState {
  return {
    ...EMPTY_STATE,
    displayName: "Ada",
    accounts: [
      {
        id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        name: "Checking",
        kind: "checking",
        balance: 500,
        asOf: "2026-09-25",
      },
    ],
    expenses: [
      {
        id: "99999999-9999-4999-8999-999999999999",
        name: "Groceries",
        category: "need",
        amount,
        date: "2026-09-12",
        dueDate: "2026-09-30",
        isSettled: amount !== 20,
      },
    ],
  };
}

function present(vault: PersistedState, revision: number): CloudVaultGetResult {
  return {
    status: "present",
    schemaVersion: 5,
    revision,
    updatedAt: "2026-09-25T00:00:00.000Z",
    vaultData: vault,
  };
}

function updated(
  revision: number
): Extract<CloudVaultUpdateResult, { status: "updated" }> {
  return {
    status: "updated",
    schemaVersion: 5,
    revision,
    updatedAt: "2026-09-25T00:00:00.000Z",
  };
}

function cycle(input: {
  local: PersistedState;
  baseline?: CloudSyncBaseline | null;
  owner?: string | null;
  readCloud: () => Promise<CloudVaultGetResult>;
  pushCloud?: CloudRevisionCycleDeps["pushCloud"];
  readStored?: () => PersistedState;
  writeStored?: (state: PersistedState) => void;
  onMemory?: (state: PersistedState) => void;
}) {
  let memory = input.local;
  let baseline = input.baseline ?? null;
  let owner = input.owner === undefined ? OWNER : input.owner;
  let storedWrites = 0;
  let advanced: CloudVaultGetResult | null = null;
  const pushes: Array<{ expected: number; fingerprint: string }> = [];
  let cloudReads = 0;
  const deps: CloudRevisionCycleDeps = {
    sessionUserId: OWNER,
    readOwner: () => owner,
    readBaseline: () => baseline,
    writeBaseline: (next) => {
      baseline = next;
      return true;
    },
    readMemory: () => memory,
    readStored: input.readStored ?? (() => memory),
    writeStored: (next) => {
      storedWrites += 1;
      if (input.writeStored) input.writeStored(next);
      else memory = next;
    },
    readCloud: async () => {
      cloudReads += 1;
      if (advanced) return advanced;
      return input.readCloud();
    },
    pushCloud: async (expected, snapshot) => {
      pushes.push({
        expected,
        fingerprint: financialVaultFingerprint(snapshot),
      });
      input.onMemory?.(snapshot);
      if (input.pushCloud) return input.pushCloud(expected, snapshot);
      const result = updated(expected + 1);
      advanced = present(snapshot, result.revision);
      return result;
    },
    bindOwner: (userId) => {
      owner = userId;
      return true;
    },
  };
  return {
    deps,
    pushes,
    cloudReads: () => cloudReads,
    storedWrites: () => storedWrites,
    baseline: () => baseline,
    owner: () => owner,
    memory: () => memory,
    setMemory: (next: PersistedState) => {
      memory = next;
    },
  };
}

describe("revision sync", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("adopts revision 1 when the bound desktop already matches the cloud", async () => {
    const local = state();
    const harness = cycle({
      local,
      baseline: null,
      readCloud: async () => present(local, 1),
    });
    const result = await runCloudRevisionCycle(harness.deps);
    expect(result.view).toEqual({ kind: "clean", revision: 1 });
    expect(harness.baseline()).toEqual({
      revision: 1,
      fingerprint: financialVaultFingerprint(local),
    });
    expect(harness.pushes).toEqual([]);
    expect(harness.storedWrites()).toBe(0);
    expect(result.pulled).toBe(false);
  });

  it("stops when a bound desktop has no baseline and differs from the cloud", async () => {
    const harness = cycle({
      local: state(21),
      baseline: null,
      readCloud: async () => present(state(20), 1),
    });
    const result = await runCloudRevisionCycle(harness.deps);
    expect(result.view).toMatchObject({
      kind: "conflict",
      baselineRevision: null,
      cloudRevision: 1,
    });
    expect(harness.pushes).toEqual([]);
    expect(harness.storedWrites()).toBe(0);
    expect(harness.baseline()).toBeNull();
    expect(harness.memory().expenses[0]?.amount).toBe(21);
  });

  it("stays clean when the cloud revision still matches", async () => {
    const local = state();
    const baseline = {
      revision: 4,
      fingerprint: financialVaultFingerprint(local),
    };
    const harness = cycle({
      local,
      baseline,
      readCloud: async () => present(local, 4),
    });
    const result = await runCloudRevisionCycle(harness.deps);
    expect(result.view).toEqual({ kind: "clean", revision: 4 });
    expect(harness.pushes).toEqual([]);
    expect(harness.storedWrites()).toBe(0);
  });

  it("pulls a newer cloud revision only when this device is still clean", async () => {
    const older = state(20);
    const newer = state(30);
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
    savePersistedState(older);
    const harness = cycle({
      local: older,
      baseline: { revision: 1, fingerprint: financialVaultFingerprint(older) },
      readCloud: async () => present(newer, 2),
      readStored: loadPersistedState,
      writeStored: savePersistedState,
    });
    const result = await runCloudRevisionCycle(harness.deps);
    expect(result.pulled).toBe(true);
    expect(result.view).toEqual({ kind: "clean", revision: 2 });
    expect(result.appliedLocal?.expenses[0]?.amount).toBe(30);
    expect(loadPersistedState().expenses[0]).toMatchObject({
      amount: 30,
      isSettled: true,
      category: "need",
    });
    expect(loadPersistedState().accounts[0]).toMatchObject({
      balance: 500,
      asOf: "2026-09-25",
    });
    expect(harness.pushes).toEqual([]);
    expect(map.get(CLOUD_SYNC_STORAGE_KEY)).toBeUndefined();
  });

  it("pushes a dirty vault with compare-and-swap and then marks that revision clean", async () => {
    const base = state(20);
    const dirty = state(25);
    const harness = cycle({
      local: dirty,
      baseline: { revision: 3, fingerprint: financialVaultFingerprint(base) },
      readCloud: async () => present(base, 3),
    });
    const result = await runCloudRevisionCycle(harness.deps);
    expect(harness.pushes).toEqual([
      { expected: 3, fingerprint: financialVaultFingerprint(dirty) },
    ]);
    expect(result.view).toEqual({ kind: "clean", revision: 4 });
    expect(harness.baseline()?.revision).toBe(4);
    expect(harness.baseline()?.fingerprint).toBe(financialVaultFingerprint(dirty));
    expect(harness.storedWrites()).toBe(0);
  });

  it("does not upload or download when the cloud moved and this device is dirty", async () => {
    const base = state(20);
    const local = state(25);
    const remote = state(40);
    const harness = cycle({
      local,
      baseline: { revision: 3, fingerprint: financialVaultFingerprint(base) },
      readCloud: async () => present(remote, 4),
    });
    const result = await runCloudRevisionCycle(harness.deps);
    expect(result.view).toEqual({
      kind: "conflict",
      baselineRevision: 3,
      cloudRevision: 4,
    });
    expect(harness.pushes).toEqual([]);
    expect(harness.storedWrites()).toBe(0);
    expect(harness.memory().expenses[0]?.amount).toBe(25);
    expect(harness.baseline()?.revision).toBe(3);
  });

  it("treats a stale compare-and-swap as a conflict and does not write again", async () => {
    const base = state(20);
    const local = state(25);
    const remote = state(40);
    let reads = 0;
    const harness = cycle({
      local,
      baseline: { revision: 3, fingerprint: financialVaultFingerprint(base) },
      readCloud: async () => {
        reads += 1;
        return reads === 1 ? present(base, 3) : present(remote, 4);
      },
      pushCloud: async () => ({
        status: "conflict",
        storedRevision: 4,
        schemaVersion: 5,
      }),
    });
    const result = await runCloudRevisionCycle(harness.deps);
    expect(result.view).toMatchObject({
      kind: "conflict",
      baselineRevision: 3,
      cloudRevision: 4,
    });
    expect(harness.pushes).toHaveLength(1);
    expect(harness.storedWrites()).toBe(0);
    expect(harness.baseline()?.revision).toBe(3);
  });

  it("keeps a failed upload dirty and retries the latest local vault later", async () => {
    const base = state(20);
    const dirty = state(25);
    const harness = cycle({
      local: dirty,
      baseline: { revision: 2, fingerprint: financialVaultFingerprint(base) },
      readCloud: async () => present(base, 2),
      pushCloud: async () => ({ status: "error", message: "offline" }),
    });
    const failed = await runCloudRevisionCycle(harness.deps);
    expect(failed.view).toEqual({ kind: "offline_pending", revision: 2 });
    expect(harness.baseline()?.revision).toBe(2);
    expect(harness.memory().expenses[0]?.amount).toBe(25);
    expect(vaultSyncCopy(failed.view).title).toBe(
      "Offline · changes saved on this device"
    );

    const retry = cycle({
      local: dirty,
      baseline: harness.baseline(),
      readCloud: async () => present(base, 2),
    });
    const synced = await runCloudRevisionCycle(retry.deps);
    expect(synced.view).toEqual({ kind: "clean", revision: 3 });
    expect(retry.pushes[0]?.expected).toBe(2);
    expect(retry.pushes[0]?.fingerprint).toBe(financialVaultFingerprint(dirty));
  });

  it("does not mark a newer local edit clean when an older snapshot finishes uploading", async () => {
    const base = state(20);
    const first = state(25);
    const second = state(26);
    let memory = first;
    let remote = present(base, 2);
    const pushes: Array<{ expected: number; amount: number }> = [];
    const result = await runCloudRevisionCycle({
      sessionUserId: OWNER,
      readOwner: () => OWNER,
      readBaseline: () => ({
        revision: pushes.length === 0 ? 2 : 3,
        fingerprint: financialVaultFingerprint(pushes.length === 0 ? base : first),
      }),
      writeBaseline: () => true,
      readMemory: () => memory,
      readStored: () => memory,
      writeStored: (next) => {
        memory = next;
      },
      readCloud: async () => remote,
      pushCloud: async (expected, snapshot) => {
        pushes.push({ expected, amount: snapshot.expenses[0]?.amount ?? 0 });
        if (snapshot.expenses[0]?.amount === 25) {
          memory = second;
          remote = present(first, 3);
          return updated(3);
        }
        remote = present(snapshot, expected + 1);
        return updated(expected + 1);
      },
      bindOwner: () => true,
    });
    expect(pushes).toEqual([
      { expected: 2, amount: 25 },
      { expected: 3, amount: 26 },
    ]);
    expect(result.view).toEqual({ kind: "clean", revision: 4 });
    expect(result.pushed).toBe(true);
    expect(memory.expenses[0]?.amount).toBe(26);
    expect(financialVaultFingerprint(memory)).not.toBe(financialVaultFingerprint(first));
  });

  it("does not transfer when the owner, schema, or vault is unsafe", async () => {
    const local = state();
    const wrongOwner = cycle({
      local,
      owner: OTHER,
      readCloud: async () => present(local, 1),
    });
    expect((await runCloudRevisionCycle(wrongOwner.deps)).view.kind).toBe(
      "owner_mismatch"
    );
    expect(wrongOwner.cloudReads()).toBe(0);
    expect(wrongOwner.pushes).toEqual([]);

    const unsupported = cycle({
      local,
      baseline: { revision: 1, fingerprint: financialVaultFingerprint(local) },
      readCloud: async () => ({
        status: "unsupported_schema",
        schemaVersion: 6,
        revision: 2,
        updatedAt: "2026-09-25T00:00:00.000Z",
      }),
    });
    expect((await runCloudRevisionCycle(unsupported.deps)).view.kind).toBe(
      "unsupported_schema"
    );
    expect(unsupported.pushes).toEqual([]);
    expect(unsupported.storedWrites()).toBe(0);

    const invalid = cycle({
      local,
      baseline: { revision: 1, fingerprint: financialVaultFingerprint(local) },
      readCloud: async () => ({
        status: "invalid_vault",
        schemaVersion: 5,
        revision: 2,
        updatedAt: "2026-09-25T00:00:00.000Z",
      }),
    });
    expect((await runCloudRevisionCycle(invalid.deps)).view.kind).toBe("invalid_vault");
    expect(invalid.storedWrites()).toBe(0);

    const missing = cycle({
      local: state(25),
      baseline: { revision: 1, fingerprint: financialVaultFingerprint(state(20)) },
      readCloud: async () => ({ status: "error", message: "relation does not exist" }),
    });
    const unavailable = await runCloudRevisionCycle(missing.deps);
    expect(unavailable.view.kind).toBe("offline_pending");
    expect(missing.memory().expenses[0]?.amount).toBe(25);
    expect(missing.baseline()?.revision).toBe(1);
    expect(vaultSyncCopy({ kind: "cloud_unavailable" }).title).toBe(
      "Cloud vault unavailable"
    );
  });

  it("leaves an empty second device for an explicit load", async () => {
    const harness = cycle({
      local: EMPTY_STATE,
      baseline: null,
      owner: null,
      readCloud: async () => present(state(), 4),
    });
    const result = await runCloudRevisionCycle(harness.deps);
    expect(result.view.kind).toBe("offer_hydrate");
    expect(harness.storedWrites()).toBe(0);
    expect(harness.pushes).toEqual([]);
    expect(harness.owner()).toBeNull();
    expect(vaultSyncCopy(result.view).title).toBe("Cloud account connected");
  });

  it("adopts a non-empty second device only when its document matches the cloud", async () => {
    const local = state();
    const same = cycle({
      local,
      baseline: null,
      owner: null,
      readCloud: async () => present(local, 4),
    });
    const adopted = await runCloudRevisionCycle(same.deps);
    expect(adopted.view).toEqual({ kind: "clean", revision: 4 });
    expect(adopted.boundOwner).toBe(true);
    expect(same.owner()).toBe(OWNER);
    expect(same.pushes).toEqual([]);
    expect(same.storedWrites()).toBe(0);

    const different = cycle({
      local: state(99),
      baseline: null,
      owner: null,
      readCloud: async () => present(state(20), 4),
    });
    const conflict = await runCloudRevisionCycle(different.deps);
    expect(conflict.view).toMatchObject({
      kind: "conflict",
      baselineRevision: null,
      cloudRevision: 4,
    });
    expect(different.owner()).toBeNull();
    expect(different.pushes).toEqual([]);
    expect(different.storedWrites()).toBe(0);
    expect(different.memory().expenses[0]?.amount).toBe(99);
  });

  it("does not treat an unverified compare-and-swap as a clean baseline", async () => {
    const base = state(20);
    const sent = state(25);
    const newer = state(26);
    const other = state(40);
    let reads = 0;
    const failed = cycle({
      local: sent,
      baseline: { revision: 2, fingerprint: financialVaultFingerprint(base) },
      readCloud: async () => {
        reads += 1;
        return reads === 1
          ? present(base, 2)
          : { status: "error", message: "offline" };
      },
      pushCloud: async (expected) => updated(expected + 1),
    });
    const pending = await runCloudRevisionCycle(failed.deps);
    expect(pending.view).toEqual({ kind: "pending_verification", revision: 3 });
    expect(vaultSyncCopy(pending.view).title).toBe(
      "Waiting to confirm cloud revision 3"
    );
    expect(vaultSyncCopy(pending.view).title).not.toContain("Up to date");
    expect(failed.baseline()).toEqual({
      revision: 2,
      fingerprint: financialVaultFingerprint(base),
      pendingRevision: 3,
      pendingFingerprint: financialVaultFingerprint(sent),
    });
    expect(failed.pushes.map((push) => push.expected)).toEqual([2]);
    expect(failed.memory().expenses[0]?.amount).toBe(25);
    expect(failed.storedWrites()).toBe(0);

    const confirmed = cycle({
      local: sent,
      baseline: failed.baseline(),
      readCloud: async () => present(sent, 3),
    });
    const clean = await runCloudRevisionCycle(confirmed.deps);
    expect(clean.view).toEqual({ kind: "clean", revision: 3 });
    expect(confirmed.pushes).toEqual([]);
    expect(confirmed.baseline()).toEqual({
      revision: 3,
      fingerprint: financialVaultFingerprint(sent),
    });
    expect(confirmed.storedWrites()).toBe(0);

    const advanced = cycle({
      local: newer,
      baseline: failed.baseline(),
      readCloud: async () => present(sent, 3),
    });
    const verified = await runCloudRevisionCycle(advanced.deps);
    expect(verified.view).toEqual({ kind: "local_dirty", revision: 3 });
    expect(advanced.pushes).toEqual([]);
    expect(advanced.memory().expenses[0]?.amount).toBe(26);
    expect(advanced.baseline()).toEqual({
      revision: 3,
      fingerprint: financialVaultFingerprint(sent),
    });
    const follow = cycle({
      local: newer,
      baseline: advanced.baseline(),
      readCloud: async () => present(sent, 3),
    });
    const synced = await runCloudRevisionCycle(follow.deps);
    expect(follow.pushes).toEqual([
      { expected: 3, fingerprint: financialVaultFingerprint(newer) },
    ]);
    expect(synced.view).toEqual({ kind: "clean", revision: 4 });

    let mismatchedReads = 0;
    const mismatched = cycle({
      local: sent,
      baseline: { revision: 2, fingerprint: financialVaultFingerprint(base) },
      readCloud: async () => {
        mismatchedReads += 1;
        return mismatchedReads === 1 ? present(base, 2) : present(other, 3);
      },
      pushCloud: async (expected) => updated(expected + 1),
    });
    const stopped = await runCloudRevisionCycle(mismatched.deps);
    expect(stopped.view).toEqual({
      kind: "conflict",
      baselineRevision: 2,
      cloudRevision: 3,
    });
    expect(mismatched.pushes.map((push) => push.expected)).toEqual([2]);
    expect(mismatched.baseline()?.revision).toBe(2);
    expect(mismatched.baseline()?.pendingFingerprint).toBe(
      financialVaultFingerprint(sent)
    );
    expect(mismatched.memory().expenses[0]?.amount).toBe(25);
    const retry = cycle({
      local: sent,
      baseline: mismatched.baseline(),
      readCloud: async () => present(other, 4),
    });
    const stillStopped = await runCloudRevisionCycle(retry.deps);
    expect(stillStopped.view.kind).toBe("conflict");
    expect(retry.pushes).toEqual([]);
    expect(retry.baseline()?.pendingRevision).toBe(3);
    expect(retry.memory().expenses[0]?.amount).toBe(25);
  });

  it("refuses a cloud revision older than the verified baseline", async () => {
    const local = state();
    const harness = cycle({
      local,
      baseline: { revision: 5, fingerprint: financialVaultFingerprint(local) },
      readCloud: async () => present(local, 4),
    });
    const result = await runCloudRevisionCycle(harness.deps);
    expect(result.view).toMatchObject({
      kind: "unexpected_revision",
      baselineRevision: 5,
      cloudRevision: 4,
    });
    expect(harness.pushes).toEqual([]);
    expect(harness.storedWrites()).toBe(0);
    expect(harness.baseline()?.revision).toBe(5);
  });

  it("keeps sync metadata out of the financial vault and backup", () => {
    const local = state();
    const map = new Map<string, string>();
    const store = {
      getItem: (key: string) => map.get(key) ?? null,
      setItem: (key: string, value: string) => {
        map.set(key, value);
      },
      removeItem: (key: string) => {
        map.delete(key);
      },
    };
    expect(
      writeCloudSyncBaseline(
        { revision: 1, fingerprint: financialVaultFingerprint(local) },
        store
      )
    ).toBe(true);
    expect(readCloudSyncBaseline(store)?.revision).toBe(1);
    expect(CLOUD_SYNC_STORAGE_KEY).not.toBe("wealth-engine-babylon-v2");
    const backup = buildLedgerBackup(local);
    expect(backup.version).toBe(5);
    expect(LEDGER_BACKUP_VERSION).toBe(5);
    expect(backup).not.toHaveProperty("fingerprint");
    expect(backup).not.toHaveProperty("revision");
    expect(CLOUD_VAULT_DATA_KEYS).not.toContain("fingerprint");
    expect(JSON.stringify(backup)).not.toContain(CLOUD_SYNC_STORAGE_KEY);
    expect(
      writeCloudSyncBaseline(
        { revision: 1, fingerprint: "abc", extra: true } as CloudSyncBaseline,
        store
      )
    ).toBe(false);
  });

  it("does not bring back relational writes, log the vault, or clear it on sign-out", () => {
    const hook = readFileSync(resolve(process.cwd(), "hooks/useBabylonEngine.ts"), "utf8");
    const sync = readFileSync(resolve(process.cwd(), "lib/babylon/vault-sync.ts"), "utf8");
    const worker = readFileSync(resolve(process.cwd(), "public/sw.js"), "utf8");
    expect(hook).not.toContain("updateCloudVault");
    expect(hook).not.toContain("income_entries");
    expect(hook).not.toContain("expense_entries");
    expect(hook).not.toContain("budget_targets");
    expect(hook).not.toContain("cloud-sync");
    expect(hook).toContain("runCurrentVaultCycle");
    expect(hook).toContain('addEventListener("online"');
    expect(sync).not.toContain("console.");
    expect(sync).not.toContain("income_entries");
    expect(worker).not.toContain("wealth_engine_vaults");
    const signOut = hook.slice(
      hook.indexOf("const signOutCloud"),
      hook.indexOf("const alignToLocalDay")
    );
    expect(signOut).not.toContain("clearPersistedState");
    expect(signOut).not.toContain("clearCloudSyncBaseline");
    expect(vaultSyncCopy({ kind: "clean", revision: 2 }).title).toBe(
      "Up to date · revision 2"
    );
    expect(vaultSyncCopy({ kind: "clean", revision: 2 }).title).not.toContain(
      "New entries stay on this device"
    );
  });
});
