/**
 * Bounded cloud-sync check orchestration for requestCloudCheck.
 *
 * Two separate boundedness concepts:
 * 1. Human-facing interim UI (checking/syncing) is bounded (25s).
 * 2. Underlying runCycle remains single-flight until that Promise settles.
 *
 * A UI timeout does not cancel transport and does not mean the cloud
 * operation did not commit. Subsequent reconciliation determines truth.
 */

import type { CycleResult } from "@/lib/babylon/vault-sync";
import type { CloudSyncBaseline, VaultSyncView } from "@/lib/babylon/vault-sync";
import type { PersistedState } from "@/types/babylon";

/** Human-facing interim UI bound. Not the same as cycle occupancy release. */
export const CLOUD_SYNC_ATTEMPT_TIMEOUT_MS = 25_000;

/** @deprecated Prefer waitForUiOrCycle — kept for unit tests of the UI bound helper. */
export class CloudSyncAttemptTimeoutError extends Error {
  readonly code = "cloud_sync_attempt_timeout" as const;

  constructor() {
    super("Cloud sync attempt exceeded the bounded wait.");
    this.name = "CloudSyncAttemptTimeoutError";
  }
}

export function interimVaultSyncView(
  baseline: CloudSyncBaseline | null,
  localFingerprint: string
): Extract<VaultSyncView, { kind: "checking" | "syncing" }> {
  if (baseline?.pendingRevision) {
    return { kind: "checking" };
  }
  if (baseline && localFingerprint !== baseline.fingerprint) {
    return { kind: "syncing", revision: baseline.revision };
  }
  return { kind: "checking" };
}

/** Recoverable terminal when a bounded attempt could not finish truthfully. */
export function recoverableSyncFailureView(): Extract<
  VaultSyncView,
  { kind: "cloud_unavailable" }
> {
  return { kind: "cloud_unavailable" };
}

export function shouldPauseAutoPush(view: VaultSyncView): boolean {
  return (
    view.kind === "offline_pending" ||
    view.kind === "pending_verification" ||
    view.kind === "conflict" ||
    view.kind === "unsupported_schema" ||
    view.kind === "invalid_vault" ||
    view.kind === "owner_mismatch" ||
    view.kind === "unexpected_revision" ||
    view.kind === "cloud_unavailable"
  );
}

export type CloudSyncDiagnosticEvent =
  | {
      type: "start";
      opId: number;
      interim: "checking" | "syncing";
      baselineRevision: number | null;
      pendingRevision: boolean;
      fingerprintMatch: boolean;
      online: boolean;
      visibilityState: DocumentVisibilityState | "unknown";
    }
  | { type: "terminal"; opId: number; kind: VaultSyncView["kind"] }
  | { type: "ui_timeout"; opId: number }
  | { type: "occupied_after_ui_timeout"; opId: number }
  | { type: "late_settle"; opId: number; outcome: "resolved" | "rejected" }
  | { type: "retry_queued"; opId: number }
  | { type: "exception"; opId: number; name: string; message: string }
  | { type: "stale"; opId: number; activeOpId: number }
  /** @deprecated Use ui_timeout */
  | { type: "timeout"; opId: number };

export function logCloudSyncDiagnostic(event: CloudSyncDiagnosticEvent): void {
  if (typeof console === "undefined" || typeof console.info !== "function") {
    return;
  }
  console.info("[cloud-sync]", event);
}

export function readCloudSyncRuntimeContext(): {
  online: boolean;
  visibilityState: DocumentVisibilityState | "unknown";
} {
  if (typeof navigator === "undefined") {
    return { online: true, visibilityState: "unknown" };
  }
  const visibilityState =
    typeof document !== "undefined" ? document.visibilityState : "unknown";
  return { online: navigator.onLine, visibilityState };
}

type UiOrCycleRace =
  | { kind: "settled"; result: CycleResult }
  | { kind: "rejected"; error: unknown }
  | { kind: "ui_timeout" };

/** Shown beside a preserved conflict when refresh does not finish. Not persisted. */
export const CONFLICT_REFRESH_INCOMPLETE_COPY =
  "Refresh could not complete. The last known conflict is unchanged.";

/**
 * Register the human-facing deadline before any new Syncing view is painted.
 * clear() does not cancel the underlying cycle.
 */
export function beginCloudSyncUiDeadline(
  timeoutMs: number = CLOUD_SYNC_ATTEMPT_TIMEOUT_MS
): { expired: Promise<{ kind: "ui_timeout" }>; clear: () => void } {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const expired = new Promise<{ kind: "ui_timeout" }>((resolve) => {
    timer = setTimeout(() => resolve({ kind: "ui_timeout" }), timeoutMs);
  });
  return {
    expired,
    clear: () => {
      if (timer !== undefined) {
        clearTimeout(timer);
        timer = undefined;
      }
    },
  };
}

function raceCycleAgainstDeadline(
  cyclePromise: Promise<CycleResult>,
  expired: Promise<{ kind: "ui_timeout" }>
): Promise<UiOrCycleRace> {
  return Promise.race([
    cyclePromise.then(
      (result): UiOrCycleRace => ({ kind: "settled", result }),
      (error): UiOrCycleRace => ({ kind: "rejected", error })
    ),
    expired,
  ]);
}

