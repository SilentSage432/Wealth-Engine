/**
 * Incident-specific reconciliation of two preserved Wealth Engine copies.
 * Ownership: the supported-shape predicate, the cloud-first candidate, and
 * one compare-and-swap followed by verified readback.
 * It does not own the sync cycle, the CAS primitive, or generic merging.
 * A difference is not a conflict unless two records make incompatible claims
 * about the same authority scope.
 */

import {
  CLOUD_VAULT_SCHEMA_VERSION,
  financialVaultFingerprint,
  parseCloudVaultData,
  serializeCloudVaultData,
  type CloudVaultGetResult,
  type CloudVaultUpdateResult,
} from "@/lib/babylon/cloud-vault";
import {
  monthlyPlanRevisionHistoryError,
  parseMonthlyPlanRevision,
} from "@/lib/babylon/monthly-plan";
import { formatCivilMonthLabel } from "@/lib/babylon/monthly-plan-semantic";
import {
  canonicalDurableJson,
  compareVaultStructure,
} from "@/lib/babylon/vault-structural-diff";
import type { CloudSyncBaseline } from "@/lib/babylon/vault-sync";
import type {
  ActivityEvent,
  MonthlyPlanRevision,
  PersistedState,
} from "@/types/babylon";

export const RECONCILIATION_DIAGNOSTIC_TYPES = [
  "reconcile_preview_start",
  "reconcile_preview_ready",
  "reconcile_refused",
  "reconcile_cas_start",
  "reconcile_cas_success",
  "reconcile_readback_verified",
  "reconcile_local_converged",
  "reconcile_stopped",
] as const;

export type ReconciliationDiagnosticType =
  (typeof RECONCILIATION_DIAGNOSTIC_TYPES)[number];

/** Console-only. The payload is the event name and nothing else. */
export function logReconciliationDiagnostic(
  type: ReconciliationDiagnosticType
): void {
  if (typeof console === "undefined" || typeof console.info !== "function") return;
  console.info("[reconcile]", { type });
}

export type ReconciliationStopCode =
  | "sync_occupied"
  | "reconciliation_occupied"
  | "not_conflict"
  | "owner_invalid"
  | "pending_revision"
  | "backup_stale"
  | "local_changed_during_preview"
  | "baseline_changed_during_preview"
  | "cloud_read_failed"
  | "unsupported_contract"
  | "unsupported_shape"
  | "shared_record_divergence"
  | "same_plan_id_differs"
  | "competing_same_month"
  | "monthly_plan_chain_invalid"
  | "missing_predecessor"
  | "financial_scalar_differs"
  | "monthly_plan_history_invalid"
  | "evidence_changed"
  | "cas_lost"
  | "cas_transport"
  | "readback_failed"
  | "readback_revision"
  | "readback_fingerprint"
  | "local_apply_failed"
  | "baseline_record_failed";

export type ReconciliationPhase = "before_write" | "after_possible_write";

const AFTER_WRITE = new Set<ReconciliationStopCode>([
  "cas_transport",
  "readback_failed",
  "readback_revision",
  "readback_fingerprint",
  "local_apply_failed",
  "baseline_record_failed",
]);

