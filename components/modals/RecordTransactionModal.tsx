"use client";

import { useEffect, useState, type FormEvent } from "react";
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { INTERVAL_LABELS } from "@/lib/babylon/constants";
import { todayIso } from "@/lib/babylon/engine";
import { cn, formatCurrency } from "@/lib/utils";
import type {
  AllocationSplit,
  BudgetTarget,
  DebtInput,
  ExpenseInput,
  IncomeInput,
  IncomeInterval,
  TributeMode,
} from "@/types/babylon";

interface RecordTransactionModalProps {
  open: boolean;
  mode: TributeMode;
  hasActiveDebt: boolean;
  budgetTargets: BudgetTarget[];
  onOpenChange: (open: boolean) => void;
  onModeChange: (mode: TributeMode) => void;
  onPreviewAllocation: (gross: number) => AllocationSplit;
  onRecordIncome: (input: IncomeInput) => boolean;
  onRecordExpense: (input: ExpenseInput) => boolean;
  onRecordDebt: (input: DebtInput) => boolean;
  onAddBudgetTarget: (target: Omit<BudgetTarget, "id">) => boolean;
}

const MODE_COPY: Record<
  TributeMode,
  { title: string; description: string; submit: string }
> = {
  income: {
    title: "Income stream",
    description:
      "Record gross income for autonomous 10/20/70 allocation into wealth, debt, and living allowance.",
    submit: "Allocate Tribute",
  },
  expense: {
    title: "Expense Item",
    description:
      "Archive a Necessary Expenditures draw — name, amount, bucket, and due date.",
    submit: "Archive Expense",
  },
  debt: {
    title: "Debt Obligation",
    description:
      "Enroll a creditor with total balance and mandatory monthly allocation.",
    submit: "Enroll Creditor",
  },
  budget: {
    title: "Budget Category Blueprint",
    description:
      "Map a custom Necessary Expenditures bucket — name, monthly cap, and essential vs. discretionary.",
    submit: "Add Budget Bucket",
  },
};

