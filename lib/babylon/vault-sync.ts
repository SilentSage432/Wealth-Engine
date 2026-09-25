/**
 * Revision sync for one Wealth Engine vault.
 * The financial document stays in the local vault. This module only remembers
 * which cloud revision that document last matched, then pushes or pulls
 * through the existing compare-and-swap primitive.
 * Sign-in does not call this. A conflict does not choose a winner.
 */

import { bindCloudOwnerId, readCloudOwnerId } from "@/lib/babylon/cloud-owner";
import { isFinancialVaultEmpty } from "@/lib/babylon/cloud-setup";
import {
  CLOUD_VAULT_SCHEMA_VERSION,
  financialVaultFingerprint,
  getCloudVault,
  updateCloudVault,
  type CloudVaultGetResult,
  type CloudVaultUpdateResult,
} from "@/lib/babylon/cloud-vault";
import { loadPersistedState, savePersistedState } from "@/lib/babylon/persistence";
import type { PersistedState } from "@/types/babylon";

export const CLOUD_SYNC_STORAGE_KEY = "wealth-engine-cloud-sync";

const MAX_PUSHES_PER_CYCLE = 8;

export type CloudSyncBaseline = {
  /** Last cloud revision whose document was read back and matched. */
  revision: number;
  /** Fingerprint of that verified document. Not a second copy of the vault. */
  fingerprint: string;
  /**
   * Revision reported by compare-and-swap when the following read-back failed
   * or disagreed. This is not a verified baseline.
   */
  pendingRevision?: number;
  /** Fingerprint of the document sent in that compare-and-swap. */
  pendingFingerprint?: string;
};

export type CloudSyncStore = {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
};

export type VaultSyncView =
  | { kind: "signed_out" }
  | { kind: "checking" }
  | { kind: "syncing"; revision: number | null }
  | { kind: "cloud_unavailable" }
  | { kind: "account_only" }
  | { kind: "offer_bootstrap" }
  | { kind: "offer_hydrate" }
  | { kind: "clean"; revision: number }
  | { kind: "local_dirty"; revision: number }
  | { kind: "offline_pending"; revision: number }
  | { kind: "pending_verification"; revision: number }
  | {
      kind: "conflict";
      baselineRevision: number | null;
      cloudRevision: number;
    }
  | { kind: "unsupported_schema" }
  | { kind: "invalid_vault" }
  | { kind: "owner_mismatch" }
  | {
      kind: "unexpected_revision";
      baselineRevision: number;
      cloudRevision: number;
    };

export type CycleResult = {
  view: VaultSyncView;
  baseline: CloudSyncBaseline | null;
  appliedLocal: PersistedState | null;
  pushed: boolean;
  pulled: boolean;
  boundOwner: boolean;
};

export type CloudRevisionCycleDeps = {
  sessionUserId: string;
  readOwner: () => string | null;
  readBaseline: () => CloudSyncBaseline | null;
  writeBaseline: (baseline: CloudSyncBaseline) => boolean;
  readMemory: () => PersistedState;
  readStored: () => PersistedState;
  writeStored: (state: PersistedState) => void;
  readCloud: () => Promise<CloudVaultGetResult>;
  pushCloud: (
    expectedRevision: number,
    state: PersistedState
  ) => Promise<CloudVaultUpdateResult>;
  bindOwner: (userId: string) => boolean;
};

function browserStore(): CloudSyncStore | null {
  if (typeof window === "undefined") return null;
  return window.localStorage;
}

function isPositiveInt(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value > 0;
}

function isFingerprint(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function isBaseline(value: unknown): value is CloudSyncBaseline {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record).sort();
  const verifiedOnly =
    keys.length === 2 && keys[0] === "fingerprint" && keys[1] === "revision";
  const awaitingReadBack =
    keys.length === 4 &&
    keys[0] === "fingerprint" &&
    keys[1] === "pendingFingerprint" &&
    keys[2] === "pendingRevision" &&
    keys[3] === "revision";
  if (!verifiedOnly && !awaitingReadBack) return false;
  if (!isPositiveInt(record.revision) || !isFingerprint(record.fingerprint)) return false;
  if (!awaitingReadBack) return true;
  return (
    isPositiveInt(record.pendingRevision) &&
    record.pendingRevision > record.revision &&
    isFingerprint(record.pendingFingerprint)
  );
}

