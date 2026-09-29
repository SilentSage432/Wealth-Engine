/**
 * Expected Pay Schedule — steward-authored timing for future income.
 *
 * Expected Payday ≠ received Income.
 * Derivation is pure. Occurrences are not persisted.
 * Schedules do not allocate, mutate position, or create ledger history.
 */

import { isCivilIsoDate, lastCivilDayOfMonth } from "@/lib/babylon/attention";
import { monthKeyFromDate, roundMoney } from "@/lib/babylon/engine";
import { dueDateForMonth } from "@/lib/babylon/recurring-obligations";
import type {
  PaySchedule,
  PayScheduleCadence,
  ExpectedPayday,
  SemimonthlyMonthDay,
} from "@/types/babylon";

const PERIOD_KEY = /^\d{4}-\d{2}$/;

export const PAY_SCHEDULE_CADENCES = [
  "weekly",
  "biweekly",
  "semimonthly",
  "monthly",
] as const satisfies readonly PayScheduleCadence[];

export function isPayScheduleCadence(value: unknown): value is PayScheduleCadence {
  return (
    value === "weekly" ||
    value === "biweekly" ||
    value === "semimonthly" ||
    value === "monthly"
  );
}

/** Civil YYYY-MM-DD plus whole days. Invalid input → null. */
export function addCivilDays(isoDate: string, days: number): string | null {
  if (!isCivilIsoDate(isoDate) || !Number.isInteger(days)) return null;
  const year = Number(isoDate.slice(0, 4));
  const month = Number(isoDate.slice(5, 7));
  const day = Number(isoDate.slice(8, 10));
  const utc = new Date(Date.UTC(year, month - 1, day));
  if (
    utc.getUTCFullYear() !== year ||
    utc.getUTCMonth() !== month - 1 ||
    utc.getUTCDate() !== day
  ) {
    return null;
  }
  utc.setUTCDate(utc.getUTCDate() + days);
  return utc.toISOString().slice(0, 10);
}

function civilDayNumber(isoDate: string): number | null {
  if (!isCivilIsoDate(isoDate)) return null;
  const year = Number(isoDate.slice(0, 4));
  const month = Number(isoDate.slice(5, 7));
  const day = Number(isoDate.slice(8, 10));
  return Math.floor(Date.UTC(year, month - 1, day) / 86_400_000);
}

function isoFromCivilDayNumber(dayNumber: number): string | null {
  if (!Number.isInteger(dayNumber)) return null;
  const utc = new Date(dayNumber * 86_400_000);
  const iso = utc.toISOString().slice(0, 10);
  return isCivilIsoDate(iso) ? iso : null;
}

function isMonthDay(value: number): boolean {
  return Number.isInteger(value) && value >= 1 && value <= 31;
}

function resolveMonthDay(
  day: SemimonthlyMonthDay,
  periodKey: string
): string | null {
  if (day === "last") return lastCivilDayOfMonth(periodKey);
  if (!isMonthDay(day)) return null;
  const iso = dueDateForMonth(day, periodKey);
  return isCivilIsoDate(iso) ? iso : null;
}

function orderedUniqueDates(dates: readonly string[]): string[] {
  return [...new Set(dates)].sort();
}

function withOptionalMeta(
  base: Omit<ExpectedPayday, "expectedAmount" | "label">,
  schedule: PaySchedule
): ExpectedPayday {
  const row: ExpectedPayday = { ...base };
  if (schedule.expectedAmount !== undefined) {
    row.expectedAmount = schedule.expectedAmount;
  }
  if (schedule.label !== undefined) {
    row.label = schedule.label;
  }
  return row;
}

/**
 * Anchor is a recurrence PHASE reference for the 7/14-day lattice.
 * It is not a hard schedule-start cutoff: months before the anchor are
 * derived from the same lattice.
 */
function deriveSteppedPaydays(
  schedule: Extract<PaySchedule, { cadence: "weekly" | "biweekly" }>,
  periodKey: string,
  stepDays: 7 | 14
): ExpectedPayday[] {
  const first = `${periodKey}-01`;
  const last = lastCivilDayOfMonth(periodKey);
  if (!last || !isCivilIsoDate(first)) return [];
  const firstNum = civilDayNumber(first);
  const lastNum = civilDayNumber(last);
  const anchorNum = civilDayNumber(schedule.anchorDate);
  if (firstNum === null || lastNum === null || anchorNum === null) return [];

  const mod = ((firstNum - anchorNum) % stepDays + stepDays) % stepDays;
  const startNum = mod === 0 ? firstNum : firstNum + (stepDays - mod);
  const dates: string[] = [];
  for (let dayNum = startNum; dayNum <= lastNum; dayNum += stepDays) {
    const iso = isoFromCivilDayNumber(dayNum);
    if (!iso) continue;
    if (monthKeyFromDate(iso) !== periodKey) continue;
    dates.push(iso);
  }
  return orderedUniqueDates(dates).map((date) =>
    withOptionalMeta(
      {
        scheduleId: schedule.id,
        date,
        periodKey,
      },
      schedule
    )
  );
}