/**
 * Race human-facing UI wait against an already-started cycle Promise.
 * Does not cancel the cycle. Callers must keep awaiting cyclePromise after
 * ui_timeout until it settles before releasing occupancy.
 */
export async function waitForUiOrCycle(
  cyclePromise: Promise<CycleResult>,
  timeoutMs: number = CLOUD_SYNC_ATTEMPT_TIMEOUT_MS
): Promise<UiOrCycleRace> {
  const deadline = beginCloudSyncUiDeadline(timeoutMs);
  try {
    return await raceCycleAgainstDeadline(cyclePromise, deadline.expired);
  } finally {
    deadline.clear();
  }
}

/**
 * @deprecated UI-only race helper. Prefer waitForUiOrCycle + await cycle settle.
 * Does not cancel the underlying cycle.
 */
export async function runVaultCycleWithTimeout(
  runCycle: () => Promise<CycleResult>,
  timeoutMs: number = CLOUD_SYNC_ATTEMPT_TIMEOUT_MS
): Promise<CycleResult> {
  const cyclePromise = runCycle();
  const raced = await waitForUiOrCycle(cyclePromise, timeoutMs);
  if (raced.kind === "ui_timeout") {
    void cyclePromise.then(
      () => undefined,
      () => undefined
    );
    throw new CloudSyncAttemptTimeoutError();
  }
  if (raced.kind === "rejected") {
    throw raced.error;
  }
  return raced.result;
}

export type ApplyCloudSyncOutcomeInput = {
  outcome: CycleResult;
  userId: string;
  applyVault: (next: PersistedState) => void;
  setSyncBaseline: (baseline: CloudSyncBaseline | null) => void;
  setOwnerUserId: (userId: string) => void;
  setVaultSync: (view: VaultSyncView) => void;
  onPauseAutoPush: (pause: boolean) => void;
};

/** Apply a completed cycle: local pull before baseline + terminal UI. */
export function applyCloudSyncCycleOutcome(input: ApplyCloudSyncOutcomeInput): void {
  const {
    outcome,
    userId,
    applyVault,
    setSyncBaseline,
    setOwnerUserId,
    setVaultSync,
    onPauseAutoPush,
  } = input;

  onPauseAutoPush(shouldPauseAutoPush(outcome.view));

  if (outcome.appliedLocal) {
    applyVault(outcome.appliedLocal);
  }
  setSyncBaseline(outcome.baseline);
  if (outcome.boundOwner) {
    setOwnerUserId(userId);
  }
  setVaultSync(outcome.view);
}

export type PerformCloudSyncCheckInput = {
  attemptId: number;
  /** True when this attempt was superseded for React/UI application. */
  isSuperseded: () => boolean;
  /** Mark this attempt superseded so late React application is discarded. */
  supersedeInFlightAttempts: () => void;
  readActiveAttemptId: () => number;
  readBaseline: () => CloudSyncBaseline | null;
  readFingerprint: () => string;
  runCycle: () => Promise<CycleResult>;
  timeoutMs?: number;
  /**
   * When the steward already has a conflict on screen, do not replace it
   * with interim Syncing or with cloud_unavailable. A later terminal view
   * may still replace it.
   */
  preserveEstablishedConflict?: boolean;
  log?: (event: CloudSyncDiagnosticEvent) => void;
};

export type PerformCloudSyncCheckCallbacks = {
  userId: string;
  setVaultSync: (view: VaultSyncView) => void;
  setSyncBaseline: (baseline: CloudSyncBaseline | null) => void;
  setOwnerUserId: (userId: string) => void;
  applyVault: (next: PersistedState) => void;
  onPauseAutoPush: (pause: boolean) => void;
  /**
   * Human-facing busy cleared on UI timeout while cycle occupancy remains
   * held by the caller until this function returns.
   */
  onUiTimeout?: () => void;
  /** UI-only. Known conflict stays; refresh did not establish a new terminal view. */
  onConflictRefreshFailed?: () => void;
};

export type CloudSyncCheckAttemptResult =
  | { status: "completed"; terminalKind: VaultSyncView["kind"] }
  | { status: "timeout" }
  | { status: "exception" }
  | { status: "stale" };

/**
 * One cloud check: UI may time out at 25s, but this function does not return
 * until the underlying runCycle Promise settles. Callers hold occupancy until
 * then so a second cycle cannot start.
 */
