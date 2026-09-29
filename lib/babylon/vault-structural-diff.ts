/**
 * Read-only structural comparison of two current Wealth Engine vaults.
 * Evidence only. Does not resolve, merge, or choose a copy.
 */

import {
  financialVaultFingerprint,
  serializeCloudVaultData,
  type CloudVaultData,
} from "@/lib/babylon/cloud-vault";
import type { PersistedState } from "@/types/babylon";

export type StructuralDiffGroup = "financial" | "planning" | "system";

export type CollectionStructuralCounts = {
  key: keyof CloudVaultData;
  label: string;
  group: StructuralDiffGroup;
  localOnly: number;
  cloudOnly: number;
  sharedSame: number;
  sharedDifferent: number;
};

export type ScalarStructuralStatus = {
  key: keyof CloudVaultData;
  label: string;
  group: StructuralDiffGroup;
  status: "same" | "different";
};

export type VaultStructuralDiffSummary = {
  localOnlyFinancial: number;
  cloudOnlyFinancial: number;
  sharedDifferentFinancial: number;
  localOnlyPlanning: number;
  cloudOnlyPlanning: number;
  sharedDifferentPlanning: number;
  hasFinancialOrPlanningDifferences: boolean;
  hasSystemOrMetadataDifferences: boolean;
  documentIdentity: "same" | "different";
  /** Fingerprint differs without ID/scalar presence explaining it (e.g. array order). */
  documentRepresentationAlsoDiffers: boolean;
};

export type VaultStructuralDiff = {
  documentIdentity: "same" | "different";
  collections: CollectionStructuralCounts[];
  scalars: ScalarStructuralStatus[];
  summary: VaultStructuralDiffSummary;
  /** Steward-facing Layer-1 lines. No IDs, amounts, or names. */
  summaryLines: string[];
};

type IdRow = { id: string };

const FINANCIAL_COLLECTIONS = [
  { key: "accounts" as const, label: "Accounts" },
  { key: "incomes" as const, label: "Income entries" },
  { key: "expenses" as const, label: "Expenses" },
  { key: "debts" as const, label: "Debts" },
  { key: "allocations" as const, label: "Allocations" },
  { key: "budgetTargets" as const, label: "Budget targets" },
  { key: "debtPurposeAttributions" as const, label: "Debt purpose attributions" },
] as const;

const PLANNING_COLLECTIONS = [
  { key: "recurringObligations" as const, label: "Recurring obligations" },
  { key: "monthlyPlans" as const, label: "Monthly plans" },
  { key: "paySchedules" as const, label: "Expected pay schedules" },
  { key: "periodArchives" as const, label: "Period archives" },
] as const;

const SYSTEM_COLLECTIONS = [
  { key: "activityLog" as const, label: "System history" },
] as const;

const FINANCIAL_SCALARS = [
  { key: "openingWealthBuilding" as const, label: "Opening Wealth Building" },
  { key: "openingEmergencyFund" as const, label: "Opening Emergency Fund" },
  { key: "emergencyShield" as const, label: "Emergency shield" },
  { key: "lastClosedMonthKey" as const, label: "Last closed month" },
] as const;