function deriveSemimonthlyPaydays(
  schedule: Extract<PaySchedule, { cadence: "semimonthly" }>,
  periodKey: string
): ExpectedPayday[] {
  const first = resolveMonthDay(schedule.firstDay, periodKey);
  const second = resolveMonthDay(schedule.secondDay, periodKey);
  if (!first || !second) return [];
  return orderedUniqueDates([first, second]).map((date) =>
    withOptionalMeta(
      {
        scheduleId: schedule.id,
        date,
        periodKey,
      },
      schedule
    )
  );
}

function deriveMonthlyPaydays(
  schedule: Extract<PaySchedule, { cadence: "monthly" }>,
  periodKey: string
): ExpectedPayday[] {
  const date = resolveMonthDay(schedule.dayOfMonth, periodKey);
  if (!date) return [];
  return [
    withOptionalMeta(
      {
        scheduleId: schedule.id,
        date,
        periodKey,
      },
      schedule
    ),
  ];
}

/**
 * Derive ExpectedPayday occurrences whose civil dates belong to periodKey.
 * Pure. No writes. Does not create Income or Allocation.
 */
export function deriveExpectedPaydays(
  schedule: PaySchedule,
  periodKey: string
): ExpectedPayday[] {
  if (!PERIOD_KEY.test(periodKey)) return [];
  if (!isValidPaySchedule(schedule)) return [];
  switch (schedule.cadence) {
    case "weekly":
      return deriveSteppedPaydays(schedule, periodKey, 7);
    case "biweekly":
      return deriveSteppedPaydays(schedule, periodKey, 14);
    case "semimonthly":
      return deriveSemimonthlyPaydays(schedule, periodKey);
    case "monthly":
      return deriveMonthlyPaydays(schedule, periodKey);
  }
}

/** Derive and merge occurrences for many schedules. Sorted by date, then id. */
export function deriveExpectedPaydaysForSchedules(
  schedules: readonly PaySchedule[],
  periodKey: string
): ExpectedPayday[] {
  const rows: ExpectedPayday[] = [];
  for (const schedule of schedules) {
    rows.push(...deriveExpectedPaydays(schedule, periodKey));
  }
  return rows.sort((left, right) => {
    if (left.date !== right.date) return left.date < right.date ? -1 : 1;
    return left.scheduleId < right.scheduleId ? -1 : left.scheduleId > right.scheduleId ? 1 : 0;
  });
}

function parseOptionalAmount(value: unknown): number | undefined | "invalid" {
  if (value === undefined || value === null) return undefined;
  if (!Number.isFinite(value) || (value as number) <= 0) return "invalid";
  return roundMoney(value as number);
}

function parseOptionalLabel(value: unknown): string | undefined | "invalid" {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "string") return "invalid";
  const trimmed = value.trim();
  if (!trimmed) return "invalid";
  return trimmed;
}

function parseSemimonthlyDay(value: unknown): SemimonthlyMonthDay | null {
  if (value === "last") return "last";
  if (typeof value === "number" && isMonthDay(value)) return value;
  return null;
}

/** Structural + semantic validation. */
export function isValidPaySchedule(value: unknown): value is PaySchedule {
  return parsePaySchedule(value) !== null;
}

/**
 * Parse a steward PaySchedule rule. Malformed → null.
 * expectedAmount if present must be finite and > 0.
 */
export function parsePaySchedule(raw: unknown): PaySchedule | null {
  if (!raw || typeof raw !== "object") return null;
  const value = raw as Record<string, unknown>;
  if (typeof value.id !== "string" || !value.id.trim()) return null;
  if (typeof value.createdAt !== "string" || !isCivilIsoDate(value.createdAt)) {
    return null;
  }
  if (!isPayScheduleCadence(value.cadence)) return null;

  const expectedAmount = parseOptionalAmount(value.expectedAmount);
  if (expectedAmount === "invalid") return null;
  const label = parseOptionalLabel(value.label);
  if (label === "invalid") return null;

  const base = {
    id: value.id.trim(),
    createdAt: value.createdAt,
    ...(expectedAmount !== undefined ? { expectedAmount } : {}),
    ...(label !== undefined ? { label } : {}),
  };

  if (value.cadence === "weekly" || value.cadence === "biweekly") {
    if (typeof value.anchorDate !== "string" || !isCivilIsoDate(value.anchorDate)) {
      return null;
    }
    return {
      ...base,
      cadence: value.cadence,
      anchorDate: value.anchorDate,
    };
  }

  if (value.cadence === "monthly") {
    if (typeof value.dayOfMonth !== "number" || !isMonthDay(value.dayOfMonth)) {
      return null;
    }
    return {
      ...base,
      cadence: "monthly",
      dayOfMonth: value.dayOfMonth,
    };
  }

  // semimonthly
  const firstDay = parseSemimonthlyDay(value.firstDay);
  const secondDay = parseSemimonthlyDay(value.secondDay);
  if (firstDay === null || secondDay === null) return null;
  // Two numeric days must not be identical; last+last collapses to one day (allowed).
  if (
    typeof firstDay === "number" &&
    typeof secondDay === "number" &&
    firstDay === secondDay
  ) {
    return null;
  }
  return {
    ...base,
    cadence: "semimonthly",
    firstDay,
    secondDay,
  };
}
