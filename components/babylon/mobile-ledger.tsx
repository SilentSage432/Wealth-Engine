"use client";

import { useState, type KeyboardEvent } from "react";
import { Check, Pencil, Trash2 } from "lucide-react";
import { LedgerRecordEditors } from "@/components/babylon/ledger-record-editors";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { INTERVAL_LABELS, STREAM_KIND_LABELS } from "@/lib/babylon/constants";
import { formatDiscreetCurrency } from "@/lib/babylon/discreet";
import {
  PHONE_LEDGER_SECTIONS,
  phoneDebtClearedPct,
  phoneExpenseTiming,
  phoneLedgerDateLabel,
  selectPhoneLedgerSection,
  type PhoneLedgerSection,
} from "@/lib/babylon/mobile-ledger";
import { cn, formatCurrency } from "@/lib/utils";
import type {
  BudgetTarget,
  DebtEntry,
  ExpenseEntry,
  ExpenseKind,
  IncomeEntry,
  RecurringObligation,
} from "@/types/babylon";

interface MobileLedgerProps {
  incomes: IncomeEntry[];
  expenses: ExpenseEntry[];
  debts: DebtEntry[];
  needSpend: number;
  desireSpend: number;
  totalSpent: number;
  budgetTargets: BudgetTarget[];
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
  discreet: boolean;
}

