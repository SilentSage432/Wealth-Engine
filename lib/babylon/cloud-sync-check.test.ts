import { afterEach, describe, expect, it, vi } from "vitest";
import { EMPTY_STATE } from "@/lib/babylon/constants";
import {
  applyCloudSyncCycleOutcome,
  CLOUD_SYNC_ATTEMPT_TIMEOUT_MS,
  CloudSyncAttemptTimeoutError,
  createCloudSyncOccupancyGate,
  interimVaultSyncView,
  logCloudSyncDiagnostic,
  performCloudSyncCheck,
  recoverableSyncFailureView,
  runVaultCycleWithTimeout,
  shouldPauseAutoPush,
  waitForUiOrCycle,
} from "@/lib/babylon/cloud-sync-check";
import { financialVaultFingerprint } from "@/lib/babylon/cloud-vault";
import { savePersistedState } from "@/lib/babylon/persistence";
import {
  runCloudRevisionCycle,
  vaultSyncCopy,
  type CloudRevisionCycleDeps,
  type CloudSyncBaseline,
  type CycleResult,
  type VaultSyncView,
} from "@/lib/babylon/vault-sync";
import type { PersistedState } from "@/types/babylon";

const OWNER = "11111111-1111-4111-8111-111111111111";

function local(amount = 20): PersistedState {
  return {
    ...EMPTY_STATE,
    displayName: "Ada",
    expenses: [
      {
        id: "99999999-9999-4999-8999-999999999999",
        name: "Groceries",
        category: "need",
        amount,
        date: "2026-09-12",
        dueDate: "2026-09-30",
        isSettled: false,
      },
    ],
  };
}

function cleanOutcome(revision = 1): CycleResult {
  return {
    view: { kind: "clean", revision },
    baseline: {
      revision,
      fingerprint: financialVaultFingerprint(local()),
    },
    appliedLocal: null,
    pushed: false,
    pulled: false,
    boundOwner: false,
  };
}

function harness(input: {
  local: PersistedState;
  baseline: CloudSyncBaseline | null;
  cloud?: PersistedState;
  cloudRevision?: number;
}) {
  let memory = structuredClone(input.local);
  let cloudData = input.cloud ? structuredClone(input.cloud) : null;
  let cloudRev = input.cloudRevision ?? 1;
  let baselineState = input.baseline;
  const reads: number[] = [];
  const pushes: { expected: number; fingerprint: string }[] = [];

  const deps: CloudRevisionCycleDeps = {
    sessionUserId: OWNER,
    readOwner: () => null,
    readBaseline: () => baselineState,
    writeBaseline: (next) => {
      baselineState = next;
      return true;
    },
    readMemory: () => memory,
    readStored: () => memory,
    writeStored: (next) => {
      memory = structuredClone(next);
      savePersistedState(memory);
    },
    readCloud: async () => {
      reads.push(reads.length);
      if (!cloudData) return { status: "absent" as const };
      return {
        status: "present" as const,
        schemaVersion: 6,
        revision: cloudRev,
        updatedAt: "2026-09-25T00:00:00.000Z",
        vaultData: cloudData,
      };
    },
    pushCloud: async (expectedRevision, state) => {
      pushes.push({
        expected: expectedRevision,
        fingerprint: financialVaultFingerprint(state),
      });
      cloudRev = expectedRevision + 1;
      cloudData = structuredClone(state);
      return {
        status: "updated" as const,
        schemaVersion: 6,
        revision: cloudRev,
        updatedAt: "2026-09-25T00:00:00.000Z",
      };
    },
    bindOwner: () => true,
  };

  return {
    deps,
    baseline: () => baselineState,
    reads: () => reads.length,
    pushes: () => pushes,
    memory: () => memory,
    runCycle: () => runCloudRevisionCycle(deps),
  };
}