const MESSAGES: Record<ReconciliationStopCode, string> = {
  sync_occupied: "Cloud sync is already running. Nothing was changed.",
  reconciliation_occupied: "Reconciliation is already running. Nothing was changed.",
  not_conflict:
    "Reconciliation is available only while both copies are preserved. Nothing was changed.",
  owner_invalid:
    "Cloud owner state is not valid for reconciliation. Nothing was changed.",
  pending_revision:
    "A cloud update is still waiting to be verified. Nothing was changed.",
  backup_stale:
    "This device changed after the preserved conflict. Export a fresh backup before reconciling. Nothing was changed.",
  local_changed_during_preview:
    "This device changed while the cloud copy was being read. Nothing was changed.",
  baseline_changed_during_preview:
    "The sync baseline changed while the cloud copy was being read. Nothing was changed.",
  cloud_read_failed: "Couldn't read the cloud copy. Nothing was changed.",
  unsupported_contract:
    "The cloud vault contract is not supported. Nothing was changed.",
  unsupported_shape:
    "These copies do not match the supported reconciliation. Nothing was changed.",
  shared_record_divergence:
    "A shared financial record differs between copies. Nothing was changed.",
  same_plan_id_differs:
    "A monthly plan with the same identity differs between copies. Nothing was changed.",
  competing_same_month:
    "Both copies contain different plans for the same month. Nothing was changed.",
  monthly_plan_chain_invalid:
    "The combined planning history is not a valid revision sequence. Nothing was changed.",
  missing_predecessor:
    "A planning revision on this device requires an earlier revision that is not in the combined history. Nothing was changed.",
  financial_scalar_differs:
    "A financial value differs between copies. Nothing was changed.",
  monthly_plan_history_invalid:
    "Monthly-plan history is not valid. Nothing was changed.",
  evidence_changed:
    "The copies changed after the preview. Nothing was written. Preview again.",
  cas_lost:
    "Cloud revision changed before this reconciliation could be saved. Nothing was written. Preview again.",
  cas_transport:
    "The cloud write did not return a completed result. This device was not changed. The cloud may or may not have accepted a write. Check cloud again before taking another action.",
  readback_failed:
    "Reconciliation could not be verified. The cloud may have accepted the combined copy, but this device was not changed. Check cloud again before taking another action.",
  readback_revision:
    "Reconciliation could not be verified. The cloud revision was not the one this reconciliation expected. This device was not changed. Check cloud again before taking another action.",
  readback_fingerprint:
    "Reconciliation could not be verified. The stored cloud copy does not match the combined copy. This device was not changed. Check cloud again before taking another action.",
  local_apply_failed:
    "The combined copy was verified in the cloud, but this device could not save it. This device was not changed. Check cloud again before taking another action.",
  baseline_record_failed:
    "The combined copy was verified in the cloud and saved on this device, but the sync record could not be saved. Check cloud again before taking another action.",
};

export type ReconciliationStop = {
  ok: false;
  phase: ReconciliationPhase;
  code: ReconciliationStopCode;
  message: string;
};

export type ReconciliationSnapshot = {
  localFingerprint: string;
  baselineRevision: number;
  baselineFingerprint: string;
  cloudRevision: number;
  candidateFingerprint: string;
  classification: string;
};

export type ReconciliationPreview = {
  ok: true;
  intro: string;
  bullets: string[];
  closing: string;
  snapshot: ReconciliationSnapshot;
};

export type ReconciliationSuccess = {
  ok: true;
  revision: number;
};

const IDENTICAL_COLLECTIONS = [
  "incomes",
  "expenses",
  "debts",
  "allocations",
  "budgetTargets",
  "debtPurposeAttributions",
  "recurringObligations",
  "paySchedules",
  "periodArchives",
] as const;

const ID_COLLECTIONS = [
  ...IDENTICAL_COLLECTIONS,
  "accounts",
  "monthlyPlans",
  "activityLog",
] as const;

export type ReconciliationDeps = {
  sessionUserId: string | null;
  readOwner: () => string | null;
  readSyncKind: () => string;
  readBaseline: () => CloudSyncBaseline | null;
  readLocal: () => PersistedState;
  /**
   * Fingerprint captured when this browser session first showed the conflict.
   * Current-session mutation guard only. Not persisted, and not proof that an
   * exported backup file matches the vault.
   */
  readConflictLocalFingerprint: () => string | null;
  readOccupied: () => "clear" | "sync" | "reconciliation";
  reserve: () => "reserved" | "sync_occupied" | "reconciliation_occupied";
  release: () => void;
  readCloud: () => Promise<CloudVaultGetResult>;
  pushCloud: (
    expectedRevision: number,
    state: PersistedState
  ) => Promise<CloudVaultUpdateResult>;
  /** Canonical local apply. False means the device was not left on the candidate. */
  applyLocal: (state: PersistedState) => boolean;
  writeBaseline: (baseline: CloudSyncBaseline) => boolean;
  onConverged?: (revision: number) => void;
  log?: (type: ReconciliationDiagnosticType) => void;
};