export function readCloudSyncBaseline(
  store: CloudSyncStore | null = browserStore()
): CloudSyncBaseline | null {
  if (!store) return null;
  try {
    const raw = store.getItem(CLOUD_SYNC_STORAGE_KEY);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    return isBaseline(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export function writeCloudSyncBaseline(
  baseline: CloudSyncBaseline,
  store: CloudSyncStore | null = browserStore()
): boolean {
  if (!isBaseline(baseline) || !store) return false;
  try {
    store.setItem(CLOUD_SYNC_STORAGE_KEY, JSON.stringify(baseline));
    return true;
  } catch {
    return false;
  }
}

export function clearCloudSyncBaseline(
  store: CloudSyncStore | null = browserStore()
): void {
  if (!store) return;
  try {
    store.removeItem(CLOUD_SYNC_STORAGE_KEY);
  } catch {
    /* The financial vault is untouched when this key cannot be cleared. */
  }
}

export function vaultSyncCopy(view: VaultSyncView): {
  title: string;
  detail: string | null;
} {
  switch (view.kind) {
    case "signed_out":
      return { title: "Sign in", detail: null };
    case "checking":
      return { title: "Checking cloud state…", detail: null };
    case "syncing":
      return { title: "Syncing…", detail: null };
    case "cloud_unavailable":
      return {
        title: "Cloud vault unavailable",
        detail: "This device is still usable. Nothing was changed.",
      };
    case "account_only":
      return { title: "Cloud account connected", detail: null };
    case "offer_bootstrap":
      return {
        title: "Cloud account connected",
        detail: "The cloud vault has not been initialized.",
      };
    case "offer_hydrate":
      return {
        title: "Cloud account connected",
        detail: "This device can load the cloud vault.",
      };
    case "clean":
      return { title: `Up to date · revision ${view.revision}`, detail: null };
    case "local_dirty":
      return {
        title: "Changes waiting to sync",
        detail: `Cloud revision ${view.revision} does not include the latest entries on this device.`,
      };
    case "offline_pending":
      return {
        title: "Offline · changes saved on this device",
        detail: `Cloud revision ${view.revision} is unchanged.`,
      };
    case "pending_verification":
      return {
        title: `Waiting to confirm cloud revision ${view.revision}`,
        detail:
          "The upload was accepted, but this device has not verified the cloud copy.",
      };
    case "conflict":
      return view.baselineRevision === null
        ? {
            title: "Both copies have data",
            detail:
              "This device and the cloud differ. Neither copy was changed. Export a backup of this device before any later choice.",
          }
        : {
            title: "Sync conflict — both copies preserved",
            detail: `This device last matched revision ${view.baselineRevision}. Cloud is revision ${view.cloudRevision}. Export a backup before choosing either copy.`,
          };
    case "unsupported_schema":
      return {
        title: "Cloud schema is newer than this app",
        detail: "Nothing was changed.",
      };
    case "invalid_vault":
      return {
        title: "Cloud vault could not be validated",
        detail: "Nothing was changed.",
      };
    case "owner_mismatch":
      return {
        title: "This device belongs to a different cloud owner",
        detail: "Nothing was uploaded or replaced.",
      };
    case "unexpected_revision":
      return {
        title: "Cloud revision is older than this device",
        detail: `This device last matched revision ${view.baselineRevision}. Cloud is revision ${view.cloudRevision}. Nothing was changed.`,
      };
    default: {
      const _exhaustive: never = view;
      return _exhaustive;
    }
  }
}

function stop(
  view: VaultSyncView,
  baseline: CloudSyncBaseline | null,
  pushed = false,
  pulled = false,
  boundOwner = false,
  appliedLocal: PersistedState | null = null
): CycleResult {
  return { view, baseline, appliedLocal, pushed, pulled, boundOwner };
}

function transportFailure(
  status: CloudVaultGetResult["status"] | CloudVaultUpdateResult["status"]
): boolean {
  return status === "error" || status === "unconfigured" || status === "unauthenticated";
}

export async function runCloudRevisionCycle(
  deps: CloudRevisionCycleDeps
): Promise<CycleResult> {
  const owner = deps.readOwner();
  if (owner && owner !== deps.sessionUserId) {
    return stop({ kind: "owner_mismatch" }, deps.readBaseline());
  }

  const first = await deps.readCloud();
  if (first.status === "unsupported_schema") {
    return stop({ kind: "unsupported_schema" }, deps.readBaseline());
  }
  if (first.status === "invalid_vault") {
    return stop({ kind: "invalid_vault" }, deps.readBaseline());
  }
  if (first.status === "forbidden") {
    return stop({ kind: "owner_mismatch" }, deps.readBaseline());
  }
  if (first.status !== "present" && first.status !== "absent") {
    return offlineOrUnavailable(deps);
  }
  if (first.status === "absent") {
    const baseline = deps.readBaseline();
    if (baseline?.pendingRevision) {
      return stop(
        { kind: "pending_verification", revision: baseline.pendingRevision },
        baseline
      );
    }
    const local = deps.readMemory();
    return stop(
      isFinancialVaultEmpty(local)
        ? { kind: "account_only" }
        : { kind: "offer_bootstrap" },
      baseline
    );
  }

  return settleRemote(deps, first);
}

function offlineOrUnavailable(deps: CloudRevisionCycleDeps): CycleResult {
  const baseline = deps.readBaseline();
  if (baseline?.pendingRevision) {
    return stop(
      { kind: "pending_verification", revision: baseline.pendingRevision },
      baseline
    );
  }
  const local = deps.readMemory();
  if (baseline && financialVaultFingerprint(local) !== baseline.fingerprint) {
    return stop({ kind: "offline_pending", revision: baseline.revision }, baseline);
  }
  return stop({ kind: "cloud_unavailable" }, baseline);
}

function rememberUnverified(
  deps: CloudRevisionCycleDeps,
  baseline: CloudSyncBaseline,
  sentFingerprint: string,
  reportedRevision: number
): CloudSyncBaseline {
  const next: CloudSyncBaseline = {
    revision: baseline.revision,
    fingerprint: baseline.fingerprint,
    pendingRevision: reportedRevision,
    pendingFingerprint: sentFingerprint,
  };
  if (!deps.writeBaseline(next)) return baseline;
  return next;
}

async function settleRemote(
  deps: CloudRevisionCycleDeps,
  remote: Extract<CloudVaultGetResult, { status: "present" }>
): Promise<CycleResult> {
  let pushed = false;
  let cloud = remote;

  for (let pass = 0; pass < MAX_PUSHES_PER_CYCLE; pass += 1) {
    const baseline = deps.readBaseline();
    const local = deps.readMemory();
    const localFingerprint = financialVaultFingerprint(local);
    const cloudFingerprint = financialVaultFingerprint(cloud.vaultData);

    if (baseline?.pendingRevision && baseline.pendingFingerprint) {
      const confirmed =
        cloud.revision === baseline.pendingRevision &&
        cloudFingerprint === baseline.pendingFingerprint;
      if (!confirmed) {
        return stop(
          {
            kind: "conflict",
            baselineRevision: baseline.revision,
            cloudRevision: cloud.revision,
          },
          baseline,
          pushed
        );
      }
      const verified: CloudSyncBaseline = {
        revision: baseline.pendingRevision,
        fingerprint: baseline.pendingFingerprint,
      };
      if (!deps.writeBaseline(verified)) {
        return stop(
          { kind: "pending_verification", revision: baseline.pendingRevision },
          baseline,
          pushed
        );
      }
      if (localFingerprint === baseline.pendingFingerprint) {
        return stop({ kind: "clean", revision: verified.revision }, verified, pushed);
      }
      return stop({ kind: "local_dirty", revision: verified.revision }, verified, pushed);
    }

    if (baseline && cloud.revision < baseline.revision) {
      return stop(
        {
          kind: "unexpected_revision",
          baselineRevision: baseline.revision,
          cloudRevision: cloud.revision,
        },
        baseline,
        pushed
      );
    }

    if (localFingerprint === cloudFingerprint) {
      const adopted = adoptMatch(deps, cloud.revision, cloudFingerprint);
      return { ...adopted, pushed };
    }

    if (isFinancialVaultEmpty(local) && !baseline) {
      return stop({ kind: "offer_hydrate" }, null, pushed);
    }

    if (!baseline) {
      return stop(
        {
          kind: "conflict",
          baselineRevision: null,
          cloudRevision: cloud.revision,
        },
        null,
        pushed
      );
    }

    if (
      cloud.revision === baseline.revision &&
      cloudFingerprint !== baseline.fingerprint
    ) {
      return stop(
        {
          kind: "conflict",
          baselineRevision: baseline.revision,
          cloudRevision: cloud.revision,
        },
        baseline,
        pushed
      );
    }

    if (cloud.revision > baseline.revision) {
      if (localFingerprint !== baseline.fingerprint) {
        return stop(
          {
            kind: "conflict",
            baselineRevision: baseline.revision,
            cloudRevision: cloud.revision,
          },
          baseline,
          pushed
        );
      }
      return pullClean(deps, cloud, baseline, pushed);
    }

    const sent = deps.readMemory();
    const sentFingerprint = financialVaultFingerprint(sent);
    const expected = baseline.revision;
    const write = await deps.pushCloud(expected, sent);
    if (write.status === "updated" && write.revision === expected + 1) {
      pushed = true;
      const readback = await deps.readCloud();
      if (
        readback.status === "present" &&
        readback.revision === write.revision &&
        financialVaultFingerprint(readback.vaultData) === sentFingerprint
      ) {
        const next: CloudSyncBaseline = {
          revision: write.revision,
          fingerprint: sentFingerprint,
        };
        if (!deps.writeBaseline(next)) {
          return stop(
            { kind: "pending_verification", revision: write.revision },
            baseline,
            pushed
          );
        }
        if (financialVaultFingerprint(deps.readMemory()) === sentFingerprint) {
          return stop({ kind: "clean", revision: next.revision }, next, pushed);
        }
        cloud = readback;
        continue;
      }
      const pending = rememberUnverified(deps, baseline, sentFingerprint, write.revision);
      if (readback.status === "unsupported_schema" || readback.status === "invalid_vault") {
        return stop({ kind: readback.status }, pending, pushed);
      }
      if (readback.status === "present") {
        return stop(
          {
            kind: "conflict",
            baselineRevision: baseline.revision,
            cloudRevision: readback.revision,
          },
          pending,
          pushed
        );
      }
      return stop(
        { kind: "pending_verification", revision: write.revision },
        pending,
        pushed
      );
    }

    if (write.status === "conflict") {
      const again = await deps.readCloud();
      if (again.status === "present") {
        cloud = again;
        if (
          financialVaultFingerprint(deps.readMemory()) ===
          financialVaultFingerprint(again.vaultData)
        ) {
          const adopted = adoptMatch(deps, again.revision, financialVaultFingerprint(again.vaultData));
          return { ...adopted, pushed };
        }
        return stop(
          {
            kind: "conflict",
            baselineRevision: baseline.revision,
            cloudRevision: again.revision,
          },
          baseline,
          pushed
        );
      }
      if (transportFailure(again.status)) {
        return stop({ kind: "offline_pending", revision: expected }, baseline, pushed);
      }
      if (again.status === "unsupported_schema" || again.status === "invalid_vault") {
        return stop({ kind: again.status }, baseline, pushed);
      }
      return stop(
        {
          kind: "conflict",
          baselineRevision: baseline.revision,
          cloudRevision: write.storedRevision,
        },
        baseline,
        pushed
      );
    }

    if (write.status === "unsupported_schema") {
      return stop({ kind: "unsupported_schema" }, baseline, pushed);
    }
    if (transportFailure(write.status)) {
      return stop({ kind: "offline_pending", revision: expected }, baseline, pushed);
    }
    return stop({ kind: "cloud_unavailable" }, baseline, pushed);
  }

  const baseline = deps.readBaseline();
  return stop(
    {
      kind: "local_dirty",
      revision: baseline?.revision ?? cloud.revision,
    },
    baseline,
    pushed
  );
}

function adoptMatch(
  deps: CloudRevisionCycleDeps,
  revision: number,
  fingerprint: string
): CycleResult {
  const owner = deps.readOwner();
  let boundOwner = false;
  if (!owner) {
    if (!deps.bindOwner(deps.sessionUserId)) {
      return stop({ kind: "cloud_unavailable" }, deps.readBaseline());
    }
    boundOwner = true;
  }
  const next = { revision, fingerprint };
  const current = deps.readBaseline();
  if (
    !current ||
    current.revision !== next.revision ||
    current.fingerprint !== next.fingerprint
  ) {
    if (!deps.writeBaseline(next)) {
      return stop({ kind: "cloud_unavailable" }, current, false, false, boundOwner);
    }
  }
  return stop({ kind: "clean", revision }, next, false, false, boundOwner);
}

function pullClean(
  deps: CloudRevisionCycleDeps,
  cloud: Extract<CloudVaultGetResult, { status: "present" }>,
  baseline: CloudSyncBaseline,
  pushed: boolean
): CycleResult {
  const before = deps.readMemory();
  if (financialVaultFingerprint(before) !== baseline.fingerprint) {
    return stop(
      {
        kind: "conflict",
        baselineRevision: baseline.revision,
        cloudRevision: cloud.revision,
      },
      baseline,
      pushed
    );
  }
  deps.writeStored(cloud.vaultData);
  const stored = deps.readStored();
  const cloudFingerprint = financialVaultFingerprint(cloud.vaultData);
  if (financialVaultFingerprint(stored) !== cloudFingerprint) {
    deps.writeStored(before);
    return stop({ kind: "invalid_vault" }, baseline, pushed);
  }
  if (financialVaultFingerprint(deps.readMemory()) !== baseline.fingerprint) {
    deps.writeStored(deps.readMemory());
    return stop(
      {
        kind: "conflict",
        baselineRevision: baseline.revision,
        cloudRevision: cloud.revision,
      },
      baseline,
      pushed
    );
  }
  const next = { revision: cloud.revision, fingerprint: cloudFingerprint };
  if (!deps.writeBaseline(next)) {
    deps.writeStored(before);
    return stop({ kind: "cloud_unavailable" }, baseline, pushed);
  }
  return stop({ kind: "clean", revision: next.revision }, next, pushed, true, false, stored);
}

export function runCurrentVaultCycle(
  sessionUserId: string,
  readMemory: () => PersistedState
): Promise<CycleResult> {
  return runCloudRevisionCycle({
    sessionUserId,
    readOwner: readCloudOwnerId,
    readBaseline: readCloudSyncBaseline,
    writeBaseline: writeCloudSyncBaseline,
    readMemory,
    readStored: loadPersistedState,
    writeStored: savePersistedState,
    readCloud: () => getCloudVault(sessionUserId),
    pushCloud: (expectedRevision, state) =>
      updateCloudVault(
        sessionUserId,
        expectedRevision,
        CLOUD_VAULT_SCHEMA_VERSION,
        state
      ),
    bindOwner: bindCloudOwnerId,
  });
}
