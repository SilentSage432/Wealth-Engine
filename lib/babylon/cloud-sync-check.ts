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

/**
 * Request source, named at the call to requestCloudCheck.
 * Not inferred later and not persisted.
 */
export type CloudSyncRequestTrigger =
  | "manual"
  | "mount"
  | "visibility"
  | "online"
  | "auto_push"
  | "queued_rerun"
  | "bootstrap"
  | "hydrate"
  | "clear"
  | "import";

export type CloudSyncCheckAttribution = {
  trigger: CloudSyncRequestTrigger;
  previousKind: VaultSyncView["kind"];
  queuedRerun: boolean;
};

type AttemptDiagnosticFields = {
  trigger: CloudSyncRequestTrigger;
  previousKind: VaultSyncView["kind"];
  preserveEstablishedConflict: boolean;
  attemptId: number;
  queuedRerun: boolean;
};

export type CloudSyncDiagnosticEvent =
  | ({ type: "start" } & AttemptDiagnosticFields)
  | ({ type: "interim_paint"; nextKind: "syncing" } & AttemptDiagnosticFields)
  | {
      type: "retry_queued";
      trigger: CloudSyncRequestTrigger;
      currentKind: VaultSyncView["kind"];
      activeAttemptId: number;
    }
  | {
      type: "terminal";
      trigger: CloudSyncRequestTrigger;
      previousKind: VaultSyncView["kind"];
      terminalKind: VaultSyncView["kind"];
      preserveEstablishedConflict: boolean;
      attemptId: number;
    }
  | {
      type: "ui_timeout";
      trigger: CloudSyncRequestTrigger;
      attemptId: number;
      previousKind: VaultSyncView["kind"];
      preserveEstablishedConflict: boolean;
    }
  | {
      type: "occupied_after_ui_timeout";
      trigger: CloudSyncRequestTrigger;
      attemptId: number;
      previousKind: VaultSyncView["kind"];
      preserveEstablishedConflict: boolean;
    }
  | {
      type: "late_settle";
      trigger: CloudSyncRequestTrigger;
      attemptId: number;
      outcome: "resolved" | "rejected";
      /** The cycle result was not applied after the human-facing deadline. */
      discardedAfterDeadline: true;
      resultingKind?: VaultSyncView["kind"];
    }
  | {
      type: "exception";
      attemptId: number;
      trigger: CloudSyncRequestTrigger;
      name: string;
      message: string;
    }
  | {
      type: "stale";
      attemptId: number;
      trigger: CloudSyncRequestTrigger;
      activeAttemptId: number;
    }
  /** @deprecated Use ui_timeout */
  | { type: "timeout"; opId: number };

/**
 * Keys that may appear on a [cloud-sync] console payload.
 * Anything else is dropped before logging.
 */
export const CLOUD_SYNC_DIAGNOSTIC_ALLOWLIST = [
  "type",
  "trigger",
  "previousKind",
  "nextKind",
  "currentKind",
  "terminalKind",
  "resultingKind",
  "preserveEstablishedConflict",
  "attemptId",
  "activeAttemptId",
  "queuedRerun",
  "outcome",
  "discardedAfterDeadline",
  "opId",
  "name",
  "message",
] as const;

const CLOUD_SYNC_DIAGNOSTIC_ALLOWED_KEYS = new Set<string>(
  CLOUD_SYNC_DIAGNOSTIC_ALLOWLIST
);

function isCloudSyncDiagnosticPrimitive(value: unknown): boolean {
  const kind = typeof value;
  return kind === "string" || kind === "number" || kind === "boolean";
}

/** Runtime privacy gate. Drops unknown keys and non-primitive values. */
export function projectCloudSyncDiagnostic(
  event: CloudSyncDiagnosticEvent
): CloudSyncDiagnosticEvent {
  const source = event as unknown as Record<string, unknown>;
  const projected: Record<string, unknown> = {};
  for (const key of Object.keys(source)) {
    if (!CLOUD_SYNC_DIAGNOSTIC_ALLOWED_KEYS.has(key)) continue;
    const value = source[key];
    if (!isCloudSyncDiagnosticPrimitive(value)) continue;
    projected[key] = value;
  }
  return projected as unknown as CloudSyncDiagnosticEvent;
}

