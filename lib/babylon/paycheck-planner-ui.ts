/**
 * Paycheck planner presentation — composes domain funding + temporal outputs
 * into a read-only steward view model.
 *
 * React must not recalculate cent splits or temporal classification.
 * Expected ≠ Income. Temporal fact ≠ funding responsibility.
 */

import { roundMoney } from "@/lib/babylon/engine";
import {
  deriveExpectedPaydaysForSchedules,
} from "@/lib/babylon/pay-schedule";
import { derivePaycheckFundingPlan } from "@/lib/babylon/paycheck-funding";
import { derivePaycheckTemporalPlan } from "@/lib/babylon/paycheck-temporal";
import type {
  ExpectedPayday,
  MonthlyPlanRevision,
  PaycheckFundingResponsibility,
  PaySchedule,
  TemporalObligationFact,
} from "@/types/babylon";

export type FundThisMonthStatus =
  | "no_schedule"
  | "no_expected_funding"
  | "path";

export interface FundThisMonthFundingSlot {
  expectedPayday: ExpectedPayday;
  responsibilities: PaycheckFundingResponsibility[];
  /** Sum of funding responsibilities only — never temporal obligation amounts. */
  plannedResponsibilityTotal: number;
}

export interface FundThisMonthDateGroup {
  date: string;
  nextPaydayDate: string | null;
  fundingSlots: FundThisMonthFundingSlot[];
  dueOnPayday: TemporalObligationFact[];
  dueBeforeNextPayday: TemporalObligationFact[];
}

export type FundThisMonthView =
  | {
      status: "no_schedule";
      periodKey: string;
      monthlyPlanRevisionId: string;
      schedulesCount: number;
      expectedPaydayCount: 0;
      uniquePaydayDateCount: 0;
      beforeFirstPayday: [];
      afterFinalPayday: [];
      dateGroups: [];
    }
  | {
      status: "no_expected_funding";
      periodKey: string;
      monthlyPlanRevisionId: string;
      schedulesCount: number;
      expectedPaydayCount: number;
      uniquePaydayDateCount: 0;
      beforeFirstPayday: [];
      afterFinalPayday: [];
      dateGroups: [];
    }
  | {
      status: "path";
      periodKey: string;
      monthlyPlanRevisionId: string;
      schedulesCount: number;
      expectedPaydayCount: number;
      uniquePaydayDateCount: number;
      beforeFirstPayday: TemporalObligationFact[];
      afterFinalPayday: TemporalObligationFact[];
      dateGroups: FundThisMonthDateGroup[];
    };

function sumResponsibilityAmounts(
  rows: readonly PaycheckFundingResponsibility[]
): number {
  const cents = rows.reduce(
    (sum, row) => sum + Math.round(roundMoney(row.amount) * 100),
    0
  );
  return roundMoney(cents / 100);
}

/**
 * Compose the Fund-this-month view from a finalized revision and steward
 * PaySchedule rules. Domain modules own all arithmetic and classification.
 */
export function composeFundThisMonthView(
  revision: MonthlyPlanRevision,
  schedules: readonly PaySchedule[]
): FundThisMonthView {
  if (schedules.length === 0) {
    return {
      status: "no_schedule",
      periodKey: revision.periodKey,
      monthlyPlanRevisionId: revision.id,
      schedulesCount: 0,
      expectedPaydayCount: 0,
      uniquePaydayDateCount: 0,
      beforeFirstPayday: [],
      afterFinalPayday: [],
      dateGroups: [],
    };
  }

  const paydays = deriveExpectedPaydaysForSchedules(
    schedules,
    revision.periodKey
  );
  const funding = derivePaycheckFundingPlan(revision, paydays);
  const temporal = derivePaycheckTemporalPlan(revision, paydays);

  if (!funding.ok || !temporal.ok) {
    return {
      status: "no_expected_funding",
      periodKey: revision.periodKey,
      monthlyPlanRevisionId: revision.id,
      schedulesCount: schedules.length,
      expectedPaydayCount: paydays.length,
      uniquePaydayDateCount: 0,
      beforeFirstPayday: [],
      afterFinalPayday: [],
      dateGroups: [],
    };
  }

  if (
    funding.plan.status === "no_expected_funding" ||
    temporal.plan.status === "no_expected_funding" ||
    funding.plan.paydays.length === 0
  ) {
    return {
      status: "no_expected_funding",
      periodKey: revision.periodKey,
      monthlyPlanRevisionId: revision.id,
      schedulesCount: schedules.length,
      expectedPaydayCount: 0,
      uniquePaydayDateCount: 0,
      beforeFirstPayday: [],
      afterFinalPayday: [],
      dateGroups: [],
    };
  }

  const slotsByDate = new Map<string, FundThisMonthFundingSlot[]>();
  for (const slot of funding.plan.paydays) {
    const date = slot.expectedPayday.date;
    const list = slotsByDate.get(date) ?? [];
    list.push({
      expectedPayday: slot.expectedPayday,
      responsibilities: slot.responsibilities,
      plannedResponsibilityTotal: sumResponsibilityAmounts(
        slot.responsibilities
      ),
    });
    slotsByDate.set(date, list);
  }

  const dateGroups: FundThisMonthDateGroup[] = temporal.plan.windows.map(
    (window) => ({
      date: window.paydayDate,
      nextPaydayDate: window.nextPaydayDate,
      fundingSlots: slotsByDate.get(window.paydayDate) ?? [],
      dueOnPayday: window.obligationsDueOnPayday,
      dueBeforeNextPayday: window.obligationsDueBeforeNextPayday,
    })
  );

  return {
    status: "path",
    periodKey: revision.periodKey,
    monthlyPlanRevisionId: revision.id,
    schedulesCount: schedules.length,
    expectedPaydayCount: funding.plan.fundingOpportunityCount,
    uniquePaydayDateCount: temporal.plan.uniquePaydayDates.length,
    beforeFirstPayday: temporal.plan.obligationsDueBeforeFirstPayday,
    afterFinalPayday: temporal.plan.obligationsDueAfterFinalPayday,
    dateGroups,
  };
}

/** Steward-facing purpose label; React must not invent creditor rows. */
export function fundingResponsibilityLabel(
  row: PaycheckFundingResponsibility
): string {
  return row.label;
}

export function formatCivilDateLabel(isoDate: string): string {
  const [year, month, day] = isoDate.split("-").map(Number);
  if (!year || !month || !day) return isoDate;
  return new Date(year, month - 1, day).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });
}

export function cadenceLabel(cadence: PaySchedule["cadence"]): string {
  switch (cadence) {
    case "weekly":
      return "Weekly";
    case "biweekly":
      return "Every two weeks";
    case "semimonthly":
      return "Twice a month";
    case "monthly":
      return "Monthly";
  }
}
