"use client";

import { OverviewDisclosure } from "@/components/babylon/overview-disclosure";
import { ArrowDownRight, ArrowUpRight } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { formatCurrency } from "@/lib/utils";

interface QuickStatsProps {
  totalIncome: number;
  debtAllocated: number;
  /** Desktop Overview starts the lifetime cards closed. Amounts stay in the summary. */
  disclosure?: boolean;
}

export function QuickStats({
  totalIncome,
  debtAllocated,
  disclosure = false,
}: QuickStatsProps) {
  const cards = (
    <>
      <Card className="border-slate-800 bg-slate-900/60">
        <CardContent className="flex items-center gap-4 p-5">
          <div className="rounded-xl bg-slate-800 p-3 text-slate-300">
            <ArrowUpRight className="h-5 w-5" />
          </div>
          <div>
            <p className="text-xs uppercase tracking-wider text-slate-500">
              Lifetime Income
            </p>
            <p className="font-[family-name:var(--font-display)] text-2xl font-semibold tabular-nums">
              {formatCurrency(totalIncome)}
            </p>
          </div>
        </CardContent>
      </Card>
      <Card className="border-slate-800 bg-slate-900/60">
        <CardContent className="flex items-center gap-4 p-5">
          <div className="rounded-xl bg-slate-800 p-3 text-slate-300">
            <ArrowDownRight className="h-5 w-5" />
          </div>
          <div>
            <p className="text-xs uppercase tracking-wider text-slate-500">
              Debt Payoff allocated
            </p>
            <p className="font-[family-name:var(--font-display)] text-2xl font-semibold tabular-nums text-amber-300">
              {formatCurrency(debtAllocated)}
            </p>
          </div>
        </CardContent>
      </Card>
    </>
  );
  if (!disclosure) return cards;
  return (
    <OverviewDisclosure
      regionId="overview-quick-stats"
      className="rounded-xl border border-slate-800/80 bg-slate-900/40"
      summary={
        <div className="space-y-1">
          <p className="text-sm text-slate-200">
            Lifetime Income{" "}
            <span className="font-[family-name:var(--font-display)] text-lg font-semibold tabular-nums text-slate-50">
              {formatCurrency(totalIncome)}
            </span>
          </p>
          <p className="text-sm text-slate-200">
            Debt Payoff allocated{" "}
            <span className="font-[family-name:var(--font-display)] text-lg font-semibold tabular-nums text-amber-300">
              {formatCurrency(debtAllocated)}
            </span>
          </p>
        </div>
      }
    >
      <div className="grid gap-4 p-4 lg:grid-cols-2">{cards}</div>
    </OverviewDisclosure>
  );
}
