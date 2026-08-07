export type IncomeInterval =
  | "one-time"
  | "weekly"
  | "biweekly"
  | "monthly"
  | "yearly";

/** Classification for growth-focused multi-income tracking. */
export type IncomeStreamKind =
  | "primary"
  | "side_hustle"
  | "passive"
  | "other";

export type ExpenseKind = "need" | "desire";

export type TributeMode = "income" | "expense" | "debt" | "budget";

export type NavSection = "overview" | "ledgers" | "wisdom";

export type ExpenditureBarTone = "emerald" | "amber" | "crimson";

export type BudgetBarTone = "emerald" | "amber";

/** Planned cap for a Necessary Expenditures (70%) operational bucket. */
export interface BudgetTarget {
  id: string;
  categoryName: string;
  plannedAmount: number;
  isEssential: boolean;
}

/** Derived Planned vs. Actual snapshot for the current month. */
export interface BudgetCategoryVariance {
  id: string;
  categoryName: string;
  plannedAmount: number;
  actualAmount: number;
  remainingAmount: number;
  /** Planned − Actual (positive = under cap). */
  variance: number;
  usedPct: number;
  isEssential: boolean;
  tone: BudgetBarTone;
}

export interface IncomeEntry {
  id: string;
  source: string;
  amount: number;
  date: string;
  interval: IncomeInterval;
  /** Growth engine classification — legacy rows soft-migrate to primary. */
  kind: IncomeStreamKind;
  wealthShare: number;
  debtShare: number;
  expenditureShare: number;
  debtRedirected: boolean;
}

export interface ExpenseEntry {
  id: string;
  name: string;
  category: ExpenseKind;
  amount: number;
  date: string;
  /** ISO date (YYYY-MM-DD) when payment is due. */
  dueDate: string;
  /** Links spend to a BudgetTarget within the 70% expenditure boundary. */
  budgetCategoryId?: string;
  /**
   * Whether the bill is paid/settled.
   * Legacy payloads without the field soft-migrate to `true`.
   */
  isSettled: boolean;
}

/**
 * Surplus disposition chosen during the Monthly Close Ritual.
 * - debt_wealth: legacy ⅓ wealth / ⅔ debt (archives may still carry this)
 * - emergency_shield: tuck into shield reservoir
 * - split_50_50: equal wealth / debt sweep
 * - wealth_boost: 100% wealth archive
 * - rollover: carry unused 70% into next month's expenditure pool
 */
export type SurplusDisposition =
  | "debt_wealth"
  | "emergency_shield"
  | "split_50_50"
  | "wealth_boost"
  | "rollover";

/** Debt payoff strategy for the Freedom Date engine. */
export type DebtPayoffStrategy = "snowball" | "avalanche";

/** Lightweight Command Deck activity feed item. */
export type ActivityKind =
  | "income"
  | "expense"
  | "budget"
  | "settle"
  | "close";

export interface ActivityEvent {
  id: string;
  kind: ActivityKind;
  title: string;
  subtitle?: string;
  amount?: number;
  /** Present for income rows — drives stream-specific icons. */
  streamKind?: IncomeStreamKind;
  /** ISO datetime when the mutation occurred. */
  createdAt: string;
}

/** Archived snapshot produced by the Monthly Close Ritual. */
export interface PeriodArchive {
  id: string;
  monthKey: string;
  closedAt: string;
  totalIncome: number;
  totalSpent: number;
  wealthAllocated: number;
  debtAllocated: number;
  expenditurePool: number;
  expenditureRemaining: number;
  surplusDisposition: SurplusDisposition;
  surplusAmount: number;
}

/** Step-1 summary for the closing calendar month. */
export interface MonthlyCloseSummary {
  monthKey: string;
  monthLabel: string;
  totalIncome: number;
  totalSpent: number;
  wealthAllocated: number;
  debtAllocated: number;
  expenditurePool: number;
  expenditureRemaining: number;
  /** Positive = surplus in 70% pool; negative = overspend. */
  surplusOrDeficit: number;
  alreadyClosed: boolean;
}

