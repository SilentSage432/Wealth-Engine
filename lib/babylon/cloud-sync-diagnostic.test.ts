import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { EMPTY_STATE } from "@/lib/babylon/constants";
import {
  CLOUD_SYNC_DIAGNOSTIC_ALLOWLIST,
  logCloudSyncDiagnostic,
  performCloudSyncCheck,
  projectCloudSyncDiagnostic,
  takeOccupiedCloudCheckQueue,
  type CloudSyncCheckAttribution,
  type CloudSyncDiagnosticEvent,
  type CloudSyncRequestTrigger,
} from "@/lib/babylon/cloud-sync-check";
import { financialVaultFingerprint } from "@/lib/babylon/cloud-vault";
import type { CloudSyncBaseline, CycleResult, VaultSyncView } from "@/lib/babylon/vault-sync";
import type { PersistedState } from "@/types/babylon";

const PROHIBITED_KEY =
  /revision|fingerprint|owner|email|account|plan|amount|supabase|token|vault/i;

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

function cleanOutcome(revision = 4): CycleResult {
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

function callbacks(views: VaultSyncView["kind"][]) {
  return {
    userId: "11111111-1111-4111-8111-111111111111",
    setVaultSync: (view: VaultSyncView) => views.push(view.kind),
    setSyncBaseline: () => {},
    setOwnerUserId: () => {},
    applyVault: () => {},
    onPauseAutoPush: () => {},
  };
}

async function runCheck(input: {
  attribution: CloudSyncCheckAttribution;
  preserve?: boolean;
  attemptId?: number;
  timeoutMs?: number;
  baseline: CloudSyncBaseline | null;
  fingerprintState: PersistedState;
  runCycle: () => Promise<CycleResult>;
  superseded?: () => boolean;
}) {
  const events: CloudSyncDiagnosticEvent[] = [];
  const views: VaultSyncView["kind"][] = [];
  const result = await performCloudSyncCheck(
    {
      attemptId: input.attemptId ?? 1,
      isSuperseded: input.superseded ?? (() => false),
      supersedeInFlightAttempts: () => {},
      readActiveAttemptId: () => input.attemptId ?? 1,
      readBaseline: () => input.baseline,
      readFingerprint: () => financialVaultFingerprint(input.fingerprintState),
      runCycle: input.runCycle,
      timeoutMs: input.timeoutMs,
      preserveEstablishedConflict: input.preserve,
      attribution: input.attribution,
      log: (event) => events.push(event),
    },
    callbacks(views)
  );
  return { events, views, result };
}

function eventOf<T extends CloudSyncDiagnosticEvent["type"]>(
  events: CloudSyncDiagnosticEvent[],
  type: T
): Extract<CloudSyncDiagnosticEvent, { type: T }> {
  const found = events.find((event) => event.type === type);
  expect(found, type).toBeTruthy();
  return found as Extract<CloudSyncDiagnosticEvent, { type: T }>;
}

function assertDiagnosticPayload(events: CloudSyncDiagnosticEvent[]) {
  const allowed = new Set<string>(CLOUD_SYNC_DIAGNOSTIC_ALLOWLIST);
  for (const event of events) {
    const projected = projectCloudSyncDiagnostic(event);
    for (const [key, value] of Object.entries(projected)) {
      expect(allowed.has(key), key).toBe(true);
      expect(key).not.toMatch(PROHIBITED_KEY);
      expect(["string", "number", "boolean"]).toContain(typeof value);
    }
    const serialized = JSON.stringify(projected);
    expect(serialized).not.toContain("Groceries");
    expect(serialized).not.toContain("11111111-1111-4111-8111-111111111111");
    expect(serialized).not.toContain("99999999-9999-4999-8999-999999999999");
  }
}

describe("cloud sync diagnostic attribution", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("allowlist keys exclude prohibited diagnostic fields", () => {
    for (const key of CLOUD_SYNC_DIAGNOSTIC_ALLOWLIST) {
      expect(key).not.toMatch(PROHIBITED_KEY);
    }
  });

  it("A: manual conflict recheck starts without painting syncing", async () => {
    const dirty = local(30);
    const { events, views } = await runCheck({
      attribution: {
        trigger: "manual",
        previousKind: "conflict",
        queuedRerun: false,
      },
      preserve: true,
      attemptId: 8,
      baseline: {
        revision: 29,
        fingerprint: financialVaultFingerprint(local(20)),
      },
      fingerprintState: dirty,
      runCycle: async () => ({
        ...cleanOutcome(39),
        view: {
          kind: "conflict",
          baselineRevision: 29,
          cloudRevision: 39,
        },
      }),
    });

    const start = eventOf(events, "start");
    expect(start).toMatchObject({
      trigger: "manual",
      previousKind: "conflict",
      preserveEstablishedConflict: true,
      attemptId: 8,
      queuedRerun: false,
    });
    expect(events.some((event) => event.type === "interim_paint")).toBe(false);
    expect(views).not.toContain("syncing");
    expect(eventOf(events, "terminal")).toMatchObject({
      attemptId: 8,
      trigger: "manual",
      terminalKind: "conflict",
      preserveEstablishedConflict: true,
    });
    assertDiagnosticPayload(events);
  });

  it("B: mount non-conflict check records trigger mount", async () => {
    const state = local(20);
    const { events, views } = await runCheck({
      attribution: {
        trigger: "mount",
        previousKind: "checking",
        queuedRerun: false,
      },
      baseline: {
        revision: 2,
        fingerprint: financialVaultFingerprint(state),
      },
      fingerprintState: state,
      runCycle: async () => cleanOutcome(2),
    });
    expect(eventOf(events, "start").trigger).toBe("mount");
    expect(eventOf(events, "start").previousKind).not.toBe("conflict");
    expect(events.some((event) => event.type === "interim_paint")).toBe(false);
    expect(views[0]).toBe("checking");
  });

  it.each([
    ["visibility", "visibility"],
    ["online", "online"],
    ["auto_push", "auto_push"],
  ] as const)("%s request records that trigger", async (_label, trigger: CloudSyncRequestTrigger) => {
    const { events } = await runCheck({
      attribution: {
        trigger,
        previousKind: "clean",
        queuedRerun: false,
      },
      baseline: null,
      fingerprintState: local(20),
      runCycle: async () => cleanOutcome(1),
    });
    expect(eventOf(events, "start").trigger).toBe(trigger);
  });

  it("F: an occupied second request queues one retry identifying that trigger", () => {
    const first = takeOccupiedCloudCheckQueue({
      occupied: true,
      alreadyQueued: false,
      trigger: "online",
      currentKind: "conflict",
      activeAttemptId: 8,
    });
    expect(first.handled).toBe(true);
    expect(first.rerunQueued).toBe(true);
    expect(first.event).toEqual({
      type: "retry_queued",
      trigger: "online",
      currentKind: "conflict",
      activeAttemptId: 8,
    });

    const coalesced = takeOccupiedCloudCheckQueue({
      occupied: true,
      alreadyQueued: true,
      trigger: "visibility",
      currentKind: "conflict",
      activeAttemptId: 8,
    });
    expect(coalesced.event).toBeNull();
    expect(coalesced.rerunQueued).toBe(true);

    const free = takeOccupiedCloudCheckQueue({
      occupied: false,
      alreadyQueued: false,
      trigger: "manual",
      currentKind: "conflict",
      activeAttemptId: 8,
    });
    expect(free.handled).toBe(false);
    expect(free.event).toBeNull();
  });

  it("G: a queued rerun start names queued_rerun and queuedRerun", async () => {
    const { events } = await runCheck({
      attribution: {
        trigger: "queued_rerun",
        previousKind: "cloud_unavailable",
        queuedRerun: true,
      },
      attemptId: 9,
      baseline: null,
      fingerprintState: local(20),
      runCycle: async () => cleanOutcome(3),
    });
    expect(eventOf(events, "start")).toMatchObject({
      trigger: "queued_rerun",
      attemptId: 9,
      queuedRerun: true,
      previousKind: "cloud_unavailable",
    });
  });

  it("H: a non-conflict syncing paint names the same attempt", async () => {
    const { events, views } = await runCheck({
      attribution: {
        trigger: "auto_push",
        previousKind: "local_dirty",
        queuedRerun: false,
      },
      attemptId: 4,
      baseline: {
        revision: 2,
        fingerprint: financialVaultFingerprint(local(20)),
      },
      fingerprintState: local(30),
      runCycle: async () => cleanOutcome(3),
    });
    const start = eventOf(events, "start");
    const paint = eventOf(events, "interim_paint");
    expect(views[0]).toBe("syncing");
    expect(paint).toMatchObject({
      trigger: "auto_push",
      previousKind: "local_dirty",
      nextKind: "syncing",
      preserveEstablishedConflict: false,
      attemptId: start.attemptId,
      queuedRerun: false,
    });
    expect(paint.attemptId).toBe(4);
  });

  it("I–J: timeout and discarded late settle stay on the same attempt", async () => {
    vi.useFakeTimers();
    let resolveCycle!: (value: CycleResult) => void;
    const events: CloudSyncDiagnosticEvent[] = [];
    const views: VaultSyncView["kind"][] = [];
    const check = performCloudSyncCheck(
      {
        attemptId: 6,
        isSuperseded: () => false,
        supersedeInFlightAttempts: () => {},
        readActiveAttemptId: () => 6,
        readBaseline: () => ({
          revision: 2,
          fingerprint: financialVaultFingerprint(local(20)),
        }),
        readFingerprint: () => financialVaultFingerprint(local(30)),
        runCycle: () =>
          new Promise<CycleResult>((resolve) => {
            resolveCycle = resolve;
          }),
        timeoutMs: 25,
        attribution: {
          trigger: "manual",
          previousKind: "local_dirty",
          queuedRerun: false,
        },
        log: (event) => events.push(event),
      },
      callbacks(views)
    );

    await vi.advanceTimersByTimeAsync(25);
    await Promise.resolve();
    expect(eventOf(events, "ui_timeout")).toMatchObject({
      trigger: "manual",
      attemptId: 6,
      previousKind: "local_dirty",
      preserveEstablishedConflict: false,
    });
    expect(eventOf(events, "interim_paint").attemptId).toBe(6);

    resolveCycle(cleanOutcome(11));
    await check;
    expect(eventOf(events, "late_settle")).toMatchObject({
      trigger: "manual",
      attemptId: 6,
      outcome: "resolved",
      discardedAfterDeadline: true,
      resultingKind: "clean",
    });
    expect(views).not.toContain("clean");
    expect(views.at(-1)).toBe("cloud_unavailable");
    assertDiagnosticPayload(events);
  });

  it("K: a completed attempt's terminal event uses the same attempt", async () => {
    const { events, result } = await runCheck({
      attribution: {
        trigger: "visibility",
        previousKind: "checking",
        queuedRerun: false,
      },
      attemptId: 3,
      baseline: null,
      fingerprintState: local(20),
      runCycle: async () => cleanOutcome(5),
    });
    expect(result).toEqual({ status: "completed", terminalKind: "clean" });
    expect(eventOf(events, "terminal")).toMatchObject({
      trigger: "visibility",
      previousKind: "checking",
      terminalKind: "clean",
      preserveEstablishedConflict: false,
      attemptId: 3,
    });
    expect(eventOf(events, "start").attemptId).toBe(3);
  });

  it("L: projected events drop prohibited keys and non-primitive payloads", () => {
    const spy = vi.spyOn(console, "info").mockImplementation(() => {});
    const poisoned = {
      type: "start",
      trigger: "manual",
      previousKind: "account_only",
      preserveEstablishedConflict: false,
      attemptId: 1,
      queuedRerun: false,
      revision: 39,
      fingerprint: financialVaultFingerprint(local(500)),
      owner: "owner-1",
      email: "ada@example.com",
      account: "Checking",
      plan: "monthly",
      amount: 500,
      supabase: "https://example.supabase.co",
      token: "secret-token",
      vault: local(500),
      message: { revision: 1, vault: local(500) },
    } as unknown as CloudSyncDiagnosticEvent;

    const projected = projectCloudSyncDiagnostic(poisoned);
    expect(projected).toEqual({
      type: "start",
      trigger: "manual",
      previousKind: "account_only",
      preserveEstablishedConflict: false,
      attemptId: 1,
      queuedRerun: false,
    });
    logCloudSyncDiagnostic(poisoned);
    expect(spy.mock.calls[0]?.[0]).toBe("[cloud-sync]");
    expect(spy.mock.calls[0]?.[1]).toEqual(projected);
    expect(JSON.stringify(projected)).toContain("account_only");
    expect(JSON.stringify(projected)).not.toContain("Groceries");
    expect(JSON.stringify(projected)).not.toContain("secret-token");
    expect(JSON.stringify(projected)).not.toContain("supabase");

    const terminal = projectCloudSyncDiagnostic({
      type: "terminal",
      trigger: "manual",
      previousKind: "account_only",
      terminalKind: "account_only",
      preserveEstablishedConflict: false,
      attemptId: 2,
    });
    expect(terminal).toMatchObject({ terminalKind: "account_only" });

    spy.mockRestore();
  });

  it("wires every current requestCloudCheck source to an explicit trigger", () => {
    const hook = readFileSync("hooks/useBabylonEngine.ts", "utf8");
    expect(hook).toContain('useRef<CloudSyncRequestTrigger>("mount")');
    expect(hook).toContain("void requestCloudCheck(trigger)");
    expect(hook).toContain('return requestCloudCheck("manual")');
    expect(hook).toContain('cloudCheckTriggerRef.current = "visibility"');
    expect(hook).toContain('cloudCheckTriggerRef.current = "online"');
    expect(hook).toContain('void requestCloudCheck("auto_push")');
    expect(hook).toContain('void requestCloudCheck("queued_rerun", true)');
    expect(hook).toContain('cloudCheckTriggerRef.current = "bootstrap"');
    expect(hook).toContain('cloudCheckTriggerRef.current = "hydrate"');
    expect(hook).toContain('cloudCheckTriggerRef.current = "clear"');
    expect(hook).toContain('cloudCheckTriggerRef.current = "import"');
    expect(hook).not.toMatch(/requestCloudCheck\(\s*\)/);
    expect(hook).toContain("preserveEstablishedConflict: establishedConflict");
    expect(hook).toContain("takeOccupiedCloudCheckQueue");
  });
});
