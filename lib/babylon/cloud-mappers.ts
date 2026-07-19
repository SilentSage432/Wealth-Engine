/**
 * Path A mapping adapters between camelCase domain models and snake_case
 * Postgres rows. Ownership: presentation/domain stay on types/babylon.ts;
 * this module owns the sync boundary only.
 */

import { monthKeyFromDate } from "@/lib/babylon/engine";
import type {
  ActivityKind,
  BudgetTarget,
  ExpenseEntry,
  IncomeEntry,
  IncomeInterval,
} from "@/types/babylon";
import type {
  ActivityLogTypeDb,
  BudgetCategoryGroupDb,
  BudgetTargetInsert,
  ExpenseEntryInsert,
  IncomeEntryInsert,
  IncomeIntervalDb,
} from "@/lib/supabase/database.types";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function isUuid(value: string | undefined | null): value is string {
  return typeof value === "string" && UUID_RE.test(value);
}

export function mapIntervalToDb(interval: IncomeInterval): IncomeIntervalDb {
  switch (interval) {
    case "one-time":
      return "one_time";
    case "biweekly":
      return "bi_weekly";
    case "yearly":
      return "annually";
    case "weekly":
    case "monthly":
      return interval;
    default: {
      const _exhaustive: never = interval;
      return _exhaustive;
    }
  }
}

export function mapIntervalFromDb(interval: IncomeIntervalDb): IncomeInterval {
  switch (interval) {
    case "one_time":
      return "one-time";
    case "bi_weekly":
      return "biweekly";
    case "semi_monthly":
      // Nearest local contract until TS gains a dedicated semi-monthly bound.
      return "biweekly";
    case "annually":
      return "yearly";
    case "weekly":
    case "monthly":
      return interval;
    default: {
      const _exhaustive: never = interval;
      return _exhaustive;
    }
  }
}

export function mapGroupKindToDb(isEssential: boolean): BudgetCategoryGroupDb {
  return isEssential ? "essential" : "discretionary";
}

export function mapGroupKindFromDb(
  groupKind: BudgetCategoryGroupDb
): boolean {
  return groupKind === "essential";
}

export function mapActivityKindToDb(kind: ActivityKind): ActivityLogTypeDb {
  switch (kind) {
    case "income":
      return "income";
    case "expense":
      return "expense";
    case "budget":
      return "category";
    case "settle":
    case "close":
      return "system";
    default: {
      const _exhaustive: never = kind;
      return _exhaustive;
    }
  }
}

export function toIncomeInsert(
  userId: string,
  entry: IncomeEntry
): IncomeEntryInsert {
  const row: IncomeEntryInsert = {
    user_id: userId,
    source: entry.source,
    amount: entry.amount,
    date: entry.date,
    kind: entry.kind,
    interval: mapIntervalToDb(entry.interval),
    month_key: monthKeyFromDate(entry.date),
  };
  if (isUuid(entry.id)) row.id = entry.id;
  return row;
}

export function toExpenseInsert(
  userId: string,
  entry: ExpenseEntry
): ExpenseEntryInsert {
  const categoryId = entry.budgetCategoryId;
  const row: ExpenseEntryInsert = {
    user_id: userId,
    name: entry.name,
    amount: entry.amount,
    date: entry.date,
    due_date: entry.dueDate,
    is_settled: entry.isSettled,
    category_id: isUuid(categoryId) ? categoryId : null,
    month_key: monthKeyFromDate(entry.date),
  };
  if (isUuid(entry.id)) row.id = entry.id;
  return row;
}

export function toBudgetTargetInsert(
  userId: string,
  target: BudgetTarget,
  monthKey: string
): BudgetTargetInsert {
  const row: BudgetTargetInsert = {
    user_id: userId,
    name: target.categoryName,
    cap: target.plannedAmount,
    group_kind: mapGroupKindToDb(target.isEssential),
    month_key: monthKey,
  };
  if (isUuid(target.id)) row.id = target.id;
  return row;
}

export function fromBudgetTargetRow(row: {
  id: string;
  name: string;
  cap: number;
  group_kind: BudgetCategoryGroupDb;
}): BudgetTarget {
  return {
    id: row.id,
    categoryName: row.name,
    plannedAmount: Number(row.cap),
    isEssential: mapGroupKindFromDb(row.group_kind),
  };
}

export function fromExpenseRow(row: {
  id: string;
  name: string;
  amount: number;
  date: string;
  due_date: string | null;
  is_settled: boolean;
  category_id: string | null;
}): ExpenseEntry {
  return {
    id: row.id,
    name: row.name,
    category: "need",
    amount: Number(row.amount),
    date: row.date,
    dueDate: row.due_date ?? row.date,
    isSettled: row.is_settled,
    ...(row.category_id ? { budgetCategoryId: row.category_id } : {}),
  };
}

export function fromIncomeRow(row: {
  id: string;
  source: string;
  amount: number;
  date: string;
  kind: IncomeEntry["kind"];
  interval: IncomeIntervalDb;
}): IncomeEntry {
  return {
    id: row.id,
    source: row.source,
    amount: Number(row.amount),
    date: row.date,
    kind: row.kind,
    interval: mapIntervalFromDb(row.interval),
    wealthShare: 0,
    debtShare: 0,
    expenditureShare: 0,
    debtRedirected: false,
  };
}
