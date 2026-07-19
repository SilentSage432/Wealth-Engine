"use client";

import { ArrowDownRight, ArrowUpRight } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { formatCurrency } from "@/lib/utils";

interface QuickStatsProps {
  totalIncome: number;
  debtAllocated: number;
}

export function QuickStats({ totalIncome, debtAllocated }: QuickStatsProps) {
  return (
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
              Debt Pot Allocated
            </p>
            <p className="font-[family-name:var(--font-display)] text-2xl font-semibold tabular-nums text-amber-300">
              {formatCurrency(debtAllocated)}
            </p>
          </div>
        </CardContent>
      </Card>
    </>
  );
}
