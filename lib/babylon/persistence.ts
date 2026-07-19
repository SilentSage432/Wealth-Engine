import {
  DISCRETIONARY_BUDGET_ID,
  EMPTY_STATE,
  STORAGE_KEY,
  USERNAME_STORAGE_KEY,
} from "@/lib/babylon/constants";
import type {
  AllocationEvent,
  BudgetTarget,
  DebtEntry,
  ExpenseEntry,
  ExpenseKind,
  IncomeEntry,
  IncomeInterval,
  IncomeStreamKind,
  LedgerBackup,
  PersistedState,
} from "@/types/babylon";

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

  return {
    id: value.id,
    name: value.name.trim(),
    category: value.category as ExpenseKind,
    amount: value.amount,
    date: value.date,
    dueDate,
    ...(budgetCategoryId ? { budgetCategoryId } : {}),
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

  return {
    id: value.id,
    creditor: value.creditor.trim(),
    totalDebt: value.totalDebt,
    remainingDebt: Math.min(value.totalDebt, Math.max(0, value.remainingDebt)),
    monthlyAllocation: value.monthlyAllocation,
    createdAt: value.createdAt,
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
  const expenses = Array.isArray(raw.expenses)
    ? raw.expenses
        .map(parseExpenseEntry)
        .filter((e): e is ExpenseEntry => e !== null)
    : [];
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

  return {
    incomes,
    expenses,
    debts,
    allocations,
    budgetTargets,
    displayName: typeof raw.displayName === "string" ? raw.displayName : "",
  };
}

/**
 * Strict backup validation — rejects the entire payload if any row fails schema.
 * Prevents partial / corrupt imports from crashing the dashboard.
 */
export function validateLedgerBackup(raw: unknown): LedgerBackup | null {
  if (!isRecord(raw)) return null;

  if (raw.version !== 1) return null;
  if (typeof raw.exportedAt !== "string" || !raw.exportedAt.trim()) return null;

  const incomes = parseArray(raw.incomes, parseIncomeEntry);
  const expenses = parseArray(raw.expenses, parseExpenseEntry);
  const debts = parseArray(raw.debts, parseDebtEntry);
  if (!incomes || !expenses || !debts) return null;

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

  const displayName =
    typeof raw.displayName === "string" ? raw.displayName : "";

  return {
    version: 1,
    exportedAt: raw.exportedAt,
    incomes,
    expenses,
    debts,
    allocations,
    budgetTargets,
    displayName,
  };
}

export function buildLedgerBackup(state: PersistedState): LedgerBackup {
  return {
    version: 1,
    exportedAt: new Date().toISOString(),
    incomes: state.incomes,
    expenses: state.expenses,
    debts: state.debts,
    allocations: state.allocations,
    budgetTargets: state.budgetTargets,
    displayName: state.displayName,
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