export function logCloudSyncDiagnostic(event: CloudSyncDiagnosticEvent): void {
  if (typeof console === "undefined" || typeof console.info !== "function") {
    return;
  }
  console.info("[cloud-sync]", projectCloudSyncDiagnostic(event));
}

/**
 * Occupancy coalesce used by requestCloudCheck.
 * A repeated request while a rerun is already queued does not emit another event.
 */
export function takeOccupiedCloudCheckQueue(input: {
  occupied: boolean;
  alreadyQueued: boolean;
  trigger: CloudSyncRequestTrigger;
  currentKind: VaultSyncView["kind"];
  activeAttemptId: number;
}): {
  handled: boolean;
  rerunQueued: boolean;
  event: Extract<CloudSyncDiagnosticEvent, { type: "retry_queued" }> | null;
} {
  if (!input.occupied) {
    return {
      handled: false,
      rerunQueued: input.alreadyQueued,
      event: null,
    };
  }
  if (input.alreadyQueued) {
    return { handled: true, rerunQueued: true, event: null };
  }
  return {
    handled: true,
    rerunQueued: true,
    event: {
      type: "retry_queued",
      trigger: input.trigger,
      currentKind: input.currentKind,
      activeAttemptId: input.activeAttemptId,
    },
  };
}

/**
 * Remember which request is waiting for occupancy.
 * A later explicit request replaces a queued auto_push so conflict quiesce
 * cannot discard a steward, visibility, or online check.
 * Another auto_push does not replace an explicit request.
 */
export function rememberQueuedCloudCheck(
  queued: CloudSyncRequestTrigger | null,
  incoming: CloudSyncRequestTrigger
): CloudSyncRequestTrigger {
  if (queued === null) return incoming;
  if (queued === "auto_push" && incoming !== "auto_push") return incoming;
  return queued;
}

/**
 * A terminal conflict must not launch the automatic rerun that arrived while
 * that attempt was occupied. Explicit queued requests still run once.
 */
export function shouldLaunchQueuedCloudCheck(input: {
  queued: CloudSyncRequestTrigger | null;
  vaultKind: VaultSyncView["kind"];
}): boolean {
  if (input.queued === null) return false;
  if (input.queued === "auto_push" && input.vaultKind === "conflict") return false;
  return true;
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
  /**
   * Named at requestCloudCheck. Omitted only by direct unit callers that
   * predate attribution; the hook always supplies it.
   */
  attribution?: CloudSyncCheckAttribution;
  log?: (event: CloudSyncDiagnosticEvent) => void;
};

