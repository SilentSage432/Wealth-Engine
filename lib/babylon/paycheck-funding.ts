/**
 * Paycheck funding — temporal decomposition of finalized monthly purpose
 * across ExpectedPayday occurrences in the same civil period.
 *
 * MonthlyPlanRevision → PaycheckFundingPlan ← ExpectedPayday[]
 *
 * Planning arithmetic only. Not Income. Not Allocation. Not Position.
 * Does not persist. Does not read actual IncomeEntry. Does not weight by
 * expectedAmount. Does not use obligation due dates.
 */

import { isCivilIsoDate } from "@/lib/babylon/attention";
import { monthKeyFromDate, roundMoney } from "@/lib/babylon/engine";
import { isMonthlyPlanPeriodKey } from "@/lib/babylon/monthly-plan";
import type {
  ExpectedPayday,
  MonthlyFundingPurpose,
  MonthlyPlanRevision,
  PaycheckFundingPaydaySlot,
  PaycheckFundingPlan,
  PaycheckFundingResponsibility,
} from "@/types/babylon";

export type PaycheckFundingRejectReason =
  | "malformed_period"
  | "malformed_plan"
  | "malformed_payday"
  | "foreign_period_payday"
  | "period_date_mismatch"
  | "duplicate_expected_payday";

export type DerivePaycheckFundingResult =
  | { ok: true; plan: PaycheckFundingPlan }
  | {
      ok: false;
      reason: PaycheckFundingRejectReason;
      message: string;
    };

function reject(
  reason: PaycheckFundingRejectReason,
  message: string
): Extract<DerivePaycheckFundingResult, { ok: false }> {
  return { ok: false, reason, message };
}

function toCents(value: number): number {
  return Math.round(roundMoney(value) * 100);
}

function fromCents(cents: number): number {
  return roundMoney(cents / 100);
}

/**
 * Split non-negative integer cents across N >= 1 ordered slots.
 * Base share is floor(total / N). Remainder cents (total % N) are assigned
 * one each to the earliest slots (index 0 .. rem-1).
 * Guarantees: sum === total and max − min <= 1.
 */
export function splitCentsEarliestRemainder(
  totalCents: number,
  occurrenceCount: number
): number[] {
  if (
    !Number.isInteger(totalCents) ||
    totalCents < 0 ||
    !Number.isInteger(occurrenceCount) ||
    occurrenceCount < 1
  ) {
    throw new Error("splitCentsEarliestRemainder requires cents >= 0 and N >= 1");
  }
  const base = Math.floor(totalCents / occurrenceCount);
  const remainder = totalCents % occurrenceCount;
  const shares: number[] = [];
  for (let index = 0; index < occurrenceCount; index += 1) {
    shares.push(base + (index < remainder ? 1 : 0));
  }
  return shares;
}

/** Extract decomposable monthly purposes from a finalized revision. */
export function extractMonthlyFundingPurposes(
  plan: MonthlyPlanRevision
): MonthlyFundingPurpose[] {
  const purposes: MonthlyFundingPurpose[] = [];
  for (const category of plan.categories) {
    purposes.push({
      kind: "living",
      purposeId: category.id,
      label: category.categoryName,
      monthlyPlannedAmount: roundMoney(category.plannedAmount),
    });
  }
  purposes.push({
    kind: "wealth",
    purposeId: "wealth",
    label: "Wealth Building",
    monthlyPlannedAmount: roundMoney(plan.wealthShare),
  });
  purposes.push({
    kind: "debt",
    purposeId: "debt",
    label: "Debt Payoff",
    monthlyPlannedAmount: roundMoney(plan.debtShare),
  });
  return purposes;
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

function validateAndOrderPaydays(
  periodKey: string,
  paydays: readonly ExpectedPayday[]
):
  | { ok: true; ordered: ExpectedPayday[] }
  | { ok: false; failure: Extract<DerivePaycheckFundingResult, { ok: false }> } {
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

function responsibilityFor(
  purpose: MonthlyFundingPurpose,
  payday: ExpectedPayday,
  amountCents: number
): PaycheckFundingResponsibility {
  return {
    purposeKind: purpose.kind,
    purposeId: purpose.purposeId,
    label: purpose.label,
    monthlyPlannedAmount: purpose.monthlyPlannedAmount,
    amount: fromCents(amountCents),
    scheduleId: payday.scheduleId,
    date: payday.date,
    periodKey: payday.periodKey,
  };
}

/**
 * Derive paycheck funding responsibilities for one finalized Monthly Plan
 * and ExpectedPayday occurrences in the same period.
 *
 * Equal split by occurrence count. expectedAmount does not weight.
 * Obligation due dates do not influence amounts.
 */
export function derivePaycheckFundingPlan(
  monthlyPlan: MonthlyPlanRevision,
  expectedPaydays: readonly ExpectedPayday[]
): DerivePaycheckFundingResult {
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

  const validated = validateAndOrderPaydays(
    monthlyPlan.periodKey,
    expectedPaydays
  );
  if (!validated.ok) return validated.failure;

  const purposes = extractMonthlyFundingPurposes(monthlyPlan);
  const ordered = validated.ordered;
  const n = ordered.length;

  if (n === 0) {
    return {
      ok: true,
      plan: {
        periodKey: monthlyPlan.periodKey,
        monthlyPlanRevisionId: monthlyPlan.id,
        status: "no_expected_funding",
        fundingOpportunityCount: 0,
        purposes,
        paydays: [],
      },
    };
  }

  const slots: PaycheckFundingPaydaySlot[] = ordered.map((payday) => ({
    expectedPayday: payday,
    responsibilities: [],
  }));

  for (const purpose of purposes) {
    const shares = splitCentsEarliestRemainder(toCents(purpose.monthlyPlannedAmount), n);
    for (let index = 0; index < n; index += 1) {
      slots[index].responsibilities.push(
        responsibilityFor(purpose, ordered[index], shares[index])
      );
    }
  }

  return {
    ok: true,
    plan: {
      periodKey: monthlyPlan.periodKey,
      monthlyPlanRevisionId: monthlyPlan.id,
      status: "decomposed",
      fundingOpportunityCount: n,
      purposes,
      paydays: slots,
    },
  };
}
