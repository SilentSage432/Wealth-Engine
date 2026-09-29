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
 * Steward-defined meaning of a FinancialAccount.
 * Absent = ordinary liquid money. Not inferred from kind, Plaid, or transfers.
 */
export type FinancialAccountPurpose =
  | "wealth_building"
  | "emergency_fund";

/**
 * Steward cadence for expected income timing.
 * Distinct from IncomeEntry.interval (rate metadata only).
 */
export type PayScheduleCadence =
  | "weekly"
  | "biweekly"
  | "semimonthly"
  | "monthly";

/** Day-of-month for semimonthly / monthly schedules. "last" = final civil day. */
export type SemimonthlyMonthDay = number | "last";

interface PayScheduleBase {
  id: string;
  /** Local civil date the rule was created (YYYY-MM-DD). */
  createdAt: string;
  /**
   * Optional planning estimate for each expected occurrence.
   * Not Income. Not Position. Omitted when unknown.
   */
  expectedAmount?: number;
  /**
   * Optional steward label / source hint (e.g. "Lowe's").
   * Descriptive only. Never implies identity with an IncomeEntry.
   */
  label?: string;
}

/**
 * Weekly lattice. anchorDate is recurrence PHASE, not a hard start cutoff.
 * Months before the anchor are derived from the same 7-day lattice.
 */
export interface WeeklyPaySchedule extends PayScheduleBase {
  cadence: "weekly";
  anchorDate: string;
}

/** Biweekly lattice (every 14 civil days). Same phase semantics as weekly. */
export interface BiweeklyPaySchedule extends PayScheduleBase {
  cadence: "biweekly";
  anchorDate: string;
}

/**
 * Two steward-defined civil days within each month.
 * Not biweekly. Weekend/holiday stays on the declared civil day.
 */
export interface SemimonthlyPaySchedule extends PayScheduleBase {
  cadence: "semimonthly";
  firstDay: SemimonthlyMonthDay;
  secondDay: SemimonthlyMonthDay;
}

/**
 * One steward-defined civil day per month.
 * Day 31 clamps to the month's last civil day (same as obligation dueDay).
 */
export interface MonthlyPaySchedule extends PayScheduleBase {
  cadence: "monthly";
  dayOfMonth: number;
}

/** Steward-authored expected-pay rule. Not IncomeEntry. */
export type PaySchedule =
  | WeeklyPaySchedule
  | BiweeklyPaySchedule
  | SemimonthlyPaySchedule
  | MonthlyPaySchedule;

/**
 * Derived expected occurrence for one civil date in a period.
 * Not IncomeEntry. Not persisted. Not interchangeable with recorded income.
 */
export interface ExpectedPayday {
  scheduleId: string;
  /** Civil ISO date (YYYY-MM-DD). */
  date: string;
  /** YYYY-MM of date. */
  periodKey: string;
  expectedAmount?: number;
  label?: string;
}

/**
 * Kind of monthly purpose decomposed across expected paydays.
 * Living uses category identity. Wealth / Debt use the plan's canonical shares.
 */
export type PaycheckFundingPurposeKind = "living" | "wealth" | "debt";

/**
 * One finalized monthly purpose extracted for paycheck funding derivation.
 * Not an AllocationEvent. Not Income. Derived provenance only.
 */
export type MonthlyFundingPurpose =
  | {
      kind: "living";
      /** Budget category id from MonthlyPlanCategoryPurpose.id. */
      purposeId: string;
      label: string;
      monthlyPlannedAmount: number;
    }
  | {
      kind: "wealth";
      purposeId: "wealth";
      label: "Wealth Building";
      monthlyPlannedAmount: number;
    }
  | {
      kind: "debt";
      purposeId: "debt";
      label: "Debt Payoff";
      /** Aggregate debtShare. Not per-creditor monthlyAllocation. */
      monthlyPlannedAmount: number;
    };

/**
 * Portion of one monthly purpose belonging to one expected funding slot.
 * Planning arithmetic only. Not an AllocationEvent.
 */
export interface PaycheckFundingResponsibility {
  purposeKind: PaycheckFundingPurposeKind;
  purposeId: string;
  label: string;
  monthlyPlannedAmount: number;
  amount: number;
  scheduleId: string;
  date: string;
  periodKey: string;
}

/** One ordered expected payday with its derived responsibilities. */
export interface PaycheckFundingPaydaySlot {
  expectedPayday: ExpectedPayday;
  responsibilities: PaycheckFundingResponsibility[];
}

/**
 * Derived temporal decomposition of a finalized MonthlyPlanRevision
 * across ExpectedPayday occurrences in the same period.
 * Not persisted. Not Income. Not Allocation.
 */
