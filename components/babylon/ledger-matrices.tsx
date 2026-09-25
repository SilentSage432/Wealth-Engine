"use client";

import { useState, type FormEvent } from "react";
import { Check, Pencil, Plus, Trash2 } from "lucide-react";
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
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { INTERVAL_LABELS, STREAM_KIND_LABELS } from "@/lib/babylon/constants";
import { isDueWithinWeek, isOverdue } from "@/lib/babylon/engine";
import { cn, formatCurrency } from "@/lib/utils";
import type {
  BudgetTarget,
  DebtEntry,
  ExpenseEntry,
  ExpenseKind,
  IncomeEntry,
  RecurringObligation,
  TributeMode,
} from "@/types/babylon";

interface LedgerMatricesProps {
  incomes: IncomeEntry[];
  expenses: ExpenseEntry[];
  debts: DebtEntry[];
  needSpend: number;
  desireSpend: number;
  totalSpent: number;
  budgetTargets: BudgetTarget[];
  onOpenTribute: (mode: TributeMode) => void;
  onDeleteIncome: (id: string) => void;
  onDeleteExpense: (id: string) => void;
  onDeleteDebt: (id: string) => void;
  onToggleExpenseSettled: (id: string) => void;
  recurringObligations: RecurringObligation[];
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
}