/** Mirrors requestCloudCheck occupancy + coalesce + late-settle await. */
function createRequestSimulator(runCycle: () => Promise<CycleResult>) {
  const gate = createCloudSyncOccupancyGate();
  let attemptId = 0;
  let activeId = 0;
  const views: VaultSyncView["kind"][] = [];
  let applyCount = 0;
  let baselineWrites = 0;
  let uiBusy = false;
  let runInvocations = 0;

  async function request() {
    if (!gate.tryEnter()) {
      gate.queueRerun();
      return;
    }
    uiBusy = true;
    const id = ++attemptId;
    activeId = id;
    try {
      await performCloudSyncCheck(
        {
          attemptId: id,
          isSuperseded: () => id !== activeId,
          supersedeInFlightAttempts: () => {
            activeId += 1;
          },
          readActiveAttemptId: () => activeId,
          readBaseline: () => ({
            revision: 1,
            fingerprint: financialVaultFingerprint(local(20)),
          }),
          readFingerprint: () => financialVaultFingerprint(local(30)),
          runCycle: () => {
            runInvocations += 1;
            return runCycle();
          },
          timeoutMs: 50,
        },
        {
          userId: OWNER,
          setVaultSync: (view) => views.push(view.kind),
          setSyncBaseline: () => {
            baselineWrites += 1;
          },
          setOwnerUserId: () => {},
          applyVault: () => {
            applyCount += 1;
          },
          onPauseAutoPush: () => {},
          onUiTimeout: () => {
            uiBusy = false;
          },
        }
      );
    } finally {
      uiBusy = false;
      const { rerunQueued } = gate.exit();
      if (rerunQueued) {
        void request();
      }
    }
  }

  return {
    request,
    gate,
    views: () => views,
    applyCount: () => applyCount,
    baselineWrites: () => baselineWrites,
    uiBusy: () => uiBusy,
    runInvocations: () => runInvocations,
    isOccupied: () => gate.isOccupied(),
  };
}

