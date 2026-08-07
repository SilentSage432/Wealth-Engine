"use client";

import { useMemo, useState } from "react";
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { ChartTooltipShell } from "@/components/babylon/chart-tooltip";
import { Button } from "@/components/ui/button";
import {
  formatMonthLabel,
  projectDebtFreedom,
} from "@/lib/babylon/engine";
import { formatDiscreetCurrency } from "@/lib/babylon/discreet";
import { cn, formatCurrency } from "@/lib/utils";
import type {
  DebtEntry,
  DebtPayoffStrategy,
  PeriodArchive,
} from "@/types/babylon";

interface DebtFreedomEngineProps {
  debts: DebtEntry[];
  monthlyDebtBudget: number;
  currentMonthKey: string;
  periodArchives: PeriodArchive[];
  discreet?: boolean;
}

export function DebtFreedomEngine({
  debts,
  monthlyDebtBudget,
  currentMonthKey,
  periodArchives,
  discreet = false,
}: DebtFreedomEngineProps) {
  const [strategy, setStrategy] = useState<DebtPayoffStrategy>("snowball");
  const [extraTribute, setExtraTribute] = useState(0);

  const money = (n: number) =>
    formatDiscreetCurrency(n, discreet, formatCurrency);

  const projection = useMemo(
    () =>
      projectDebtFreedom(
        debts,
        monthlyDebtBudget,
        extraTribute,
        strategy,
        currentMonthKey
      ),
    [debts, monthlyDebtBudget, extraTribute, strategy, currentMonthKey]
  );

  const ordered = useMemo(() => {
    const map = new Map(debts.map((d) => [d.id, d]));
    return projection.orderedDebtIds
      .map((id) => map.get(id))
      .filter((d): d is DebtEntry => Boolean(d));
  }, [debts, projection.orderedDebtIds]);

  const velocity = useMemo(() => {
    const chronological = [...periodArchives].sort((a, b) =>
      a.monthKey.localeCompare(b.monthKey)
    );
    let wealthRun = 0;
    let debtRun = 0;
    return chronological.map((archive) => {
      wealthRun += archive.wealthAllocated;
      debtRun += archive.debtAllocated;
      return {
        month: formatMonthLabel(archive.monthKey),
        wealthVelocity: Math.round(wealthRun),
        debtVelocity: Math.round(debtRun),
        surplus: archive.surplusAmount,
      };
    });
  }, [periodArchives]);

  const activeDebt = debts.some((d) => d.remainingDebt > 0);

  return (
    <section className="animate-fade-up space-y-4 rounded-xl border border-slate-800/80 bg-slate-900/40 p-4 sm:p-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-500">
            Debt Elimination Engine
          </p>
          <h2 className="mt-1 font-[family-name:var(--font-display)] text-2xl text-slate-50">
            Freedom Date
          </h2>
        </div>
        <div className="flex gap-2">
          <Button
            type="button"
            size="sm"
            variant={strategy === "snowball" ? "default" : "outline"}
            onClick={() => setStrategy("snowball")}
            aria-pressed={strategy === "snowball"}
          >
            Snowball
          </Button>
          <Button
            type="button"
            size="sm"
            variant={strategy === "avalanche" ? "default" : "outline"}
            onClick={() => setStrategy("avalanche")}
            aria-pressed={strategy === "avalanche"}
          >
            Avalanche
          </Button>
        </div>
      </div>

      <div className="rounded-xl border border-emerald-900/40 bg-emerald-950/20 px-4 py-5 text-center sm:px-6">
        {!activeDebt ? (
          <p className="font-[family-name:var(--font-display)] text-2xl text-emerald-300 sm:text-3xl">
            100% Debt-Free today
          </p>
        ) : projection.debtFreeLabel ? (
          <p className="font-[family-name:var(--font-display)] text-2xl text-emerald-300 sm:text-4xl">
            100% Debt-Free by {projection.debtFreeLabel}
          </p>
        ) : (
          <p className="font-[family-name:var(--font-display)] text-xl text-amber-300 sm:text-2xl">
            Increase tribute firepower to unlock a Freedom Date
          </p>
        )}
        <p className="mt-2 text-xs text-slate-500">
          Monthly debt budget {money(monthlyDebtBudget)}
          {projection.monthsRemaining != null
            ? ` · ${projection.monthsRemaining} months remaining`
            : ""}
          {projection.totalInterestPaid > 0
            ? ` · est. interest ${money(projection.totalInterestPaid)}`
            : ""}
        </p>
      </div>

      <div className="space-y-2">
        <div className="flex items-center justify-between text-xs text-slate-400">
          <label htmlFor="extra-tribute">Extra Tribute Simulator</label>
          <span className="tabular-nums text-amber-300">
            +{money(extraTribute)}/mo
          </span>
        </div>
        <input
          id="extra-tribute"
          type="range"
          min={0}
          max={2000}
          step={25}
          value={extraTribute}
          onChange={(e) => setExtraTribute(Number(e.target.value))}
          className="w-full accent-amber-500"
          aria-valuemin={0}
          aria-valuemax={2000}
          aria-valuenow={extraTribute}
        />
      </div>

      {ordered.length > 0 && (
        <ol className="space-y-2">
          {ordered.map((debt, index) => (
            <li
              key={debt.id}
              className="flex items-center justify-between gap-3 rounded-lg border border-slate-800/80 bg-slate-950/40 px-3 py-2.5 text-sm"
            >
              <div className="min-w-0">
                <p className="truncate font-medium text-slate-200">
                  <span className="mr-2 text-slate-500">#{index + 1}</span>
                  {debt.creditor}
                </p>
                <p className="text-[11px] text-slate-500">
                  Min {money(debt.monthlyAllocation)}
                  {debt.interestRate > 0
                    ? ` · ${debt.interestRate}% APR`
                    : " · 0% APR"}
                </p>
              </div>
              <p className="shrink-0 tabular-nums text-amber-300">
                {money(debt.remainingDebt)}
              </p>
            </li>
          ))}
        </ol>
      )}

      {velocity.length > 0 && (
        <div className="rounded-lg border border-slate-800/80 bg-slate-950/40 p-3">
          <p className="mb-3 text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-500">
            Net Worth & Debt Velocity
          </p>
          <div className={cn("h-48 w-full", discreet && "opacity-40")}>
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={velocity}>
                <CartesianGrid stroke="#1e293b" strokeDasharray="3 3" />
                <XAxis dataKey="month" tick={{ fill: "#64748b", fontSize: 11 }} />
                <YAxis tick={{ fill: "#64748b", fontSize: 11 }} width={48} />
                <Tooltip content={<ChartTooltipShell />} />
                <Line
                  type="monotone"
                  dataKey="wealthVelocity"
                  name="Wealth velocity"
                  stroke="#34d399"
                  strokeWidth={2}
                  dot={false}
                />
                <Line
                  type="monotone"
                  dataKey="debtVelocity"
                  name="Debt velocity"
                  stroke="#fbbf24"
                  strokeWidth={2}
                  dot={false}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}
    </section>
  );
}