export interface DebtEntry {
  id: string;
  creditor: string;
  totalDebt: number;
  remainingDebt: number;
  monthlyAllocation: number;
  createdAt: string;
  /** Annual percentage rate (0–100). Soft-migrates to 0 when absent. */
  interestRate: number;
}

export interface AllocationEvent {
  id: string;
  incomeId: string;
  date: string;
  monthKey: string;
  gross: number;
  wealth: number;
  debt: number;
  expenditure: number;
}

export interface PersistedState {
  incomes: IncomeEntry[];
  expenses: ExpenseEntry[];
  debts: DebtEntry[];
  allocations: AllocationEvent[];
  budgetTargets: BudgetTarget[];
  displayName: string;
  /** Chronological mutation feed for the Command Deck (newest first). */
  activityLog: ActivityEvent[];
  /** Emergency shield reservoir built from Monthly Close surplus. */
  emergencyShield: number;
  /** Historical month-close archives. */
  periodArchives: PeriodArchive[];
  /** Last calendar month key successfully closed (YYYY-MM). */
  lastClosedMonthKey: string | null;
}

export interface ChartMonthPoint {
  month: string;
  label: string;
  income: number;
  wealth: number;
  debt: number;
  expenditure: number;
}

export interface SparkPoint {
  index: number;
  value: number;
}

export interface DonutSlice {
  name: string;
  value: number;
  color: string;
}

export interface IncomeInput {
  source: string;
  amount: number;
  date: string;
  interval: IncomeInterval;
  kind: IncomeStreamKind;
}

export interface ExpenseInput {
  name: string;
  amount: number;
  date: string;
  dueDate: string;
  category: ExpenseKind;
  budgetCategoryId: string;
}

/** Portable ledger snapshot for export / import backups. */
export interface LedgerBackup {
  version: 1;
  exportedAt: string;
  incomes: IncomeEntry[];
  expenses: ExpenseEntry[];
  debts: DebtEntry[];
  allocations: AllocationEvent[];
  budgetTargets: BudgetTarget[];
  displayName: string;
  activityLog?: ActivityEvent[];
  emergencyShield?: number;
  periodArchives?: PeriodArchive[];
  lastClosedMonthKey?: string | null;
}

export interface AffordabilitySnapshot {
  /** Unspent discretionary slice of the current-month 70% pool. */
  desiresPoolRemaining: number;
  /** Effective hourly rate from primary recurring labor streams. */
  hourlyLaborRate: number;
}

export interface DebtInput {
  creditor: string;
  totalDebt: number;
  monthlyAllocation: number;
  /** Optional APR % for Avalanche ordering; defaults to 0. */
  interestRate?: number;
}

/** Projected debt freedom snapshot from domain payoff math. */
export interface DebtFreedomProjection {
  strategy: DebtPayoffStrategy;
  debtFreeMonthKey: string | null;
  debtFreeLabel: string | null;
  monthsRemaining: number | null;
  totalInterestPaid: number;
  orderedDebtIds: string[];
}

export interface AllocationSplit {
  wealthShare: number;
  debtShare: number;
  expenditureShare: number;
  debtRedirected: boolean;
}

/** Per-kind revenue pulse for the Tribute Engines scoreboard. */
export interface TributeEngineKindRow {
  kind: IncomeStreamKind;
  amount: number;
  pctOfMonth: number;
  /** Month-over-month % change vs prior calendar month; null if no prior base. */
  momPct: number | null;
}

export interface TributeEngineSnapshot {
  monthKey: string;
  monthTotal: number;
  primaryAmount: number;
  secondaryAmount: number;
  primaryPct: number;
  secondaryPct: number;
  byKind: TributeEngineKindRow[];
}