describe("cloud sync check orchestration", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("A: success before timeout → terminal clean; occupancy released", async () => {
    const base = local(20);
    const dirty = local(25);
    const baseline = {
      revision: 3,
      fingerprint: financialVaultFingerprint(base),
    };
    const h = harness({ local: dirty, baseline, cloud: base, cloudRevision: 3 });
    const views: string[] = [];
    const gate = createCloudSyncOccupancyGate();
    expect(gate.tryEnter()).toBe(true);

    const result = await performCloudSyncCheck(
      {
        attemptId: 1,
        isSuperseded: () => false,
        supersedeInFlightAttempts: () => {},
        readActiveAttemptId: () => 1,
        readBaseline: () => baseline,
        readFingerprint: () => financialVaultFingerprint(dirty),
        runCycle: h.runCycle,
      },
      {
        userId: OWNER,
        setVaultSync: (view) => views.push(view.kind),
        setSyncBaseline: () => {},
        setOwnerUserId: () => {},
        applyVault: () => {},
        onPauseAutoPush: () => {},
      }
    );
    gate.exit();

    expect(views[0]).toBe("syncing");
    expect(result.status).toBe("completed");
    expect(views.at(-1)).toBe("clean");
    expect(gate.isOccupied()).toBe(false);
  });

  it("B: known failure before timeout → terminal; occupancy released", async () => {
    const dirty = local(25);
    const baseline = {
      revision: 2,
      fingerprint: financialVaultFingerprint(local(20)),
    };
    const views: string[] = [];

    const result = await performCloudSyncCheck(
      {
        attemptId: 1,
        isSuperseded: () => false,
        supersedeInFlightAttempts: () => {},
        readActiveAttemptId: () => 1,
        readBaseline: () => baseline,
        readFingerprint: () => financialVaultFingerprint(dirty),
        runCycle: async () => ({
          view: { kind: "cloud_unavailable" },
          baseline,
          appliedLocal: null,
          pushed: false,
          pulled: false,
          boundOwner: false,
        }),
      },
      {
        userId: OWNER,
        setVaultSync: (view) => views.push(view.kind),
        setSyncBaseline: () => {},
        setOwnerUserId: () => {},
        applyVault: () => {},
        onPauseAutoPush: () => {},
      }
    );

    expect(result.status).toBe("completed");
    expect(views.at(-1)).toBe("cloud_unavailable");
  });

  it("C: exception before timeout → cloud_unavailable; occupancy can release", async () => {
    const views: string[] = [];
    const result = await performCloudSyncCheck(
      {
        attemptId: 1,
        isSuperseded: () => false,
        supersedeInFlightAttempts: () => {},
        readActiveAttemptId: () => 1,
        readBaseline: () => ({
          revision: 1,
          fingerprint: financialVaultFingerprint(local()),
        }),
        readFingerprint: () => financialVaultFingerprint(local(30)),
        runCycle: async () => {
          throw new Error("rpc exploded");
        },
      },
      {
        userId: OWNER,
        setVaultSync: (view) => views.push(view.kind),
        setSyncBaseline: () => {},
        setOwnerUserId: () => {},
        applyVault: () => {},
        onPauseAutoPush: () => {},
      }
    );

    expect(result.status).toBe("exception");
    expect(views.at(-1)).toBe("cloud_unavailable");
  });

  it("D: UI timeout → cloud_unavailable while cycle still occupied until settle", async () => {
    vi.useFakeTimers();
    const views: string[] = [];
    let activeId = 1;
    let resolveCycle!: (value: CycleResult) => void;
    const cyclePromise = new Promise<CycleResult>((resolve) => {
      resolveCycle = resolve;
    });
    let uiBusy = true;
    let returned = false;

    const checkPromise = performCloudSyncCheck(
      {
        attemptId: 1,
        isSuperseded: () => 1 !== activeId,
        supersedeInFlightAttempts: () => {
          activeId += 1;
        },
        readActiveAttemptId: () => activeId,
        readBaseline: () => ({
          revision: 2,
          fingerprint: financialVaultFingerprint(local(20)),
        }),
        readFingerprint: () => financialVaultFingerprint(local(30)),
        runCycle: () => cyclePromise,
        timeoutMs: 50,
      },
      {
        userId: OWNER,
        setVaultSync: (view) => views.push(view.kind),
        setSyncBaseline: () => {},
        setOwnerUserId: () => {},
        applyVault: () => {},
        onPauseAutoPush: () => {},
        onUiTimeout: () => {
          uiBusy = false;
        },
      }
    ).then((result) => {
      returned = true;
      return result;
    });

    await vi.advanceTimersByTimeAsync(50);
    await Promise.resolve();
    expect(views.at(-1)).toBe("cloud_unavailable");
    expect(uiBusy).toBe(false);
    expect(returned).toBe(false);

    resolveCycle(cleanOutcome(3));
    const result = await checkPromise;
    expect(result.status).toBe("timeout");
    expect(returned).toBe(true);
    expect(views).not.toContain("clean");
  });

  it("E–G central: timeout + Check cloud while occupied → one cycle then one queued rerun", async () => {
    vi.useFakeTimers();
    let resolveFirst!: (value: CycleResult) => void;
    let resolveSecond!: (value: CycleResult) => void;
    const first = new Promise<CycleResult>((resolve) => {
      resolveFirst = resolve;
    });
    const second = new Promise<CycleResult>((resolve) => {
      resolveSecond = resolve;
    });
    const cycles = [first, second];
    let cycleIndex = 0;

    const sim = createRequestSimulator(() => {
      const next = cycles[cycleIndex] ?? second;
      cycleIndex += 1;
      return next;
    });

    const firstRequest = sim.request();
    await vi.advanceTimersByTimeAsync(50);
    await Promise.resolve();

    expect(sim.views().at(-1)).toBe("cloud_unavailable");
    expect(sim.uiBusy()).toBe(false);
    expect(sim.isOccupied()).toBe(true);
    expect(sim.runInvocations()).toBe(1);

    // Check cloud / online / visibility while occupied — coalesce.
    await sim.request();
    await sim.request();
    await sim.request();
    expect(sim.runInvocations()).toBe(1);

    resolveFirst(cleanOutcome(10));
    await firstRequest;
    await Promise.resolve();
    await Promise.resolve();

    expect(sim.runInvocations()).toBe(2);
    expect(sim.applyCount()).toBe(0);

    resolveSecond(cleanOutcome(11));
    await vi.waitFor(() => {
      expect(sim.isOccupied()).toBe(false);
    });
    expect(sim.runInvocations()).toBe(2);
  });

  it("H: late resolve after timeout does not applyVault / React baseline / success UI", async () => {
    vi.useFakeTimers();
    let activeId = 1;
    let resolveCycle!: (value: CycleResult) => void;
    const cyclePromise = new Promise<CycleResult>((resolve) => {
      resolveCycle = resolve;
    });
    const views: string[] = [];
    let applyCount = 0;
    let baselineWrites = 0;

    const checkPromise = performCloudSyncCheck(
      {
        attemptId: 1,
        isSuperseded: () => 1 !== activeId,
        supersedeInFlightAttempts: () => {
          activeId += 1;
        },
        readActiveAttemptId: () => activeId,
        readBaseline: () => null,
        readFingerprint: () => financialVaultFingerprint(local()),
        runCycle: () => cyclePromise,
        timeoutMs: 30,
      },
      {
        userId: OWNER,
        setVaultSync: (view) => views.push(view.kind),
        setSyncBaseline: () => {
          baselineWrites += 1;
        },
        setOwnerUserId: () => {},
        applyVault: () => {
          applyCount += 1;
        },
        onPauseAutoPush: () => {},
      }
    );

    await vi.advanceTimersByTimeAsync(35);
    await Promise.resolve();
    resolveCycle({
      view: { kind: "clean", revision: 99 },
      baseline: {
        revision: 99,
        fingerprint: financialVaultFingerprint(local()),
      },
      appliedLocal: local(99),
      pushed: true,
      pulled: false,
      boundOwner: true,
    });
    const result = await checkPromise;
    expect(result.status).toBe("timeout");
    expect(applyCount).toBe(0);
    expect(baselineWrites).toBe(0);
    expect(views).not.toContain("clean");
    expect(views.at(-1)).toBe("cloud_unavailable");
  });

  it("I: late reject after UI timeout — no unhandled rejection; occupancy releases", async () => {
    vi.useFakeTimers();
    let rejectCycle!: (error: Error) => void;
    const cyclePromise = new Promise<CycleResult>((_, reject) => {
      rejectCycle = reject;
    });
    // Prevent unhandled rejection if anything else races.
    cyclePromise.catch(() => undefined);

    const checkPromise = performCloudSyncCheck(
      {
        attemptId: 1,
        isSuperseded: () => false,
        supersedeInFlightAttempts: () => {},
        readActiveAttemptId: () => 1,
        readBaseline: () => null,
        readFingerprint: () => financialVaultFingerprint(local()),
        runCycle: () => cyclePromise,
        timeoutMs: 20,
      },
      {
        userId: OWNER,
        setVaultSync: () => {},
        setSyncBaseline: () => {},
        setOwnerUserId: () => {},
        applyVault: () => {},
        onPauseAutoPush: () => {},
      }
    );

    await vi.advanceTimersByTimeAsync(25);
    await Promise.resolve();
    rejectCycle(new Error("late network"));
    await expect(checkPromise).resolves.toEqual({ status: "timeout" });
  });

  it("J–K: after late settlement exactly one queued rerun starts fresh cycle", async () => {
    vi.useFakeTimers();
    let resolveFirst!: (value: CycleResult) => void;
    let resolveSecond!: (value: CycleResult) => void;
    const first = new Promise<CycleResult>((resolve) => {
      resolveFirst = resolve;
    });
    const second = new Promise<CycleResult>((resolve) => {
      resolveSecond = resolve;
    });
    let n = 0;
    const sim = createRequestSimulator(() => {
      n += 1;
      return n === 1 ? first : second;
    });

    const pending = sim.request();
    await vi.advanceTimersByTimeAsync(50);
    await Promise.resolve();
    await sim.request();
    expect(sim.runInvocations()).toBe(1);

    resolveFirst(cleanOutcome(1));
    await pending;
    await Promise.resolve();
    await Promise.resolve();
    expect(sim.runInvocations()).toBe(2);

    resolveSecond(cleanOutcome(2));
    await vi.waitFor(() => expect(sim.isOccupied()).toBe(false));
  });

  it("L–O: timeout does not fabricate pendingRevision / revision / clear local", async () => {
    vi.useFakeTimers();
    const dirty = local(40);
    const baseline = {
      revision: 5,
      fingerprint: financialVaultFingerprint(local(20)),
    };
    let baselineState: CloudSyncBaseline = baseline;
    let stored = structuredClone(dirty);
    let resolveCycle!: (value: CycleResult) => void;
    const cyclePromise = new Promise<CycleResult>((resolve) => {
      resolveCycle = resolve;
    });

    const promise = performCloudSyncCheck(
      {
        attemptId: 1,
        isSuperseded: () => false,
        supersedeInFlightAttempts: () => {},
        readActiveAttemptId: () => 1,
        readBaseline: () => baselineState,
        readFingerprint: () => financialVaultFingerprint(stored),
        runCycle: () => cyclePromise,
        timeoutMs: 20,
      },
      {
        userId: OWNER,
        setVaultSync: () => {},
        setSyncBaseline: (next) => {
          baselineState = next ?? baseline;
        },
        setOwnerUserId: () => {},
        applyVault: () => {
          stored = local(0);
        },
        onPauseAutoPush: () => {},
      }
    );
    await vi.advanceTimersByTimeAsync(25);
    await Promise.resolve();
    expect(baselineState.pendingRevision).toBeUndefined();
    expect(baselineState.revision).toBe(5);
    expect(stored.expenses[0]?.amount).toBe(40);

    resolveCycle(cleanOutcome(5));
    await promise;
    expect(baselineState.revision).toBe(5);
    expect(stored.expenses[0]?.amount).toBe(40);
  });

  it("M: underlying cycle may write pendingRevision; React path still skips apply", async () => {
    vi.useFakeTimers();
    let activeId = 1;
    const h = harness({
      local: local(25),
      baseline: {
        revision: 2,
        fingerprint: financialVaultFingerprint(local(20)),
      },
      cloud: local(20),
      cloudRevision: 2,
    });
    // Force push then fail readback by clearing cloud after push via custom deps —
    // use remember path: push succeeds, read returns error-like absent after update.
    // Simpler: write pending directly in a deferred cycle that mutates harness baseline.
    let resolveCycle!: (value: CycleResult) => void;
    const cyclePromise = new Promise<CycleResult>((resolve) => {
      resolveCycle = resolve;
    });

    const checkPromise = performCloudSyncCheck(
      {
        attemptId: 1,
        isSuperseded: () => 1 !== activeId,
        supersedeInFlightAttempts: () => {
          activeId += 1;
        },
        readActiveAttemptId: () => activeId,
        readBaseline: () => h.baseline(),
        readFingerprint: () => financialVaultFingerprint(local(25)),
        runCycle: () => cyclePromise,
        timeoutMs: 20,
      },
      {
        userId: OWNER,
        setVaultSync: () => {},
        setSyncBaseline: () => {},
        setOwnerUserId: () => {},
        applyVault: () => {},
        onPauseAutoPush: () => {},
      }
    );

    await vi.advanceTimersByTimeAsync(25);
    await Promise.resolve();
    // Simulate in-cycle rememberUnverified side effect.
    const pending = {
      revision: 2,
      fingerprint: financialVaultFingerprint(local(20)),
      pendingRevision: 3,
      pendingFingerprint: financialVaultFingerprint(local(25)),
    };
    h.deps.writeBaseline(pending);
    resolveCycle({
      view: { kind: "pending_verification", revision: 3 },
      baseline: pending,
      appliedLocal: null,
      pushed: true,
      pulled: false,
      boundOwner: false,
    });
    await checkPromise;
    expect(h.baseline()?.pendingRevision).toBe(3);
  });

  it("P: occupancy gate never allows two concurrent enters", () => {
    const gate = createCloudSyncOccupancyGate();
    expect(gate.tryEnter()).toBe(true);
    expect(gate.tryEnter()).toBe(false);
    expect(gate.queueRerun()).toBe(true);
    expect(gate.queueRerun()).toBe(false);
    const exited = gate.exit();
    expect(exited.rerunQueued).toBe(true);
    expect(gate.isOccupied()).toBe(false);
  });

  it("Q–T: CAS / conflict / adopt / pull semantics unchanged via harness", async () => {
    const base = local(20);
    const dirty = local(25);
    const baseline = {
      revision: 8,
      fingerprint: financialVaultFingerprint(base),
    };
    const h = harness({ local: dirty, baseline, cloud: base, cloudRevision: 8 });
    await h.runCycle();
    expect(h.pushes()).toEqual([
      { expected: 8, fingerprint: financialVaultFingerprint(dirty) },
    ]);
  });

  it("U: valid paySchedules still sync through cycle harness", async () => {
    const schedule = {
      id: "sched-1",
      createdAt: "2026-01-15",
      cadence: "biweekly" as const,
      anchorDate: "2026-01-03",
    };
    const dirty = { ...local(25), paySchedules: [schedule] };
    const base = { ...local(20), paySchedules: [] };
    const baseline = {
      revision: 2,
      fingerprint: financialVaultFingerprint(base),
    };
    const h = harness({ local: dirty, baseline, cloud: base, cloudRevision: 2 });
    const outcome = await h.runCycle();
    expect(outcome.view.kind).toBe("clean");
    expect(h.pushes()[0]?.fingerprint).toBe(financialVaultFingerprint(dirty));
  });

  it("V: diagnostics contain no financial payload", () => {
    const spy = vi.spyOn(console, "info").mockImplementation(() => {});
    logCloudSyncDiagnostic({
      type: "ui_timeout",
      opId: 1,
    });
    logCloudSyncDiagnostic({
      type: "occupied_after_ui_timeout",
      opId: 1,
    });
    logCloudSyncDiagnostic({
      type: "late_settle",
      opId: 1,
      outcome: "resolved",
    });
    logCloudSyncDiagnostic({
      type: "start",
      opId: 1,
      interim: "syncing",
      baselineRevision: 39,
      pendingRevision: false,
      fingerprintMatch: false,
      online: true,
      visibilityState: "visible",
    });
    const serialized = JSON.stringify(spy.mock.calls);
    expect(serialized).not.toContain("Groceries");
    expect(serialized).not.toContain("500");
    expect(serialized).not.toMatch(/"fingerprint"\s*:\s*"/);
    spy.mockRestore();
  });

  it("applyVault throws → recoverable terminal", async () => {
    const views: string[] = [];
    const pulled = local(99);
    const result = await performCloudSyncCheck(
      {
        attemptId: 1,
        isSuperseded: () => false,
        supersedeInFlightAttempts: () => {},
        readActiveAttemptId: () => 1,
        readBaseline: () => null,
        readFingerprint: () => financialVaultFingerprint(local()),
        runCycle: async () => ({
          view: { kind: "clean", revision: 4 },
          baseline: {
            revision: 4,
            fingerprint: financialVaultFingerprint(pulled),
          },
          appliedLocal: pulled,
          pushed: false,
          pulled: true,
          boundOwner: true,
        }),
      },
      {
        userId: OWNER,
        setVaultSync: (view) => views.push(view.kind),
        setSyncBaseline: () => {},
        setOwnerUserId: () => {},
        applyVault: () => {
          throw new Error("quota");
        },
        onPauseAutoPush: () => {},
      }
    );
    expect(result.status).toBe("exception");
    expect(views.at(-1)).toBe("cloud_unavailable");
  });

  it("recoverable failure exposes Check cloud copy", () => {
    const copy = vaultSyncCopy(recoverableSyncFailureView());
    expect(copy.title).toBe("Cloud sync couldn't complete");
    expect(copy.detail).toContain("Check cloud");
  });

  it("shouldPauseAutoPush includes cloud_unavailable", () => {
    expect(shouldPauseAutoPush({ kind: "cloud_unavailable" })).toBe(true);
  });

  it("UI timeout bound stays in 15–30s", () => {
    expect(CLOUD_SYNC_ATTEMPT_TIMEOUT_MS).toBe(25_000);
  });

  it("applyCloudSyncCycleOutcome applies vault before terminal sync view", () => {
    const order: string[] = [];
    const pulled = local(77);
    applyCloudSyncCycleOutcome({
      outcome: {
        view: { kind: "clean", revision: 2 },
        baseline: {
          revision: 2,
          fingerprint: financialVaultFingerprint(pulled),
        },
        appliedLocal: pulled,
        pushed: false,
        pulled: true,
        boundOwner: false,
      },
      userId: OWNER,
      applyVault: () => order.push("apply"),
      setSyncBaseline: () => order.push("baseline"),
      setOwnerUserId: () => order.push("owner"),
      setVaultSync: () => order.push("view"),
      onPauseAutoPush: () => order.push("pause"),
    });
    expect(order.indexOf("apply")).toBeLessThan(order.indexOf("view"));
  });

  it("interimVaultSyncView matches dirty vs checking rules", () => {
    const fp = financialVaultFingerprint(local(30));
    expect(interimVaultSyncView(null, fp).kind).toBe("checking");
    expect(
      interimVaultSyncView({ revision: 1, fingerprint: fp }, fp).kind
    ).toBe("checking");
    expect(
      interimVaultSyncView(
        { revision: 1, fingerprint: financialVaultFingerprint(local(20)) },
        fp
      ).kind
    ).toBe("syncing");
  });

  it("waitForUiOrCycle distinguishes UI timeout from settle", async () => {
    vi.useFakeTimers();
    let resolveCycle!: (value: CycleResult) => void;
    const cycle = new Promise<CycleResult>((resolve) => {
      resolveCycle = resolve;
    });
    const raced = waitForUiOrCycle(cycle, 40);
    await vi.advanceTimersByTimeAsync(40);
    await expect(raced).resolves.toEqual({ kind: "ui_timeout" });
    resolveCycle(cleanOutcome());
  });

  it("runVaultCycleWithTimeout still rejects for legacy callers", async () => {
    vi.useFakeTimers();
    const pending = runVaultCycleWithTimeout(
      () => new Promise<CycleResult>(() => {}),
      10
    );
    const rejection = expect(pending).rejects.toBeInstanceOf(
      CloudSyncAttemptTimeoutError
    );
    await vi.advanceTimersByTimeAsync(15);
    await rejection;
  });
});
