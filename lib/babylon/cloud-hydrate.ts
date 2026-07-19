/**
 * One-time local → cloud vault migration for first successful sign-in.
 * Ownership: sync boundary only — does not own ledger math or UI state.
 */

import {
  isUuid,
  toBudgetTargetInsert,
  toExpenseInsert,
  toIncomeInsert,
} from "@/lib/babylon/cloud-mappers";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import { upsertStewardProfile } from "@/lib/supabase/auth";
import type { BudgetTarget, ExpenseEntry, IncomeEntry } from "@/types/babylon";

export type LocalVaultSnapshot = {
  incomes: IncomeEntry[];
  expenses: ExpenseEntry[];
  budgetTargets: BudgetTarget[];
  username: string;
  monthKey: string;
};

export type HydrationResult = {
  migrated: boolean;
  skippedReason?: string;
  /** Present when legacy non-UUID ids were reminted for Postgres PKs. */
  remapped?: {
    incomes: IncomeEntry[];
    expenses: ExpenseEntry[];
    budgetTargets: BudgetTarget[];
  };
};

function mintId(existing: string): string {
  if (isUuid(existing)) return existing;
  if (
    typeof crypto !== "undefined" &&
    typeof crypto.randomUUID === "function"
  ) {
    return crypto.randomUUID();
  }
  return existing;
}

function remintLedgerIds(snapshot: LocalVaultSnapshot): {
  incomes: IncomeEntry[];
  expenses: ExpenseEntry[];
  budgetTargets: BudgetTarget[];
  changed: boolean;
} {
  const budgetIdMap = new Map<string, string>();
  let changed = false;

  const budgetTargets = snapshot.budgetTargets.map((target) => {
    const nextId = mintId(target.id);
    if (nextId !== target.id) {
      changed = true;
      budgetIdMap.set(target.id, nextId);
    }
    return nextId === target.id ? target : { ...target, id: nextId };
  });

  const incomes = snapshot.incomes.map((entry) => {
    const nextId = mintId(entry.id);
    if (nextId !== entry.id) changed = true;
    return nextId === entry.id ? entry : { ...entry, id: nextId };
  });

  const expenses = snapshot.expenses.map((entry) => {
    const nextId = mintId(entry.id);
    const mappedCategory = entry.budgetCategoryId
      ? (budgetIdMap.get(entry.budgetCategoryId) ?? entry.budgetCategoryId)
      : undefined;
    const categoryChanged =
      mappedCategory !== undefined && mappedCategory !== entry.budgetCategoryId;
    if (nextId !== entry.id || categoryChanged) changed = true;
    if (nextId === entry.id && !categoryChanged) return entry;
    return {
      ...entry,
      id: nextId,
      ...(mappedCategory ? { budgetCategoryId: mappedCategory } : {}),
    };
  });

  return { incomes, expenses, budgetTargets, changed };
}

export function hasMigratableLocalData(snapshot: LocalVaultSnapshot): boolean {
  return (
    snapshot.incomes.length > 0 ||
    snapshot.expenses.length > 0 ||
    snapshot.budgetTargets.length > 0
  );
}

export async function isCloudVaultEmpty(userId: string): Promise<boolean> {
  const supabase = getSupabaseBrowserClient();
  if (!supabase) return false;

  const [incomes, expenses, budgets] = await Promise.all([
    supabase
      .from("income_entries")
      .select("id", { count: "exact", head: true })
      .eq("user_id", userId),
    supabase
      .from("expense_entries")
      .select("id", { count: "exact", head: true })
      .eq("user_id", userId),
    supabase
      .from("budget_targets")
      .select("id", { count: "exact", head: true })
      .eq("user_id", userId),
  ]);

  if (incomes.error || expenses.error || budgets.error) {
    console.error("[cloud-hydrate] emptiness probe failed", {
      incomes: incomes.error,
      expenses: expenses.error,
      budgets: budgets.error,
    });
    throw incomes.error ?? expenses.error ?? budgets.error;
  }

  return (
    (incomes.count ?? 0) === 0 &&
    (expenses.count ?? 0) === 0 &&
    (budgets.count ?? 0) === 0
  );
}

/**
 * If the steward has local history and an empty cloud vault, batch-upsert
 * incomes, expenses, and budget targets. Safe to call once per user session.
 */
export async function migrateLocalLedgerToCloud(
  userId: string,
  snapshot: LocalVaultSnapshot
): Promise<HydrationResult> {
  const supabase = getSupabaseBrowserClient();
  if (!supabase) {
    return { migrated: false, skippedReason: "supabase_unconfigured" };
  }

  if (!hasMigratableLocalData(snapshot)) {
    await upsertStewardProfile(userId, snapshot.username || "Steward");
    return { migrated: false, skippedReason: "local_empty" };
  }

  const empty = await isCloudVaultEmpty(userId);
  if (!empty) {
    return { migrated: false, skippedReason: "cloud_not_empty" };
  }

  const reminted = remintLedgerIds(snapshot);

  await upsertStewardProfile(userId, snapshot.username || "Steward");

  if (reminted.budgetTargets.length > 0) {
    const rows = reminted.budgetTargets.map((target) =>
      toBudgetTargetInsert(userId, target, snapshot.monthKey)
    );
    const { error } = await supabase
      .from("budget_targets")
      .upsert(rows, { onConflict: "id" });
    if (error) throw error;
  }

  if (reminted.incomes.length > 0) {
    const rows = reminted.incomes.map((entry) =>
      toIncomeInsert(userId, entry)
    );
    const { error } = await supabase
      .from("income_entries")
      .upsert(rows, { onConflict: "id" });
    if (error) throw error;
  }

  if (reminted.expenses.length > 0) {
    const rows = reminted.expenses.map((entry) =>
      toExpenseInsert(userId, entry)
    );
    const { error } = await supabase
      .from("expense_entries")
      .upsert(rows, { onConflict: "id" });
    if (error) throw error;
  }

  return {
    migrated: true,
    ...(reminted.changed
      ? {
          remapped: {
            incomes: reminted.incomes,
            expenses: reminted.expenses,
            budgetTargets: reminted.budgetTargets,
          },
        }
      : {}),
  };
}
