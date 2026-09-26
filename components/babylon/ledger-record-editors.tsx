"use client";

import { useState, type FormEvent, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import type {
  BudgetTarget,
  ExpenseEntry,
  ExpenseKind,
  RecurringObligation,
} from "@/types/babylon";

export interface LedgerRecordEditorApi {
  categoryLabel: (id: string | undefined) => string;
  pulsingSettledId: string | null;
  handleToggleSettled: (row: ExpenseEntry) => void;
  clearPulse: (id: string) => void;
  openExpenseEdit: (row: ExpenseEntry) => void;
  openRuleEdit: (ruleId: string) => void;
}

interface LedgerRecordEditorsProps {
  budgetTargets: BudgetTarget[];
  recurringObligations: RecurringObligation[];
  onToggleExpenseSettled: (id: string) => void;
  onUpdateExpense: (
    id: string,
    patch: { amount: number; dueDate: string }
  ) => boolean;
  onUpdateRecurringObligation: (
    id: string,
    patch: {
      name: string;
      amount: number;
      category: ExpenseKind;
      budgetCategoryId: string;
      dueDay: number;
      isActive: boolean;
    }
  ) => boolean;
  children: (api: LedgerRecordEditorApi) => ReactNode;
}

/**
 * Shared occurrence and monthly-rule editors.
 * Desktop tables and phone records both open these. Neither form changes
 * settlement or recurrence rules; they call the existing update handlers.
 */
export function LedgerRecordEditors({
  budgetTargets,
  recurringObligations,
  onToggleExpenseSettled,
  onUpdateExpense,
  onUpdateRecurringObligation,
  children,
}: LedgerRecordEditorsProps) {
  const [pulsingSettledId, setPulsingSettledId] = useState<string | null>(null);
  const [editingExpense, setEditingExpense] = useState<ExpenseEntry | null>(null);
  const [expenseAmount, setExpenseAmount] = useState("");
  const [expenseDue, setExpenseDue] = useState("");
  const [expenseError, setExpenseError] = useState<string | null>(null);
  const [editingRule, setEditingRule] = useState<RecurringObligation | null>(null);
  const [ruleName, setRuleName] = useState("");
  const [ruleAmount, setRuleAmount] = useState("");
  const [ruleCategory, setRuleCategory] = useState<ExpenseKind>("need");
  const [ruleBudgetId, setRuleBudgetId] = useState("");
  const [ruleDueDay, setRuleDueDay] = useState("1");
  const [ruleActive, setRuleActive] = useState(true);
  const [ruleError, setRuleError] = useState<string | null>(null);

  const categoryLabel = (id: string | undefined) => {
    if (!id) return "Uncategorized";
    return (
      budgetTargets.find((t) => t.id === id)?.categoryName ?? "Uncategorized"
    );
  };

  const handleToggleSettled = (row: ExpenseEntry) => {
    const willSettle = !row.isSettled;
    onToggleExpenseSettled(row.id);
    if (willSettle) setPulsingSettledId(row.id);
  };

  const clearPulse = (id: string) => {
    if (pulsingSettledId === id) setPulsingSettledId(null);
  };

  const openExpenseEdit = (row: ExpenseEntry) => {
    setEditingExpense(row);
    setExpenseAmount(String(row.amount));
    setExpenseDue(row.dueDate);
    setExpenseError(null);
  };

  const submitExpenseEdit = (event: FormEvent) => {
    event.preventDefault();
    if (!editingExpense) return;
    const ok = onUpdateExpense(editingExpense.id, {
      amount: Number.parseFloat(expenseAmount),
      dueDate: expenseDue,
    });
    if (!ok) {
      setExpenseError("Enter a positive amount and a real due date.");
      return;
    }
    setEditingExpense(null);
  };

  const openRuleEdit = (ruleId: string) => {
    const rule = recurringObligations.find((item) => item.id === ruleId);
    if (!rule) return;
    setEditingRule(rule);
    setRuleName(rule.name);
    setRuleAmount(String(rule.amount));
    setRuleCategory(rule.category);
    setRuleBudgetId(rule.budgetCategoryId);
    setRuleDueDay(String(rule.dueDay));
    setRuleActive(rule.isActive);
    setRuleError(null);
  };

  const submitRuleEdit = (event: FormEvent) => {
    event.preventDefault();
    if (!editingRule) return;
    const ok = onUpdateRecurringObligation(editingRule.id, {
      name: ruleName,
      amount: Number.parseFloat(ruleAmount),
      category: ruleCategory,
      budgetCategoryId: ruleBudgetId,
      dueDay: Number.parseInt(ruleDueDay, 10),
      isActive: ruleActive,
    });
    if (!ok) {
      setRuleError("Check the name, amount, category, and due day.");
      return;
    }
    setEditingRule(null);
  };

  return (
    <>
      {children({
        categoryLabel,
        pulsingSettledId,
        handleToggleSettled,
        clearPulse,
        openExpenseEdit,
        openRuleEdit,
      })}

      <Dialog
        open={editingExpense !== null}
        onOpenChange={(open) => {
          if (!open) setEditingExpense(null);
        }}
      >
        <DialogContent className="sm:max-w-md">
          <form onSubmit={submitExpenseEdit} className="space-y-4">
            <DialogHeader>
              <DialogTitle>Edit this month</DialogTitle>
              <DialogDescription>
                This changes only this occurrence. The monthly rule keeps its
                normal amount.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-2">
              <Label htmlFor="occurrence-amount">Amount</Label>
              <Input
                id="occurrence-amount"
                type="number"
                min="0.01"
                step="0.01"
                inputMode="decimal"
                value={expenseAmount}
                onChange={(event) => setExpenseAmount(event.target.value)}
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="occurrence-due">Due date</Label>
              <Input
                id="occurrence-due"
                type="date"
                value={expenseDue}
                onChange={(event) => setExpenseDue(event.target.value)}
                required
              />
            </div>
            {expenseError ? (
              <p role="alert" className="text-xs text-amber-200">
                {expenseError}
              </p>
            ) : null}
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => setEditingExpense(null)}
              >
                Cancel
              </Button>
              <Button type="submit">Save</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog
        open={editingRule !== null}
        onOpenChange={(open) => {
          if (!open) setEditingRule(null);
        }}
      >
        <DialogContent className="sm:max-w-md">
          <form onSubmit={submitRuleEdit} className="space-y-4">
            <DialogHeader>
              <DialogTitle>Monthly bill</DialogTitle>
              <DialogDescription>
                Changes apply to months generated after this save. Months
                already on the ledger stay as they are.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-2">
              <Label htmlFor="rule-name">Name</Label>
              <Input
                id="rule-name"
                value={ruleName}
                onChange={(event) => setRuleName(event.target.value)}
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="rule-amount">Normal amount</Label>
              <Input
                id="rule-amount"
                type="number"
                min="0.01"
                step="0.01"
                inputMode="decimal"
                value={ruleAmount}
                onChange={(event) => setRuleAmount(event.target.value)}
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="rule-category">Category</Label>
              <Select value={ruleBudgetId} onValueChange={setRuleBudgetId}>
                <SelectTrigger id="rule-category" aria-label="Category">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {budgetTargets.map((target) => (
                    <SelectItem key={target.id} value={target.id}>
                      {target.categoryName}
                    </SelectItem>
                  ))}
                  {!budgetTargets.some((target) => target.id === ruleBudgetId) &&
                  ruleBudgetId ? (
                    <SelectItem value={ruleBudgetId}>
                      {categoryLabel(ruleBudgetId)}
                    </SelectItem>
                  ) : null}
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-center justify-between gap-3">
              <p className="text-sm text-slate-200">Need or Want</p>
              <div className="flex items-center gap-2">
                <span className="text-xs text-slate-400">Need</span>
                <Switch
                  checked={ruleCategory === "desire"}
                  onCheckedChange={(checked) =>
                    setRuleCategory(checked ? "desire" : "need")
                  }
                  aria-label="Toggle want"
                />
                <span className="text-xs text-slate-400">Want</span>
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="rule-day">Due day</Label>
              <Input
                id="rule-day"
                type="number"
                min="1"
                max="31"
                step="1"
                value={ruleDueDay}
                onChange={(event) => setRuleDueDay(event.target.value)}
                required
              />
              <p className="text-[11px] text-slate-500">
                Shorter months use the last valid day. February does not
                change this day.
              </p>
            </div>
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-sm text-slate-200">Active</p>
                <p className="text-[11px] text-slate-500">
                  Turning this off stops new months. Existing bills stay.
                </p>
              </div>
              <Switch
                checked={ruleActive}
                onCheckedChange={setRuleActive}
                aria-label="Monthly bill active"
              />
            </div>
            {ruleError ? (
              <p role="alert" className="text-xs text-amber-200">
                {ruleError}
              </p>
            ) : null}
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => setEditingRule(null)}
              >
                Cancel
              </Button>
              <Button type="submit">Save</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