export async function performCloudSyncCheck(
  input: PerformCloudSyncCheckInput,
  callbacks: PerformCloudSyncCheckCallbacks
): Promise<CloudSyncCheckAttemptResult> {
  const log = input.log ?? logCloudSyncDiagnostic;
  const baseline = input.readBaseline();
  const fingerprint = input.readFingerprint();
  const interim = interimVaultSyncView(baseline, fingerprint);
  const runtime = readCloudSyncRuntimeContext();
  const timeoutMs = input.timeoutMs ?? CLOUD_SYNC_ATTEMPT_TIMEOUT_MS;
  const preserveConflict = input.preserveEstablishedConflict === true;

  const notePreservedConflict = () => {
    callbacks.onPauseAutoPush(true);
    callbacks.onConflictRefreshFailed?.();
  };

  // Deadline exists before any new Syncing paint. The cycle is not aborted.
  const deadline = beginCloudSyncUiDeadline(timeoutMs);
  let raced: UiOrCycleRace;
  try {
    if (!preserveConflict) {
      callbacks.setVaultSync(interim);
    }
    log({
      type: "start",
      opId: input.attemptId,
      interim: interim.kind,
      baselineRevision: baseline?.revision ?? null,
      pendingRevision: Boolean(baseline?.pendingRevision),
      fingerprintMatch: baseline ? fingerprint === baseline.fingerprint : false,
      online: runtime.online,
      visibilityState: runtime.visibilityState,
    });

    const cyclePromise = input.runCycle();
    raced = await raceCycleAgainstDeadline(cyclePromise, deadline.expired);

    if (raced.kind === "ui_timeout") {
      log({ type: "ui_timeout", opId: input.attemptId });
      log({ type: "timeout", opId: input.attemptId });
      input.supersedeInFlightAttempts();
      callbacks.onPauseAutoPush(true);
      if (preserveConflict) {
        notePreservedConflict();
      } else {
        callbacks.setVaultSync(recoverableSyncFailureView());
      }
      callbacks.onUiTimeout?.();
      log({ type: "occupied_after_ui_timeout", opId: input.attemptId });

    try {
      await cyclePromise;
      log({ type: "late_settle", opId: input.attemptId, outcome: "resolved" });
    } catch (error) {
      const name = error instanceof Error ? error.name : "Error";
      const message = error instanceof Error ? error.message : "unknown";
      log({
        type: "late_settle",
        opId: input.attemptId,
        outcome: "rejected",
      });
      log({ type: "exception", opId: input.attemptId, name, message });
    }
    // Late CycleResult must not apply React vault / baseline / success UI.
      return { status: "timeout" };
    }

    if (raced.kind === "rejected") {
      const error = raced.error;
      const name = error instanceof Error ? error.name : "Error";
      const message = error instanceof Error ? error.message : "unknown";
      log({ type: "exception", opId: input.attemptId, name, message });
      input.supersedeInFlightAttempts();
      callbacks.onPauseAutoPush(true);
      if (preserveConflict) {
        notePreservedConflict();
      } else {
        callbacks.setVaultSync(recoverableSyncFailureView());
      }
      return { status: "exception" };
    }

  const outcome = raced.result;

  if (input.isSuperseded()) {
    log({
      type: "stale",
      opId: input.attemptId,
      activeOpId: input.readActiveAttemptId(),
    });
    return { status: "stale" };
  }

  try {
    applyCloudSyncCycleOutcome({
      outcome,
      userId: callbacks.userId,
      applyVault: callbacks.applyVault,
      setSyncBaseline: callbacks.setSyncBaseline,
      setOwnerUserId: callbacks.setOwnerUserId,
      setVaultSync: callbacks.setVaultSync,
      onPauseAutoPush: callbacks.onPauseAutoPush,
    });
  } catch (error) {
    const name = error instanceof Error ? error.name : "Error";
    const message = error instanceof Error ? error.message : "unknown";
    log({ type: "exception", opId: input.attemptId, name, message });
    input.supersedeInFlightAttempts();
    callbacks.onPauseAutoPush(true);
    if (preserveConflict) {
      notePreservedConflict();
    } else {
      callbacks.setVaultSync(recoverableSyncFailureView());
    }
    return { status: "exception" };
  }

  log({ type: "terminal", opId: input.attemptId, kind: outcome.view.kind });
  return { status: "completed", terminalKind: outcome.view.kind };
  } finally {
    deadline.clear();
  }
}

/**
 * Single-flight occupancy gate used by requestCloudCheck.
 * Separates cycle occupancy from human-facing cloudBusy.
 */
export type CloudSyncOccupancyGate = {
  /** True while an underlying runCycle is the sole active reconciliation. */
  isOccupied: () => boolean;
  /** Queue exactly one rerun; returns whether this call newly queued. */
  queueRerun: () => boolean;
  /** Take occupancy; returns false if already occupied (caller should queue). */
  tryEnter: () => boolean;
  /** Release occupancy; returns whether a rerun was queued. */
  exit: () => { rerunQueued: boolean };
};

export function createCloudSyncOccupancyGate(log?: {
  onRetryQueued?: () => void;
}): CloudSyncOccupancyGate {
  let occupied = false;
  let rerunQueued = false;
  return {
    isOccupied: () => occupied,
    queueRerun: () => {
      if (rerunQueued) return false;
      rerunQueued = true;
      log?.onRetryQueued?.();
      return true;
    },
    tryEnter: () => {
      if (occupied) return false;
      occupied = true;
      return true;
    },
    exit: () => {
      occupied = false;
      const had = rerunQueued;
      rerunQueued = false;
      return { rerunQueued: had };
    },
  };
}
