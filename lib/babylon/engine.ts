import {
  BUDGET_WARNING_PCT,
  DEBT_RATE,
  EXPENDITURE_RATE,
  STREAM_KIND_ORDER,
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
  IncomeStreamKind,
  TributeEngineKindRow,
  TributeEngineSnapshot,
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

/** Previous calendar month key (YYYY-MM). */
export function previousMonthKey(monthKey: string): string {
  const [year, month] = monthKey.split("-").map(Number);
  const date = new Date(year, month - 2, 1);
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  return `${y}-${m}`;
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

/**
 * Aggregate effective hourly rate from recurring income streams.
 * Optionally restrict to specific stream kinds (e.g. primary labor only).
 */
export function effectiveHourlyRate(
  incomes: IncomeEntry[],
  kinds?: ReadonlyArray<IncomeStreamKind>
): number {
  const scoped = kinds
    ? incomes.filter((entry) => kinds.includes(entry.kind))
    : incomes;
  const monthly = roundMoney(
    scoped.reduce(
      (sum, entry) =>
        sum + monthlyIncomeEquivalent(entry.amount, entry.interval),
      0
    )
  );
  if (monthly <= 0) return 0;
  const hoursPerMonth = (WORK_HOURS_PER_WEEK * 52) / 12;
  return roundMoney(monthly / hoursPerMonth);
}

/** Primary labor hourly rate — excludes side hustles, passive, and other. */
export function primaryHourlyRate(incomes: IncomeEntry[]): number {
  return effectiveHourlyRate(incomes, ["primary"]);
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

/**
 * Unspent discretionary slice of the current-month 70% pool.
 * Needs reserve the greater of actual need spend and essential planned caps;
 * desires draw from what remains.
 */
export function computeDesiresPoolRemaining(
  monthExpenditurePool: number,
  monthNeedSpend: number,
  monthDesireSpend: number,
  essentialPlannedTotal: number
): number {
  const needsReservation = Math.max(
    Math.max(0, monthNeedSpend),
    Math.max(0, essentialPlannedTotal)
  );
  const discretionaryCap = Math.max(
    0,
    monthExpenditurePool - needsReservation
  );
  return roundMoney(Math.max(0, discretionaryCap - Math.max(0, monthDesireSpend)));
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

/** Ensure remainingDebt stays within [0, totalDebt]. */
export function clampDebtBalances(debts: DebtEntry[]): DebtEntry[] {
  return debts.map((d) => ({
    ...d,
    totalDebt: roundMoney(Math.max(0, d.totalDebt)),
    remainingDebt: roundMoney(
      Math.min(Math.max(0, d.totalDebt), Math.max(0, d.remainingDebt))
    ),
    monthlyAllocation: roundMoney(Math.max(0, d.monthlyAllocation)),
  }));
}

export function applyDebtAllocation(
  debts: DebtEntry[],
  amount: number
): DebtEntry[] {
  if (amount <= 0 || debts.length === 0) {
    return clampDebtBalances(debts);
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

  return clampDebtBalances(active);
}

/**
 * Reverse a prior debt waterfall application by restoring remaining balances
 * (most-cleared creditors first), never exceeding totalDebt.
 */
export function reverseDebtAllocation(
  debts: DebtEntry[],
  amount: number
): DebtEntry[] {
  if (amount <= 0 || debts.length === 0) {
    return clampDebtBalances(debts);
  }

  let remaining = amount;
  const active = debts.map((d) => ({ ...d }));
  const ordered = [...active].sort((a, b) => {
    const clearedA = a.totalDebt - a.remainingDebt;
    const clearedB = b.totalDebt - b.remainingDebt;
    return clearedB - clearedA;
  });

  for (const debt of ordered) {
    if (remaining <= 0) break;
    const room = roundMoney(Math.max(0, debt.totalDebt - debt.remainingDebt));
    if (room <= 0) continue;
    const restored = Math.min(room, remaining);
    debt.remainingDebt = roundMoney(debt.remainingDebt + restored);
    remaining = roundMoney(remaining - restored);
  }

  return clampDebtBalances(active);
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

function sumIncomeByKind(
  incomes: IncomeEntry[],
  monthKey: string
): Record<IncomeStreamKind, number> {
  const totals: Record<IncomeStreamKind, number> = {
    primary: 0,
    side_hustle: 0,
    passive: 0,
    other: 0,
  };
  for (const entry of incomes) {
    if (monthKeyFromDate(entry.date) !== monthKey) continue;
    totals[entry.kind] = roundMoney(totals[entry.kind] + entry.amount);
  }
  return totals;
}

/** Build the Tribute Engines scoreboard for a calendar month. */
export function buildTributeEngineSnapshot(
  incomes: IncomeEntry[],
  monthKey: string
): TributeEngineSnapshot {
  const current = sumIncomeByKind(incomes, monthKey);
  const prior = sumIncomeByKind(incomes, previousMonthKey(monthKey));
  const monthTotal = roundMoney(
    STREAM_KIND_ORDER.reduce((sum, kind) => sum + current[kind], 0)
  );
  const primaryAmount = current.primary;
  const secondaryAmount = roundMoney(monthTotal - primaryAmount);

  const byKind: TributeEngineKindRow[] = STREAM_KIND_ORDER.map((kind) => {
    const amount = current[kind];
    const priorAmount = prior[kind];
    const pctOfMonth =
      monthTotal <= 0 ? 0 : Math.round((amount / monthTotal) * 1000) / 10;
    let momPct: number | null = null;
    if (priorAmount > 0) {
      momPct = Math.round(((amount - priorAmount) / priorAmount) * 1000) / 10;
    } else if (amount > 0 && priorAmount === 0) {
      momPct = null; // new engine — no prior base to percentage
    }
    return { kind, amount, pctOfMonth, momPct };
  });

  return {
    monthKey,
    monthTotal,
    primaryAmount,
    secondaryAmount,
    primaryPct:
      monthTotal <= 0
        ? 0
        : Math.round((primaryAmount / monthTotal) * 1000) / 10,
    secondaryPct:
      monthTotal <= 0
        ? 0
        : Math.round((secondaryAmount / monthTotal) * 1000) / 10,
    byKind,
  };
}
