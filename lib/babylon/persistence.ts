import {
  DEBT_SEMANTICS_LEGACY,
  DEBT_SEMANTICS_POSITION,
  resolveDebtSemanticsVersion,
} from "@/lib/babylon/debt-semantics";
import {
  DISCRETIONARY_BUDGET_ID,
  EMPTY_STATE,
  STORAGE_KEY,
  USERNAME_STORAGE_KEY,
} from "@/lib/babylon/constants";
import { roundMoney } from "@/lib/babylon/engine";
import { parseMonthlyPlanRevision } from "@/lib/babylon/monthly-plan";
import { parseRecurringObligation } from "@/lib/babylon/recurring-obligations";
import { isFinancialAccountPurpose } from "@/lib/babylon/account-purpose";
import {
  isFinancialAccountKind,
  isLocalIsoDate,
} from "@/lib/babylon/financial-position";
import { canonicalIanaTimeZone } from "@/lib/babylon/civil-time";
import { parsePaySchedule } from "@/lib/babylon/pay-schedule";
import type {
  AllocationEvent,
  ActivityEvent,
  ActivityKind,
  BudgetTarget,
  DebtEntry,
  DebtPurposeAttribution,
  ExpenseEntry,
  ExpenseKind,
  FinancialAccount,
  FinancialAccountPurpose,
  IncomeEntry,
  IncomeInterval,
  IncomeStreamKind,
  LedgerBackup,
  MonthlyPlanRevision,
  PaySchedule,
  PeriodArchive,
  PersistedState,
  RecurringObligation,
  SurplusDisposition,
} from "@/types/babylon";

/** Current export version. Version 11 may store financialTimeZone. Version 10 adds steward PaySchedule rules. */
export const LEDGER_BACKUP_VERSION = 11 as const;

/** Local vault marker. 2 means `isSettled: false` is an Upcoming obligation. */
export const EXPENSE_SEMANTICS_VERSION = 2 as const;

function nonNegativeMoney(value: unknown): number | null {
  if (!isFiniteNumber(value) || value < 0) return null;
  return roundMoney(value);
}

function settleLegacyExpenses(expenses: ExpenseEntry[]): ExpenseEntry[] {
  return expenses.map((expense) =>
    expense.isSettled ? expense : { ...expense, isSettled: true }
  );
}

const INCOME_INTERVALS: ReadonlySet<string> = new Set([
  "one-time",
  "weekly",
  "biweekly",
  "monthly",
  "yearly",
]);

const INCOME_STREAM_KINDS: ReadonlySet<string> = new Set([
  "primary",
  "side_hustle",
  "passive",
  "other",
]);

