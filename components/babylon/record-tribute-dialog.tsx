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
  DebtInput,
  ExpenseInput,
  IncomeInput,
  IncomeInterval,
  TributeMode,
} from "@/types/babylon";

interface RecordTributeDialogProps {
  open: boolean;
  mode: TributeMode;
  hasActiveDebt: boolean;
  onOpenChange: (open: boolean) => void;
  onModeChange: (mode: TributeMode) => void;
  onPreviewAllocation: (gross: number) => AllocationSplit;
  onRecordIncome: (input: IncomeInput) => boolean;
  onRecordExpense: (input: ExpenseInput) => boolean;
  onRecordDebt: (input: DebtInput) => boolean;
}

export function RecordTributeDialog({
  open,
  mode,
  hasActiveDebt,
  onOpenChange,
  onModeChange,
  onPreviewAllocation,
  onRecordIncome,
  onRecordExpense,
  onRecordDebt,
}: RecordTributeDialogProps) {
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

  const [debtCreditor, setDebtCreditor] = useState("");
  const [debtTotal, setDebtTotal] = useState("");
  const [debtMonthly, setDebtMonthly] = useState("");

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
    setDebtCreditor("");
    setDebtTotal("");
    setDebtMonthly("");
  }, [open, mode]);

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
      });
      return;
    }

    onRecordDebt({
      creditor: debtCreditor,
      totalDebt: Number.parseFloat(debtTotal),
      monthlyAllocation: Number.parseFloat(debtMonthly),
    });
  };

  const parsedIncome = Number.parseFloat(incomeAmount);
  const showPreview = Number.isFinite(parsedIncome) && parsedIncome > 0;
  const preview = showPreview ? onPreviewAllocation(parsedIncome) : null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto scrollbar-thin sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="font-[family-name:var(--font-display)] text-2xl">
            Record Tribute
          </DialogTitle>
          <DialogDescription>
            Enter income for autonomous 10/20/70 allocation, log an expenditure,
            or enroll a creditor.
          </DialogDescription>
        </DialogHeader>

        <Tabs
          value={mode}
          onValueChange={(v) => onModeChange(v as TributeMode)}
          className="w-full"
        >
          <TabsList className="grid w-full grid-cols-3">
            <TabsTrigger value="income">Income</TabsTrigger>
            <TabsTrigger value="expense">Expense</TabsTrigger>
            <TabsTrigger value="debt">Debt</TabsTrigger>
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
                  required
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
                  required
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
                    required
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
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-2">
                  <Label htmlFor="expense-date">Date</Label>
                  <Input
                    id="expense-date"
                    type="date"
                    value={expenseDate}
                    onChange={(e) => setExpenseDate(e.target.value)}
                    required={mode === "expense"}
                  />
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
              </div>
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
                    onCheckedChange={setExpenseIsDesire}
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
                <Label htmlFor="debt-monthly">
                  Mandatory Monthly Allocation
                </Label>
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

            <DialogFooter className="mt-6">
              <Button
                type="button"
                variant="outline"
                onClick={() => onOpenChange(false)}
              >
                Cancel
              </Button>
              <Button type="submit">
                {mode === "income" && "Allocate Tribute"}
                {mode === "expense" && "Archive Expense"}
                {mode === "debt" && "Enroll Creditor"}
              </Button>
            </DialogFooter>
          </form>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}