export function LedgerMatrices({
  incomes,
  expenses,
  debts,
  needSpend,
  desireSpend,
  totalSpent,
  budgetTargets,
  onOpenTribute,
  onDeleteIncome,
  onDeleteExpense,
  onDeleteDebt,
  onToggleExpenseSettled,
  recurringObligations,
  onUpdateExpense,
  onUpdateRecurringObligation,
}: LedgerMatricesProps) {
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
    <section className="animate-fade-up">
      <Card>
        <CardHeader className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <CardTitle className="font-[family-name:var(--font-display)] text-xl">
              Ledger
            </CardTitle>
            <CardDescription>
              Income, expenses, and debts
            </CardDescription>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => onOpenTribute("income")}
              aria-label="Add income"
            >
              <Plus className="h-3.5 w-3.5" aria-hidden="true" />
              Income
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => onOpenTribute("expense")}
              aria-label="Add expense"
            >
              <Plus className="h-3.5 w-3.5" aria-hidden="true" />
              Expense
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => onOpenTribute("debt")}
              aria-label="Record debt obligation"
            >
              <Plus className="h-3.5 w-3.5" aria-hidden="true" />
              Debt
            </Button>
          </div>
        </CardHeader>
        <CardContent className="min-w-0">
          <Tabs defaultValue="income" className="w-full">
            <TabsList className="mb-2 w-full justify-start overflow-x-auto scrollbar-thin sm:w-auto">
              <TabsTrigger value="income" className="min-h-10 shrink-0">
                Income Streams
              </TabsTrigger>
              <TabsTrigger value="expenses" className="min-h-10 shrink-0">
                Expenses Archive
              </TabsTrigger>
              <TabsTrigger value="debts" className="min-h-10 shrink-0">
                Debt Ledger
              </TabsTrigger>
            </TabsList>

            <TabsContent value="income">
              <div className="w-full overflow-x-auto scrollbar-thin">
                <Table className="min-w-[36rem]">
                  <TableHeader>
                    <TableRow>
                      <TableHead>Source</TableHead>
                      <TableHead>Amount</TableHead>
                      <TableHead>Date</TableHead>
                      <TableHead>Interval</TableHead>
                      <TableHead className="hidden lg:table-cell">
                        10/20/70
                      </TableHead>
                      <TableHead className="w-12" />
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {incomes.length === 0 ? (
                      <TableRow>
                        <TableCell
                          colSpan={6}
                          className="py-10 text-center text-sm text-slate-500"
                        >
                          No entries yet. Use Add to begin.
                        </TableCell>
                      </TableRow>
                    ) : (
                      incomes.map((row) => (
                        <TableRow key={row.id}>
                          <TableCell className="font-medium text-slate-100">
                            {row.source}
                            <span
                              className={cn(
                                "ml-2 inline-flex rounded-full px-2 py-0.5 text-[10px] font-medium",
                                row.kind === "side_hustle" &&
                                  "bg-amber-500/10 text-amber-400",
                                row.kind === "passive" &&
                                  "bg-emerald-500/10 text-emerald-400",
                                row.kind === "primary" &&
                                  "bg-slate-700/50 text-slate-300",
                                row.kind === "other" &&
                                  "bg-slate-800 text-slate-500"
                              )}
                            >
                              {STREAM_KIND_LABELS[row.kind]}
                            </span>
                            {row.debtRedirected && (
                              <span className="ml-2 inline-flex rounded-full bg-emerald-500/10 px-2 py-0.5 text-[10px] font-medium text-emerald-400">
                                30% archive
                              </span>
                            )}
                          </TableCell>
                          <TableCell className="tabular-nums text-emerald-300">
                            {formatCurrency(row.amount)}
                          </TableCell>
                          <TableCell className="text-slate-400">
                            {row.date}
                          </TableCell>
                          <TableCell>{INTERVAL_LABELS[row.interval]}</TableCell>
                          <TableCell className="hidden text-xs text-slate-500 lg:table-cell">
                            <span className="text-emerald-400">
                              {formatCurrency(row.wealthShare)}
                            </span>
                            {" · "}
                            <span className="text-amber-400">
                              {formatCurrency(row.debtShare)}
                            </span>
                            {" · "}
                            <span className="text-slate-400">
                              {formatCurrency(row.expenditureShare)}
                            </span>
                          </TableCell>
                          <TableCell>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-10 w-10 text-slate-500 hover:text-rose-400 md:h-8 md:w-8"
                              onClick={() => onDeleteIncome(row.id)}
                              aria-label={`Delete income ${row.source}`}
                            >
                              <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                            </Button>
                          </TableCell>
                        </TableRow>
                      ))
                    )}
                  </TableBody>
                </Table>
              </div>
            </TabsContent>

            <TabsContent value="expenses" className="space-y-4">
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="rounded-lg border border-emerald-900/40 bg-emerald-950/20 p-4">
                  <p className="text-xs uppercase tracking-wider text-emerald-500/80">
                    Core Needs
                  </p>
                  <p className="mt-1 font-[family-name:var(--font-display)] text-2xl font-semibold tabular-nums text-emerald-300">
                    {formatCurrency(needSpend)}
                  </p>
                  <p className="mt-1 text-xs text-slate-500">
                    {totalSpent > 0
                      ? `${Math.round((needSpend / totalSpent) * 100)}% of spend`
                      : "No spend yet"}
                  </p>
                </div>
                <div className="rounded-lg border border-amber-900/40 bg-amber-950/20 p-4">
                  <p className="text-xs uppercase tracking-wider text-amber-500/80">
                    Wants
                  </p>
                  <p className="mt-1 font-[family-name:var(--font-display)] text-2xl font-semibold tabular-nums text-amber-300">
                    {formatCurrency(desireSpend)}
                  </p>
                  <p className="mt-1 text-xs text-slate-500">
                    Discretionary spending. Keep wants from crowding out needs.
                  </p>
                </div>
              </div>

              <div className="w-full overflow-x-auto scrollbar-thin">
                {expenses.length === 0 ? (
                  <Table className="min-w-[44rem]">
                    <TableHeader>
                      <TableRow>
                        <TableHead className="w-12">Paid</TableHead>
                        <TableHead>Name</TableHead>
                        <TableHead>Category</TableHead>
                        <TableHead>Amount</TableHead>
                        <TableHead>Date</TableHead>
                        <TableHead>Due Date</TableHead>
                        <TableHead className="w-12" />
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      <TableRow>
                        <TableCell
                          colSpan={7}
                          className="py-10 text-center text-sm text-slate-500"
                        >
                          No entries yet. Use Add to begin.
                        </TableCell>
                      </TableRow>
                    </TableBody>
                  </Table>
                ) : (
                  <Table className="min-w-[44rem]">
                    <TableHeader>
                      <TableRow>
                        <TableHead className="w-12">Paid</TableHead>
                        <TableHead>Name</TableHead>
                        <TableHead>Category</TableHead>
                        <TableHead>Amount</TableHead>
                        <TableHead>Date</TableHead>
                        <TableHead>Due Date</TableHead>
                        <TableHead className="w-12" />
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {expenses.map((row) => {
                        const dueSoon =
                          !row.isSettled && isDueWithinWeek(row.dueDate);
                        const overdue = !row.isSettled && isOverdue(row.dueDate);
                        const bucket = categoryLabel(row.budgetCategoryId);
                        const timing = row.isSettled
                          ? "Paid"
                          : overdue
                            ? "Overdue"
                            : dueSoon
                              ? "Due soon"
                              : "Upcoming";
                        const statusLabel = row.recurringObligationId
                          ? `Monthly · ${timing}`
                          : timing;
                        return (
                          <TableRow
                            key={row.id}
                            className={cn(
                              "transition-opacity duration-300 ease-out will-change-[opacity]",
                              row.isSettled && "opacity-55"
                            )}
                          >
                            <TableCell>
                              <button
                                type="button"
                                onClick={() => handleToggleSettled(row)}
                                onAnimationEnd={() => {
                                  if (pulsingSettledId === row.id) {
                                    setPulsingSettledId(null);
                                  }
                                }}
                                aria-label={
                                  row.isSettled
                                    ? `Mark ${row.name} as upcoming`
                                    : `Mark ${row.name} as paid`
                                }
                                aria-pressed={row.isSettled}
                                className={cn(
                                  "flex h-10 w-10 items-center justify-center rounded-md border transition-all duration-300 ease-out will-change-transform md:h-8 md:w-8",
                                  row.isSettled
                                    ? "border-emerald-500/50 bg-emerald-500/15 text-emerald-400"
                                    : "border-slate-700 bg-slate-950/50 text-slate-500 hover:border-slate-500 hover:text-slate-300",
                                  pulsingSettledId === row.id &&
                                    "animate-settle-pulse"
                                )}
                              >
                                <Check
                                  className="h-3.5 w-3.5"
                                  aria-hidden="true"
                                />
                              </button>
                            </TableCell>
                            <TableCell
                              className={cn(
                                "font-medium transition-[color,opacity,text-decoration-color] duration-300 ease-out",
                                row.isSettled
                                  ? "text-slate-400 line-through decoration-slate-500"
                                  : "text-slate-100"
                              )}
                            >
                              <span className="inline-flex flex-wrap items-center gap-2">
                                {row.name}
                                <span
                                  className={cn(
                                    "text-[11px] font-medium no-underline",
                                    overdue
                                      ? "text-rose-300"
                                      : dueSoon
                                        ? "text-amber-400"
                                        : row.isSettled
                                          ? "text-emerald-500/80"
                                          : "text-slate-400"
                                  )}
                                >
                                  {statusLabel}
                                </span>
                                {row.recurringObligationId ? (
                                  <button
                                    type="button"
                                    className="text-[11px] font-medium text-slate-400 underline-offset-2 hover:text-slate-200 hover:underline"
                                    onClick={() =>
                                      openRuleEdit(row.recurringObligationId!)
                                    }
                                  >
                                    Edit rule
                                  </button>
                                ) : null}
                              </span>
                              <p className="mt-0.5 text-[11px] font-normal text-slate-500 no-underline">
                                {bucket}
                              </p>
                            </TableCell>
                            <TableCell>
                              <span
                                className={cn(
                                  "inline-flex rounded-full px-2.5 py-0.5 text-xs font-medium",
                                  row.category === "need"
                                    ? "bg-emerald-500/10 text-emerald-400"
                                    : "bg-amber-500/10 text-amber-400"
                                )}
                              >
                                {row.category === "need" ? "Need" : "Want"}
                              </span>
                            </TableCell>
                            <TableCell
                              className={cn(
                                "tabular-nums transition-[color,opacity,text-decoration-color] duration-300 ease-out",
                                row.isSettled &&
                                  "line-through text-slate-500 decoration-slate-600"
                              )}
                            >
                              {formatCurrency(row.amount)}
                            </TableCell>
                            <TableCell className="text-slate-400">
                              {row.date}
                            </TableCell>
                            <TableCell
                              className={cn(
                                "tabular-nums",
                                dueSoon
                                  ? "text-amber-400"
                                  : overdue
                                    ? "text-rose-300"
                                    : "text-slate-400"
                              )}
                            >
                              {row.dueDate}
                            </TableCell>
                            <TableCell>
                              <div className="flex items-center justify-end">
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-10 w-10 text-slate-500 hover:text-slate-200 md:h-8 md:w-8"
                                onClick={() => openExpenseEdit(row)}
                                aria-label={`Edit expense ${row.name}`}
                              >
                                <Pencil
                                  className="h-3.5 w-3.5"
                                  aria-hidden="true"
                                />
                              </Button>
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-10 w-10 text-slate-500 hover:text-rose-400 md:h-8 md:w-8"
                                onClick={() => onDeleteExpense(row.id)}
                                aria-label={`Delete expense ${row.name}`}
                              >
                                <Trash2
                                  className="h-3.5 w-3.5"
                                  aria-hidden="true"
                                />
                              </Button>
                              </div>
                            </TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                )}
              </div>
            </TabsContent>

            <TabsContent value="debts">
              <div className="w-full overflow-x-auto scrollbar-thin">
                <Table className="min-w-[42rem]">
                  <TableHeader>
                    <TableRow>
                      <TableHead>Creditor</TableHead>
                      <TableHead>Total Debt</TableHead>
                      <TableHead>Remaining</TableHead>
                      <TableHead>Monthly Allocation</TableHead>
                      <TableHead className="min-w-[140px]">Progress</TableHead>
                      <TableHead className="w-12" />
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {debts.length === 0 ? (
                      <TableRow>
                        <TableCell
                          colSpan={6}
                          className="py-10 text-center text-sm text-slate-500"
                        >
                          No entries yet. Use Add to begin.
                        </TableCell>
                      </TableRow>
                    ) : (
                      debts.map((row) => {
                        const cleared = Math.max(
                          0,
                          row.totalDebt - row.remainingDebt
                        );
                        const pct =
                          row.totalDebt > 0
                            ? Math.round((cleared / row.totalDebt) * 100)
                            : 100;
                        return (
                          <TableRow key={row.id}>
                            <TableCell className="font-medium text-slate-100">
                              {row.creditor}
                            </TableCell>
                            <TableCell className="tabular-nums">
                              {formatCurrency(row.totalDebt)}
                            </TableCell>
                            <TableCell className="tabular-nums text-amber-300">
                              {formatCurrency(row.remainingDebt)}
                            </TableCell>
                            <TableCell className="tabular-nums text-slate-400">
                              {formatCurrency(row.monthlyAllocation)}
                            </TableCell>
                            <TableCell>
                              <div className="space-y-1.5">
                                <Progress
                                  value={pct}
                                  className="h-1.5"
                                  indicatorClassName="bg-amber-500"
                                />
                                <p className="text-[10px] text-slate-500">
                                  {pct}% toward zero
                                </p>
                              </div>
                            </TableCell>
                            <TableCell>
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-10 w-10 text-slate-500 hover:text-rose-400 md:h-8 md:w-8"
                                onClick={() => onDeleteDebt(row.id)}
                                aria-label={`Delete debt ${row.creditor}`}
                              >
                                <Trash2
                                  className="h-3.5 w-3.5"
                                  aria-hidden="true"
                                />
                              </Button>
                            </TableCell>
                          </TableRow>
                        );
                      })
                    )}
                  </TableBody>
                </Table>
              </div>
            </TabsContent>
          </Tabs>
        </CardContent>
      </Card>

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
    </section>
  );
}
