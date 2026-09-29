/**
 * Paycheck temporal facts — civil-date relationships between finalized
 * MonthlyPlanRevision obligation evidence and ExpectedPayday dates.
 *
 * Temporal relationship ≠ funding responsibility ≠ allocation ≠ settlement.
 * Does not mutate PaycheckFundingPlan amounts. Does not persist.
 */

import { isCivilIsoDate } from "@/lib/babylon/attention";
import { monthKeyFromDate, roundMoney } from "@/lib/babylon/engine";
import { isMonthlyPlanPeriodKey } from "@/lib/babylon/monthly-plan";
import type {
  ExpectedPayday,
  ExpenseKind,
  MonthlyPlanObligationEvidence,
  MonthlyPlanRevision,
  PaydayTemporalWindow,
  PaycheckTemporalPlan,
  TemporalObligationFact,
} from "@/types/babylon";

export type PaycheckTemporalRejectReason =
  | "malformed_period"
  | "malformed_plan"
  | "malformed_payday"
  | "foreign_period_payday"
  | "period_date_mismatch"
  | "duplicate_expected_payday"
  | "malformed_obligation"
  | "foreign_period_obligation"
  | "duplicate_obligation";

export type DerivePaycheckTemporalResult =
  | { ok: true; plan: PaycheckTemporalPlan }
  | {
      ok: false;
      reason: PaycheckTemporalRejectReason;
      message: string;
    };

function reject(
  reason: PaycheckTemporalRejectReason,
  message: string
): Extract<DerivePaycheckTemporalResult, { ok: false }> {
  return { ok: false, reason, message };
}

function paydayOccurrenceKey(payday: ExpectedPayday): string {
  return `${payday.scheduleId}\0${payday.date}`;
}

function comparePaydays(a: ExpectedPayday, b: ExpectedPayday): number {
  const byDate = a.date.localeCompare(b.date);
  if (byDate !== 0) return byDate;
  return a.scheduleId.localeCompare(b.scheduleId);
}

function cloneExpectedPayday(payday: ExpectedPayday): ExpectedPayday {
  const clone: ExpectedPayday = {
    scheduleId: payday.scheduleId,
    date: payday.date,
    periodKey: payday.periodKey,
  };
  if (payday.expectedAmount !== undefined) {
    clone.expectedAmount = payday.expectedAmount;
  }
  if (payday.label !== undefined) {
    clone.label = payday.label;
  }
  return clone;
}

function isExpenseKind(value: unknown): value is ExpenseKind {
  return value === "need" || value === "desire";
}

function compareFacts(
  a: TemporalObligationFact,
  b: TemporalObligationFact
): number {
  const byDue = a.dueDate.localeCompare(b.dueDate);
  if (byDue !== 0) return byDue;
  return a.obligationId.localeCompare(b.obligationId);
}

function sortFacts(facts: TemporalObligationFact[]): TemporalObligationFact[] {
  return [...facts].sort(compareFacts);
}

function validateAndOrderPaydays(
  periodKey: string,
  paydays: readonly ExpectedPayday[]
):
  | { ok: true; ordered: ExpectedPayday[] }
  | { ok: false; failure: Extract<DerivePaycheckTemporalResult, { ok: false }> } {
  const seen = new Set<string>();
  const accepted: ExpectedPayday[] = [];

  for (const payday of paydays) {
    if (
      typeof payday.scheduleId !== "string" ||
      !payday.scheduleId.trim() ||
      typeof payday.date !== "string" ||
      !isCivilIsoDate(payday.date) ||
      typeof payday.periodKey !== "string" ||
      !isMonthlyPlanPeriodKey(payday.periodKey)
    ) {
      return {
        ok: false,
        failure: reject(
          "malformed_payday",
          "An expected payday is incomplete or malformed."
        ),
      };
    }
    if (monthKeyFromDate(payday.date) !== payday.periodKey) {
      return {
        ok: false,
        failure: reject(
          "period_date_mismatch",
          "An expected payday date does not match its periodKey."
        ),
      };
    }
    if (payday.periodKey !== periodKey) {
      return {
        ok: false,
        failure: reject(
          "foreign_period_payday",
          "Expected paydays must belong to the Monthly Plan period."
        ),
      };
    }
    if (
      payday.expectedAmount !== undefined &&
      (typeof payday.expectedAmount !== "number" ||
        !Number.isFinite(payday.expectedAmount) ||
        payday.expectedAmount <= 0)
    ) {
      return {
        ok: false,
        failure: reject(
          "malformed_payday",
          "An expected payday is incomplete or malformed."
        ),
      };
    }
    const key = paydayOccurrenceKey(payday);
    if (seen.has(key)) {
      return {
        ok: false,
        failure: reject(
          "duplicate_expected_payday",
          "Duplicate expected payday occurrences are not allowed."
        ),
      };
    }
    seen.add(key);
    accepted.push(cloneExpectedPayday(payday));
  }

  accepted.sort(comparePaydays);
  return { ok: true, ordered: accepted };
}

