/**
 * Read-only semantic comparison of two MonthlyPlanRevision records.
 * Civil month is periodKey. Record identity and audit timestamps are not intent.
 */

import { canonicalDurableJson } from "@/lib/babylon/vault-structural-diff";
import { isMonthlyPlanPeriodKey } from "@/lib/babylon/monthly-plan";
import type { MonthlyPlanRevision, PersistedState } from "@/types/babylon";

export type MonthlyPlanIntentRelation =
  | "same_month_same_intent"
  | "same_month_different_intent"
  | "different_months"
  | "not_comparable";

export type MonthlyPlanSideEvidence = {
  monthLabel: string;
  revision: number;
  supersedesEarlier: boolean;
};

export type MonthlyPlanLayer2 =
  | { status: "hidden" }
  | { status: "multiple" }
  | {
      status: "compared";
      relation: MonthlyPlanIntentRelation;
      local: MonthlyPlanSideEvidence | null;
      cloud: MonthlyPlanSideEvidence | null;
      copy: string;
    };

const MONTH_NAMES = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
] as const;

/** Civil YYYY-MM → "September 2026". No Date conversion. */
export function formatCivilMonthLabel(periodKey: string): string | null {
  if (!isMonthlyPlanPeriodKey(periodKey)) return null;
  const month = Number(periodKey.slice(5, 7));
  const year = periodKey.slice(0, 4);
  const name = MONTH_NAMES[month - 1];
  if (!name) return null;
  return `${name} ${year}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function planningIntent(plan: MonthlyPlanRevision): unknown {
  return {
    planningBasis: plan.planningBasis,
    wealthShare: plan.wealthShare,
    debtShare: plan.debtShare,
    expenditureShare: plan.expenditureShare,
    debtRedirected: plan.debtRedirected,
    categories: plan.categories,
    debts: plan.debts,
    obligations: plan.obligations,
    protectedContext: plan.protectedContext,
  };
}

function asPlan(value: unknown): MonthlyPlanRevision | null {
  if (!isRecord(value)) return null;
  if (typeof value.id !== "string" || !value.id.trim()) return null;
  if (typeof value.periodKey !== "string" || !isMonthlyPlanPeriodKey(value.periodKey)) {
    return null;
  }
  if (typeof value.revision !== "number" || !Number.isInteger(value.revision) || value.revision < 1) {
    return null;
  }
  if (
    !("planningBasis" in value) ||
    !("wealthShare" in value) ||
    !("debtShare" in value) ||
    !("expenditureShare" in value) ||
    typeof value.debtRedirected !== "boolean" ||
    !Array.isArray(value.categories) ||
    !Array.isArray(value.debts) ||
    !Array.isArray(value.obligations) ||
    !isRecord(value.protectedContext)
  ) {
    return null;
  }
  return value as unknown as MonthlyPlanRevision;
}

function sideEvidence(plan: MonthlyPlanRevision): MonthlyPlanSideEvidence | null {
  const monthLabel = formatCivilMonthLabel(plan.periodKey);
  if (!monthLabel) return null;
  return {
    monthLabel,
    revision: plan.revision,
    supersedesEarlier:
      typeof plan.supersedesId === "string" && plan.supersedesId.trim().length > 0,
  };
}

export function monthlyPlanRelationCopy(relation: MonthlyPlanIntentRelation): string {
  switch (relation) {
    case "same_month_same_intent":
      return "These plans are for the same month and contain the same planning intent. Their record identities differ.";
    case "same_month_different_intent":
      return "These plans are for the same month, but their planning intent differs.";
    case "different_months":
      return "These plans are for different months. Both may represent valid planning history.";
    case "not_comparable":
      return "These plans couldn't be compared safely.";
  }
}

/**
 * Classify two plans. Identity fields (id, supersedesId, finalizedAt, revision)
 * do not decide intent. revision is reported separately by the caller.
 */
export function compareMonthlyPlanIntent(
  local: unknown,
  cloud: unknown
): MonthlyPlanIntentRelation {
  const left = asPlan(local);
  const right = asPlan(cloud);
  if (!left || !right) return "not_comparable";
  if (left.periodKey !== right.periodKey) return "different_months";
  const same =
    canonicalDurableJson(planningIntent(left)) ===
    canonicalDurableJson(planningIntent(right));
  return same ? "same_month_same_intent" : "same_month_different_intent";
}

function idSet(plans: readonly MonthlyPlanRevision[]): Set<string> {
  return new Set(plans.map((plan) => plan.id));
}

function onlyOn(
  plans: readonly MonthlyPlanRevision[],
  otherIds: ReadonlySet<string>
): MonthlyPlanRevision[] {
  return plans.filter((plan) => plan.id && !otherIds.has(plan.id));
}

/**
 * Layer-2 evidence only for exactly one local-only and one cloud-only plan.
 * More than one unique plan on either side is not pairwise-matched.
 */
export function classifyUniqueMonthlyPlans(
  localPlans: readonly MonthlyPlanRevision[],
  cloudPlans: readonly MonthlyPlanRevision[]
): MonthlyPlanLayer2 {
  const localOnly = onlyOn(localPlans, idSet(cloudPlans));
  const cloudOnly = onlyOn(cloudPlans, idSet(localPlans));
  if (localOnly.length === 0 && cloudOnly.length === 0) {
    return { status: "hidden" };
  }
  if (localOnly.length !== 1 || cloudOnly.length !== 1) {
    if (localOnly.length > 1 || cloudOnly.length > 1) {
      return { status: "multiple" };
    }
    return { status: "hidden" };
  }

  const relation = compareMonthlyPlanIntent(localOnly[0], cloudOnly[0]);
  const localSide = sideEvidence(asPlan(localOnly[0]) ?? localOnly[0]);
  const cloudSide = sideEvidence(asPlan(cloudOnly[0]) ?? cloudOnly[0]);
  if (relation === "not_comparable" || !localSide || !cloudSide) {
    return {
      status: "compared",
      relation: "not_comparable",
      local: localSide,
      cloud: cloudSide,
      copy: monthlyPlanRelationCopy("not_comparable"),
    };
  }

  return {
    status: "compared",
    relation,
    local: localSide,
    cloud: cloudSide,
    copy: monthlyPlanRelationCopy(relation),
  };
}

export function classifyVaultMonthlyPlans(
  local: PersistedState,
  cloud: PersistedState
): MonthlyPlanLayer2 {
  return classifyUniqueMonthlyPlans(local.monthlyPlans, cloud.monthlyPlans);
}

/** Layer-2 steward payload must not carry ids, names, or amounts. */
export function isLayer2PlanEvidenceSafe(evidence: MonthlyPlanLayer2): boolean {
  const raw = JSON.stringify(evidence);
  if (/"id"\s*:/.test(raw)) return false;
  if (/"supersedesId"\s*:/.test(raw)) return false;
  if (/"finalizedAt"\s*:/.test(raw)) return false;
  if (/"planningBasis"\s*:/.test(raw)) return false;
  if (/"categoryName"\s*:/.test(raw)) return false;
  if (/"creditor"\s*:/.test(raw)) return false;
  if (/"amount"\s*:/.test(raw)) return false;
  if (/"name"\s*:/.test(raw)) return false;
  return true;
}
