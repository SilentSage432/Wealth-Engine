"use client";

import {
  ArrowUpRight,
  CircleDollarSign,
  CreditCard,
  PiggyBank,
  Scale,
  Sparkles,
  TrendingUp,
  Wallet,
} from "lucide-react";
import { MiniSparkline } from "@/components/babylon/mini-sparkline";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { cn, formatCurrency } from "@/lib/utils";
import type { ExpenditureBarTone, SparkPoint } from "@/types/babylon";

interface GoldenTriadProps {
  goldRetained: number;
  wealthSpark: SparkPoint[];
  clearedDebt: number;
  originalDebt: number;
  remainingDebt: number;
  debtClearPct: number;
  hasActiveDebt: boolean;
  expenditureRemaining: number;
  expenditureRemainingPct: number;
  expenditureBarTone: ExpenditureBarTone;
  progressIndicatorClass: string;
  totalSpent: number;
  expenditurePool: number;
}

export function GoldenTriad({
  goldRetained,
  wealthSpark,
  clearedDebt,
  originalDebt,
  remainingDebt,
  debtClearPct,
  hasActiveDebt,
  expenditureRemaining,
  expenditureRemainingPct,
  expenditureBarTone,
  progressIndicatorClass,
  totalSpent,
  expenditurePool,
}: GoldenTriadProps) {
  return (
    <section className="grid gap-4 md:grid-cols-3">
      <Card className="group relative overflow-hidden animate-fade-up border-emerald-900/30">
        <div className="pointer-events-none absolute inset-0 animate-shimmer" />
        <CardHeader className="flex flex-row items-start justify-between space-y-0 pb-2">
          <div>
            <CardDescription className="flex items-center gap-1.5 text-emerald-400/80">
              <PiggyBank className="h-3.5 w-3.5" />
              Thy Purse to Fattening · 10%
            </CardDescription>
            <CardTitle className="mt-2 font-[family-name:var(--font-display)] text-3xl font-semibold tracking-tight text-emerald-300">
              {formatCurrency(goldRetained)}
            </CardTitle>
          </div>
          <div className="rounded-lg bg-emerald-500/10 p-2 text-emerald-400 transition-transform duration-300 group-hover:scale-110">
            <TrendingUp className="h-5 w-5" />
          </div>
        </CardHeader>
        <CardContent className="flex items-end justify-between gap-3">
          <div>
            <p className="text-xs text-slate-500">
              Wealth Archive · Yours to Keep
            </p>
            <p className="mt-1 inline-flex items-center gap-1 text-xs text-emerald-400">
              <ArrowUpRight className="h-3 w-3" />
              Locked from expenditures
            </p>
          </div>
          <MiniSparkline data={wealthSpark} color="#34d399" />
        </CardContent>
      </Card>

      <Card
        className="group relative overflow-hidden animate-fade-up border-amber-900/30"
        style={{ animationDelay: "80ms" }}
      >
        <CardHeader className="flex flex-row items-start justify-between space-y-0 pb-2">
          <div>
            <CardDescription className="flex items-center gap-1.5 text-amber-400/80">
              <Scale className="h-3.5 w-3.5" />
              Thy Creditors · 20%
            </CardDescription>
            <CardTitle className="mt-2 font-[family-name:var(--font-display)] text-3xl font-semibold tracking-tight text-amber-300">
              {formatCurrency(clearedDebt)}
              <span className="ml-1 text-base font-normal text-slate-500">
                / {formatCurrency(originalDebt || 0)}
              </span>
            </CardTitle>
          </div>
          <div className="rounded-lg bg-amber-500/10 p-2 text-amber-400 transition-transform duration-300 group-hover:scale-110">
            <CreditCard className="h-5 w-5" />
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          <Progress
            value={debtClearPct}
            className="h-2"
            indicatorClassName="bg-amber-500"
          />
          <div className="flex items-center justify-between text-xs">
            <span className="text-slate-500">{debtClearPct}% liquidated</span>
            <span className="tabular-nums text-amber-400/90">
              {formatCurrency(remainingDebt)} remaining
            </span>
          </div>
          {!hasActiveDebt && (
            <p className="inline-flex items-center gap-1 text-xs text-emerald-400">
              <Sparkles className="h-3 w-3" />
              Debt-free — 20% flows to Wealth Archive
            </p>
          )}
        </CardContent>
      </Card>

      <Card
        className="group relative overflow-hidden animate-fade-up border-slate-700/50"
        style={{ animationDelay: "160ms" }}
      >
        <CardHeader className="flex flex-row items-start justify-between space-y-0 pb-2">
          <div>
            <CardDescription className="flex items-center gap-1.5 text-slate-400">
              <Wallet className="h-3.5 w-3.5" />
              Necessary Expenditures · 70%
            </CardDescription>
            <CardTitle
              className={cn(
                "mt-2 font-[family-name:var(--font-display)] text-3xl font-semibold tracking-tight",
                expenditureBarTone === "emerald" && "text-emerald-300",
                expenditureBarTone === "amber" && "text-amber-300",
                expenditureBarTone === "crimson" && "text-rose-300"
              )}
            >
              {formatCurrency(expenditureRemaining)}
            </CardTitle>
          </div>
          <div
            className={cn(
              "rounded-lg p-2 transition-transform duration-300 group-hover:scale-110",
              expenditureBarTone === "emerald" &&
                "bg-emerald-500/10 text-emerald-400",
              expenditureBarTone === "amber" &&
                "bg-amber-500/10 text-amber-400",
              expenditureBarTone === "crimson" &&
                "bg-rose-500/10 text-rose-400"
            )}
          >
            <CircleDollarSign className="h-5 w-5" />
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          <Progress
            value={expenditureRemainingPct}
            className="h-2.5"
            indicatorClassName={progressIndicatorClass}
          />
          <div className="flex items-center justify-between text-xs">
            <span className="text-slate-500">
              {expenditureRemainingPct}% of allowance left
            </span>
            <span className="tabular-nums text-slate-400">
              {formatCurrency(totalSpent)} spent of{" "}
              {formatCurrency(expenditurePool)}
            </span>
          </div>
        </CardContent>
      </Card>
    </section>
  );
}