const EXPENSE_KINDS: ReadonlySet<string> = new Set(["need", "desire"]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isIsoDate(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /^\d{4}-\d{2}-\d{2}$/.test(value) &&
    Number.isFinite(Date.parse(`${value}T00:00:00`))
  );
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function parseIncomeEntry(value: unknown): IncomeEntry | null {
  if (!isRecord(value)) return null;
  if (!isNonEmptyString(value.id)) return null;
  if (!isNonEmptyString(value.source)) return null;
  if (!isFiniteNumber(value.amount) || value.amount < 0) return null;
  if (!isIsoDate(value.date)) return null;
  if (
    typeof value.interval !== "string" ||
    !INCOME_INTERVALS.has(value.interval)
  ) {
    return null;
  }
  if (!isFiniteNumber(value.wealthShare)) return null;
  if (!isFiniteNumber(value.debtShare)) return null;
  if (!isFiniteNumber(value.expenditureShare)) return null;
  if (typeof value.debtRedirected !== "boolean") return null;

  // Soft-migrate legacy incomes without kind → primary labor.
  const kind: IncomeStreamKind =
    typeof value.kind === "string" && INCOME_STREAM_KINDS.has(value.kind)
      ? (value.kind as IncomeStreamKind)
      : "primary";

  return {
    id: value.id,
    source: value.source.trim(),
    amount: value.amount,
    date: value.date,
    interval: value.interval as IncomeInterval,
    kind,
    wealthShare: value.wealthShare,
    debtShare: value.debtShare,
    expenditureShare: value.expenditureShare,
    debtRedirected: value.debtRedirected,
  };
}

function parseExpenseEntry(value: unknown): ExpenseEntry | null {
  if (!isRecord(value)) return null;
  if (!isNonEmptyString(value.id)) return null;
  if (!isNonEmptyString(value.name)) return null;
  if (
    typeof value.category !== "string" ||
    !EXPENSE_KINDS.has(value.category)
  ) {
    return null;
  }
  if (!isFiniteNumber(value.amount) || value.amount < 0) return null;
  if (!isIsoDate(value.date)) return null;

  // Prefer explicit dueDate; fall back to transaction date for legacy payloads.
  const dueDate = isIsoDate(value.dueDate)
    ? value.dueDate
    : isIsoDate(value.date)
      ? value.date
      : null;
  if (!dueDate) return null;

  const budgetCategoryId =
    typeof value.budgetCategoryId === "string" && value.budgetCategoryId.trim()
      ? value.budgetCategoryId.trim()
      : value.category === "desire"
        ? DISCRETIONARY_BUDGET_ID
        : undefined;

  // Legacy rows without isSettled soft-migrate to settled (paid).
  const isSettled =
    typeof value.isSettled === "boolean" ? value.isSettled : true;

  const recurringObligationId =
    typeof value.recurringObligationId === "string" &&
    value.recurringObligationId.trim()
      ? value.recurringObligationId.trim()
      : undefined;
  const recurrenceMonth =
    typeof value.recurrenceMonth === "string" &&
    /^\d{4}-\d{2}$/.test(value.recurrenceMonth)
      ? value.recurrenceMonth
      : undefined;

  return {
    id: value.id,
    name: value.name.trim(),
    category: value.category as ExpenseKind,
    amount: value.amount,
    date: value.date,
    dueDate,
    isSettled,
    ...(budgetCategoryId ? { budgetCategoryId } : {}),
    ...(recurringObligationId && recurrenceMonth
      ? { recurringObligationId, recurrenceMonth }
      : {}),
  };
}

function parseBudgetTarget(value: unknown): BudgetTarget | null {
  if (!isRecord(value)) return null;
  if (!isNonEmptyString(value.id)) return null;
  if (!isNonEmptyString(value.categoryName)) return null;
  if (!isFiniteNumber(value.plannedAmount) || value.plannedAmount < 0) {
    return null;
  }
  if (typeof value.isEssential !== "boolean") return null;

  return {
    id: value.id,
    categoryName: value.categoryName.trim(),
    plannedAmount: value.plannedAmount,
    isEssential: value.isEssential,
  };
}

function parseDebtEntry(value: unknown): DebtEntry | null {
  if (!isRecord(value)) return null;
  if (!isNonEmptyString(value.id)) return null;
  if (!isNonEmptyString(value.creditor)) return null;
  if (!isFiniteNumber(value.totalDebt) || value.totalDebt < 0) return null;
  if (!isFiniteNumber(value.remainingDebt) || value.remainingDebt < 0) {
    return null;
  }
  if (
    !isFiniteNumber(value.monthlyAllocation) ||
    value.monthlyAllocation < 0
  ) {
    return null;
  }
  if (!isIsoDate(value.createdAt)) return null;

  const interestRate =
    isFiniteNumber(value.interestRate) && value.interestRate >= 0
      ? value.interestRate
      : 0;

  let legacyModeledRemaining: number | undefined;
  if (value.legacyModeledRemaining !== undefined) {
    if (
      !isFiniteNumber(value.legacyModeledRemaining) ||
      value.legacyModeledRemaining < 0
    ) {
      return null;
    }
    legacyModeledRemaining = roundMoney(value.legacyModeledRemaining);
  }

  return {
    id: value.id,
    creditor: value.creditor.trim(),
    totalDebt: value.totalDebt,
    // Authoritative owed may exceed original enrollment (interest / charges).
    remainingDebt: Math.max(0, value.remainingDebt),
    monthlyAllocation: value.monthlyAllocation,
    createdAt: value.createdAt,
    interestRate,
    ...(legacyModeledRemaining !== undefined
      ? { legacyModeledRemaining }
      : {}),
  };
}

/**
 * Live vault / soft path: absent purpose is ordinary liquid; unknown purpose
 * is dropped so a corrupt optional field cannot wipe the account.
 * Strict backup path rejects the row when purpose is present and invalid.
 */
function parseFinancialAccountPurposeField(
  value: unknown,
  mode: "soft" | "strict"
): FinancialAccountPurpose | undefined | "invalid" {
  if (value === undefined || value === null) return undefined;
  if (isFinancialAccountPurpose(value)) return value;
  return mode === "strict" ? "invalid" : undefined;
}

/**
 * Soft: invalid restriction dropped. Strict: invalid rejects the account row.
 * Amount may exceed balance (conflict is derived later). Zero is omitted.
 */
function parseRestrictedAmountField(
  value: unknown,
  mode: "soft" | "strict"
): number | undefined | "invalid" {
  if (value === undefined || value === null) return undefined;
  if (!isFiniteNumber(value) || value < 0) {
    return mode === "strict" ? "invalid" : undefined;
  }
  const rounded = roundMoney(value);
  if (rounded === 0) return undefined;
  return rounded;
}

function parseFinancialAccount(
  value: unknown,
  mode: "soft" | "strict" = "soft"
): FinancialAccount | null {
  if (!isRecord(value)) return null;
  if (!isNonEmptyString(value.id)) return null;
  if (!isNonEmptyString(value.name)) return null;
  if (!isFinancialAccountKind(value.kind)) return null;
  if (!isFiniteNumber(value.balance) || value.balance < 0) return null;
  if (!isLocalIsoDate(value.asOf)) return null;

  const purpose = parseFinancialAccountPurposeField(value.purpose, mode);
  if (purpose === "invalid") return null;

  const restrictedAmount = parseRestrictedAmountField(
    value.restrictedAmount,
    mode
  );
  if (restrictedAmount === "invalid") return null;

  const account: FinancialAccount = {
    id: value.id,
    name: value.name.trim(),
    kind: value.kind,
    balance: roundMoney(value.balance),
    asOf: value.asOf,
  };
  if (purpose !== undefined) {
    account.purpose = purpose;
  }
  if (restrictedAmount !== undefined) {
    account.restrictedAmount = restrictedAmount;
  }
  return account;
}

function parseDebtPurposeAttribution(
  value: unknown
): DebtPurposeAttribution | null {
  if (!isRecord(value)) return null;
  if (!isNonEmptyString(value.id)) return null;
  if (!isNonEmptyString(value.allocationEventId)) return null;
  if (!isNonEmptyString(value.debtId)) return null;
  if (!isFiniteNumber(value.amount) || value.amount < 0) return null;
  if (!isIsoDate(value.date)) return null;
  if (
    typeof value.monthKey !== "string" ||
    !/^\d{4}-\d{2}$/.test(value.monthKey)
  ) {
    return null;
  }
  return {
    id: value.id,
    allocationEventId: value.allocationEventId,
    debtId: value.debtId,
    amount: roundMoney(value.amount),
    date: value.date,
    monthKey: value.monthKey,
  };
}

function parseAllocationEvent(value: unknown): AllocationEvent | null {
  if (!isRecord(value)) return null;
  if (!isNonEmptyString(value.id)) return null;
  if (!isNonEmptyString(value.incomeId)) return null;
  if (!isIsoDate(value.date)) return null;
  if (typeof value.monthKey !== "string" || !/^\d{4}-\d{2}$/.test(value.monthKey)) {
    return null;
  }
  if (!isFiniteNumber(value.gross)) return null;
  if (!isFiniteNumber(value.wealth)) return null;
  if (!isFiniteNumber(value.debt)) return null;
  if (!isFiniteNumber(value.expenditure)) return null;

  return {
    id: value.id,
    incomeId: value.incomeId,
    date: value.date,
    monthKey: value.monthKey,
    gross: value.gross,
    wealth: value.wealth,
    debt: value.debt,
    expenditure: value.expenditure,
  };
}

const ACTIVITY_KINDS: ReadonlySet<string> = new Set([
  "income",
  "expense",
  "budget",
  "settle",
  "close",
]);

const SURPLUS_DISPOSITIONS: ReadonlySet<string> = new Set([
  "debt_wealth",
  "emergency_shield",
  "split_50_50",
  "wealth_boost",
  "rollover",
]);

function parseActivityEvent(value: unknown): ActivityEvent | null {
  if (!isRecord(value)) return null;
  if (!isNonEmptyString(value.id)) return null;
  if (typeof value.kind !== "string" || !ACTIVITY_KINDS.has(value.kind)) {
    return null;
  }
  if (!isNonEmptyString(value.title)) return null;
  if (typeof value.createdAt !== "string" || !value.createdAt.trim()) {
    return null;
  }

  const event: ActivityEvent = {
    id: value.id,
    kind: value.kind as ActivityKind,
    title: value.title.trim(),
    createdAt: value.createdAt,
  };

  if (typeof value.subtitle === "string" && value.subtitle.trim()) {
    event.subtitle = value.subtitle.trim();
  }
  if (isFiniteNumber(value.amount)) {
    event.amount = value.amount;
  }
  if (
    typeof value.streamKind === "string" &&
    INCOME_STREAM_KINDS.has(value.streamKind)
  ) {
    event.streamKind = value.streamKind as IncomeStreamKind;
  }

  return event;
}

function parsePeriodArchive(value: unknown): PeriodArchive | null {
  if (!isRecord(value)) return null;
  if (!isNonEmptyString(value.id)) return null;
  if (
    typeof value.monthKey !== "string" ||
    !/^\d{4}-\d{2}$/.test(value.monthKey)
  ) {
    return null;
  }
  if (typeof value.closedAt !== "string" || !value.closedAt.trim()) return null;
  if (!isFiniteNumber(value.totalIncome)) return null;
  if (!isFiniteNumber(value.totalSpent)) return null;
  if (!isFiniteNumber(value.wealthAllocated)) return null;
  if (!isFiniteNumber(value.debtAllocated)) return null;
  if (!isFiniteNumber(value.expenditurePool)) return null;
  if (!isFiniteNumber(value.expenditureRemaining)) return null;
  if (
    typeof value.surplusDisposition !== "string" ||
    !SURPLUS_DISPOSITIONS.has(value.surplusDisposition)
  ) {
    return null;
  }
  if (!isFiniteNumber(value.surplusAmount)) return null;

  return {
    id: value.id,
    monthKey: value.monthKey,
    closedAt: value.closedAt,
    totalIncome: value.totalIncome,
    totalSpent: value.totalSpent,
    wealthAllocated: value.wealthAllocated,
    debtAllocated: value.debtAllocated,
    expenditurePool: value.expenditurePool,
    expenditureRemaining: value.expenditureRemaining,
    surplusDisposition: value.surplusDisposition as SurplusDisposition,
    surplusAmount: value.surplusAmount,
  };
}

function parseArray<T>(
  value: unknown,
  parser: (item: unknown) => T | null
): T[] | null {
  if (!Array.isArray(value)) return null;
  const result: T[] = [];
  for (const item of value) {
    const parsed = parser(item);
    if (!parsed) return null;
    result.push(parsed);
  }
  return result;
}

export function normalizePersistedState(raw: unknown): PersistedState {
  if (!isRecord(raw)) return EMPTY_STATE;

  // Soft-migrate: keep valid rows; drop corrupt ones rather than wiping the vault.
  const incomes = Array.isArray(raw.incomes)
    ? raw.incomes
        .map(parseIncomeEntry)
        .filter((e): e is IncomeEntry => e !== null)
    : [];
  const parsedExpenses = Array.isArray(raw.expenses)
    ? raw.expenses
        .map(parseExpenseEntry)
        .filter((e): e is ExpenseEntry => e !== null)
    : [];
  // Absent marker: those unsettled rows were already treated as spent.
  const expenses =
    raw.expenseSemanticsVersion === EXPENSE_SEMANTICS_VERSION
      ? parsedExpenses
      : settleLegacyExpenses(parsedExpenses);
  const debts = Array.isArray(raw.debts)
    ? raw.debts
        .map(parseDebtEntry)
        .filter((e): e is DebtEntry => e !== null)
    : [];
  const allocations = Array.isArray(raw.allocations)
    ? raw.allocations
        .map(parseAllocationEvent)
        .filter((e): e is AllocationEvent => e !== null)
    : [];

  const budgetTargets = Array.isArray(raw.budgetTargets)
    ? raw.budgetTargets
        .map(parseBudgetTarget)
        .filter((t): t is BudgetTarget => t !== null)
    : [];

  // Older vaults omit accounts. Never infer balances from income or spending.
  const accounts = Array.isArray(raw.accounts)
    ? raw.accounts
        .map((row) => parseFinancialAccount(row, "soft"))
        .filter((account): account is FinancialAccount => account !== null)
    : [];

  const activityLog = Array.isArray(raw.activityLog)
    ? raw.activityLog
        .map(parseActivityEvent)
        .filter((e): e is ActivityEvent => e !== null)
    : [];

  const periodArchives = Array.isArray(raw.periodArchives)
    ? raw.periodArchives
        .map(parsePeriodArchive)
        .filter((e): e is PeriodArchive => e !== null)
    : [];

  const emergencyShield =
    isFiniteNumber(raw.emergencyShield) && raw.emergencyShield >= 0
      ? raw.emergencyShield
      : 0;

  const lastClosedMonthKey =
    typeof raw.lastClosedMonthKey === "string" &&
    /^\d{4}-\d{2}$/.test(raw.lastClosedMonthKey)
      ? raw.lastClosedMonthKey
      : null;

  const openingWealthBuilding = nonNegativeMoney(raw.openingWealthBuilding) ?? 0;
  const openingEmergencyFund = nonNegativeMoney(raw.openingEmergencyFund) ?? 0;
  const recurringObligations = Array.isArray(raw.recurringObligations)
    ? raw.recurringObligations
        .map(parseRecurringObligation)
        .filter((rule): rule is RecurringObligation => rule !== null)
    : [];

  // Older vaults omit plans. Never infer a plan from current caps or rules.
  const monthlyPlans = Array.isArray(raw.monthlyPlans)
    ? raw.monthlyPlans
        .map(parseMonthlyPlanRevision)
        .filter((plan): plan is MonthlyPlanRevision => plan !== null)
    : [];

  const debtPurposeAttributions = Array.isArray(raw.debtPurposeAttributions)
    ? raw.debtPurposeAttributions
        .map(parseDebtPurposeAttribution)
        .filter((row): row is DebtPurposeAttribution => row !== null)
    : [];

  // Older vaults omit pay schedules. Never infer from IncomeEntry history.
  const paySchedules = Array.isArray(raw.paySchedules)
    ? raw.paySchedules
        .map(parsePaySchedule)
        .filter((row): row is PaySchedule => row !== null)
    : [];

  const financialTimeZone = readFinancialTimeZone(raw.financialTimeZone);

  const debtSemanticsVersion = resolveDebtSemanticsVersion(
    raw.debtSemanticsVersion,
    debts.length
  );

  let debtPositionEpochAt: string | null = null;
  if (
    typeof raw.debtPositionEpochAt === "string" &&
    raw.debtPositionEpochAt.trim()
  ) {
    debtPositionEpochAt = raw.debtPositionEpochAt;
  }
  if (
    debtSemanticsVersion === DEBT_SEMANTICS_POSITION &&
    debts.length > 0 &&
    !debtPositionEpochAt &&
    raw.debtSemanticsVersion === DEBT_SEMANTICS_POSITION
  ) {
    // Explicit position epoch without timestamp still counts; keep null.
    debtPositionEpochAt = null;
  }

  return {
    incomes,
    expenses,
    debts,
    allocations,
    budgetTargets,
    accounts,
    displayName: typeof raw.displayName === "string" ? raw.displayName : "",
    activityLog,
    emergencyShield,
    periodArchives,
    lastClosedMonthKey,
    expenseSemanticsVersion: EXPENSE_SEMANTICS_VERSION,
    openingWealthBuilding,
    openingEmergencyFund,
    recurringObligations,
    monthlyPlans,
    debtSemanticsVersion,
    debtPositionEpochAt,
    debtPurposeAttributions,
    paySchedules,
    ...(financialTimeZone ? { financialTimeZone } : {}),
  };
}

/**
 * A valid trimmed IANA name, or unknown. Invalid text is not kept and is
 * not replaced with the device zone or a notification zone.
 */
function readFinancialTimeZone(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const zone = canonicalIanaTimeZone(value);
  return zone ?? undefined;
}

/**
 * Strict backup validation — rejects the entire payload if any row fails schema.
 * Prevents partial / corrupt imports from crashing the dashboard.
 */
export function validateLedgerBackup(raw: unknown): LedgerBackup | null {
  if (!isRecord(raw)) return null;

  if (
    raw.version !== 1 &&
    raw.version !== 2 &&
    raw.version !== 3 &&
    raw.version !== 4 &&
    raw.version !== 5 &&
    raw.version !== 6 &&
    raw.version !== 7 &&
    raw.version !== 8 &&
    raw.version !== 9 &&
    raw.version !== 10 &&
    raw.version !== 11
  ) {
    return null;
  }
  if (typeof raw.exportedAt !== "string" || !raw.exportedAt.trim()) return null;

  const incomes = parseArray(raw.incomes, parseIncomeEntry);
  const expenses = parseArray(raw.expenses, parseExpenseEntry);
  const debts = parseArray(raw.debts, parseDebtEntry);
  if (!incomes || !expenses || !debts) return null;

  // Versions 1 and 2 counted unsettled rows as spent. Mark them paid on import
  // so a later save does not turn old spending into Upcoming. Versions 3–11
  // keep Upcoming unpaid.
  const settledExpenses =
    raw.version === 3 ||
    raw.version === 4 ||
    raw.version === 5 ||
    raw.version === 6 ||
    raw.version === 7 ||
    raw.version === 8 ||
    raw.version === 9 ||
    raw.version === 10 ||
    raw.version === 11
      ? expenses
      : settleLegacyExpenses(expenses);

  // Allocations optional for older hand-crafted files; default empty.
  let allocations: AllocationEvent[] = [];
  if (raw.allocations !== undefined) {
    const parsed = parseArray(raw.allocations, parseAllocationEvent);
    if (!parsed) return null;
    allocations = parsed;
  }

  // Budget targets optional for older backups; empty means steward configures later.
  let budgetTargets: BudgetTarget[] = [];
  if (raw.budgetTargets !== undefined) {
    const parsed = parseArray(raw.budgetTargets, parseBudgetTarget);
    if (!parsed) return null;
    budgetTargets = parsed;
  }

  let activityLog: ActivityEvent[] = [];
  if (raw.activityLog !== undefined) {
    const parsed = parseArray(raw.activityLog, parseActivityEvent);
    if (!parsed) return null;
    activityLog = parsed;
  }

  let periodArchives: PeriodArchive[] = [];
  if (raw.periodArchives !== undefined) {
    const parsed = parseArray(raw.periodArchives, parsePeriodArchive);
    if (!parsed) return null;
    periodArchives = parsed;
  }

  const emergencyShield =
    raw.emergencyShield === undefined
      ? 0
      : isFiniteNumber(raw.emergencyShield) && raw.emergencyShield >= 0
        ? raw.emergencyShield
        : null;
  if (emergencyShield === null) return null;

  let lastClosedMonthKey: string | null = null;
  if (raw.lastClosedMonthKey !== undefined && raw.lastClosedMonthKey !== null) {
    if (
      typeof raw.lastClosedMonthKey !== "string" ||
      !/^\d{4}-\d{2}$/.test(raw.lastClosedMonthKey)
    ) {
      return null;
    }
    lastClosedMonthKey = raw.lastClosedMonthKey;
  }

  const displayName =
    typeof raw.displayName === "string" ? raw.displayName : "";

  // Version 1 has no account contract. Ignore any stray `accounts` field so a
  // version-1 file cannot smuggle balances. Versions 2–11 require a valid list;
  // one bad row rejects the whole backup. Versions ≤7 strip purpose and
  // restriction. Version 8 keeps purpose and strips restriction. Versions 9–11
  // keep purpose and restrictedAmount; rejects invalid optional fields.
  let accounts: FinancialAccount[] = [];
  if (
    raw.version === 2 ||
    raw.version === 3 ||
    raw.version === 4 ||
    raw.version === 5 ||
    raw.version === 6 ||
    raw.version === 7 ||
    raw.version === 8 ||
    raw.version === 9 ||
    raw.version === 10 ||
    raw.version === 11
  ) {
    if (raw.accounts === undefined) return null;
    const parsed =
      raw.version === 9 || raw.version === 10 || raw.version === 11
        ? parseArray(raw.accounts, (row) => parseFinancialAccount(row, "strict"))
        : raw.version === 8
          ? parseArray(raw.accounts, (row) => {
              const account = parseFinancialAccount(row, "strict");
              if (!account) return null;
              const stripped: FinancialAccount = {
                id: account.id,
                name: account.name,
                kind: account.kind,
                balance: account.balance,
                asOf: account.asOf,
              };
              if (account.purpose !== undefined) {
                stripped.purpose = account.purpose;
              }
              return stripped;
            })
          : parseArray(raw.accounts, (row) => {
              const account = parseFinancialAccount(row, "soft");
              if (!account) return null;
              return {
                id: account.id,
                name: account.name,
                kind: account.kind,
                balance: account.balance,
                asOf: account.asOf,
              };
            });
    if (!parsed) return null;
    accounts = parsed;
  }

  // Versions 1–3 have no protected-designation contract. Force zero even if
  // stray fields are present. Versions 4–11 must include both amounts; a
  // missing field rejects the backup instead of silently dropping a designation.
  let openingWealthBuilding = 0;
  let openingEmergencyFund = 0;
  if (
    raw.version === 4 ||
    raw.version === 5 ||
    raw.version === 6 ||
    raw.version === 7 ||
    raw.version === 8 ||
    raw.version === 9 ||
    raw.version === 10 ||
    raw.version === 11
  ) {
    const wealth = nonNegativeMoney(raw.openingWealthBuilding);
    const emergency = nonNegativeMoney(raw.openingEmergencyFund);
    if (wealth === null || emergency === null) return null;
    openingWealthBuilding = wealth;
    openingEmergencyFund = emergency;
  }

  // Versions 1–4 have no recurring-rule contract. Force an empty list even if
  // stray rules are present. Versions 5–11 must include the list; a missing
  // list rejects the backup instead of silently dropping recurrence.
  let recurringObligations: RecurringObligation[] = [];
  if (
    raw.version === 5 ||
    raw.version === 6 ||
    raw.version === 7 ||
    raw.version === 8 ||
    raw.version === 9 ||
    raw.version === 10 ||
    raw.version === 11
  ) {
    if (raw.recurringObligations === undefined) return null;
    const parsed = parseArray(raw.recurringObligations, parseRecurringObligation);
    if (!parsed) return null;
    recurringObligations = parsed;
  }

  // Versions 1–5 have no monthly-plan contract. Force an empty list even if
  // stray revisions are present. Versions 6–11 must include the list; a missing
  // or corrupt list rejects the backup instead of dropping historical intent.
  let monthlyPlans: MonthlyPlanRevision[] = [];
  if (
    raw.version === 6 ||
    raw.version === 7 ||
    raw.version === 8 ||
    raw.version === 9 ||
    raw.version === 10 ||
    raw.version === 11
  ) {
    if (raw.monthlyPlans === undefined) return null;
    const parsed = parseArray(raw.monthlyPlans, parseMonthlyPlanRevision);
    if (!parsed) return null;
    monthlyPlans = parsed;
  }

  // Versions 1–6 have no debt-position epoch contract. Soft-migrate to legacy
  // semantics when debts exist (fail-closed: modeled remaining is NOT treated
  // as authoritative). Versions 7–11 require explicit epoch fields.
  let debtSemanticsVersion: 1 | 2 = DEBT_SEMANTICS_LEGACY;
  let debtPositionEpochAt: string | null = null;
  let debtPurposeAttributions: DebtPurposeAttribution[] = [];
  if (
    raw.version === 7 ||
    raw.version === 8 ||
    raw.version === 9 ||
    raw.version === 10 ||
    raw.version === 11
  ) {
    if (
      raw.debtSemanticsVersion !== DEBT_SEMANTICS_LEGACY &&
      raw.debtSemanticsVersion !== DEBT_SEMANTICS_POSITION
    ) {
      return null;
    }
    debtSemanticsVersion = raw.debtSemanticsVersion;
    if (raw.debtPurposeAttributions === undefined) return null;
    const parsed = parseArray(
      raw.debtPurposeAttributions,
      parseDebtPurposeAttribution
    );
    if (!parsed) return null;
    debtPurposeAttributions = parsed;
    if (raw.debtPositionEpochAt === null || raw.debtPositionEpochAt === undefined) {
      debtPositionEpochAt = null;
    } else if (
      typeof raw.debtPositionEpochAt === "string" &&
      raw.debtPositionEpochAt.trim()
    ) {
      debtPositionEpochAt = raw.debtPositionEpochAt;
    } else {
      return null;
    }
    // Position epoch with null stamp is valid for vaults born in the position
    // era (empty debts at first save). Steward-rebased vaults carry a stamp.
  } else {
    debtSemanticsVersion = resolveDebtSemanticsVersion(undefined, debts.length);
    debtPositionEpochAt = null;
    debtPurposeAttributions = [];
  }

  // Versions 1–9 have no pay-schedule contract. Force an empty list even if
  // stray schedules are present. Versions 10 and 11 must include the list.
  let paySchedules: PaySchedule[] = [];
  if (raw.version === 10 || raw.version === 11) {
    if (raw.paySchedules === undefined) return null;
    const parsed = parseArray(raw.paySchedules, parsePaySchedule);
    if (!parsed) return null;
    paySchedules = parsed;
  }

  let financialTimeZone: string | undefined;
  if (raw.version === 11 && raw.financialTimeZone !== undefined) {
    if (typeof raw.financialTimeZone !== "string") return null;
    const zone = canonicalIanaTimeZone(raw.financialTimeZone);
    if (!zone || zone !== raw.financialTimeZone) return null;
    financialTimeZone = zone;
  }

  return {
    version: raw.version,
    exportedAt: raw.exportedAt,
    incomes,
    expenses: settledExpenses,
    debts,
    allocations,
    budgetTargets,
    displayName,
    activityLog,
    emergencyShield,
    periodArchives,
    lastClosedMonthKey,
    accounts,
    openingWealthBuilding,
    openingEmergencyFund,
    recurringObligations,
    monthlyPlans,
    debtSemanticsVersion,
    debtPositionEpochAt,
    debtPurposeAttributions,
    paySchedules,
    ...(financialTimeZone ? { financialTimeZone } : {}),
  };
}

export function buildLedgerBackup(state: PersistedState): LedgerBackup {
  const financialTimeZone = readFinancialTimeZone(state.financialTimeZone);
  return {
    version: LEDGER_BACKUP_VERSION,
    exportedAt: new Date().toISOString(),
    incomes: state.incomes,
    expenses: state.expenses,
    debts: state.debts,
    allocations: state.allocations,
    budgetTargets: state.budgetTargets,
    displayName: state.displayName,
    activityLog: state.activityLog,
    emergencyShield: state.emergencyShield,
    periodArchives: state.periodArchives,
    lastClosedMonthKey: state.lastClosedMonthKey,
    accounts: state.accounts,
    openingWealthBuilding: state.openingWealthBuilding,
    openingEmergencyFund: state.openingEmergencyFund,
    recurringObligations: state.recurringObligations,
    monthlyPlans: state.monthlyPlans,
    debtSemanticsVersion: state.debtSemanticsVersion ?? DEBT_SEMANTICS_LEGACY,
    debtPositionEpochAt: state.debtPositionEpochAt ?? null,
    debtPurposeAttributions: state.debtPurposeAttributions ?? [],
    paySchedules: state.paySchedules ?? [],
    ...(financialTimeZone ? { financialTimeZone } : {}),
  };
}

export function loadPersistedState(): PersistedState {
  if (typeof window === "undefined") {
    return EMPTY_STATE;
  }

  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return EMPTY_STATE;
    return normalizePersistedState(JSON.parse(raw));
  } catch {
    return EMPTY_STATE;
  }
}

export function savePersistedState(state: PersistedState): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

export function clearPersistedState(): void {
  if (typeof window === "undefined") return;
  window.localStorage.removeItem(STORAGE_KEY);
}

/**
 * Load steward username. Prefers dedicated `babylon_username`; soft-migrates from
 * an optional vault `displayName` when the dedicated key is absent.
 */
export function loadUsername(vaultDisplayName?: string): string {
  if (typeof window === "undefined") return "";

  try {
    const raw = window.localStorage.getItem(USERNAME_STORAGE_KEY);
    if (raw !== null) return raw;

    if (typeof vaultDisplayName === "string") {
      saveUsername(vaultDisplayName);
      return vaultDisplayName;
    }

    return "";
  } catch {
    return "";
  }
}

export function saveUsername(username: string): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(USERNAME_STORAGE_KEY, username);
}

export function clearUsername(): void {
  if (typeof window === "undefined") return;
  window.localStorage.removeItem(USERNAME_STORAGE_KEY);
}

export function isEmptyLedger(state: PersistedState): boolean {
  return (
    state.incomes.length === 0 &&
    state.expenses.length === 0 &&
    state.debts.length === 0
  );
}
