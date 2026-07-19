/**
 * Cloud mutation primitives for Path A dual-write.
 * Presentation never calls these directly — useBabylonEngine composes them.
 */

import {
  toBudgetTargetInsert,
  toExpenseInsert,
  toIncomeInsert,
} from "@/lib/babylon/cloud-mappers";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import type { BudgetTarget, ExpenseEntry, IncomeEntry } from "@/types/babylon";

async function requireClient() {
  const client = getSupabaseBrowserClient();
  if (!client) {
    throw new Error(
      "[cloud-sync] Supabase client unavailable — check NEXT_PUBLIC_SUPABASE_* env."
    );
  }
  return client;
}

export async function cloudUpsertIncome(
  userId: string,
  entry: IncomeEntry
): Promise<void> {
  const supabase = await requireClient();
  const { error } = await supabase
    .from("income_entries")
    .upsert(toIncomeInsert(userId, entry), { onConflict: "id" });
  if (error) throw error;
}

export async function cloudUpsertExpense(
  userId: string,
  entry: ExpenseEntry
): Promise<void> {
  const supabase = await requireClient();
  const { error } = await supabase
    .from("expense_entries")
    .upsert(toExpenseInsert(userId, entry), { onConflict: "id" });
  if (error) throw error;
}

export async function cloudUpdateExpenseSettled(
  userId: string,
  expenseId: string,
  isSettled: boolean
): Promise<void> {
  const supabase = await requireClient();
  const { error } = await supabase
    .from("expense_entries")
    .update({ is_settled: isSettled })
    .eq("id", expenseId)
    .eq("user_id", userId);
  if (error) throw error;
}

export async function cloudUpsertBudgetTargets(
  userId: string,
  targets: BudgetTarget[],
  monthKey: string
): Promise<void> {
  const supabase = await requireClient();
  const rows = targets.map((target) =>
    toBudgetTargetInsert(userId, target, monthKey)
  );
  const { error } = await supabase
    .from("budget_targets")
    .upsert(rows, { onConflict: "id" });
  if (error) throw error;
}