function validateObligations(
  periodKey: string,
  obligations: readonly MonthlyPlanObligationEvidence[]
):
  | { ok: true; rows: MonthlyPlanObligationEvidence[] }
  | { ok: false; failure: Extract<DerivePaycheckTemporalResult, { ok: false }> } {
  const seen = new Set<string>();
  const rows: MonthlyPlanObligationEvidence[] = [];

  for (const obligation of obligations) {
    if (
      typeof obligation.id !== "string" ||
      !obligation.id.trim() ||
      typeof obligation.name !== "string" ||
      !obligation.name.trim() ||
      typeof obligation.amount !== "number" ||
      !Number.isFinite(obligation.amount) ||
      obligation.amount < 0 ||
      !isExpenseKind(obligation.category) ||
      typeof obligation.budgetCategoryId !== "string" ||
      !obligation.budgetCategoryId.trim() ||
      typeof obligation.dueDate !== "string" ||
      !isCivilIsoDate(obligation.dueDate)
    ) {
      return {
        ok: false,
        failure: reject(
          "malformed_obligation",
          "A monthly plan obligation is incomplete or malformed."
        ),
      };
    }
    if (monthKeyFromDate(obligation.dueDate) !== periodKey) {
      return {
        ok: false,
        failure: reject(
          "foreign_period_obligation",
          "Obligation due dates must belong to the Monthly Plan period."
        ),
      };
    }
    const id = obligation.id.trim();
    if (seen.has(id)) {
      return {
        ok: false,
        failure: reject(
          "duplicate_obligation",
          "Each monthly plan obligation is classified once."
        ),
      };
    }
    seen.add(id);
    rows.push({
      id,
      name: obligation.name.trim(),
      amount: roundMoney(obligation.amount),
      category: obligation.category,
      budgetCategoryId: obligation.budgetCategoryId.trim(),
      dueDay: obligation.dueDay,
      intervalMonths: obligation.intervalMonths,
      dueDate: obligation.dueDate,
    });
  }

  return { ok: true, rows };
}

/**
 * Unique civil payday dates in ascending order.
 * Same-date funding opportunities collapse to one temporal moment.
 */
export function uniqueCivilPaydayDates(
  paydays: readonly ExpectedPayday[]
): string[] {
  return [...new Set(paydays.map((row) => row.date))].sort();
}

function factFrom(
  obligation: MonthlyPlanObligationEvidence,
  relationship: TemporalObligationFact["relationship"],
  anchors?: { paydayDate?: string; nextPaydayDate?: string }
): TemporalObligationFact {
  const fact: TemporalObligationFact = {
    obligationId: obligation.id,
    label: obligation.name,
    amount: obligation.amount,
    dueDate: obligation.dueDate,
    category: obligation.category,
    budgetCategoryId: obligation.budgetCategoryId,
    relationship,
  };
  if (anchors?.paydayDate !== undefined) {
    fact.paydayDate = anchors.paydayDate;
  }
  if (anchors?.nextPaydayDate !== undefined) {
    fact.nextPaydayDate = anchors.nextPaydayDate;
  }
  return fact;
}

/**
 * Derive temporal obligation facts for one finalized Monthly Plan and
 * ExpectedPayday occurrences in the same period.
 *
 * Interval model (unique civil payday dates D0 < D1 < … < Dk):
 * - due < D0 → due_before_first_payday
 * - due === Di → due_on_payday (elevated; not labeled "before next")
 * - Di < due < D{i+1} → due_before_next_payday for Di
 * - due > Dk → due_after_final_payday
 *
 * Payday coincidence uses due_on_payday rather than including the right
 * endpoint of (Di, D{i+1}] as "before next," so a due-on-payday fact is
 * never described as due before the next payday.
 */
