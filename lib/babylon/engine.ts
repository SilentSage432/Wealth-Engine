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
  DebtFreedomProjection,
  DebtPayoffStrategy,
  ExpenseEntry,
  IncomeEntry,
  IncomeInterval,
  IncomeStreamKind,
  SurplusDisposition,
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

/**
 * Local calendar date as YYYY-MM-DD.
 * Financial "today" follows the user's calendar day, not the UTC day.
 */
export function todayIso(now: Date = new Date()): string {
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

/**
 * Milliseconds until the next local midnight.
 * A 1s floor avoids a tight loop if the clock is already on the boundary.
 * Local hours match `todayIso`; this is not a UTC-day timer.
 */
export function msUntilNextLocalMidnight(now: Date = new Date()): number {
  const next = new Date(now.getTime());
  next.setHours(24, 0, 0, 0);
  return Math.max(1000, next.getTime() - now.getTime());
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

/** Unpaid expense whose due date is before today. */
export function isOverdue(dueDate: string, today: string = todayIso()): boolean {
  const days = daysUntilDue(dueDate, today);
  return Number.isFinite(days) && days < 0;
}

/** Paid expenses only. Upcoming rows are not actual spending. */
export function settledExpenses(
  expenses: readonly ExpenseEntry[]
): ExpenseEntry[] {
  return expenses.filter((expense) => expense.isSettled);
}

function sumExpenseKind(
  expenses: readonly ExpenseEntry[],
  category: ExpenseEntry["category"]
): number {
  return roundMoney(
    expenses
      .filter((expense) => expense.category === category)
      .reduce((sum, expense) => sum + expense.amount, 0)
  );
}

/**
 * Actual spending. Optional monthKey limits the sum to that transaction month.
 * Unsettled expenses are excluded.
 */
export function actualSpendTotals(
  expenses: readonly ExpenseEntry[],
  monthKey?: string
): { need: number; desire: number; total: number } {
  const settled = settledExpenses(expenses).filter((expense) =>
    monthKey ? monthKeyFromDate(expense.date) === monthKey : true
  );
  const need = sumExpenseKind(settled, "need");
  const desire = sumExpenseKind(settled, "desire");
  return { need, desire, total: roundMoney(need + desire) };
}

/** All unpaid Need expenses, regardless of due date or month. */
export function upcomingNeedsTotal(expenses: readonly ExpenseEntry[]): number {
  return roundMoney(
    expenses
      .filter((expense) => !expense.isSettled && expense.category === "need")
      .reduce((sum, expense) => sum + expense.amount, 0)
  );
}

/** Living Budget remaining after actual settled spending. Floors at zero. */
export function livingBudgetRemaining(pool: number, actualSpent: number): number {
  return roundMoney(Math.max(0, pool - Math.max(0, actualSpent)));
}

/**
 * Same row, now paid. `paymentDate` is the local calendar date of payment.
 * The due date is left unchanged and is not used as the spending date.
 */
export function markExpensePaid(
  expense: ExpenseEntry,
  paymentDate: string
): ExpenseEntry {
  return { ...expense, isSettled: true, date: paymentDate };
}

/**
 * Proportionally scale planned caps so their sum equals the 70% expenditure pool.
 * Remainder pennies land on the largest category so the total matches exactly.
 */
export function scaleBudgetCapsToPool(
  targets: BudgetTarget[],
  pool: number
): BudgetTarget[] | null {
  if (targets.length === 0) return null;
  if (!Number.isFinite(pool) || pool < 0) return null;

  const plannedTotal = roundMoney(
    targets.reduce((sum, t) => sum + Math.max(0, t.plannedAmount), 0)
  );
  if (plannedTotal <= 0) return null;

  const factor = pool / plannedTotal;
  const scaled = targets.map((t) => ({
    ...t,
    plannedAmount: roundMoney(Math.max(0, t.plannedAmount) * factor),
  }));

  const scaledSum = roundMoney(
    scaled.reduce((sum, t) => sum + t.plannedAmount, 0)
  );
  const drift = roundMoney(pool - scaledSum);
  if (drift !== 0 && scaled.length > 0) {
    let largestIdx = 0;
    for (let i = 1; i < scaled.length; i += 1) {
      if (scaled[i].plannedAmount > scaled[largestIdx].plannedAmount) {
        largestIdx = i;
      }
    }
    scaled[largestIdx] = {
      ...scaled[largestIdx],
      plannedAmount: roundMoney(
        Math.max(0, scaled[largestIdx].plannedAmount + drift)
      ),
    };
  }

  return scaled;
}

/** Next calendar month key (YYYY-MM). */
export function nextMonthKey(monthKey: string): string {
  const [year, month] = monthKey.split("-").map(Number);
  const date = new Date(year, month, 1);
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  return `${y}-${m}`;
}

/**
 * Split living-allowance surplus into the 10/20 Debt/Wealth multiplier.
 * With active debt: 1/3 wealth, 2/3 debt. Without debt: 100% wealth.
 */
export function splitSurplusToDebtWealth(
  surplus: number,
  hasActiveDebt: boolean
): { wealth: number; debt: number } {
  const amount = roundMoney(Math.max(0, surplus));
  if (amount <= 0) return { wealth: 0, debt: 0 };
  if (!hasActiveDebt) return { wealth: amount, debt: 0 };
  const wealth = roundMoney(amount / 3);
  const debt = roundMoney(amount - wealth);
  return { wealth, debt };
}

/** Equal 50/50 wealth–debt surplus sweep (debt share is 0 when debt-free). */
export function splitSurplusFiftyFifty(
  surplus: number,
  hasActiveDebt: boolean
): { wealth: number; debt: number } {
  const amount = roundMoney(Math.max(0, surplus));
  if (amount <= 0) return { wealth: 0, debt: 0 };
  if (!hasActiveDebt) return { wealth: amount, debt: 0 };
  const wealth = roundMoney(amount / 2);
  const debt = roundMoney(amount - wealth);
  return { wealth, debt };
}

/** Resolve Monthly Close surplus into wealth/debt shares (rollover returns zeros). */
export function resolveSurplusDisposition(
  surplus: number,
  disposition: SurplusDisposition,
  hasActiveDebt: boolean
): { wealth: number; debt: number; shield: number; rollover: number } {
  const amount = roundMoney(Math.max(0, surplus));
  if (amount <= 0) {
    return { wealth: 0, debt: 0, shield: 0, rollover: 0 };
  }
  switch (disposition) {
    case "emergency_shield":
      return { wealth: 0, debt: 0, shield: amount, rollover: 0 };
    case "wealth_boost":
      return { wealth: amount, debt: 0, shield: 0, rollover: 0 };
    case "rollover":
      return { wealth: 0, debt: 0, shield: 0, rollover: amount };
    case "split_50_50": {
      const split = splitSurplusFiftyFifty(amount, hasActiveDebt);
      return { ...split, shield: 0, rollover: 0 };
    }
    case "debt_wealth":
    default: {
      const split = splitSurplusToDebtWealth(amount, hasActiveDebt);
      return { ...split, shield: 0, rollover: 0 };
    }
  }
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
 * Current recurring earning rate, grouped by trimmed income `source`.
 *
 * One-time rows are ignored. Each remaining source contributes only its
 * latest dated recurring deposit (the first row wins when dates tie, which
 * matches the newest-first ledger). That single deposit is converted with
 * `monthlyIncomeEquivalent`. Repeated history of the same source does not
 * stack into additional salaries.
 *
 * `source` is the only stream identity on IncomeEntry. Two simultaneous
 * jobs count separately only when their source names differ. A later
 * one-time deposit under the same name does not replace the recurring rate.
 */
function latestRecurringBySource(incomes: IncomeEntry[]): IncomeEntry[] {
  const chosen = new Map<string, IncomeEntry>();
  for (const entry of incomes) {
    if (entry.interval === "one-time") continue;
    const key = entry.source.trim();
    const current = chosen.get(key);
    if (!current || entry.date > current.date) {
      chosen.set(key, entry);
    }
  }
  return [...chosen.values()];
}

/**
 * Hourly rate used to translate spending into labor.
 * Optionally restrict to specific stream kinds (e.g. primary labor only).
 * See `latestRecurringBySource` for how repeated deposits are collapsed.
 */
export function effectiveHourlyRate(
  incomes: IncomeEntry[],
  kinds?: ReadonlyArray<IncomeStreamKind>
): number {
  const scoped = kinds
    ? incomes.filter((entry) => kinds.includes(entry.kind))
    : incomes;
  const monthly = roundMoney(
    latestRecurringBySource(scoped).reduce(
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

/** Half-up integer division for non-negative numerators. */
function divRoundHalfUp(numerator: number, denominator: number): number {
  return Math.floor((numerator + Math.floor(denominator / 2)) / denominator);
}

/**
 * Split gross into 10/20/70 at cent precision.
 * Nominal shares are half-up rounded in integer cents. Any leftover penny
 * is applied to the 70% expenditure share so the three shares sum to gross.
 * With no active debt, the 20% cents move into wealth and the sum is unchanged.
 */
export function allocateIncome(
  gross: number,
  hasActiveDebt: boolean
): AllocationSplit {
  const grossCents = Math.round(roundMoney(gross) * 100);
  const wealthBps = Math.round(WEALTH_RATE * 100);
  const debtBps = Math.round(DEBT_RATE * 100);
  const expenditureBps = Math.round(EXPENDITURE_RATE * 100);
  const wealthCents = divRoundHalfUp(grossCents * wealthBps, 100);
  const debtCents = divRoundHalfUp(grossCents * debtBps, 100);
  let expenditureCents = divRoundHalfUp(grossCents * expenditureBps, 100);
  expenditureCents += grossCents - (wealthCents + debtCents + expenditureCents);

  const expenditureShare = roundMoney(expenditureCents / 100);
  if (hasActiveDebt) {
    return {
      wealthShare: roundMoney(wealthCents / 100),
      debtShare: roundMoney(debtCents / 100),
      expenditureShare,
      debtRedirected: false,
    };
  }

  return {
    wealthShare: roundMoney((wealthCents + debtCents) / 100),
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
    interestRate: roundMoney(Math.max(0, d.interestRate ?? 0)),
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
 * Only settled expenses count as actual spending. Unsettled rows are upcoming obligations.
 * Expenses without a budgetCategoryId are ignored (except desire soft-migration handled at load).
 */
export function buildBudgetVariances(
  targets: BudgetTarget[],
  monthExpenses: ExpenseEntry[]
): BudgetCategoryVariance[] {
  return targets.map((target) => {
    const actualAmount = roundMoney(
      monthExpenses
        .filter((e) => e.isSettled && e.budgetCategoryId === target.id)
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

const MAX_PAYOFF_MONTHS = 600;

/** Order debts for Snowball (lowest balance) or Avalanche (highest APR). */
export function orderDebtsForStrategy(
  debts: DebtEntry[],
  strategy: DebtPayoffStrategy
): DebtEntry[] {
  const active = debts
    .filter((d) => d.remainingDebt > 0)
    .map((d) => ({ ...d }));
  if (strategy === "snowball") {
    return active.sort((a, b) => a.remainingDebt - b.remainingDebt);
  }
  return active.sort((a, b) => {
    const rateDiff = (b.interestRate ?? 0) - (a.interestRate ?? 0);
    if (rateDiff !== 0) return rateDiff;
    return a.remainingDebt - b.remainingDebt;
  });
}

/**
 * Project debt-free month from minimum payments + monthly 20% firepower + extra tribute.
 * Interest compounds monthly using each debt's APR before payments apply.
 */
export function projectDebtFreedom(
  debts: DebtEntry[],
  monthlyDebtBudget: number,
  extraTribute: number,
  strategy: DebtPayoffStrategy,
  startMonthKey: string
): DebtFreedomProjection {
  const ordered = orderDebtsForStrategy(debts, strategy);
  const orderedDebtIds = ordered.map((d) => d.id);

  if (ordered.length === 0) {
    return {
      strategy,
      debtFreeMonthKey: startMonthKey,
      debtFreeLabel: formatMonthLabel(startMonthKey),
      monthsRemaining: 0,
      totalInterestPaid: 0,
      orderedDebtIds,
    };
  }

  const balances = new Map(
    ordered.map((d) => [d.id, roundMoney(Math.max(0, d.remainingDebt))])
  );
  const rates = new Map(
    ordered.map((d) => [d.id, Math.max(0, d.interestRate ?? 0) / 100 / 12])
  );
  const mins = new Map(
    ordered.map((d) => [d.id, roundMoney(Math.max(0, d.monthlyAllocation))])
  );

  const firepower = roundMoney(
    Math.max(0, monthlyDebtBudget) + Math.max(0, extraTribute)
  );
  let monthKey = startMonthKey;
  let months = 0;
  let totalInterestPaid = 0;

  while (months < MAX_PAYOFF_MONTHS) {
    let remainingTotal = 0;
    for (const bal of balances.values()) remainingTotal += bal;
    if (remainingTotal <= 0.009) break;

    // Accrue interest
    for (const id of orderedDebtIds) {
      const bal = balances.get(id) ?? 0;
      if (bal <= 0) continue;
      const interest = roundMoney(bal * (rates.get(id) ?? 0));
      totalInterestPaid = roundMoney(totalInterestPaid + interest);
      balances.set(id, roundMoney(bal + interest));
    }

    let budget = firepower;
    // Minimums first (in strategy order)
    for (const id of orderedDebtIds) {
      if (budget <= 0) break;
      const bal = balances.get(id) ?? 0;
      if (bal <= 0) continue;
      const minPay = Math.min(bal, mins.get(id) ?? 0, budget);
      balances.set(id, roundMoney(bal - minPay));
      budget = roundMoney(budget - minPay);
    }
    // Extra to priority target (first with balance)
    for (const id of orderedDebtIds) {
      if (budget <= 0) break;
      const bal = balances.get(id) ?? 0;
      if (bal <= 0) continue;
      const pay = Math.min(bal, budget);
      balances.set(id, roundMoney(bal - pay));
      budget = roundMoney(budget - pay);
      break;
    }

    months += 1;
    monthKey = nextMonthKey(monthKey);
  }

  if (months >= MAX_PAYOFF_MONTHS) {
    return {
      strategy,
      debtFreeMonthKey: null,
      debtFreeLabel: null,
      monthsRemaining: null,
      totalInterestPaid,
      orderedDebtIds,
    };
  }

  const freeKey = monthKey;
  return {
    strategy,
    debtFreeMonthKey: freeKey,
    debtFreeLabel: formatMonthLabel(freeKey),
    monthsRemaining: months,
    totalInterestPaid,
    orderedDebtIds,
  };
}