function stop(code: ReconciliationStopCode): ReconciliationStop {
  return {
    ok: false,
    phase: AFTER_WRITE.has(code) ? "after_possible_write" : "before_write",
    code,
    message: MESSAGES[code],
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function duplicateOrMissingIds(value: unknown): boolean {
  if (!Array.isArray(value)) return true;
  const seen = new Set<string>();
  for (const item of value) {
    if (!isRecord(item) || typeof item.id !== "string" || !item.id) return true;
    if (seen.has(item.id)) return true;
    seen.add(item.id);
  }
  return false;
}

function joinLabels(labels: readonly string[]): string {
  if (labels.length <= 1) return labels[0] ?? "";
  if (labels.length === 2) return `${labels[0]} and ${labels[1]}`;
  return `${labels.slice(0, -1).join(", ")}, and ${labels[labels.length - 1]}`;
}

export function preservedCopyPreviewCopy(input: {
  cloudMonthLabels: readonly string[];
  localMonthLabels: readonly string[];
}): { intro: string; bullets: string[]; closing: string } {
  return {
    intro:
      "Both preserved copies contain compatible information that can be kept together.",
    bullets: [
      "Keep the accounts currently stored in cloud.",
      `Keep ${joinLabels(input.cloudMonthLabels)} planning history currently stored in cloud.`,
      `Keep ${joinLabels(input.localMonthLabels)} planning history currently stored on this device.`,
      "Keep shared financial records unchanged.",
    ],
    closing:
      "No financial records will be discarded by this supported reconciliation.",
  };
}

/** Steward copy. The app does not check the exported file. */
export const CURRENT_BACKUP_PROMPT =
  "Before reconciling, export a current backup of this device's preserved copy.";

/** Human authority. Not a verified fingerprint match. */
export const CURRENT_BACKUP_CONFIRMATION_LABEL =
  "I exported a current backup of this device.";

/**
 * Reconcile copies stays off until the steward says a current backup exists.
 * A ready preview is not that confirmation.
 */
export function canConfirmPreservedCopies(input: {
  previewReady: boolean;
  currentBackupConfirmed: boolean;
  busy: boolean;
}): boolean {
  return input.previewReady && input.currentBackupConfirmed && !input.busy;
}

function monthLabels(periods: readonly string[]): string[] | null {
  const labels: string[] = [];
  const seen = new Set<string>();
  for (const period of periods) {
    if (seen.has(period)) continue;
    seen.add(period);
    const label = formatCivilMonthLabel(period);
    if (!label) return null;
    labels.push(label);
  }
  return labels;
}

function verifiedBaseline(
  baseline: CloudSyncBaseline | null
): CloudSyncBaseline | null {
  if (!baseline) return null;
  if (baseline.pendingRevision || baseline.pendingFingerprint) return null;
  return baseline;
}

function sameBaseline(
  left: CloudSyncBaseline,
  right: CloudSyncBaseline | null
): boolean {
  const verified = verifiedBaseline(right);
  if (!verified) return false;
  return (
    verified.revision === left.revision &&
    verified.fingerprint === left.fingerprint
  );
}

function unionActivity(
  cloud: readonly ActivityEvent[],
  local: readonly ActivityEvent[]
): ActivityEvent[] {
  const seen = new Set(cloud.map((event) => event.id));
  const phoneOnly = local.filter((event) => !seen.has(event.id));
  return [...cloud, ...phoneOnly];
}

export type PreservedCopyCandidate =
  | {
      ok: true;
      candidate: PersistedState;
      classification: string;
      cloudMonthLabels: string[];
      localMonthLabels: string[];
    }
  | { ok: false; code: ReconciliationStopCode };

/**
 * Cloud-only account count is not fixed at 4.
 * Competing account authority is a local-only account or a shared account
 * that differs. Cloud-only accounts stay the cloud array. The observed
 * incident had four; one or more is the same safe relationship.
 */
export function evaluatePreservedCopyCandidate(
  local: PersistedState,
  cloud: PersistedState
): PreservedCopyCandidate {
  for (const key of ID_COLLECTIONS) {
    if (duplicateOrMissingIds(local[key]) || duplicateOrMissingIds(cloud[key])) {
      return { ok: false, code: "unsupported_shape" };
    }
  }

  const diff = compareVaultStructure(local, cloud);
  const counts = (key: (typeof ID_COLLECTIONS)[number]) => {
    const row = diff.collections.find((item) => item.key === key);
    if (!row) return { localOnly: 1, cloudOnly: 1, sharedDifferent: 1 };
    return row;
  };

  const accounts = counts("accounts");
  if (accounts.sharedDifferent > 0) {
    return { ok: false, code: "shared_record_divergence" };
  }
  if (accounts.localOnly > 0 || accounts.cloudOnly < 1) {
    return { ok: false, code: "unsupported_shape" };
  }

  for (const key of IDENTICAL_COLLECTIONS) {
    const row = counts(key);
    if (row.sharedDifferent > 0) {
      return { ok: false, code: "shared_record_divergence" };
    }
    if (row.localOnly > 0 || row.cloudOnly > 0) {
      return { ok: false, code: "unsupported_shape" };
    }
  }

  if (
    diff.scalars.some(
      (row) => row.group === "financial" && row.status === "different"
    )
  ) {
    return { ok: false, code: "financial_scalar_differs" };
  }

  if (
    diff.scalars.some(
      (row) =>
        row.group === "system" &&
        row.key !== "debtPositionEpochAt" &&
        row.status === "different"
    )
  ) {
    return { ok: false, code: "unsupported_shape" };
  }

  const activity = counts("activityLog");
  if (activity.sharedDifferent > 0) {
    return { ok: false, code: "unsupported_shape" };
  }

  const plans = counts("monthlyPlans");
  if (plans.sharedDifferent > 0) {
    return { ok: false, code: "same_plan_id_differs" };
  }

  const readable = (list: readonly MonthlyPlanRevision[]) =>
    list.every((plan) => parseMonthlyPlanRevision(plan) !== null);
  if (!readable(local.monthlyPlans) || !readable(cloud.monthlyPlans)) {
    return { ok: false, code: "monthly_plan_history_invalid" };
  }

  const cloudIds = new Set(cloud.monthlyPlans.map((plan) => plan.id));
  const localIds = new Set(local.monthlyPlans.map((plan) => plan.id));
  const phoneOnly = local.monthlyPlans.filter((plan) => !cloudIds.has(plan.id));
  const cloudOnly = cloud.monthlyPlans.filter((plan) => !localIds.has(plan.id));
  if (phoneOnly.length < 1 || cloudOnly.length < 1) {
    return { ok: false, code: "unsupported_shape" };
  }

  const cloudOnlyPeriods = new Set(cloudOnly.map((plan) => plan.periodKey));
  if (phoneOnly.some((plan) => cloudOnlyPeriods.has(plan.periodKey))) {
    return { ok: false, code: "competing_same_month" };
  }

  const cloudLabels = monthLabels(cloudOnly.map((plan) => plan.periodKey));
  const localLabels = monthLabels(phoneOnly.map((plan) => plan.periodKey));
  if (!cloudLabels || !localLabels || cloudLabels.length < 1 || localLabels.length < 1) {
    return { ok: false, code: "monthly_plan_history_invalid" };
  }

  const combined = [...cloud.monthlyPlans, ...phoneOnly];
  const combinedIds = new Set(combined.map((plan) => plan.id));
  if (
    combined.some(
      (plan) => plan.supersedesId !== null && !combinedIds.has(plan.supersedesId)
    )
  ) {
    return { ok: false, code: "missing_predecessor" };
  }
  if (monthlyPlanRevisionHistoryError(combined)) {
    return { ok: false, code: "monthly_plan_chain_invalid" };
  }

  const candidate: PersistedState = structuredClone({
    ...cloud,
    monthlyPlans: combined,
    activityLog: unionActivity(cloud.activityLog, local.activityLog),
  });

  for (const key of Object.keys(serializeCloudVaultData(cloud)) as Array<
    keyof ReturnType<typeof serializeCloudVaultData>
  >) {
    if (key === "monthlyPlans" || key === "activityLog") continue;
    if (
      canonicalDurableJson(candidate[key]) !== canonicalDurableJson(cloud[key])
    ) {
      return { ok: false, code: "unsupported_shape" };
    }
  }

  if (!parseCloudVaultData(serializeCloudVaultData(candidate))) {
    return { ok: false, code: "unsupported_contract" };
  }

  const debtSame =
    canonicalDurableJson(local.debtPositionEpochAt) ===
    canonicalDurableJson(cloud.debtPositionEpochAt);

  const classification = canonicalDurableJson({
    accountCloudOnly: accounts.cloudOnly,
    accountLocalOnly: 0,
    accountSharedDifferent: 0,
    phoneOnlyPeriods: phoneOnly.map((plan) => plan.periodKey),
    cloudOnlyPeriods: cloudOnly.map((plan) => plan.periodKey),
    activityLocalOnly: activity.localOnly,
    activityCloudOnly: activity.cloudOnly,
    debtEpoch: debtSame ? "same" : "cloud_kept",
  });

  return {
    ok: true,
    candidate,
    classification,
    cloudMonthLabels: cloudLabels,
    localMonthLabels: localLabels,
  };
}

function mapCloudRead(read: CloudVaultGetResult): ReconciliationStopCode | null {
  if (read.status === "present") {
    if (read.schemaVersion !== CLOUD_VAULT_SCHEMA_VERSION) {
      return "unsupported_contract";
    }
    return null;
  }
  if (read.status === "unsupported_schema" || read.status === "invalid_vault") {
    return "unsupported_contract";
  }
  if (
    read.status === "forbidden" ||
    read.status === "unauthenticated"
  ) {
    return "owner_invalid";
  }
  return "cloud_read_failed";
}

function preconditions(
  deps: ReconciliationDeps
): { ok: true; baseline: CloudSyncBaseline } | ReconciliationStop {
  if (deps.readSyncKind() !== "conflict") return stop("not_conflict");
  if (!deps.sessionUserId) return stop("owner_invalid");
  const owner = deps.readOwner();
  if (!owner || owner !== deps.sessionUserId) return stop("owner_invalid");
  const baseline = deps.readBaseline();
  if (baseline?.pendingRevision || baseline?.pendingFingerprint) {
    return stop("pending_revision");
  }
  if (!baseline) return stop("not_conflict");
  return { ok: true, baseline };
}

export async function previewPreservedCopyReconciliation(
  deps: ReconciliationDeps
): Promise<ReconciliationPreview | ReconciliationStop> {
  deps.log?.("reconcile_preview_start");
  const reserved = deps.reserve();
  if (reserved !== "reserved") {
    deps.log?.("reconcile_refused");
    return stop(
      reserved === "sync_occupied" ? "sync_occupied" : "reconciliation_occupied"
    );
  }

  const fail = (code: ReconciliationStopCode): ReconciliationStop => {
    deps.release();
    deps.log?.("reconcile_refused");
    return stop(code);
  };

  try {
    const ready = preconditions(deps);
    if (!ready.ok) return fail(ready.code);

    const localFingerprint = financialVaultFingerprint(deps.readLocal());
    const conflictFingerprint = deps.readConflictLocalFingerprint();
    // Session mutation guard. This does not compare an exported backup file.
    if (!conflictFingerprint || conflictFingerprint !== localFingerprint) {
      return fail("backup_stale");
    }

    const read = await deps.readCloud();
    if (financialVaultFingerprint(deps.readLocal()) !== localFingerprint) {
      return fail("local_changed_during_preview");
    }
    if (!sameBaseline(ready.baseline, deps.readBaseline())) {
      return fail("baseline_changed_during_preview");
    }

    const readProblem = mapCloudRead(read);
    if (readProblem) return fail(readProblem);
    if (read.status !== "present") return fail("cloud_read_failed");

    const evaluated = evaluatePreservedCopyCandidate(
      deps.readLocal(),
      read.vaultData
    );
    if (!evaluated.ok) return fail(evaluated.code);

    const copy = preservedCopyPreviewCopy(evaluated);
    deps.log?.("reconcile_preview_ready");
    return {
      ok: true,
      ...copy,
      snapshot: {
        localFingerprint,
        baselineRevision: ready.baseline.revision,
        baselineFingerprint: ready.baseline.fingerprint,
        cloudRevision: read.revision,
        candidateFingerprint: financialVaultFingerprint(evaluated.candidate),
        classification: evaluated.classification,
      },
    };
  } catch {
    return fail("cloud_read_failed");
  }
}

export async function confirmPreservedCopyReconciliation(
  deps: ReconciliationDeps,
  snapshot: ReconciliationSnapshot
): Promise<ReconciliationSuccess | ReconciliationStop> {
  const finish = (
    outcome: ReconciliationSuccess | ReconciliationStop
  ): ReconciliationSuccess | ReconciliationStop => {
    if (outcome.ok) deps.onConverged?.(outcome.revision);
    deps.release();
    if (!outcome.ok) {
      deps.log?.(
        outcome.phase === "before_write" ? "reconcile_refused" : "reconcile_stopped"
      );
    }
    return outcome;
  };

  let writeAttempted = false;
  let writeAccepted = false;
  try {
    const occupied = deps.readOccupied();
    if (occupied === "sync") return finish(stop("sync_occupied"));
    if (occupied !== "reconciliation") {
      return finish(stop("reconciliation_occupied"));
    }

    const ready = preconditions(deps);
    if (!ready.ok) return finish(ready);
    if (
      ready.baseline.revision !== snapshot.baselineRevision ||
      ready.baseline.fingerprint !== snapshot.baselineFingerprint
    ) {
      return finish(stop("evidence_changed"));
    }
    if (financialVaultFingerprint(deps.readLocal()) !== snapshot.localFingerprint) {
      return finish(stop("evidence_changed"));
    }

    const read = await deps.readCloud();
    if (financialVaultFingerprint(deps.readLocal()) !== snapshot.localFingerprint) {
      return finish(stop("evidence_changed"));
    }
    if (!sameBaseline(ready.baseline, deps.readBaseline())) {
      return finish(stop("evidence_changed"));
    }
    const readProblem = mapCloudRead(read);
    if (readProblem === "cloud_read_failed") return finish(stop("cloud_read_failed"));
    if (readProblem) return finish(stop("evidence_changed"));
    if (read.status !== "present") return finish(stop("cloud_read_failed"));
    if (read.revision !== snapshot.cloudRevision) {
      return finish(stop("evidence_changed"));
    }

    const evaluated = evaluatePreservedCopyCandidate(
      deps.readLocal(),
      read.vaultData
    );
    if (
      !evaluated.ok ||
      evaluated.classification !== snapshot.classification ||
      financialVaultFingerprint(evaluated.candidate) !== snapshot.candidateFingerprint
    ) {
      return finish(stop("evidence_changed"));
    }

    if (deps.readOccupied() !== "reconciliation") {
      return finish(stop("sync_occupied"));
    }
    if (financialVaultFingerprint(deps.readLocal()) !== snapshot.localFingerprint) {
      return finish(stop("evidence_changed"));
    }

    deps.log?.("reconcile_cas_start");
    writeAttempted = true;
    const write = await deps.pushCloud(
      snapshot.cloudRevision,
      evaluated.candidate
    );
    const advanced =
      write.status === "updated" &&
      write.revision === snapshot.cloudRevision + 1 &&
      write.schemaVersion === CLOUD_VAULT_SCHEMA_VERSION;
    if (!advanced) {
      if (
        write.status === "error" ||
        write.status === "unconfigured" ||
        write.status === "unauthenticated"
      ) {
        return finish(stop("cas_transport"));
      }
      return finish(stop("cas_lost"));
    }
    writeAccepted = true;
    deps.log?.("reconcile_cas_success");

    const readback = await deps.readCloud();
    if (readback.status !== "present") return finish(stop("readback_failed"));
    if (readback.schemaVersion !== CLOUD_VAULT_SCHEMA_VERSION) {
      return finish(stop("readback_failed"));
    }
    if (readback.revision !== snapshot.cloudRevision + 1) {
      return finish(stop("readback_revision"));
    }
    const readbackFingerprint = financialVaultFingerprint(readback.vaultData);
    if (readbackFingerprint !== snapshot.candidateFingerprint) {
      return finish(stop("readback_fingerprint"));
    }
    deps.log?.("reconcile_readback_verified");

    if (!deps.applyLocal(readback.vaultData)) {
      return finish(stop("local_apply_failed"));
    }
    const recorded = deps.writeBaseline({
      revision: readback.revision,
      fingerprint: readbackFingerprint,
    });
    if (!recorded) return finish(stop("baseline_record_failed"));
    deps.log?.("reconcile_local_converged");
    return finish({ ok: true, revision: readback.revision });
  } catch {
    if (writeAccepted) return finish(stop("readback_failed"));
    if (writeAttempted) return finish(stop("cas_transport"));
    return finish(stop("cloud_read_failed"));
  }
}
