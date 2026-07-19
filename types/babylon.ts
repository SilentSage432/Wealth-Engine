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
}

export interface DebtEntry {
  id: string;
  creditor: string;
  totalDebt: number;
  remainingDebt: number;
  monthlyAllocation: number;
  createdAt: string;
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