export interface PaycheckFundingPlan {
  periodKey: string;
  monthlyPlanRevisionId: string;
  /**
   * "decomposed" when N >= 1.
   * "no_expected_funding" when the plan exists but the period has zero
   * expected funding opportunities (UNKNOWN temporal funding).
   */
  status: "decomposed" | "no_expected_funding";
  fundingOpportunityCount: number;
  purposes: MonthlyFundingPurpose[];
  paydays: PaycheckFundingPaydaySlot[];
}

/**
 * Temporal relationship between a finalized monthly obligation and
 * expected civil payday dates. Describes TIME only — not funding,
 * priority, payment, or execution.
 */
export type PaycheckTemporalRelationship =
  | "due_before_first_payday"
  | "due_on_payday"
  | "due_before_next_payday"
  | "due_after_final_payday";

/**
 * One obligation placed relative to expected payday civil dates.
 * Not a funding assignment. Not settlement. Not an AllocationEvent.
 */
export interface TemporalObligationFact {
  obligationId: string;
  label: string;
  amount: number;
  dueDate: string;
  /** Need/Want from plan evidence. Context only — never prioritizes funding. */
  category: ExpenseKind;
  budgetCategoryId: string;
  relationship: PaycheckTemporalRelationship;
  /**
   * Civil payday date this fact anchors to when relationship is
   * due_on_payday or due_before_next_payday.
   */
  paydayDate?: string;
  /** Present when relationship is due_before_next_payday. */
  nextPaydayDate?: string;
}

/**
 * One unique civil payday date and the obligations temporally related to it.
 * Windows are keyed by civil date, not funding-opportunity identity.
 */
export interface PaydayTemporalWindow {
  paydayDate: string;
  periodKey: string;
  /** All ExpectedPayday occurrences on this civil date (provenance). */
  paydayOccurrences: ExpectedPayday[];
  /** Next distinct civil payday date in-period, or null if final. */
  nextPaydayDate: string | null;
  obligationsDueOnPayday: TemporalObligationFact[];
  obligationsDueBeforeNextPayday: TemporalObligationFact[];
}

/**
 * Derived temporal classification of finalized monthly obligation evidence
 * against same-period ExpectedPayday civil dates.
 * Not persisted. Does not mutate PaycheckFundingPlan.
 */
export interface PaycheckTemporalPlan {
  periodKey: string;
  monthlyPlanRevisionId: string;
  /**
   * "classified" when at least one unique civil payday date exists.
   * "no_expected_funding" when zero ExpectedPaydays — no temporal windows.
   */
  status: "classified" | "no_expected_funding";
  uniquePaydayDates: string[];
  obligationsDueBeforeFirstPayday: TemporalObligationFact[];
  windows: PaydayTemporalWindow[];
  obligationsDueAfterFinalPayday: TemporalObligationFact[];
}

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
  /**
   * Steward purpose for this liquid place. Optional for legacy vaults.
   * At most one protected purpose. Not proof of movement or allocation execution.
   */
  purpose?: FinancialAccountPurpose;
  /**
   * Steward-declared amount of this account's owned position that is presently
   * unavailable for deployment. Optional. Not purpose, debt, movement, or
   * Plaid available. Zero is omitted.
   */
  restrictedAmount?: number;
}

/**
 * Declared bill the user expects. This is not spending and not an account.
 * Occurrences are ordinary expenses generated from the rule.
 * A missing interval is monthly. This is not a spending cap or a reserve.
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
  /**
   * Calendar months between due occurrences, anchored at startMonth.
   * Absent means 1. A month that is not due is not a skipped month.
   */
  intervalMonths?: number;
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
  /** Optional. Absent or zero clears restriction. */
  restrictedAmount?: number;
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

/**
 * One category purpose copied onto a finalized Monthly Plan.
 * Same fields as a BudgetTarget. Later edits to the live cap do not rewrite it.
 */
export interface MonthlyPlanCategoryPurpose {
  id: string;
  categoryName: string;
  plannedAmount: number;
  isEssential: boolean;
}

/**
 * Debt intent copied at finalization.
 * monthlyAllocation is the minimum the steward had entered.
 * It is not a second pool beside the canonical debt share.
 * remainingDebt is the balance at finalization, not a payment order.
 */
export interface MonthlyPlanDebtIntent {
  id: string;
  creditor: string;
  monthlyAllocation: number;
  remainingDebt: number;
}

/**
 * A recurring rule that was due in the plan's period, copied at finalization.
 * intervalMonths is the effective interval. An omitted rule interval is 1.
 * dueDate is the due date inside that period.
 */
export interface MonthlyPlanObligationEvidence {
  id: string;
  name: string;
  amount: number;
  category: ExpenseKind;
  budgetCategoryId: string;
  dueDay: number;
  intervalMonths: number;
  dueDate: string;
}

