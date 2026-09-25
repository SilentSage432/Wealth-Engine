/**
 * Explicit cloud setup for one Wealth Engine vault.
 * Classification and the two confirmed transfers live here.
 * Sign-in does not call them. Later edits do not upload themselves.
 */

import {
  bindCloudOwnerId,
  readCloudOwnerId,
} from "@/lib/babylon/cloud-owner";
import {
  CLOUD_VAULT_SCHEMA_VERSION,
  getCloudVault,
  initializeCloudVault,
  serializeCloudVaultData,
  type CloudVaultGetResult,
  type CloudVaultInitializeResult,
} from "@/lib/babylon/cloud-vault";
import {
  loadPersistedState,
  savePersistedState,
} from "@/lib/babylon/persistence";
import type { PersistedState } from "@/types/babylon";

export const BOOTSTRAP_CONFIRM =
  "Export a fresh backup first. This uploads the Wealth Engine on this device as cloud revision 1. The copy on this device stays.";

export const HYDRATE_CONFIRM =
  "This loads the cloud Wealth Engine onto this empty device. The cloud copy is not changed.";

export type CloudOwnerRelation = "unbound" | "same_user" | "different_user";

export type CloudProbe =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "ready"; result: CloudVaultGetResult };

export type CloudSetupAction =
  | { kind: "signed_out" }
  | { kind: "checking" }
  | { kind: "account_only" }
  | { kind: "offer_bootstrap" }
  | { kind: "offer_hydrate" }
  | { kind: "linked"; revision: number }
  | { kind: "conflict" }
  | { kind: "owner_mismatch" }
  | { kind: "unsupported_schema" }
  | { kind: "invalid_vault" }
  | { kind: "cloud_unavailable" };

export type CloudTransferResult =
  | { ok: true; revision: number }
  | { ok: false; reason: string };

export type HydrateResult =
  | { ok: true; revision: number; state: PersistedState }
  | { ok: false; reason: string };

/**
 * Financial emptiness for the current vault. A display name or activity note
 * alone is not financial state. expenseSemanticsVersion is always present.
 */
export function isFinancialVaultEmpty(state: PersistedState): boolean {
  return (
    state.accounts.length === 0 &&
    state.incomes.length === 0 &&
    state.expenses.length === 0 &&
    state.debts.length === 0 &&
    state.allocations.length === 0 &&
    state.budgetTargets.length === 0 &&
    state.openingWealthBuilding === 0 &&
    state.openingEmergencyFund === 0 &&
    state.emergencyShield === 0 &&
    state.periodArchives.length === 0 &&
    state.recurringObligations.length === 0 &&
    state.lastClosedMonthKey === null
  );
}

export function classifyCloudOwner(
  boundUserId: string | null,
  sessionUserId: string
): CloudOwnerRelation {
  if (!boundUserId) return "unbound";
  return boundUserId === sessionUserId ? "same_user" : "different_user";
}

export function decideCloudSetup(input: {
  sessionUserId: string | null;
  local: PersistedState;
  ownerUserId: string | null;
  probe: CloudProbe;
}): CloudSetupAction {
  if (!input.sessionUserId) return { kind: "signed_out" };
  const owner = classifyCloudOwner(input.ownerUserId, input.sessionUserId);
  if (owner === "different_user") return { kind: "owner_mismatch" };
  if (input.probe.status !== "ready") return { kind: "checking" };

  const cloud = input.probe.result;
  if (
    cloud.status === "error" ||
    cloud.status === "unconfigured" ||
    cloud.status === "unauthenticated" ||
    cloud.status === "forbidden" ||
    cloud.status === "rejected"
  ) {
    return { kind: "cloud_unavailable" };
  }
  if (cloud.status === "unsupported_schema") return { kind: "unsupported_schema" };
  if (cloud.status === "invalid_vault") return { kind: "invalid_vault" };

  const localEmpty = isFinancialVaultEmpty(input.local);
  if (cloud.status === "absent") {
    return localEmpty ? { kind: "account_only" } : { kind: "offer_bootstrap" };
  }

  if (localEmpty) return { kind: "offer_hydrate" };
  if (owner === "same_user") return { kind: "linked", revision: cloud.revision };
  return { kind: "conflict" };
}