const SYSTEM_SCALARS = [
  { key: "displayName" as const, label: "Profile name" },
  { key: "expenseSemanticsVersion" as const, label: "Expense semantics version" },
  { key: "debtSemanticsVersion" as const, label: "Debt semantics version" },
  { key: "debtPositionEpochAt" as const, label: "Debt position epoch" },
] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Deterministic JSON for durable record equality (key-order independent). */
export function canonicalDurableJson(value: unknown): string {
  return JSON.stringify(sortKeys(value));
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

function asIdRows(value: unknown): IdRow[] {
  if (!Array.isArray(value)) return [];
  const rows: IdRow[] = [];
  for (const item of value) {
    if (!isRecord(item) || typeof item.id !== "string" || !item.id) continue;
    rows.push(item as IdRow);
  }
  return rows;
}

function compareIdCollection(
  localRows: IdRow[],
  cloudRows: IdRow[]
): Omit<CollectionStructuralCounts, "key" | "label" | "group"> {
  const localById = new Map<string, IdRow>();
  for (const row of localRows) localById.set(row.id, row);
  const cloudById = new Map<string, IdRow>();
  for (const row of cloudRows) cloudById.set(row.id, row);

  let localOnly = 0;
  let cloudOnly = 0;
  let sharedSame = 0;
  let sharedDifferent = 0;

  for (const id of localById.keys()) {
    if (!cloudById.has(id)) localOnly += 1;
  }
  for (const id of cloudById.keys()) {
    if (!localById.has(id)) cloudOnly += 1;
  }
  for (const [id, localRow] of localById) {
    const cloudRow = cloudById.get(id);
    if (!cloudRow) continue;
    if (canonicalDurableJson(localRow) === canonicalDurableJson(cloudRow)) {
      sharedSame += 1;
    } else {
      sharedDifferent += 1;
    }
  }

  return { localOnly, cloudOnly, sharedSame, sharedDifferent };
}

function sumGroup(
  collections: CollectionStructuralCounts[],
  group: StructuralDiffGroup
): { localOnly: number; cloudOnly: number; sharedDifferent: number } {
  return collections
    .filter((row) => row.group === group)
    .reduce(
      (acc, row) => ({
        localOnly: acc.localOnly + row.localOnly,
        cloudOnly: acc.cloudOnly + row.cloudOnly,
        sharedDifferent: acc.sharedDifferent + row.sharedDifferent,
      }),
      { localOnly: 0, cloudOnly: 0, sharedDifferent: 0 }
    );
}

function buildSummaryLines(summary: VaultStructuralDiffSummary): string[] {
  const lines: string[] = [];

  if (!summary.hasFinancialOrPlanningDifferences) {
    if (summary.hasSystemOrMetadataDifferences || summary.documentRepresentationAlsoDiffers) {
      lines.push(
        "No financial or planning record differences were found. The conflict is limited to system/history or metadata differences."
      );
    } else {
      lines.push("No structural differences were found between these copies.");
    }
  } else {
    const localOnly =
      summary.localOnlyFinancial + summary.localOnlyPlanning;
    const cloudOnly =
      summary.cloudOnlyFinancial + summary.cloudOnlyPlanning;
    const sharedDifferent =
      summary.sharedDifferentFinancial + summary.sharedDifferentPlanning;

    if (localOnly === 0) {
      lines.push("No local-only financial or planning records were found.");
    } else {
      lines.push(
        `This device contains ${localOnly} financial or planning record${localOnly === 1 ? "" : "s"} that ${localOnly === 1 ? "is" : "are"} not present in cloud.`
      );
    }

    if (cloudOnly === 0) {
      lines.push("No cloud-only financial or planning records were found.");
    } else {
      lines.push(
        `Cloud contains ${cloudOnly} financial or planning record${cloudOnly === 1 ? "" : "s"} that ${cloudOnly === 1 ? "is" : "are"} not present on this device.`
      );
    }

    if (sharedDifferent > 0) {
      lines.push(
        `${sharedDifferent} shared financial or planning record${sharedDifferent === 1 ? "" : "s"} differ between copies.`
      );
    }
  }

  if (summary.documentRepresentationAlsoDiffers) {
    lines.push("Document representation also differs.");
  }

  return lines;
}

/**
 * Compare two current durable vaults structurally (Layer 1: counts only).
 * Inputs should already be domain PersistedState (e.g. in-memory local and
 * a present cloud read result). Soft-filled empties are compared as present
 * arrays/scalars after serialize.
 */
export function compareVaultStructure(
  local: PersistedState,
  cloud: PersistedState
): VaultStructuralDiff {
  const localDoc = serializeCloudVaultData(local);
  const cloudDoc = serializeCloudVaultData(cloud);
  const documentIdentity =
    financialVaultFingerprint(local) === financialVaultFingerprint(cloud)
      ? "same"
      : "different";

  const collections: CollectionStructuralCounts[] = [];

  for (const meta of FINANCIAL_COLLECTIONS) {
    const counts = compareIdCollection(
      asIdRows(localDoc[meta.key]),
      asIdRows(cloudDoc[meta.key])
    );
    collections.push({ ...meta, group: "financial", ...counts });
  }
  for (const meta of PLANNING_COLLECTIONS) {
    const counts = compareIdCollection(
      asIdRows(localDoc[meta.key]),
      asIdRows(cloudDoc[meta.key])
    );
    collections.push({ ...meta, group: "planning", ...counts });
  }
  for (const meta of SYSTEM_COLLECTIONS) {
    const counts = compareIdCollection(
      asIdRows(localDoc[meta.key]),
      asIdRows(cloudDoc[meta.key])
    );
    collections.push({ ...meta, group: "system", ...counts });
  }

  const scalars: ScalarStructuralStatus[] = [];
  for (const meta of FINANCIAL_SCALARS) {
    scalars.push({
      ...meta,
      group: "financial",
      status:
        canonicalDurableJson(localDoc[meta.key]) ===
        canonicalDurableJson(cloudDoc[meta.key])
          ? "same"
          : "different",
    });
  }
  for (const meta of SYSTEM_SCALARS) {
    scalars.push({
      ...meta,
      group: "system",
      status:
        canonicalDurableJson(localDoc[meta.key]) ===
        canonicalDurableJson(cloudDoc[meta.key])
          ? "same"
          : "different",
    });
  }

  const financial = sumGroup(collections, "financial");
  const planning = sumGroup(collections, "planning");
  const system = sumGroup(collections, "system");

  const financialScalarDiff = scalars.some(
    (row) => row.group === "financial" && row.status === "different"
  );
  const systemScalarDiff = scalars.some(
    (row) => row.group === "system" && row.status === "different"
  );

  const hasFinancialOrPlanningDifferences =
    financial.localOnly > 0 ||
    financial.cloudOnly > 0 ||
    financial.sharedDifferent > 0 ||
    planning.localOnly > 0 ||
    planning.cloudOnly > 0 ||
    planning.sharedDifferent > 0 ||
    financialScalarDiff;

  const hasSystemOrMetadataDifferences =
    system.localOnly > 0 ||
    system.cloudOnly > 0 ||
    system.sharedDifferent > 0 ||
    systemScalarDiff;

  const explainedDifference =
    hasFinancialOrPlanningDifferences || hasSystemOrMetadataDifferences;

  const documentRepresentationAlsoDiffers =
    documentIdentity === "different" && !explainedDifference;

  const summary: VaultStructuralDiffSummary = {
    localOnlyFinancial: financial.localOnly,
    cloudOnlyFinancial: financial.cloudOnly,
    sharedDifferentFinancial: financial.sharedDifferent,
    localOnlyPlanning: planning.localOnly,
    cloudOnlyPlanning: planning.cloudOnly,
    sharedDifferentPlanning: planning.sharedDifferent,
    hasFinancialOrPlanningDifferences,
    hasSystemOrMetadataDifferences,
    documentIdentity,
    documentRepresentationAlsoDiffers,
  };

  return {
    documentIdentity,
    collections,
    scalars,
    summary,
    summaryLines: buildSummaryLines(summary),
  };
}

/** True when Layer-1 payload contains no raw IDs or financial value fields. */
export function isLayer1SafeStructuralDiff(diff: VaultStructuralDiff): boolean {
  const raw = JSON.stringify(diff);
  if (/"id"\s*:/.test(raw)) return false;
  if (/"balance"\s*:/.test(raw)) return false;
  if (/"amount"\s*:/.test(raw)) return false;
  if (/"name"\s*:/.test(raw)) return false;
  if (/"creditor"\s*:/.test(raw)) return false;
  if (/"title"\s*:/.test(raw)) return false;
  return true;
}