export function RecordTransactionModal({
  open,
  mode,
  hasActiveDebt,
  budgetTargets,
  onOpenChange,
  onModeChange,
  onPreviewAllocation,
  onRecordIncome,
  onRecordExpense,
  onRecordDebt,
  onAddBudgetTarget,
}: RecordTransactionModalProps) {
  const [incomeSource, setIncomeSource] = useState("");
  const [incomeAmount, setIncomeAmount] = useState("");
  const [incomeDate, setIncomeDate] = useState(todayIso());
  const [incomeInterval, setIncomeInterval] =
    useState<IncomeInterval>("monthly");

  const [expenseName, setExpenseName] = useState("");
  const [expenseAmount, setExpenseAmount] = useState("");
  const [expenseDate, setExpenseDate] = useState(todayIso());
  const [expenseDueDate, setExpenseDueDate] = useState(todayIso());
  const [expenseIsDesire, setExpenseIsDesire] = useState(false);
  const [expenseBudgetId, setExpenseBudgetId] = useState("");

  const [debtCreditor, setDebtCreditor] = useState("");
  const [debtTotal, setDebtTotal] = useState("");
  const [debtMonthly, setDebtMonthly] = useState("");

  const [budgetName, setBudgetName] = useState("");
  const [budgetCap, setBudgetCap] = useState("");
  const [budgetIsEssential, setBudgetIsEssential] = useState(true);

  useEffect(() => {
    if (!open) return;
    setIncomeSource("");
    setIncomeAmount("");
    setIncomeDate(todayIso());
    setIncomeInterval("monthly");
    setExpenseName("");
    setExpenseAmount("");
    setExpenseDate(todayIso());
    setExpenseDueDate(todayIso());
    setExpenseIsDesire(false);
    setExpenseBudgetId(
      budgetTargets.find((t) => t.isEssential)?.id ??
        budgetTargets[0]?.id ??
        ""
    );
    setDebtCreditor("");
    setDebtTotal("");
    setDebtMonthly("");
    setBudgetName("");
    setBudgetCap("");
    setBudgetIsEssential(true);
    // Reset only when the modal opens or the active profile tab changes —
    // live `budgetTargets` updates are handled by the sync effect below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, mode]);

  // Keep expense category selection valid as the live blueprint changes.
  useEffect(() => {
    if (budgetTargets.length === 0) {
      setExpenseBudgetId("");
      return;
    }
    const stillValid = budgetTargets.some((t) => t.id === expenseBudgetId);
    if (!stillValid) {
      setExpenseBudgetId(
        budgetTargets.find((t) => t.isEssential)?.id ??
          budgetTargets[0]?.id ??
          ""
      );
    }
  }, [budgetTargets, expenseBudgetId]);

  const handleDesireToggle = (isDesire: boolean) => {
    setExpenseIsDesire(isDesire);
    if (isDesire) {
      const discretionary = budgetTargets.find((t) => !t.isEssential);
      if (discretionary) setExpenseBudgetId(discretionary.id);
      return;
    }
    const essential = budgetTargets.find((t) => t.isEssential);
    if (essential) setExpenseBudgetId(essential.id);
  };

  const hasBudgetCategories = budgetTargets.length > 0;

  const handleBudgetCategoryChange = (id: string) => {
    setExpenseBudgetId(id);
    const target = budgetTargets.find((t) => t.id === id);
    if (target) setExpenseIsDesire(!target.isEssential);
  };

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault();

    if (mode === "income") {
      onRecordIncome({
        source: incomeSource,
        amount: Number.parseFloat(incomeAmount),
        date: incomeDate,
        interval: incomeInterval,
      });
      return;
    }

    if (mode === "expense") {
      onRecordExpense({
        name: expenseName,
        amount: Number.parseFloat(expenseAmount),
        date: expenseDate,
        dueDate: expenseDueDate,
        category: expenseIsDesire ? "desire" : "need",
        budgetCategoryId: expenseBudgetId,
      });
      return;
    }

    if (mode === "debt") {
      onRecordDebt({
        creditor: debtCreditor,
        totalDebt: Number.parseFloat(debtTotal),
        monthlyAllocation: Number.parseFloat(debtMonthly),
      });
      return;
    }

    onAddBudgetTarget({
      categoryName: budgetName,
      plannedAmount: Number.parseFloat(budgetCap),
      isEssential: budgetIsEssential,
    });
  };

  const parsedIncome = Number.parseFloat(incomeAmount);
  const showPreview = Number.isFinite(parsedIncome) && parsedIncome > 0;
  const preview = showPreview ? onPreviewAllocation(parsedIncome) : null;
  const copy = MODE_COPY[mode];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[min(90vh,900px)] overflow-y-auto scrollbar-thin sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="font-[family-name:var(--font-display)] text-xl sm:text-2xl">
            Record Tribute
          </DialogTitle>
          <DialogDescription>{copy.description}</DialogDescription>
        </DialogHeader>

        <Tabs
          value={mode}
          onValueChange={(v) => onModeChange(v as TributeMode)}
          className="w-full"
        >
          <TabsList className="grid h-auto w-full grid-cols-2 gap-1 p-1 sm:grid-cols-4">
            <TabsTrigger
              value="income"
              className="min-h-11 px-2 text-[11px] leading-tight sm:text-sm"
            >
              Income stream
            </TabsTrigger>
            <TabsTrigger
              value="expense"
              className="min-h-11 px-2 text-[11px] leading-tight sm:text-sm"
            >
              Expense Item
            </TabsTrigger>
            <TabsTrigger
              value="debt"
              className="min-h-11 px-2 text-[11px] leading-tight sm:text-sm"
            >
              Debt Obligation
            </TabsTrigger>
            <TabsTrigger
              value="budget"
              className="min-h-11 px-2 text-[11px] leading-tight sm:text-sm"
            >
              Budget Category
            </TabsTrigger>
          </TabsList>

          <form onSubmit={handleSubmit}>
            <TabsContent value="income" className="mt-4 space-y-4">
              <div className="space-y-2">
                <Label htmlFor="income-source">Source</Label>
                <Input
                  id="income-source"
                  placeholder="e.g. Royal Stipend"
                  value={incomeSource}
                  onChange={(e) => setIncomeSource(e.target.value)}
                  required={mode === "income"}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="income-amount">Gross Amount</Label>
                <Input
                  id="income-amount"
                  type="number"
                  min="0.01"
                  step="0.01"
                  placeholder="0.00"
                  value={incomeAmount}
                  onChange={(e) => setIncomeAmount(e.target.value)}
                  required={mode === "income"}
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-2">
                  <Label htmlFor="income-date">Date</Label>
                  <Input
                    id="income-date"
                    type="date"
                    value={incomeDate}
                    onChange={(e) => setIncomeDate(e.target.value)}
                    required={mode === "income"}
                  />
                </div>
                <div className="space-y-2">
                  <Label>Interval</Label>
                  <Select
                    value={incomeInterval}
                    onValueChange={(v) =>
                      setIncomeInterval(v as IncomeInterval)
                    }
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Interval" />
                    </SelectTrigger>
                    <SelectContent>
                      {(Object.keys(INTERVAL_LABELS) as IncomeInterval[]).map(
                        (key) => (
                          <SelectItem key={key} value={key}>
                            {INTERVAL_LABELS[key]}
                          </SelectItem>
                        )
                      )}
                    </SelectContent>
                  </Select>
                </div>
              </div>
              {preview && (
                <div className="rounded-lg border border-slate-800 bg-slate-950/60 p-3 text-xs">
                  <p className="mb-2 font-medium text-slate-300">
                    Autonomous Allocation Preview
                  </p>
                  <div className="grid grid-cols-3 gap-2 text-center">
                    <div className="rounded-md bg-emerald-500/10 py-2 text-emerald-400">
                      <p className="text-[10px] uppercase">Wealth</p>
                      <p className="mt-0.5 tabular-nums font-semibold">
                        {formatCurrency(preview.wealthShare)}
                      </p>
                    </div>
                    <div className="rounded-md bg-amber-500/10 py-2 text-amber-400">
                      <p className="text-[10px] uppercase">Debt</p>
                      <p className="mt-0.5 tabular-nums font-semibold">
                        {formatCurrency(preview.debtShare)}
                      </p>
                    </div>
                    <div className="rounded-md bg-slate-800 py-2 text-slate-300">
                      <p className="text-[10px] uppercase">Live</p>
                      <p className="mt-0.5 tabular-nums font-semibold">
                        {formatCurrency(preview.expenditureShare)}
                      </p>
                    </div>
                  </div>
                  {!hasActiveDebt && (
                    <p className="mt-2 text-emerald-500/80">
                      No active debt — the 20% creditor share joins your Wealth
                      Archive.
                    </p>
                  )}
                </div>
              )}
            </TabsContent>

            <TabsContent value="expense" className="mt-4 space-y-4">
              <div className="space-y-2">
                <Label htmlFor="expense-name">Name</Label>
                <Input
                  id="expense-name"
                  placeholder="e.g. Market Provisions"
                  value={expenseName}
                  onChange={(e) => setExpenseName(e.target.value)}
                  required={mode === "expense"}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="expense-amount">Amount</Label>
                <Input
                  id="expense-amount"
                  type="number"
                  min="0.01"
                  step="0.01"
                  placeholder="0.00"
                  value={expenseAmount}
                  onChange={(e) => setExpenseAmount(e.target.value)}
                  required={mode === "expense"}
                />
              </div>
              <div className="space-y-2">
                <Label>Category</Label>
                {hasBudgetCategories ? (
                  <Select
                    value={expenseBudgetId}
                    onValueChange={handleBudgetCategoryChange}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Select category" />
                    </SelectTrigger>
                    <SelectContent>
                      {budgetTargets.map((target) => (
                        <SelectItem key={target.id} value={target.id}>
                          {target.categoryName}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                ) : (
                  <div className="rounded-md border border-dashed border-slate-800 bg-slate-950/50 px-3 py-3 text-xs leading-relaxed text-slate-500">
                    No budget buckets yet. Switch to the{" "}
                    <span className="text-slate-300">Budget Category</span> tab
                    to map your blueprint first.
                  </div>
                )}
              </div>
              <div className="space-y-2">
                <Label htmlFor="expense-due-date">Due Date</Label>
                <Input
                  id="expense-due-date"
                  type="date"
                  value={expenseDueDate}
                  onChange={(e) => setExpenseDueDate(e.target.value)}
                  required={mode === "expense"}
                />
              </div>
              <input type="hidden" value={expenseDate} readOnly />
              <div className="flex items-center justify-between rounded-lg border border-slate-800 bg-slate-950/50 px-4 py-3">
                <div>
                  <p className="text-sm font-medium text-slate-200">
                    Needs vs. Desires Gatekeeper
                  </p>
                  <p className="text-xs text-slate-500">
                    {expenseIsDesire
                      ? "Discretionary Desire — lifestyle creep watch"
                      : "Core Need — housing, food, utilities, life"}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <span
                    className={cn(
                      "text-xs font-medium",
                      !expenseIsDesire ? "text-emerald-400" : "text-slate-500"
                    )}
                  >
                    Need
                  </span>
                  <Switch
                    checked={expenseIsDesire}
                    onCheckedChange={handleDesireToggle}
                    aria-label="Toggle desire"
                  />
                  <span
                    className={cn(
                      "text-xs font-medium",
                      expenseIsDesire ? "text-amber-400" : "text-slate-500"
                    )}
                  >
                    Desire
                  </span>
                </div>
              </div>
            </TabsContent>

            <TabsContent value="debt" className="mt-4 space-y-4">
              <div className="space-y-2">
                <Label htmlFor="debt-creditor">Creditor</Label>
                <Input
                  id="debt-creditor"
                  placeholder="e.g. Babylon Credit Union"
                  value={debtCreditor}
                  onChange={(e) => setDebtCreditor(e.target.value)}
                  required={mode === "debt"}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="debt-total">Total Debt</Label>
                <Input
                  id="debt-total"
                  type="number"
                  min="0.01"
                  step="0.01"
                  placeholder="0.00"
                  value={debtTotal}
                  onChange={(e) => setDebtTotal(e.target.value)}
                  required={mode === "debt"}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="debt-monthly">Monthly Target Allocation</Label>
                <Input
                  id="debt-monthly"
                  type="number"
                  min="0.01"
                  step="0.01"
                  placeholder="0.00"
                  value={debtMonthly}
                  onChange={(e) => setDebtMonthly(e.target.value)}
                  required={mode === "debt"}
                />
                <p className="text-xs text-slate-500">
                  Fixed amount reserved each month toward this creditor.
                </p>
              </div>
              <p className="text-xs leading-relaxed text-slate-500">
                Income tributes automatically apply 20% toward active debts
                (smallest balance first). When all creditors are satisfied, that
                fifth fattens the Wealth Archive.
              </p>
            </TabsContent>

            <TabsContent value="budget" className="mt-4 space-y-4">
              <div className="space-y-2">
                <Label htmlFor="budget-category-name">Category Name</Label>
                <Input
                  id="budget-category-name"
                  placeholder='e.g. Sustenance, Insurance, Custom Hobby'
                  value={budgetName}
                  onChange={(e) => setBudgetName(e.target.value)}
                  required={mode === "budget"}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="budget-planned-cap">Planned Cap</Label>
                <Input
                  id="budget-planned-cap"
                  type="number"
                  min="0"
                  step="0.01"
                  placeholder="0.00"
                  value={budgetCap}
                  onChange={(e) => setBudgetCap(e.target.value)}
                  required={mode === "budget"}
                />
                <p className="text-[11px] text-slate-500">
                  Soft ceiling inside the 70% living-allowance boundary.
                </p>
              </div>
              <div className="flex items-center justify-between rounded-lg border border-slate-800 bg-slate-950/50 px-4 py-3">
                <div>
                  <p className="text-sm font-medium text-slate-200">
                    Essential Need vs. Discretionary Desire
                  </p>
                  <p className="text-xs text-slate-500">
                    {budgetIsEssential
                      ? "Core Need — housing, food, utilities, life"
                      : "Discretionary Desire — lifestyle creep watch"}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <span
                    className={cn(
                      "text-xs font-medium",
                      budgetIsEssential ? "text-emerald-400" : "text-slate-500"
                    )}
                  >
                    Essential
                  </span>
                  <Switch
                    checked={!budgetIsEssential}
                    onCheckedChange={(checked) =>
                      setBudgetIsEssential(!checked)
                    }
                    aria-label="Toggle discretionary desire"
                  />
                  <span
                    className={cn(
                      "text-xs font-medium",
                      !budgetIsEssential ? "text-amber-400" : "text-slate-500"
                    )}
                  >
                    Desire
                  </span>
                </div>
              </div>
            </TabsContent>

            <DialogFooter className="mt-6">
              <Button
                type="button"
                variant="outline"
                onClick={() => onOpenChange(false)}
              >
                Cancel
              </Button>
              <Button
                type="submit"
                disabled={mode === "expense" && !hasBudgetCategories}
              >
                {copy.submit}
              </Button>
            </DialogFooter>
          </form>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}