export function MobileLedger({
  incomes,
  expenses,
  debts,
  needSpend,
  desireSpend,
  totalSpent,
  budgetTargets,
  onDeleteIncome,
  onDeleteExpense,
  onDeleteDebt,
  onToggleExpenseSettled,
  recurringObligations,
  onUpdateExpense,
  onUpdateRecurringObligation,
  discreet,
}: MobileLedgerProps) {
  const [section, setSection] = useState<PhoneLedgerSection>("income");
  const money = (value: number) =>
    formatDiscreetCurrency(value, discreet, formatCurrency);
  const needPct =
    totalSpent > 0 ? Math.round((needSpend / totalSpent) * 100) : null;

  const onTabKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const next = selectPhoneLedgerSection(section, event.key);
    if (!next) return;
    event.preventDefault();
    setSection(next);
    document.getElementById(`ledger-tab-${next}`)?.focus();
  };

  return (
    <LedgerRecordEditors
      budgetTargets={budgetTargets}
      recurringObligations={recurringObligations}
      onToggleExpenseSettled={onToggleExpenseSettled}
      onUpdateExpense={onUpdateExpense}
      onUpdateRecurringObligation={onUpdateRecurringObligation}
    >
      {({
        categoryLabel,
        pulsingSettledId,
        handleToggleSettled,
        clearPulse,
        openExpenseEdit,
        openRuleEdit,
      }) => (
        <section className="min-w-0 space-y-3" aria-label="Ledger">
          <div
            role="tablist"
            aria-label="Ledger records"
            className="grid grid-cols-3 gap-1 rounded-lg border border-slate-800 bg-slate-950/80 p-1"
            onKeyDown={onTabKeyDown}
          >
            {PHONE_LEDGER_SECTIONS.map((item) => {
              const selected = section === item.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  role="tab"
                  id={`ledger-tab-${item.id}`}
                  aria-controls={`ledger-panel-${item.id}`}
                  aria-selected={selected}
                  tabIndex={selected ? 0 : -1}
                  className={cn(
                    "min-h-11 rounded-md px-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/60",
                    selected
                      ? "bg-slate-800 font-semibold text-slate-100"
                      : "font-medium text-slate-400"
                  )}
                  onClick={() => setSection(item.id)}
                >
                  {item.label}
                </button>
              );
            })}
          </div>

          {section === "income" && (
            <div
              role="tabpanel"
              id="ledger-panel-income"
              aria-labelledby="ledger-tab-income"
              className="min-w-0"
            >
              {incomes.length === 0 ? (
                <p className="py-10 text-center text-sm text-slate-500">
                  No entries yet. Use Add to begin.
                </p>
              ) : (
                <ul className="space-y-2">
                  {incomes.map((row) => (
                    <li
                      key={row.id}
                      className="min-w-0 rounded-lg border border-slate-800/80 bg-slate-950/40 px-3 py-3"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <p className="min-w-0 break-words font-medium text-slate-100">
                          {row.source}
                        </p>
                        <p className="shrink-0 tabular-nums text-emerald-300">
                          {money(row.amount)}
                        </p>
                      </div>
                      <p className="mt-1 text-xs text-slate-400">
                        {STREAM_KIND_LABELS[row.kind]} · {INTERVAL_LABELS[row.interval]} ·{" "}
                        {phoneLedgerDateLabel(row.date)}
                      </p>
                      {row.debtRedirected ? (
                        <p className="mt-1 text-[11px] font-medium text-emerald-400">
                          30% archive
                        </p>
                      ) : null}
                      <p className="mt-1 text-[11px] leading-5 text-slate-500">
                        Wealth Building {money(row.wealthShare)} · Debt Payoff{" "}
                        {money(row.debtShare)} · Living Budget{" "}
                        {money(row.expenditureShare)}
                      </p>
                      <div className="mt-2 flex justify-end">
                        <Button
                          variant="ghost"
                          size="icon"
                          className="text-slate-500 hover:text-rose-400"
                          onClick={() => onDeleteIncome(row.id)}
                          aria-label={`Delete income ${row.source}`}
                        >
                          <Trash2 aria-hidden="true" />
                        </Button>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}

          {section === "expenses" && (
            <div
              role="tabpanel"
              id="ledger-panel-expenses"
              aria-labelledby="ledger-tab-expenses"
              className="min-w-0 space-y-3"
            >
              <div className="grid grid-cols-2 gap-2">
                <div className="min-w-0 rounded-lg border border-emerald-900/40 bg-emerald-950/20 px-3 py-2">
                  <p className="text-[10px] uppercase tracking-wider text-emerald-500/80">
                    Needs
                  </p>
                  <p className="mt-1 text-lg font-semibold tabular-nums text-emerald-300">
                    {money(needSpend)}
                  </p>
                  <p className="text-[11px] text-slate-500">
                    {needPct !== null ? `${needPct}% of spend` : "No spend yet"}
                  </p>
                </div>
                <div className="min-w-0 rounded-lg border border-amber-900/40 bg-amber-950/20 px-3 py-2">
                  <p className="text-[10px] uppercase tracking-wider text-amber-500/80">
                    Wants
                  </p>
                  <p className="mt-1 text-lg font-semibold tabular-nums text-amber-300">
                    {money(desireSpend)}
                  </p>
                </div>
              </div>

              {expenses.length === 0 ? (
                <p className="py-10 text-center text-sm text-slate-500">
                  No entries yet. Use Add to begin.
                </p>
              ) : (
                <ul className="space-y-2">
                  {expenses.map((row) => {
                    const timing = phoneExpenseTiming(row);
                    const bucket = categoryLabel(row.budgetCategoryId);
                    return (
                      <li
                        key={row.id}
                        className={cn(
                          "min-w-0 rounded-lg border border-slate-800/80 bg-slate-950/40 px-3 py-3",
                          row.isSettled && "opacity-55"
                        )}
                      >
                        <div className="flex items-start justify-between gap-3">
                          <p
                            className={cn(
                              "min-w-0 break-words font-medium",
                              row.isSettled
                                ? "text-slate-400 line-through decoration-slate-500"
                                : "text-slate-100"
                            )}
                          >
                            {row.name}
                          </p>
                          <p
                            className={cn(
                              "shrink-0 tabular-nums",
                              row.isSettled &&
                                "text-slate-500 line-through decoration-slate-600"
                            )}
                          >
                            {money(row.amount)}
                          </p>
                        </div>
                        <p className="mt-1 text-xs font-medium text-slate-300">
                          {timing}
                        </p>
                        <p className="mt-1 text-xs text-slate-400">
                          Due {phoneLedgerDateLabel(row.dueDate)} · Recorded{" "}
                          {phoneLedgerDateLabel(row.date)}
                        </p>
                        <p className="mt-1 text-xs text-slate-400">
                          {row.category === "need" ? "Need" : "Want"} · {bucket}
                        </p>
                        {row.recurringObligationId ? (
                          <button
                            type="button"
                            className="mt-1 inline-flex min-h-11 items-center text-xs font-medium text-slate-400 underline-offset-2 hover:text-slate-200 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/60"
                            onClick={() => openRuleEdit(row.recurringObligationId!)}
                          >
                            Edit rule
                          </button>
                        ) : null}
                        <div className="mt-2 flex items-center justify-end gap-1">
                          <button
                            type="button"
                            onClick={() => handleToggleSettled(row)}
                            onAnimationEnd={() => clearPulse(row.id)}
                            aria-label={
                              row.isSettled
                                ? `Mark ${row.name} as upcoming`
                                : `Mark ${row.name} as paid`
                            }
                            aria-pressed={row.isSettled}
                            className={cn(
                              "flex h-11 w-11 items-center justify-center rounded-md border focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/60",
                              row.isSettled
                                ? "border-emerald-500/50 bg-emerald-500/15 text-emerald-400"
                                : "border-slate-700 bg-slate-950/50 text-slate-500",
                              pulsingSettledId === row.id && "animate-settle-pulse"
                            )}
                          >
                            <Check className="h-4 w-4" aria-hidden="true" />
                          </button>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="text-slate-500 hover:text-slate-200"
                            onClick={() => openExpenseEdit(row)}
                            aria-label={`Edit expense ${row.name}`}
                          >
                            <Pencil aria-hidden="true" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="text-slate-500 hover:text-rose-400"
                            onClick={() => onDeleteExpense(row.id)}
                            aria-label={`Delete expense ${row.name}`}
                          >
                            <Trash2 aria-hidden="true" />
                          </Button>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          )}

          {section === "debts" && (
            <div
              role="tabpanel"
              id="ledger-panel-debts"
              aria-labelledby="ledger-tab-debts"
              className="min-w-0"
            >
              {debts.length === 0 ? (
                <p className="py-10 text-center text-sm text-slate-500">
                  No entries yet. Use Add to begin.
                </p>
              ) : (
                <ul className="space-y-2">
                  {debts.map((row) => {
                    const pct = phoneDebtClearedPct(
                      row.totalDebt,
                      row.remainingDebt
                    );
                    return (
                      <li
                        key={row.id}
                        className="min-w-0 rounded-lg border border-slate-800/80 bg-slate-950/40 px-3 py-3"
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <p className="break-words font-medium text-slate-100">
                              {row.creditor}
                            </p>
                            <p className="mt-1 text-[11px] text-slate-500">
                              Remaining
                            </p>
                          </div>
                          <p className="shrink-0 tabular-nums text-amber-300">
                            {money(row.remainingDebt)}
                          </p>
                        </div>
                        <p className="mt-1 text-xs text-slate-400">
                          Total {money(row.totalDebt)} · {pct}% toward zero
                        </p>
                        <p className="mt-1 text-xs text-slate-400">
                          Monthly allocation {money(row.monthlyAllocation)} ·{" "}
                          {row.interestRate}% APR
                        </p>
                        <Progress
                          value={pct}
                          className="mt-2 h-1.5"
                          indicatorClassName="bg-amber-500"
                          aria-label={`${row.creditor} ${pct}% toward zero`}
                        />
                        <div className="mt-2 flex justify-end">
                          <Button
                            variant="ghost"
                            size="icon"
                            className="text-slate-500 hover:text-rose-400"
                            onClick={() => onDeleteDebt(row.id)}
                            aria-label={`Delete debt ${row.creditor}`}
                          >
                            <Trash2 aria-hidden="true" />
                          </Button>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          )}
        </section>
      )}
    </LedgerRecordEditors>
  );
}
