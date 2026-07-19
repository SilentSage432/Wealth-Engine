"use client";

import { useEffect, useState } from "react";
import { Pencil } from "lucide-react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import { cn, formatCurrency } from "@/lib/utils";
import type { BudgetCategoryVariance } from "@/types/babylon";

interface BudgetBlueprintProps {
  variances: BudgetCategoryVariance[];
  plannedTotal: number;
  actualTotal: number;
  expenditurePool: number;
  onUpdateTarget: (id: string, newAmount: number) => void;
}

function PlannedAmountEditor({
  id,
  plannedAmount,
  onCommit,
}: {
  id: string;
  plannedAmount: number;
  onCommit: (id: string, amount: number) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(String(plannedAmount));

  useEffect(() => {
    if (!editing) setDraft(String(plannedAmount));
  }, [plannedAmount, editing]);

  const commit = () => {
    const parsed = Number.parseFloat(draft);
    if (Number.isFinite(parsed) && parsed >= 0) {
      onCommit(id, parsed);
    } else {
      setDraft(String(plannedAmount));
    }
    setEditing(false);
  };

  if (!editing) {
    return (
      <button
        type="button"
        onClick={() => setEditing(true)}
        className="group inline-flex items-center gap-1.5 rounded-md border border-transparent px-1.5 py-0.5 text-right tabular-nums text-slate-200 transition-colors hover:border-slate-700 hover:bg-slate-950/60"
        aria-label={`Edit planned amount ${formatCurrency(plannedAmount)}`}
      >
        <span className="text-sm font-medium">
          {formatCurrency(plannedAmount)}
        </span>
        <Pencil className="h-3 w-3 text-slate-600 transition-colors group-hover:text-slate-400" />
      </button>
    );
  }

  return (
    <Input
      type="number"
      min="0"
      step="1"
      autoFocus
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          commit();
        }
        if (e.key === "Escape") {
          setDraft(String(plannedAmount));
          setEditing(false);
        }
      }}
      className="h-8 w-[7.5rem] text-right tabular-nums"
      aria-label="Planned monthly amount"
    />
  );
}

export function BudgetBlueprint({
  variances,
  plannedTotal,
  actualTotal,
  expenditurePool,
  onUpdateTarget,
}: BudgetBlueprintProps) {
  const remainingTotal = Math.max(0, plannedTotal - actualTotal);
  const poolPressure =
    expenditurePool > 0
      ? Math.round((plannedTotal / expenditurePool) * 100)
      : null;

  return (
    <section className="animate-fade-up">
      <Card className="border-slate-800/80">
        <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <CardTitle className="font-[family-name:var(--font-display)] text-xl">
              Budget Blueprint
            </CardTitle>
            <CardDescription>
              Plan targets inside the 70% Necessary Expenditures boundary —
              actual vs. planned for the current month
            </CardDescription>
          </div>
          <div className="shrink-0 space-y-0.5 text-right text-xs text-slate-500">
            <p>
              Planned{" "}
              <span className="tabular-nums text-slate-300">
                {formatCurrency(plannedTotal)}
              </span>
              {" · "}
              Spent{" "}
              <span className="tabular-nums text-slate-300">
                {formatCurrency(actualTotal)}
              </span>
            </p>
            <p>
              <span className="tabular-nums text-emerald-400/90">
                {formatCurrency(remainingTotal)}
              </span>{" "}
              remaining across caps
              {poolPressure !== null && (
                <span className="ml-1 text-slate-600">
                  · {poolPressure}% of 70% pool
                </span>
              )}
            </p>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {variances.map((row) => {
            const barPct = Math.min(100, row.usedPct);
            const overCap = row.actualAmount > row.plannedAmount;
            const indicatorClass =
              row.tone === "amber" ? "bg-amber-500" : "bg-emerald-600";

            return (
              <div
                key={row.id}
                className="rounded-lg border border-slate-800/70 bg-slate-950/30 px-3 py-3 sm:px-4"
              >
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0 space-y-0.5">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="text-sm font-medium text-slate-100">
                        {row.categoryName}
                      </p>
                      <span
                        className={cn(
                          "inline-flex rounded px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wider",
                          row.isEssential
                            ? "bg-emerald-500/10 text-emerald-400/90"
                            : "bg-amber-500/10 text-amber-400/90"
                        )}
                      >
                        {row.isEssential ? "Essential" : "Discretionary"}
                      </span>
                    </div>
                    <p className="text-xs text-slate-500">
                      {overCap ? (
                        <>
                          <span className="tabular-nums text-amber-400">
                            {formatCurrency(
                              row.actualAmount - row.plannedAmount
                            )}{" "}
                            over
                          </span>{" "}
                          of {formatCurrency(row.plannedAmount)}
                        </>
                      ) : (
                        <>
                          <span className="tabular-nums text-slate-300">
                            {formatCurrency(row.remainingAmount)} remaining
                          </span>{" "}
                          of {formatCurrency(row.plannedAmount)}
                        </>
                      )}
                    </p>
                  </div>
                  <div className="flex items-center gap-3 text-right">
                    <div className="hidden sm:block">
                      <p className="text-[10px] uppercase tracking-wider text-slate-600">
                        Actual
                      </p>
                      <p className="tabular-nums text-sm text-slate-300">
                        {formatCurrency(row.actualAmount)}
                      </p>
                    </div>
                    <div>
                      <p className="text-[10px] uppercase tracking-wider text-slate-600">
                        Cap
                      </p>
                      <PlannedAmountEditor
                        id={row.id}
                        plannedAmount={row.plannedAmount}
                        onCommit={onUpdateTarget}
                      />
                    </div>
                  </div>
                </div>

                <div className="relative mt-3">
                  {/* Dual layer: track = planned cap; fill = actual spend ratio */}
                  <Progress
                    value={barPct}
                    className="h-2.5 bg-slate-800/90"
                    indicatorClassName={cn(
                      "transition-all duration-500 ease-out",
                      indicatorClass
                    )}
                  />
                  <div className="mt-1.5 flex items-center justify-between text-[10px] tabular-nums text-slate-600">
                    <span>
                      {formatCurrency(row.actualAmount)}
                      <span className="mx-1 text-slate-700">/</span>
                      {formatCurrency(row.plannedAmount)}
                    </span>
                    <span
                      className={cn(
                        row.tone === "amber"
                          ? "text-amber-500"
                          : "text-emerald-600"
                      )}
                    >
                      {row.usedPct}% used
                    </span>
                  </div>
                </div>
              </div>
            );
          })}
        </CardContent>
      </Card>
    </section>
  );
}