function resolveCloudSyncAttribution(input: PerformCloudSyncCheckInput): {
  trigger: CloudSyncRequestTrigger;
  previousKind: VaultSyncView["kind"];
  queuedRerun: boolean;
  preserveEstablishedConflict: boolean;
} {
  return {
    trigger: input.attribution?.trigger ?? "mount",
    previousKind: input.attribution?.previousKind ?? "checking",
    queuedRerun: input.attribution?.queuedRerun === true,
    preserveEstablishedConflict: input.preserveEstablishedConflict === true,
  };
}

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
  const timeoutMs = input.timeoutMs ?? CLOUD_SYNC_ATTEMPT_TIMEOUT_MS;
  const attribution = resolveCloudSyncAttribution(input);

  const emit = (event: CloudSyncDiagnosticEvent) => {
    log(projectCloudSyncDiagnostic(event));
  };

  const notePreservedConflict = () => {
    callbacks.onPauseAutoPush(true);
    callbacks.onConflictRefreshFailed?.();
  };

  const paintRecoverableTerminal = () => {
    const terminal = recoverableSyncFailureView();
    callbacks.setVaultSync(terminal);
    emit({
      type: "terminal",
      trigger: attribution.trigger,
      previousKind: attribution.previousKind,
      terminalKind: terminal.kind,
      preserveEstablishedConflict: false,
      attemptId: input.attemptId,
    });
  };

  // Deadline exists before any new Syncing paint. The cycle is not aborted.
  const deadline = beginCloudSyncUiDeadline(timeoutMs);
  let raced: UiOrCycleRace;
  try {
    emit({
      type: "start",
      trigger: attribution.trigger,
      previousKind: attribution.previousKind,
      preserveEstablishedConflict: attribution.preserveEstablishedConflict,
      attemptId: input.attemptId,
      queuedRerun: attribution.queuedRerun,
    });
    if (!attribution.preserveEstablishedConflict) {
      if (interim.kind === "syncing") {
        emit({
          type: "interim_paint",
          trigger: attribution.trigger,
          previousKind: attribution.previousKind,
          nextKind: "syncing",
          preserveEstablishedConflict: false,
          attemptId: input.attemptId,
          queuedRerun: attribution.queuedRerun,
        });
      }
      callbacks.setVaultSync(interim);
    }

    const cyclePromise = input.runCycle();
    raced = await raceCycleAgainstDeadline(cyclePromise, deadline.expired);

    if (raced.kind === "ui_timeout") {
      emit({
        type: "ui_timeout",
        trigger: attribution.trigger,
        attemptId: input.attemptId,
        previousKind: attribution.previousKind,
        preserveEstablishedConflict: attribution.preserveEstablishedConflict,
      });
      emit({ type: "timeout", opId: input.attemptId });
      input.supersedeInFlightAttempts();
      callbacks.onPauseAutoPush(true);
      if (attribution.preserveEstablishedConflict) {
        notePreservedConflict();
      } else {
        paintRecoverableTerminal();
      }
      callbacks.onUiTimeout?.();
      emit({
        type: "occupied_after_ui_timeout",
        trigger: attribution.trigger,
        attemptId: input.attemptId,
        previousKind: attribution.previousKind,
        preserveEstablishedConflict: attribution.preserveEstablishedConflict,
      });

      try {
        const late = await cyclePromise;
        emit({
          type: "late_settle",
          trigger: attribution.trigger,
          attemptId: input.attemptId,
          outcome: "resolved",
          discardedAfterDeadline: true,
          resultingKind: late.view.kind,
        });
      } catch (error) {
        const name = error instanceof Error ? error.name : "Error";
        const message = error instanceof Error ? error.message : "unknown";
        emit({
          type: "late_settle",
          trigger: attribution.trigger,
          attemptId: input.attemptId,
          outcome: "rejected",
          discardedAfterDeadline: true,
        });
        emit({
          type: "exception",
          attemptId: input.attemptId,
          trigger: attribution.trigger,
          name,
          message,
        });
      }
      // Late CycleResult must not apply React vault / baseline / success UI.
      return { status: "timeout" };
    }

    if (raced.kind === "rejected") {
      const error = raced.error;
      const name = error instanceof Error ? error.name : "Error";
      const message = error instanceof Error ? error.message : "unknown";
      emit({
        type: "exception",
        attemptId: input.attemptId,
        trigger: attribution.trigger,
        name,
        message,
      });
      input.supersedeInFlightAttempts();
      callbacks.onPauseAutoPush(true);
      if (attribution.preserveEstablishedConflict) {
        notePreservedConflict();
      } else {
        paintRecoverableTerminal();
      }
      return { status: "exception" };
    }

    const outcome = raced.result;

    if (input.isSuperseded()) {
      emit({
        type: "stale",
        attemptId: input.attemptId,
        trigger: attribution.trigger,
        activeAttemptId: input.readActiveAttemptId(),
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
      emit({
        type: "exception",
        attemptId: input.attemptId,
        trigger: attribution.trigger,
        name,
        message,
      });
      input.supersedeInFlightAttempts();
      callbacks.onPauseAutoPush(true);
      if (attribution.preserveEstablishedConflict) {
        notePreservedConflict();
      } else {
        paintRecoverableTerminal();
      }
      return { status: "exception" };
    }

    emit({
      type: "terminal",
      trigger: attribution.trigger,
      previousKind: attribution.previousKind,
      terminalKind: outcome.view.kind,
      preserveEstablishedConflict: attribution.preserveEstablishedConflict,
      attemptId: input.attemptId,
    });
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
