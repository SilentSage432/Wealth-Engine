import {
  BUDGET_WARNING_PCT,
  DEBT_RATE,
  EXPENDITURE_RATE,
  WEALTH_RATE,
} from "@/lib/babylon/constants";
import type {
  AllocationSplit,
  BudgetCategoryVariance,
  BudgetTarget,
  ChartMonthPoint,
  DebtEntry,
  ExpenseEntry,
  IncomeEntry,
  IncomeInterval,
} from "@/types/babylon";

/** Assumed productive hours per week for labor-equivalent math. */
const WORK_HOURS_PER_WEEK = 40;

export function monthKeyFromDate(isoDate: string): string {
  return isoDate.slice(0, 7);
}

export function formatMonthLabel(monthKey: string): string {
  const [year, month] = monthKey.split("-").map(Number);
  const date = new Date(year, month - 1, 1);
  return date.toLocaleDateString("en-US", { month: "short", year: "2-digit" });
}

export function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

export function roundMoney(value: number): number {
  return Math.round(value * 100) / 100;
}

/** Calendar-day difference: dueDate − today (negative = overdue). */
export function daysUntilDue(dueDate: string, today: string = todayIso()): number {
  const due = Date.parse(`${dueDate}T00:00:00`);
  const now = Date.parse(`${today}T00:00:00`);
  if (!Number.isFinite(due) || !Number.isFinite(now)) return Number.NaN;
  return Math.round((due - now) / 86_400_000);
}

/** Unpaid expense due today through the next 7 days (inclusive). */
export function isDueWithinWeek(
  dueDate: string,
  today: string = todayIso()
): boolean {
  const days = daysUntilDue(dueDate, today);
  return Number.isFinite(days) && days >= 0 && days <= 7;
}

/** Normalize a recurring income amount to a monthly equivalent. One-time excluded. */
export function monthlyIncomeEquivalent(
  amount: number,
  interval: IncomeInterval
): number {
  switch (interval) {
    case "weekly":
      return roundMoney((amount * 52) / 12);
    case "biweekly":
      return roundMoney((amount * 26) / 12);
    case "monthly":
      return roundMoney(amount);
    case "yearly":
      return roundMoney(amount / 12);
    case "one-time":
      return 0;
  }
}

/** Aggregate effective hourly rate from active recurring income streams. */
export function effectiveHourlyRate(incomes: IncomeEntry[]): number {
  const monthly = roundMoney(
    incomes.reduce(
      (sum, entry) =>
        sum + monthlyIncomeEquivalent(entry.amount, entry.interval),
      0
    )
  );
  if (monthly <= 0) return 0;
  const hoursPerMonth = (WORK_HOURS_PER_WEEK * 52) / 12;
  return roundMoney(monthly / hoursPerMonth);
}

/** Labor hours required to fund an amount at the given hourly rate. */
export function laborHoursForAmount(
  amount: number,
  hourlyRate: number
): number | null {
  if (!Number.isFinite(amount) || amount <= 0) return null;
  if (!Number.isFinite(hourlyRate) || hourlyRate <= 0) return null;
  return Math.round((amount / hourlyRate) * 10) / 10;
}

/** Share of remaining desires pool consumed by a prospective purchase. */
export function desiresPoolSharePct(
  amount: number,
  desiresPoolRemaining: number
): number | null {
  if (!Number.isFinite(amount) || amount <= 0) return null;
  if (!Number.isFinite(desiresPoolRemaining) || desiresPoolRemaining <= 0) {
    return null;
  }
  return Math.round((amount / desiresPoolRemaining) * 1000) / 10;
}

export function allocateIncome(
  gross: number,
  hasActiveDebt: boolean
): AllocationSplit {
  const wealthBase = roundMoney(gross * WEALTH_RATE);
  const debtBase = roundMoney(gross * DEBT_RATE);
  const expenditureShare = roundMoney(gross * EXPENDITURE_RATE);

  if (hasActiveDebt) {
    return {
      wealthShare: wealthBase,
      debtShare: debtBase,
      expenditureShare,
      debtRedirected: false,
    };
  }

  return {
    wealthShare: roundMoney(wealthBase + debtBase),
    debtShare: 0,
    expenditureShare,
    debtRedirected: true,
  };
}

export function applyDebtAllocation(
  debts: DebtEntry[],
  amount: number
): DebtEntry[] {
  if (amount <= 0 || debts.length === 0) {
    return debts;
  }

  let remaining = amount;
  const active = debts
    .map((d) => ({ ...d }))
    .sort((a, b) => a.remainingDebt - b.remainingDebt);

  for (const debt of active) {
    if (remaining <= 0) break;
    if (debt.remainingDebt <= 0) continue;
    const applied = Math.min(debt.remainingDebt, remaining);
    debt.remainingDebt = roundMoney(debt.remainingDebt - applied);
    remaining = roundMoney(remaining - applied);
  }

  return active;
}

export function totalRemainingDebt(debts: DebtEntry[]): number {
  return roundMoney(debts.reduce((sum, d) => sum + d.remainingDebt, 0));
}

export function totalOriginalDebt(debts: DebtEntry[]): number {
  return roundMoney(debts.reduce((sum, d) => sum + d.totalDebt, 0));
}

export function buildChartData(
  allocations: Array<{
    monthKey: string;
    gross: number;
    wealth: number;
    debt: number;
    expenditure: number;
  }>
): ChartMonthPoint[] {
  const map = new Map<string, ChartMonthPoint>();

  allocations.forEach((a) => {
    const existing = map.get(a.monthKey);
    if (existing) {
      existing.income = roundMoney(existing.income + a.gross);
      existing.wealth = roundMoney(existing.wealth + a.wealth);
      existing.debt = roundMoney(existing.debt + a.debt);
      existing.expenditure = roundMoney(existing.expenditure + a.expenditure);
    } else {
      map.set(a.monthKey, {
        month: a.monthKey,
        label: formatMonthLabel(a.monthKey),
        income: a.gross,
        wealth: a.wealth,
        debt: a.debt,
        expenditure: a.expenditure,
      });
    }
  });

  return Array.from(map.values()).sort((a, b) => a.month.localeCompare(b.month));
}

/**
 * Groups current-month spend by budget target and computes Planned vs. Actual variance.
 * Expenses without a budgetCategoryId are ignored (except desire soft-migration handled at load).
 */
export function buildBudgetVariances(
  targets: BudgetTarget[],
  monthExpenses: ExpenseEntry[]
): BudgetCategoryVariance[] {
  return targets.map((target) => {
    const actualAmount = roundMoney(
      monthExpenses
        .filter((e) => e.budgetCategoryId === target.id)
        .reduce((sum, e) => sum + e.amount, 0)
    );
    const plannedAmount = roundMoney(Math.max(0, target.plannedAmount));
    const remainingAmount = roundMoney(Math.max(0, plannedAmount - actualAmount));
    const variance = roundMoney(plannedAmount - actualAmount);
    const usedPct =
      plannedAmount <= 0
        ? actualAmount > 0
          ? 100
          : 0
        : Math.min(999, Math.round((actualAmount / plannedAmount) * 100));
    const tone =
      usedPct >= BUDGET_WARNING_PCT ? ("amber" as const) : ("emerald" as const);

    return {
      id: target.id,
      categoryName: target.categoryName,
      plannedAmount,
      actualAmount,
      remainingAmount,
      variance,
      usedPct,
      isEssential: target.isEssential,
      tone,
    };
  });
}
