import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { EMPTY_STATE } from "@/lib/babylon/constants";
import {
  performCloudSyncCheck,
  rememberQueuedCloudCheck,
  shouldLaunchQueuedCloudCheck,
  takeOccupiedCloudCheckQueue,
  type CloudSyncDiagnosticEvent,
  type CloudSyncRequestTrigger,
} from "@/lib/babylon/cloud-sync-check";
import { financialVaultFingerprint } from "@/lib/babylon/cloud-vault";
import {
  runCloudRevisionCycle,
  type CloudSyncBaseline,
  type VaultSyncView,
} from "@/lib/babylon/vault-sync";
import type { PersistedState } from "@/types/babylon";

const OWNER = "11111111-1111-4111-8111-111111111111";
const PRE_REPAIR_CAP = 4;

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

type Mode = "repaired" | "pre-repair";

/**
 * Mirrors requestCloudCheck occupancy, the auto-push effect, and the
 * same-turn relaunch. Pre-repair keeps the terminal kind unpublished until
 * after that relaunch, which is what the production ref did.
 */
async function runFeedback(input: {
  mode: Mode;
  trigger: CloudSyncRequestTrigger;
  initialKind: VaultSyncView["kind"];
  scenario: "cloud_ahead" | "pushable";
  autoPushWhileOccupied: "when_effect_eligible" | "always" | "never";
}) {
  const dirty = local(30);
  const cloudVault = local(20);
  const baseline: CloudSyncBaseline = {
    revision: 4,
    fingerprint: financialVaultFingerprint(cloudVault),
  };
  let cloudRevision = input.scenario === "cloud_ahead" ? 8 : 4;
  let cloudData = structuredClone(cloudVault);
  let memory = structuredClone(dirty);
  let pause = input.initialKind === "conflict";
  let occupied = false;
  let kind = input.initialKind;
  let queued: CloudSyncRequestTrigger | null = null;
  let attempts = 0;
  let storageBaselineWrites = 0;
  let applies = 0;
  const pushes: number[] = [];
  const paints: VaultSyncView["kind"][] = [];
  const events: CloudSyncDiagnosticEvent[] = [];

  const publish = (view: VaultSyncView) => {
    paints.push(view.kind);
    if (input.mode === "repaired" || view.kind === "syncing" || view.kind === "checking") {
      kind = view.kind;
    }
  };

  async function request(
    trigger: CloudSyncRequestTrigger,
    queuedRerun = false
  ): Promise<void> {
    if (!occupied && attempts >= PRE_REPAIR_CAP) return;
    const gate = takeOccupiedCloudCheckQueue({
      occupied,
      alreadyQueued: queued !== null,
      trigger,
      currentKind: kind,
      activeAttemptId: attempts,
    });
    if (gate.handled) {
      queued =
        input.mode === "repaired"
          ? rememberQueuedCloudCheck(queued, trigger)
          : (queued ?? trigger);
      if (gate.event) events.push(gate.event);
      return;
    }

    const previousKind = kind;
    const establishedConflict = previousKind === "conflict";
    if (establishedConflict) pause = true;
    else pause = false;
    occupied = true;
    attempts += 1;
    const attemptId = attempts;

    await performCloudSyncCheck(
      {
        attemptId,
        isSuperseded: () => false,
        supersedeInFlightAttempts: () => {},
        readActiveAttemptId: () => attemptId,
        readBaseline: () => baseline,
        readFingerprint: () => financialVaultFingerprint(memory),
        preserveEstablishedConflict: establishedConflict,
        attribution: { trigger, previousKind, queuedRerun },
        log: (event) => events.push(event),
        runCycle: () =>
          runCloudRevisionCycle({
            sessionUserId: OWNER,
            readOwner: () => null,
            readBaseline: () => baseline,
            writeBaseline: () => {
              storageBaselineWrites += 1;
              return true;
            },
            readMemory: () => memory,
            readStored: () => memory,
            writeStored: (next) => {
              memory = structuredClone(next);
            },
            readCloud: async () => {
              if (input.autoPushWhileOccupied === "always") {
                await request("auto_push");
              } else if (
                input.autoPushWhileOccupied === "when_effect_eligible" &&
                !pause &&
                kind !== "conflict" &&
                financialVaultFingerprint(memory) !== baseline.fingerprint
              ) {
                await request("auto_push");
              }
              return {
                status: "present" as const,
                schemaVersion: 6,
                revision: cloudRevision,
                updatedAt: "2026-09-25T00:00:00.000Z",
                vaultData: cloudData,
              };
            },
            pushCloud: async (expected, state) => {
              pushes.push(expected);
              cloudRevision = expected + 1;
              cloudData = structuredClone(state);
              return {
                status: "updated" as const,
                schemaVersion: 6,
                revision: cloudRevision,
                updatedAt: "2026-09-25T00:00:00.000Z",
              };
            },
            bindOwner: () => true,
          }),
      },
      {
        userId: OWNER,
        setVaultSync: publish,
        setSyncBaseline: () => {},
        setOwnerUserId: () => {},
        applyVault: () => {
          applies += 1;
        },
        onPauseAutoPush: (next) => {
          pause = next;
        },
      }
    );

    occupied = false;
    const queuedTrigger = queued;
    queued = null;
    if (input.mode === "pre-repair") {
      if (queuedTrigger) await request("queued_rerun", true);
      return;
    }
    if (
      shouldLaunchQueuedCloudCheck({
        queued: queuedTrigger,
        vaultKind: kind,
      })
    ) {
      await request("queued_rerun", true);
    }
  }

  await request(input.trigger);
  return {
    attempts,
    pause,
    kind,
    memory,
    storageBaselineWrites,
    applies,
    pushes,
    paints,
    events,
    baseline,
  };
}