/**
 * Existing protected designations at finalization.
 * Context only. Not part of the Planning Basis.
 */
export interface MonthlyPlanProtectedContext {
  openingWealthBuilding: number;
  openingEmergencyFund: number;
}

/**
 * One steward-finalized period intention.
 * Append-only. A later approval for the same period is a new revision.
 * Planning Basis is an assumption used to derive the canonical split.
 * It is not Income and it does not allocate the ledger.
 */
export interface MonthlyPlanRevision {
  id: string;
  periodKey: string;
  revision: number;
  finalizedAt: string;
  supersedesId: string | null;
  planningBasis: number;
  wealthShare: number;
  debtShare: number;
  expenditureShare: number;
  debtRedirected: boolean;
  categories: MonthlyPlanCategoryPurpose[];
  debts: MonthlyPlanDebtIntent[];
  obligations: MonthlyPlanObligationEvidence[];
  protectedContext: MonthlyPlanProtectedContext;
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
  /**
   * Original enrollment principal. Progress denominators may use this.
   * After the debt-position epoch, current owed may exceed this (interest /
   * new charges via steward reconciliation).
   */
  totalDebt: number;
  /**
   * Before debt-position epoch: modeled purpose progress (legacy).
   * After epoch: steward-authoritative current amount owed (POSITION).
   * Purpose allocation must not mutate this after epoch.
   */
  remainingDebt: number;
  monthlyAllocation: number;
  createdAt: string;
  /** Annual percentage rate (0–100). Soft-migrates to 0 when absent. */
  interestRate: number;
  /**
   * Modeled remainingDebt immediately before steward position rebase.
   * Legacy context only. Not creditor truth. Absent on post-epoch new debts.
   */
  legacyModeledRemaining?: number;
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

/**
 * Per-creditor debt PURPOSE share for one AllocationEvent after the
 * debt-position epoch. Not a payment and not a position change.
 */
export interface DebtPurposeAttribution {
  id: string;
  allocationEventId: string;
  debtId: string;
  amount: number;
  date: string;
  monthKey: string;
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
  /**
   * Finalized monthly intentions. Missing on older vaults; loads as [].
   * Not inferred from current caps, debts, or rules.
   */
  monthlyPlans: MonthlyPlanRevision[];
  /**
   * 1 = legacy modeled remainingDebt mutation from allocation.
   * 2 = debt-position epoch: remainingDebt is authoritative owed.
   * Missing on older vaults: empty debts → 2, else 1.
   */
  debtSemanticsVersion: number;
  /**
   * Local ISO datetime when the steward completed the all-or-nothing
   * debt-position rebase. Null when not yet in the position epoch.
   */
  debtPositionEpochAt: string | null;
  /**
   * Per-creditor debt purpose attributions for post-epoch allocations.
   * Missing on older vaults; loads as []. Legacy allocation events are never
   * backfilled.
   */
  debtPurposeAttributions: DebtPurposeAttribution[];
  /**
   * Steward-authored expected pay schedules. Missing on older vaults; loads as [].
   * Derived ExpectedPayday occurrences are not stored.
   */
  paySchedules: PaySchedule[];
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
  /**
   * Calendar-month interval when this upcoming expense repeats.
   * 1 is monthly. Used instead of repeatsMonthly when both are sent.
   */
  intervalMonths?: number;
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
 * Version 6 stores finalized monthly plan revisions. Older builds reject
 * version 6 instead of dropping them.
 * Version 7 stores debt-position epoch fields and per-creditor purpose
 * attributions. Older builds reject version 7 instead of treating legacy
 * remainingDebt as authoritative without confirmation.
 * Version 8 stores optional FinancialAccount purpose. Older builds reject
 * version 8 instead of stripping purpose on round-trip.
 * Version 9 stores optional FinancialAccount restrictedAmount. Older builds
 * reject version 9 instead of stripping restriction on round-trip.
 * Version 10 stores steward PaySchedule rules. Older builds reject version 10
 * instead of dropping expected-pay timing on round-trip.
 */
export type LedgerBackupVersion = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10;

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
  /** Present on version 5. Earlier versions import as an empty list. Version 6 keeps them. */
  recurringObligations?: RecurringObligation[];
  /** Present on version 6. Earlier versions import as an empty list. */
  monthlyPlans?: MonthlyPlanRevision[];
  /** Present on version 7. Earlier versions import as legacy debt semantics. */
  debtSemanticsVersion?: number;
  /** Present on version 7. */
  debtPositionEpochAt?: string | null;
  /** Present on version 7. Earlier versions import as []. */
  debtPurposeAttributions?: DebtPurposeAttribution[];
  /** Present on version 10. Earlier versions import as []. */
  paySchedules?: PaySchedule[];
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
