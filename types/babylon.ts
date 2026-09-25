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
  /** Present when this row was generated from a monthly rule. */
  recurringObligationId?: string;
  /** YYYY-MM the rule generated this row for. Identity is this pair, not the name. */
  recurrenceMonth?: string;
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

/** Where manually entered money sits. Not a bank feed and not an income type. */
export type FinancialAccountKind = "checking" | "savings" | "cash";

/**
 * Current balance the user says exists in one place.
 * This is financial position. It is not income and it does not allocate.
 */
export interface FinancialAccount {
  id: string;
  name: string;
  kind: FinancialAccountKind;
  balance: number;
  /** Local calendar date (YYYY-MM-DD) the balance was last known to be accurate. */
  asOf: string;
}

/**
 * Monthly bill the user expects. This is not spending and not an account.
 * Occurrences are ordinary expenses generated from the rule.
 */
export interface RecurringObligation {
  id: string;
  name: string;
  amount: number;
  category: ExpenseKind;
  budgetCategoryId: string;
  /** Calendar day 1–31. Shorter months use the last valid day. The rule stays 31. */
  dueDay: number;
  /** First YYYY-MM that may be generated. Earlier months are not created. */
  startMonth: string;
  isActive: boolean;
  /** Local calendar date the rule was created. */
  createdAt: string;
  /** YYYY-MM keys the user deleted. Those months are not generated again. */
  skippedMonths: string[];
}

export interface FinancialAccountInput {
  name: string;
  kind: FinancialAccountKind;
  balance: number;
  asOf: string;
}

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
  /** Manually entered account balances. Missing on older vaults; never inferred. */
  accounts: FinancialAccount[];
  displayName: string;
  /** Chronological mutation feed for the Command Deck (newest first). */
  activityLog: ActivityEvent[];
  /** Emergency shield reservoir built from Monthly Close surplus. */
  emergencyShield: number;
  /** Historical month-close archives. */
  periodArchives: PeriodArchive[];
  /** Last calendar month key successfully closed (YYYY-MM). */
  lastClosedMonthKey: string | null;
  /**
   * 2 means unsettled expenses are Upcoming.
   * Missing or any other value is the pre-WE-BUDGET-003 vault, where unsettled
   * rows were already counted as spent and must be migrated to paid once.
   */
  expenseSemanticsVersion: number;
  /**
   * Portion of current Money Available already designated for Wealth Building
   * before tracked allocations. Not income and not an allocation event.
   */
  openingWealthBuilding: number;
  /**
   * Portion of current Money Available already designated for the Emergency Fund
   * before tracked month-close surplus. Not an extra balance.
   */
  openingEmergencyFund: number;
  /** Monthly obligation rules. Missing on older vaults; loads as []. */
  recurringObligations: RecurringObligation[];
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
  /** True = Already Paid. False = Upcoming. */
  isSettled: boolean;
  /** Upcoming only. Creates a monthly rule. Already Paid cannot repeat. */
  repeatsMonthly?: boolean;
}

/**
 * Portable ledger snapshot for export / import backups.
 * Version 1 predates Financial Position and has no accounts.
 * Version 2 includes `accounts`. Unsettled expenses in versions 1 and 2 were
 * counted as spent, so import marks them paid.
 * Version 3 keeps Upcoming (`isSettled: false`) as unpaid.
 * Version 4 also stores existing Wealth Building and Emergency Fund
 * designations. Older builds reject version 4 instead of dropping them.
 * Version 5 stores monthly recurring rules and skipped months. Older builds
 * reject version 5 instead of dropping them.
 */
export type LedgerBackupVersion = 1 | 2 | 3 | 4 | 5;

export interface LedgerBackup {
  version: LedgerBackupVersion;
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
  /** Present on versions 2, 3, 4, and 5. Version 1 imports as an empty list. */
  accounts?: FinancialAccount[];
  /** Present on version 4. Earlier versions import as zero. */
  openingWealthBuilding?: number;
  /** Present on version 4. Earlier versions import as zero. Version 5 keeps them. */
  openingEmergencyFund?: number;
  /** Present on version 5. Earlier versions import as an empty list. */
  recurringObligations?: RecurringObligation[];
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