export function derivePaycheckTemporalPlan(
  monthlyPlan: MonthlyPlanRevision,
  expectedPaydays: readonly ExpectedPayday[]
): DerivePaycheckTemporalResult {
  if (
    !monthlyPlan ||
    typeof monthlyPlan.id !== "string" ||
    !monthlyPlan.id.trim() ||
    typeof monthlyPlan.periodKey !== "string"
  ) {
    return reject("malformed_plan", "Monthly Plan revision is incomplete.");
  }
  if (!isMonthlyPlanPeriodKey(monthlyPlan.periodKey)) {
    return reject("malformed_period", "Monthly Plan periodKey is invalid.");
  }

  const validatedPaydays = validateAndOrderPaydays(
    monthlyPlan.periodKey,
    expectedPaydays
  );
  if (!validatedPaydays.ok) return validatedPaydays.failure;

  const validatedObligations = validateObligations(
    monthlyPlan.periodKey,
    monthlyPlan.obligations ?? []
  );
  if (!validatedObligations.ok) return validatedObligations.failure;

  const orderedPaydays = validatedPaydays.ordered;
  const uniqueDates = uniqueCivilPaydayDates(orderedPaydays);

  if (uniqueDates.length === 0) {
    return {
      ok: true,
      plan: {
        periodKey: monthlyPlan.periodKey,
        monthlyPlanRevisionId: monthlyPlan.id,
        status: "no_expected_funding",
        uniquePaydayDates: [],
        obligationsDueBeforeFirstPayday: [],
        windows: [],
        obligationsDueAfterFinalPayday: [],
      },
    };
  }

  const occurrencesByDate = new Map<string, ExpectedPayday[]>();
  for (const payday of orderedPaydays) {
    const list = occurrencesByDate.get(payday.date) ?? [];
    list.push(payday);
    occurrencesByDate.set(payday.date, list);
  }

  const windows: PaydayTemporalWindow[] = uniqueDates.map((paydayDate, index) => ({
    paydayDate,
    periodKey: monthlyPlan.periodKey,
    paydayOccurrences: occurrencesByDate.get(paydayDate) ?? [],
    nextPaydayDate:
      index + 1 < uniqueDates.length ? uniqueDates[index + 1] : null,
    obligationsDueOnPayday: [],
    obligationsDueBeforeNextPayday: [],
  }));

  const beforeFirst: TemporalObligationFact[] = [];
  const afterFinal: TemporalObligationFact[] = [];
  const first = uniqueDates[0];
  const last = uniqueDates[uniqueDates.length - 1];

  for (const obligation of validatedObligations.rows) {
    const due = obligation.dueDate;

    if (due < first) {
      beforeFirst.push(factFrom(obligation, "due_before_first_payday"));
      continue;
    }
    if (due > last) {
      afterFinal.push(factFrom(obligation, "due_after_final_payday"));
      continue;
    }

    const onIndex = uniqueDates.indexOf(due);
    if (onIndex >= 0) {
      windows[onIndex].obligationsDueOnPayday.push(
        factFrom(obligation, "due_on_payday", { paydayDate: due })
      );
      continue;
    }

    let placed = false;
    for (let index = 0; index < windows.length; index += 1) {
      const current = windows[index].paydayDate;
      const next = windows[index].nextPaydayDate;
      if (next === null) continue;
      if (due > current && due < next) {
        windows[index].obligationsDueBeforeNextPayday.push(
          factFrom(obligation, "due_before_next_payday", {
            paydayDate: current,
            nextPaydayDate: next,
          })
        );
        placed = true;
        break;
      }
    }
    if (!placed) {
      return reject(
        "malformed_obligation",
        "An obligation due date could not be classified against expected paydays."
      );
    }
  }

  for (const window of windows) {
    window.obligationsDueOnPayday = sortFacts(window.obligationsDueOnPayday);
    window.obligationsDueBeforeNextPayday = sortFacts(
      window.obligationsDueBeforeNextPayday
    );
  }

  return {
    ok: true,
    plan: {
      periodKey: monthlyPlan.periodKey,
      monthlyPlanRevisionId: monthlyPlan.id,
      status: "classified",
      uniquePaydayDates: uniqueDates,
      obligationsDueBeforeFirstPayday: sortFacts(beforeFirst),
      windows,
      obligationsDueAfterFinalPayday: sortFacts(afterFinal),
    },
  };
}
