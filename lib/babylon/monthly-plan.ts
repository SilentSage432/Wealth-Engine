/**
 * Finalized Monthly Plan revisions.
 * Historical intent only. Drafts are not stored.
 * Planning Basis is an assumption for the canonical split.
 * It does not create income, allocations, or any other ledger record.
 */

import { allocateIncome, roundMoney } from "@/lib/babylon/engine";
import {
  dueDateForMonth,
  isObligationMonthDue,
  obligationIntervalMonths,
} from "@/lib/babylon/recurring-obligations";
import type {
  AllocationSplit,
  BudgetTarget,
  DebtEntry,
  ExpenseKind,
  MonthlyPlanCategoryPurpose,
  MonthlyPlanDebtIntent,
  MonthlyPlanObligationEvidence,
  MonthlyPlanProtectedContext,
  MonthlyPlanRevision,
  PersistedState,
  RecurringObligation,
} from "@/types/babylon";

const PERIOD_KEY = /^\d{4}-\d{2}$/;
const DUE_DATE = /^\d{4}-\d{2}-\d{2}$/;

export type MonthlyPlanRejectReason =
  | "malformed_period"
  | "malformed_id"
  | "malformed_finalized_at"
  | "malformed_planning_basis"
  | "malformed_category"
  | "negative_planned_amount"
  | "duplicate_category"
  | "malformed_debt"
  | "duplicate_debt"
  | "malformed_protected_context"
  | "living_under_allocated"
  | "living_over_allocated"
  | "debt_minimums_exceed_debt_share"
  | "revision_history_invalid"
  | "duplicate_revision_id";

export type MonthlyPlanFinalizeResult =
  | {
      ok: true;
      plans: MonthlyPlanRevision[];
      revision: MonthlyPlanRevision;
    }
  | {
      ok: false;
      reason: MonthlyPlanRejectReason;
      message: string;
    };

export interface MonthlyPlanFinalizeInput {
  id: string;
  periodKey: string;
  finalizedAt: string;
  planningBasis: number;
  categories: readonly MonthlyPlanCategoryPurpose[];
  debts: readonly DebtEntry[];
  obligations: readonly RecurringObligation[];
  openingWealthBuilding: number;
  openingEmergencyFund: number;
}

/** Caller-supplied intention. Debts, rules, and protected context come from the vault. */
export interface MonthlyPlanFinalizeRequest {
  id: string;
  periodKey: string;
  finalizedAt: string;
  planningBasis: number;
  categories: readonly MonthlyPlanCategoryPurpose[];
}

export type MonthlyPlanStateResult =
  | {
      ok: true;
      state: PersistedState;
      revision: MonthlyPlanRevision;
    }
  | {
      ok: false;
      reason: MonthlyPlanRejectReason;
      message: string;
    };

function cents(value: number): number {
  return Math.round(roundMoney(value) * 100);
}

/** Integer cents using the same rounding as finalization. */
export function monthlyPlanCents(value: number): number {
  return cents(value);
}

function moneyLabel(centValue: number): string {
  return (centValue / 100).toFixed(2);
}

type MonthlyPlanFailure = Extract<MonthlyPlanFinalizeResult, { ok: false }>;