function starts(events: CloudSyncDiagnosticEvent[]) {
  return events.filter(
    (event): event is Extract<CloudSyncDiagnosticEvent, { type: "start" }> =>
      event.type === "start"
  );
}

describe("auto-push conflict feedback", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("repaired conflict attempt drops the queued auto_push", async () => {
    const repaired = await runFeedback({
      mode: "repaired",
      trigger: "auto_push",
      initialKind: "local_dirty",
      scenario: "cloud_ahead",
      autoPushWhileOccupied: "when_effect_eligible",
    });

    expect(repaired.attempts).toBe(1);
    expect(repaired.kind).toBe("conflict");
    expect(repaired.pause).toBe(true);
    expect(repaired.pushes).toEqual([]);
    expect(repaired.applies).toBe(0);
    expect(repaired.storageBaselineWrites).toBe(0);
    expect(repaired.baseline.revision).toBe(4);
    expect(repaired.memory.expenses[0]?.amount).toBe(30);
    expect(starts(repaired.events)).toEqual([
      expect.objectContaining({
        trigger: "auto_push",
        previousKind: "local_dirty",
        preserveEstablishedConflict: false,
      }),
    ]);
    expect(repaired.events).toContainEqual(
      expect.objectContaining({
        type: "retry_queued",
        trigger: "auto_push",
        currentKind: "syncing",
      })
    );
    expect(repaired.events).toContainEqual(
      expect.objectContaining({
        type: "terminal",
        trigger: "auto_push",
        terminalKind: "conflict",
      })
    );
    expect(starts(repaired.events).some((event) => event.trigger === "queued_rerun")).toBe(
      false
    );
    expect(JSON.stringify(repaired.events)).not.toContain("Groceries");
    expect(JSON.stringify(repaired.events)).not.toContain(OWNER);
  });

  it("pre-repair boolean relaunch repeats queued_rerun from syncing", async () => {
    const previous = await runFeedback({
      mode: "pre-repair",
      trigger: "auto_push",
      initialKind: "local_dirty",
      scenario: "cloud_ahead",
      autoPushWhileOccupied: "when_effect_eligible",
    });

    expect(previous.attempts).toBe(PRE_REPAIR_CAP);
    expect(
      starts(previous.events).some(
        (event) =>
          event.trigger === "queued_rerun" &&
          event.previousKind === "syncing" &&
          event.preserveEstablishedConflict === false
      )
    ).toBe(true);
    expect(previous.pushes).toEqual([]);
    expect(previous.applies).toBe(0);
    expect(previous.storageBaselineWrites).toBe(0);
  });

  it("A: a clean local-dirty auto-push still uploads once", async () => {
    const result = await runFeedback({
      mode: "repaired",
      trigger: "auto_push",
      initialKind: "local_dirty",
      scenario: "pushable",
      autoPushWhileOccupied: "never",
    });
    expect(result.attempts).toBe(1);
    expect(result.kind).toBe("clean");
    expect(result.pushes).toEqual([4]);
    expect(result.pause).toBe(false);
    expect(
      shouldLaunchQueuedCloudCheck({ queued: "auto_push", vaultKind: "clean" })
    ).toBe(true);
  });

  it("B–D: manual conflict recheck stays one attempt and does not paint syncing", async () => {
    const result = await runFeedback({
      mode: "repaired",
      trigger: "manual",
      initialKind: "conflict",
      scenario: "cloud_ahead",
      autoPushWhileOccupied: "always",
    });
    expect(result.attempts).toBe(1);
    expect(result.kind).toBe("conflict");
    expect(result.paints).not.toContain("syncing");
    expect(result.paints).toEqual(["conflict"]);
    expect(starts(result.events)).toEqual([
      expect.objectContaining({
        trigger: "manual",
        previousKind: "conflict",
        preserveEstablishedConflict: true,
      }),
    ]);
    expect(result.events).toContainEqual(
      expect.objectContaining({ type: "retry_queued", trigger: "auto_push" })
    );
    expect(result.pushes).toEqual([]);
    expect(result.applies).toBe(0);
    expect(result.storageBaselineWrites).toBe(0);
  });

  it.each(["visibility", "online"] as const)(
    "%s during an established conflict stays one preserved attempt",
    async (trigger) => {
      const result = await runFeedback({
        mode: "repaired",
        trigger,
        initialKind: "conflict",
        scenario: "cloud_ahead",
        autoPushWhileOccupied: "always",
      });
      expect(result.attempts).toBe(1);
      expect(result.paints).not.toContain("syncing");
      expect(result.kind).toBe("conflict");
      expect(result.pause).toBe(true);
      expect(starts(result.events)).toHaveLength(1);
      expect(result.pushes).toEqual([]);
    }
  );

  it("G: a later local mutation does not sync over an established conflict", async () => {
    const result = await runFeedback({
      mode: "repaired",
      trigger: "auto_push",
      initialKind: "local_dirty",
      scenario: "cloud_ahead",
      autoPushWhileOccupied: "when_effect_eligible",
    });
    result.memory.expenses[0] = {
      ...result.memory.expenses[0]!,
      amount: 99,
    };
    const effectWouldRequest =
      !result.pause &&
      result.kind !== "conflict" &&
      financialVaultFingerprint(result.memory) !== result.baseline.fingerprint;
    expect(effectWouldRequest).toBe(false);
    expect(result.memory.expenses[0]?.amount).toBe(99);
    expect(result.pushes).toEqual([]);
    expect(result.applies).toBe(0);
  });

  it("H–I: timeout still discards the late result and is not treated as conflict quiesce", async () => {
    vi.useFakeTimers();
    let resolveCycle!: (value: Awaited<ReturnType<typeof runCloudRevisionCycle>>) => void;
    const events: CloudSyncDiagnosticEvent[] = [];
    const check = performCloudSyncCheck(
      {
        attemptId: 2,
        isSuperseded: () => false,
        supersedeInFlightAttempts: () => {},
        readActiveAttemptId: () => 2,
        readBaseline: () => ({
          revision: 4,
          fingerprint: financialVaultFingerprint(local(20)),
        }),
        readFingerprint: () => financialVaultFingerprint(local(30)),
        timeoutMs: 20,
        attribution: {
          trigger: "auto_push",
          previousKind: "local_dirty",
          queuedRerun: false,
        },
        log: (event) => events.push(event),
        runCycle: () =>
          new Promise((resolve) => {
            resolveCycle = resolve;
          }),
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
    await vi.advanceTimersByTimeAsync(20);
    await Promise.resolve();
    resolveCycle({
      view: { kind: "clean", revision: 5 },
      baseline: { revision: 5, fingerprint: "unused" },
      appliedLocal: local(30),
      pushed: true,
      pulled: false,
      boundOwner: false,
    });
    await expect(check).resolves.toEqual({ status: "timeout" });
    expect(events).toContainEqual(
      expect.objectContaining({
        type: "late_settle",
        attemptId: 2,
        discardedAfterDeadline: true,
        resultingKind: "clean",
      })
    );
    expect(
      shouldLaunchQueuedCloudCheck({
        queued: "auto_push",
        vaultKind: "cloud_unavailable",
      })
    ).toBe(true);
    expect(
      shouldLaunchQueuedCloudCheck({
        queued: "auto_push",
        vaultKind: "conflict",
      })
    ).toBe(false);
  });

  it("explicit queued checks survive conflict and auto_push does not replace them", () => {
    expect(rememberQueuedCloudCheck(null, "auto_push")).toBe("auto_push");
    expect(rememberQueuedCloudCheck("auto_push", "manual")).toBe("manual");
    expect(rememberQueuedCloudCheck("auto_push", "visibility")).toBe("visibility");
    expect(rememberQueuedCloudCheck("auto_push", "online")).toBe("online");
    expect(rememberQueuedCloudCheck("manual", "auto_push")).toBe("manual");
    expect(
      shouldLaunchQueuedCloudCheck({ queued: "manual", vaultKind: "conflict" })
    ).toBe(true);
    expect(
      shouldLaunchQueuedCloudCheck({ queued: "visibility", vaultKind: "conflict" })
    ).toBe(true);
    expect(
      shouldLaunchQueuedCloudCheck({ queued: "online", vaultKind: "conflict" })
    ).toBe(true);
    expect(shouldLaunchQueuedCloudCheck({ queued: null, vaultKind: "conflict" })).toBe(
      false
    );
  });

  it("wires the hook to publish conflict before the relaunch decision", () => {
    const hook = readFileSync("hooks/useBabylonEngine.ts", "utf8");
    const effect = hook.slice(
      hook.indexOf("void requestCloudCheck(\"auto_push\")") - 280,
      hook.indexOf("void requestCloudCheck(\"auto_push\")")
    );
    expect(effect).toContain("pauseAutoPushRef.current");
    expect(effect).toContain('vaultSyncRef.current.kind === "conflict"');
    expect(hook).toContain("vaultSyncRef.current = view");
    expect(hook).toContain("shouldLaunchQueuedCloudCheck");
    expect(hook).toContain("rememberQueuedCloudCheck");
    expect(hook).toContain('void requestCloudCheck("queued_rerun", true)');
    const relaunch = hook.indexOf("shouldLaunchQueuedCloudCheck({");
    const publish = hook.indexOf("vaultSyncRef.current = view");
    expect(publish).toBeGreaterThan(0);
    expect(relaunch).toBeGreaterThan(publish);
  });
});