export function cloudSetupCopy(action: CloudSetupAction): {
  title: string;
  detail: string | null;
} {
  switch (action.kind) {
    case "signed_out":
      return { title: "Sign in", detail: null };
    case "checking":
      return {
        title: "Cloud account connected",
        detail: "Checking the cloud vault.",
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
    case "linked":
      return {
        title: `Cloud vault revision ${action.revision}`,
        detail: "New entries stay on this device for now.",
      };
    case "conflict":
      return {
        title: "Both copies have data",
        detail:
          "This device and the cloud each have a Wealth Engine. Neither copy was changed.",
      };
    case "owner_mismatch":
      return {
        title: "Different cloud account",
        detail:
          "This device is linked to another account. Nothing was uploaded or replaced.",
      };
    case "unsupported_schema":
      return {
        title: "Cloud vault is newer",
        detail: "This app cannot read that vault. Nothing was changed.",
      };
    case "invalid_vault":
      return {
        title: "Cloud vault could not be read",
        detail: "The cloud copy is not a valid Wealth Engine. Nothing was changed.",
      };
    case "cloud_unavailable":
      return {
        title: "Cloud vault is unavailable",
        detail:
          "The vault could not be read. If this project is new, its vault table may not exist yet. Nothing was changed.",
      };
    default: {
      const _exhaustive: never = action;
      return _exhaustive;
    }
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (!isRecord(value)) return value;
  const sorted: Record<string, unknown> = {};
  for (const key of Object.keys(value).sort()) {
    sorted[key] = sortKeys(value[key]);
  }
  return sorted;
}

function canonical(value: unknown): string {
  return JSON.stringify(sortKeys(value));
}

function skippedMonths(state: PersistedState): string[] {
  return state.recurringObligations
    .flatMap((rule) => rule.skippedMonths.map((month) => `${rule.id}:${month}`))
    .sort();
}

/** True only when the cloud document is the same financial vault. */
export function verifyCloudVaultDocument(
  local: PersistedState,
  remote: PersistedState
): boolean {
  const counts: (keyof PersistedState)[] = [
    "accounts",
    "incomes",
    "expenses",
    "debts",
    "allocations",
    "budgetTargets",
    "periodArchives",
    "recurringObligations",
  ];
  for (const key of counts) {
    const left = local[key];
    const right = remote[key];
    if (!Array.isArray(left) || !Array.isArray(right) || left.length !== right.length) {
      return false;
    }
  }
  if (canonical(skippedMonths(local)) !== canonical(skippedMonths(remote))) {
    return false;
  }
  if (local.openingWealthBuilding !== remote.openingWealthBuilding) return false;
  if (local.openingEmergencyFund !== remote.openingEmergencyFund) return false;
  if (local.emergencyShield !== remote.emergencyShield) return false;
  if (local.lastClosedMonthKey !== remote.lastClosedMonthKey) return false;
  if (local.expenseSemanticsVersion !== remote.expenseSemanticsVersion) return false;
  if (local.displayName !== remote.displayName) return false;
  return (
    canonical(serializeCloudVaultData(local)) ===
    canonical(serializeCloudVaultData(remote))
  );
}

export async function bootstrapDesktopVault(input: {
  sessionUserId: string;
  local: PersistedState;
  ownerUserId: string | null;
  readCloud: () => Promise<CloudVaultGetResult>;
  initialize: (state: PersistedState) => Promise<CloudVaultInitializeResult>;
  bindOwner: (userId: string) => boolean;
}): Promise<CloudTransferResult> {
  if (isFinancialVaultEmpty(input.local)) {
    return { ok: false, reason: "This device has no financial vault to upload." };
  }
  if (
    classifyCloudOwner(input.ownerUserId, input.sessionUserId) === "different_user"
  ) {
    return {
      ok: false,
      reason: "This device is linked to a different cloud account.",
    };
  }

  const before = await input.readCloud();
  if (before.status === "unsupported_schema") {
    return { ok: false, reason: "This app cannot read that cloud vault." };
  }
  if (before.status === "invalid_vault") {
    return { ok: false, reason: "The cloud vault is not valid." };
  }
  if (before.status !== "absent") {
    return {
      ok: false,
      reason: "A cloud vault already exists. This device was not uploaded.",
    };
  }

  const created = await input.initialize(input.local);
  if (created.status !== "created" || created.revision !== 1) {
    return { ok: false, reason: "The cloud vault could not be created." };
  }

  const after = await input.readCloud();
  if (
    after.status !== "present" ||
    after.schemaVersion !== CLOUD_VAULT_SCHEMA_VERSION ||
    after.revision !== 1 ||
    !verifyCloudVaultDocument(input.local, after.vaultData)
  ) {
    return {
      ok: false,
      reason:
        "The cloud copy does not match this device. Nothing on this device was changed.",
    };
  }

  if (!input.bindOwner(input.sessionUserId)) {
    return {
      ok: false,
      reason: "The cloud account could not be recorded on this device.",
    };
  }

  return { ok: true, revision: 1 };
}

export async function hydrateEmptyDevice(input: {
  sessionUserId: string;
  local: PersistedState;
  ownerUserId: string | null;
  readCloud: () => Promise<CloudVaultGetResult>;
  readLocal: () => PersistedState;
  writeLocal: (state: PersistedState) => void;
  bindOwner: (userId: string) => boolean;
}): Promise<HydrateResult> {
  if (!isFinancialVaultEmpty(input.local)) {
    return {
      ok: false,
      reason: "This device already has a financial vault. It was not replaced.",
    };
  }
  if (
    classifyCloudOwner(input.ownerUserId, input.sessionUserId) === "different_user"
  ) {
    return {
      ok: false,
      reason: "This device is linked to a different cloud account.",
    };
  }

  const cloud = await input.readCloud();
  if (cloud.status === "unsupported_schema") {
    return { ok: false, reason: "This app cannot read that cloud vault." };
  }
  if (cloud.status === "invalid_vault") {
    return { ok: false, reason: "The cloud vault is not valid." };
  }
  if (cloud.status !== "present" || cloud.schemaVersion !== CLOUD_VAULT_SCHEMA_VERSION) {
    return { ok: false, reason: "The cloud vault is not available." };
  }
  if (!isFinancialVaultEmpty(input.readLocal())) {
    return {
      ok: false,
      reason: "This device already has a financial vault. It was not replaced.",
    };
  }

  input.writeLocal(cloud.vaultData);
  const reread = input.readLocal();
  if (!verifyCloudVaultDocument(cloud.vaultData, reread)) {
    input.writeLocal(input.local);
    return {
      ok: false,
      reason:
        "The loaded vault did not match the cloud copy. This device was restored.",
    };
  }
  if (!input.bindOwner(input.sessionUserId)) {
    input.writeLocal(input.local);
    return {
      ok: false,
      reason: "The cloud account could not be recorded on this device.",
    };
  }
  return { ok: true, revision: cloud.revision, state: reread };
}

export function probeCloudVault(userId: string): Promise<CloudVaultGetResult> {
  return getCloudVault(userId);
}

export function bootstrapCurrentDesktop(
  local: PersistedState,
  sessionUserId: string
): Promise<CloudTransferResult> {
  return bootstrapDesktopVault({
    sessionUserId,
    local,
    ownerUserId: readCloudOwnerId(),
    readCloud: () => getCloudVault(sessionUserId),
    initialize: (state) =>
      initializeCloudVault(sessionUserId, CLOUD_VAULT_SCHEMA_VERSION, state),
    bindOwner: bindCloudOwnerId,
  });
}

export function hydrateCurrentDevice(
  local: PersistedState,
  sessionUserId: string
): Promise<HydrateResult> {
  return hydrateEmptyDevice({
    sessionUserId,
    local,
    ownerUserId: readCloudOwnerId(),
    readCloud: () => getCloudVault(sessionUserId),
    readLocal: loadPersistedState,
    writeLocal: savePersistedState,
    bindOwner: bindCloudOwnerId,
  });
}