function reject(
  reason: MonthlyPlanRejectReason,
  message: string
): MonthlyPlanFailure {
  return { ok: false, reason, message };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNonNegativeMoney(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

/** YYYY-MM with a calendar month. Not derived from the clock. */
export function isMonthlyPlanPeriodKey(value: string): boolean {
  if (!PERIOD_KEY.test(value)) return false;
  const month = Number(value.slice(5, 7));
  return month >= 1 && month <= 12;
}

function isFinalizedAt(value: string): boolean {
  if (!value.trim()) return false;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed);
}

/** Whole-list revision chain. Null means the list is a valid per-period sequence. */
export function monthlyPlanRevisionHistoryError(
  plans: readonly MonthlyPlanRevision[]
): MonthlyPlanFinalizeResult | null {
  const ids = new Set<string>();
  const byPeriod = new Map<string, MonthlyPlanRevision[]>();
  for (const plan of plans) {
    if (!plan.id.trim() || ids.has(plan.id)) {
      return reject(
        "revision_history_invalid",
        "Existing monthly plan revisions are not a valid sequence."
      );
    }
    ids.add(plan.id);
    if (!Number.isInteger(plan.revision) || plan.revision < 1) {
      return reject(
        "revision_history_invalid",
        "Existing monthly plan revisions are not a valid sequence."
      );
    }
    const list = byPeriod.get(plan.periodKey) ?? [];
    list.push(plan);
    byPeriod.set(plan.periodKey, list);
  }

  for (const list of byPeriod.values()) {
    const ordered = [...list].sort((a, b) => a.revision - b.revision);
    for (let index = 0; index < ordered.length; index += 1) {
      const plan = ordered[index];
      if (plan.revision !== index + 1) {
        return reject(
          "revision_history_invalid",
          "Existing monthly plan revisions are not a valid sequence."
        );
      }
      const expectedPrevious = index === 0 ? null : ordered[index - 1].id;
      if (plan.supersedesId !== expectedPrevious) {
        return reject(
          "revision_history_invalid",
          "Existing monthly plan revisions are not a valid sequence."
        );
      }
    }
  }
  return null;
}

function snapshotObligations(
  rules: readonly RecurringObligation[],
  periodKey: string
): MonthlyPlanObligationEvidence[] {
  const evidence: MonthlyPlanObligationEvidence[] = [];
  for (const rule of rules) {
    if (!rule.isActive) continue;
    if (rule.skippedMonths.includes(periodKey)) continue;
    if (
      !isObligationMonthDue(
        rule.startMonth,
        periodKey,
        obligationIntervalMonths(rule)
      )
    ) {
      continue;
    }
    evidence.push({
      id: rule.id,
      name: rule.name,
      amount: roundMoney(rule.amount),
      category: rule.category,
      budgetCategoryId: rule.budgetCategoryId,
      dueDay: rule.dueDay,
      intervalMonths: obligationIntervalMonths(rule),
      dueDate: dueDateForMonth(rule.dueDay, periodKey),
    });
  }
  return evidence;
}

function prepareCategories(
  input: readonly MonthlyPlanCategoryPurpose[]
):
  | { ok: true; categories: MonthlyPlanCategoryPurpose[] }
  | { ok: false; failure: MonthlyPlanFailure } {
  const categories: MonthlyPlanCategoryPurpose[] = [];
  const categoryIds = new Set<string>();
  for (const category of input) {
    if (!category.id.trim() || !category.categoryName.trim()) {
      return {
        ok: false,
        failure: reject("malformed_category", "A planned purpose is incomplete."),
      };
    }
    if (typeof category.isEssential !== "boolean") {
      return {
        ok: false,
        failure: reject("malformed_category", "A planned purpose is incomplete."),
      };
    }
    if (!Number.isFinite(category.plannedAmount)) {
      return {
        ok: false,
        failure: reject("malformed_category", "A planned purpose is incomplete."),
      };
    }
    if (category.plannedAmount < 0) {
      return {
        ok: false,
        failure: reject(
          "negative_planned_amount",
          "A planned purpose cannot be negative."
        ),
      };
    }
    const id = category.id.trim();
    if (categoryIds.has(id)) {
      return {
        ok: false,
        failure: reject(
          "duplicate_category",
          "Each planned purpose uses one category."
        ),
      };
    }
    categoryIds.add(id);
    categories.push({
      id,
      categoryName: category.categoryName.trim(),
      plannedAmount: roundMoney(category.plannedAmount),
      isEssential: category.isEssential,
    });
  }
  return { ok: true, categories };
}

function prepareDebts(
  input: readonly DebtEntry[]
):
  | { ok: true; debts: MonthlyPlanDebtIntent[] }
  | { ok: false; failure: MonthlyPlanFailure } {
  const debts: MonthlyPlanDebtIntent[] = [];
  const debtIds = new Set<string>();
  for (const debt of input) {
    if (!debt.id.trim() || !debt.creditor.trim()) {
      return {
        ok: false,
        failure: reject("malformed_debt", "A debt snapshot is incomplete."),
      };
    }
    if (
      !isNonNegativeMoney(debt.monthlyAllocation) ||
      !isNonNegativeMoney(debt.remainingDebt)
    ) {
      return {
        ok: false,
        failure: reject("malformed_debt", "A debt snapshot is incomplete."),
      };
    }
    const id = debt.id.trim();
    if (debtIds.has(id)) {
      return {
        ok: false,
        failure: reject("duplicate_debt", "Each debt is snapshotted once."),
      };
    }
    debtIds.add(id);
    debts.push({
      id,
      creditor: debt.creditor.trim(),
      monthlyAllocation: roundMoney(debt.monthlyAllocation),
      remainingDebt: roundMoney(debt.remainingDebt),
    });
  }
  return { ok: true, debts };
}

function livingAssignment(
  planningBasis: number,
  hasActiveDebt: boolean,
  categories: readonly MonthlyPlanCategoryPurpose[]
): {
  split: AllocationSplit;
  purposeCents: number;
  livingCents: number;
  remainingCents: number;
  failure: MonthlyPlanFailure | null;
} {
  const split = allocateIncome(planningBasis, hasActiveDebt);
  const purposeCents = categories.reduce(
    (sum, category) => sum + cents(category.plannedAmount),
    0
  );
  const livingCents = cents(split.expenditureShare);
  const remainingCents = livingCents - purposeCents;
  if (purposeCents < livingCents) {
    return {
      split,
      purposeCents,
      livingCents,
      remainingCents,
      failure: reject(
        "living_under_allocated",
        `Planned purposes total ${moneyLabel(purposeCents)}. The Living Budget share is ${moneyLabel(livingCents)}.`
      ),
    };
  }
  if (purposeCents > livingCents) {
    return {
      split,
      purposeCents,
      livingCents,
      remainingCents,
      failure: reject(
        "living_over_allocated",
        `Planned purposes total ${moneyLabel(purposeCents)}. The Living Budget share is ${moneyLabel(livingCents)}.`
      ),
    };
  }
  return {
    split,
    purposeCents,
    livingCents,
    remainingCents,
    failure: null,
  };
}

function debtMinimumFailure(
  debts: readonly MonthlyPlanDebtIntent[],
  debtShare: number
): { minimumCents: number; debtCents: number; failure: MonthlyPlanFailure | null } {
  const minimumCents = debts.reduce(
    (sum, debt) => sum + cents(debt.monthlyAllocation),
    0
  );
  const debtCents = cents(debtShare);
  if (minimumCents > debtCents) {
    return {
      minimumCents,
      debtCents,
      failure: reject(
        "debt_minimums_exceed_debt_share",
        `Debt minimums total ${moneyLabel(minimumCents)}. The Debt share is ${moneyLabel(debtCents)}.`
      ),
    };
  }
  return { minimumCents, debtCents, failure: null };
}

function obligationCentsByCategory(
  obligations: readonly MonthlyPlanObligationEvidence[]
): Record<string, number> {
  const totals: Record<string, number> = {};
  for (const obligation of obligations) {
    totals[obligation.budgetCategoryId] =
      (totals[obligation.budgetCategoryId] ?? 0) + cents(obligation.amount);
  }
  return totals;
}

/** Latest finalized revision for one explicit period. Null when none exists. */
export function latestMonthlyPlanRevision(
  plans: readonly MonthlyPlanRevision[],
  periodKey: string
): MonthlyPlanRevision | null {
  return plans.reduce<MonthlyPlanRevision | null>((current, plan) => {
    if (plan.periodKey !== periodKey) return current;
    if (current === null || plan.revision > current.revision) return plan;
    return current;
  }, null);
}

/** Revision number the next finalize for this period would store. */
export function nextMonthlyPlanRevisionNumber(
  plans: readonly MonthlyPlanRevision[],
  periodKey: string
): number {
  const latest = latestMonthlyPlanRevision(plans, periodKey);
  return latest ? latest.revision + 1 : 1;
}

/**
 * Copy live category rows into a first-plan draft.
 * The returned objects are not the BudgetTarget records.
 */
export function seedMonthlyPlanFromTargets(
  targets: readonly BudgetTarget[]
): MonthlyPlanCategoryPurpose[] {
  return targets.map((target) => ({
    id: target.id,
    categoryName: target.categoryName,
    isEssential: target.isEssential,
    plannedAmount: target.plannedAmount,
  }));
}

/**
 * Copy a finalized revision into the next draft.
 * Live caps are not read.
 */
export function seedMonthlyPlanFromRevision(revision: MonthlyPlanRevision): {
  planningBasis: number;
  categories: MonthlyPlanCategoryPurpose[];
} {
  return {
    planningBasis: revision.planningBasis,
    categories: revision.categories.map((category) => ({
      id: category.id,
      categoryName: category.categoryName,
      isEssential: category.isEssential,
      plannedAmount: category.plannedAmount,
    })),
  };
}

export interface MonthlyPlanPreviewInput {
  periodKey: string;
  planningBasis: number;
  categories: readonly MonthlyPlanCategoryPurpose[];
  debts: readonly DebtEntry[];
  obligations: readonly RecurringObligation[];
}

/** Read-only plan picture. Does not append a revision or change any input. */
export interface MonthlyPlanPreview {
  periodValid: boolean;
  basisValid: boolean;
  categoriesValid: boolean;
  debtsValid: boolean;
  split: AllocationSplit | null;
  assignedCents: number | null;
  livingCents: number | null;
  remainingCents: number | null;
  debtMinimumCents: number | null;
  debtShareCents: number | null;
  obligations: MonthlyPlanObligationEvidence[];
  obligationCentsByCategoryId: Readonly<Record<string, number>>;
  basisMessage: string | null;
  categoryMessage: string | null;
  assignmentMessage: string | null;
  debtMessage: string | null;
  canFinalize: boolean;
}

/**
 * Preview the same Living cents, debt-minimum check, and due-rule snapshot
 * finalization uses. Planning Basis is passed through allocateIncome.
 * Protected Money is not an input.
 */
export function previewMonthlyPlan(
  input: MonthlyPlanPreviewInput
): MonthlyPlanPreview {
  const periodValid = isMonthlyPlanPeriodKey(input.periodKey);
  const basisValid = isNonNegativeMoney(input.planningBasis);
  const preparedCategories = prepareCategories(input.categories);
  const preparedDebts = prepareDebts(input.debts);
  const obligations = periodValid
    ? snapshotObligations(input.obligations, input.periodKey)
    : [];
  const debts = preparedDebts.ok ? preparedDebts.debts : [];
  const hasActiveDebt = debts.some((debt) => debt.remainingDebt > 0);
  const split = basisValid
    ? allocateIncome(input.planningBasis, hasActiveDebt)
    : null;
  const assignment =
    split && preparedCategories.ok
      ? livingAssignment(input.planningBasis, hasActiveDebt, preparedCategories.categories)
      : null;
  const debtCheck =
    split && preparedDebts.ok ? debtMinimumFailure(debts, split.debtShare) : null;
  const minimumCents = preparedDebts.ok
    ? debts.reduce((sum, debt) => sum + cents(debt.monthlyAllocation), 0)
    : null;
  const canFinalize =
    periodValid &&
    basisValid &&
    preparedCategories.ok &&
    preparedDebts.ok &&
    assignment !== null &&
    assignment.failure === null &&
    debtCheck !== null &&
    debtCheck.failure === null;

  return {
    periodValid,
    basisValid,
    categoriesValid: preparedCategories.ok,
    debtsValid: preparedDebts.ok,
    split,
    assignedCents: assignment?.purposeCents ?? null,
    livingCents: assignment?.livingCents ?? (split ? cents(split.expenditureShare) : null),
    remainingCents: assignment?.remainingCents ?? null,
    debtMinimumCents: minimumCents,
    debtShareCents: debtCheck?.debtCents ?? (split ? cents(split.debtShare) : null),
    obligations,
    obligationCentsByCategoryId: obligationCentsByCategory(obligations),
    basisMessage: basisValid
      ? null
      : "Planning basis must be zero or a positive amount.",
    categoryMessage: preparedCategories.ok ? null : preparedCategories.failure.message,
    assignmentMessage: assignment?.failure?.message ?? null,
    debtMessage: debtCheck?.failure?.message ?? null,
    canFinalize,
  };
}

/**
 * Append one finalized revision.
 * The returned list keeps every previous revision object as it was.
 * Failure returns the reason and does not invent a repaired history.
 */
export function finalizeMonthlyPlanRevision(
  plans: readonly MonthlyPlanRevision[],
  input: MonthlyPlanFinalizeInput
): MonthlyPlanFinalizeResult {
  if (!input.id.trim()) {
    return reject("malformed_id", "A finalized plan needs an id.");
  }
  if (!isMonthlyPlanPeriodKey(input.periodKey)) {
    return reject("malformed_period", "Period must be YYYY-MM.");
  }
  if (!isFinalizedAt(input.finalizedAt)) {
    return reject(
      "malformed_finalized_at",
      "Finalization needs a real timestamp."
    );
  }
  if (!isNonNegativeMoney(input.planningBasis)) {
    return reject(
      "malformed_planning_basis",
      "Planning basis must be zero or a positive amount."
    );
  }
  if (
    !isNonNegativeMoney(input.openingWealthBuilding) ||
    !isNonNegativeMoney(input.openingEmergencyFund)
  ) {
    return reject(
      "malformed_protected_context",
      "Protected Money context must be zero or a positive amount."
    );
  }

  const preparedCategories = prepareCategories(input.categories);
  if (!preparedCategories.ok) return preparedCategories.failure;
  const preparedDebts = prepareDebts(input.debts);
  if (!preparedDebts.ok) return preparedDebts.failure;
  const categories = preparedCategories.categories;
  const debts = preparedDebts.debts;

  const history = monthlyPlanRevisionHistoryError(plans);
  if (history) return history;
  if (plans.some((plan) => plan.id === input.id.trim())) {
    return reject(
      "duplicate_revision_id",
      "A finalized plan id is already in the vault."
    );
  }

  const hasActiveDebt = debts.some((debt) => debt.remainingDebt > 0);
  const assignment = livingAssignment(
    input.planningBasis,
    hasActiveDebt,
    categories
  );
  if (assignment.failure) return assignment.failure;
  const split = assignment.split;
  const debtCheck = debtMinimumFailure(debts, split.debtShare);
  if (debtCheck.failure) return debtCheck.failure;

  const latest = latestMonthlyPlanRevision(plans, input.periodKey);
  const protectedContext: MonthlyPlanProtectedContext = {
    openingWealthBuilding: roundMoney(input.openingWealthBuilding),
    openingEmergencyFund: roundMoney(input.openingEmergencyFund),
  };
  const revision: MonthlyPlanRevision = {
    id: input.id.trim(),
    periodKey: input.periodKey,
    revision: latest ? latest.revision + 1 : 1,
    finalizedAt: input.finalizedAt,
    supersedesId: latest ? latest.id : null,
    planningBasis: roundMoney(input.planningBasis),
    wealthShare: split.wealthShare,
    debtShare: split.debtShare,
    expenditureShare: split.expenditureShare,
    debtRedirected: split.debtRedirected,
    categories,
    debts,
    obligations: snapshotObligations(input.obligations, input.periodKey),
    protectedContext,
  };

  return {
    ok: true,
    plans: [...plans, revision],
    revision,
  };
}

/**
 * Finalize against a vault snapshot.
 * The next state replaces monthlyPlans only.
 */
export function finalizeMonthlyPlanOnState(
  state: PersistedState,
  input: MonthlyPlanFinalizeRequest
): MonthlyPlanStateResult {
  const outcome = finalizeMonthlyPlanRevision(state.monthlyPlans, {
    ...input,
    debts: state.debts,
    obligations: state.recurringObligations,
    openingWealthBuilding: state.openingWealthBuilding,
    openingEmergencyFund: state.openingEmergencyFund,
  });
  if (!outcome.ok) return outcome;
  return {
    ok: true,
    revision: outcome.revision,
    state: { ...state, monthlyPlans: outcome.plans },
  };
}

function parseCategory(value: unknown): MonthlyPlanCategoryPurpose | null {
  if (!isRecord(value)) return null;
  if (typeof value.id !== "string" || !value.id.trim()) return null;
  if (typeof value.categoryName !== "string" || !value.categoryName.trim()) {
    return null;
  }
  if (!isNonNegativeMoney(value.plannedAmount)) return null;
  if (typeof value.isEssential !== "boolean") return null;
  return {
    id: value.id.trim(),
    categoryName: value.categoryName.trim(),
    plannedAmount: roundMoney(value.plannedAmount),
    isEssential: value.isEssential,
  };
}

function parseDebt(value: unknown): MonthlyPlanDebtIntent | null {
  if (!isRecord(value)) return null;
  if (typeof value.id !== "string" || !value.id.trim()) return null;
  if (typeof value.creditor !== "string" || !value.creditor.trim()) return null;
  if (!isNonNegativeMoney(value.monthlyAllocation)) return null;
  if (!isNonNegativeMoney(value.remainingDebt)) return null;
  return {
    id: value.id.trim(),
    creditor: value.creditor.trim(),
    monthlyAllocation: roundMoney(value.monthlyAllocation),
    remainingDebt: roundMoney(value.remainingDebt),
  };
}

function parseObligation(value: unknown): MonthlyPlanObligationEvidence | null {
  if (!isRecord(value)) return null;
  if (typeof value.id !== "string" || !value.id.trim()) return null;
  if (typeof value.name !== "string" || !value.name.trim()) return null;
  if (!isNonNegativeMoney(value.amount) || value.amount <= 0) return null;
  if (value.category !== "need" && value.category !== "desire") return null;
  if (typeof value.budgetCategoryId !== "string" || !value.budgetCategoryId.trim()) {
    return null;
  }
  if (
    typeof value.dueDay !== "number" ||
    !Number.isInteger(value.dueDay) ||
    value.dueDay < 1 ||
    value.dueDay > 31
  ) {
    return null;
  }
  if (
    typeof value.intervalMonths !== "number" ||
    !Number.isInteger(value.intervalMonths) ||
    value.intervalMonths < 1
  ) {
    return null;
  }
  if (typeof value.dueDate !== "string" || !DUE_DATE.test(value.dueDate)) {
    return null;
  }
  return {
    id: value.id.trim(),
    name: value.name.trim(),
    amount: roundMoney(value.amount),
    category: value.category as ExpenseKind,
    budgetCategoryId: value.budgetCategoryId.trim(),
    dueDay: value.dueDay,
    intervalMonths: value.intervalMonths,
    dueDate: value.dueDate,
  };
}

function parseProtected(value: unknown): MonthlyPlanProtectedContext | null {
  if (!isRecord(value)) return null;
  if (!isNonNegativeMoney(value.openingWealthBuilding)) return null;
  if (!isNonNegativeMoney(value.openingEmergencyFund)) return null;
  return {
    openingWealthBuilding: roundMoney(value.openingWealthBuilding),
    openingEmergencyFund: roundMoney(value.openingEmergencyFund),
  };
}

/** One stored revision. Null drops a corrupt row on local load. */
export function parseMonthlyPlanRevision(value: unknown): MonthlyPlanRevision | null {
  if (!isRecord(value)) return null;
  if (typeof value.id !== "string" || !value.id.trim()) return null;
  if (typeof value.periodKey !== "string" || !isMonthlyPlanPeriodKey(value.periodKey)) {
    return null;
  }
  if (
    typeof value.revision !== "number" ||
    !Number.isInteger(value.revision) ||
    value.revision < 1
  ) {
    return null;
  }
  if (typeof value.finalizedAt !== "string" || !isFinalizedAt(value.finalizedAt)) {
    return null;
  }
  if (value.supersedesId !== null && typeof value.supersedesId !== "string") {
    return null;
  }
  if (typeof value.supersedesId === "string" && !value.supersedesId.trim()) {
    return null;
  }
  if (!isNonNegativeMoney(value.planningBasis)) return null;
  if (!isNonNegativeMoney(value.wealthShare)) return null;
  if (!isNonNegativeMoney(value.debtShare)) return null;
  if (!isNonNegativeMoney(value.expenditureShare)) return null;
  if (typeof value.debtRedirected !== "boolean") return null;
  if (!Array.isArray(value.categories)) return null;
  if (!Array.isArray(value.debts)) return null;
  if (!Array.isArray(value.obligations)) return null;

  const categories: MonthlyPlanCategoryPurpose[] = [];
  for (const category of value.categories) {
    const parsed = parseCategory(category);
    if (!parsed) return null;
    categories.push(parsed);
  }
  const debts: MonthlyPlanDebtIntent[] = [];
  for (const debt of value.debts) {
    const parsed = parseDebt(debt);
    if (!parsed) return null;
    debts.push(parsed);
  }
  const obligations: MonthlyPlanObligationEvidence[] = [];
  for (const obligation of value.obligations) {
    const parsed = parseObligation(obligation);
    if (!parsed) return null;
    obligations.push(parsed);
  }
  const protectedContext = parseProtected(value.protectedContext);
  if (!protectedContext) return null;
  if (obligations.some((obligation) => !obligation.dueDate.startsWith(`${value.periodKey}-`))) {
    return null;
  }

  return {
    id: value.id.trim(),
    periodKey: value.periodKey,
    revision: value.revision,
    finalizedAt: value.finalizedAt,
    supersedesId:
      typeof value.supersedesId === "string" ? value.supersedesId.trim() : null,
    planningBasis: roundMoney(value.planningBasis),
    wealthShare: roundMoney(value.wealthShare),
    debtShare: roundMoney(value.debtShare),
    expenditureShare: roundMoney(value.expenditureShare),
    debtRedirected: value.debtRedirected,
    categories,
    debts,
    obligations,
    protectedContext,
  };
}
