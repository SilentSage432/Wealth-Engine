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
    <section
      aria-label="Golden Triad 10 20 70 summary"
      className="flex gap-2 overflow-x-auto pb-1 scrollbar-thin sm:grid sm:grid-cols-2 sm:gap-4 sm:overflow-visible sm:pb-0 xl:grid-cols-3"
    >
      <Card className="group relative w-[min(78vw,17.5rem)] shrink-0 overflow-hidden animate-fade-up border-emerald-900/30 sm:w-auto sm:min-w-0">
        <div className="pointer-events-none absolute inset-0 animate-shimmer" />
        <CardHeader className="flex flex-row items-start justify-between space-y-0 p-3 pb-1.5 sm:p-6 sm:pb-2">
          <div className="min-w-0 pr-2">
            <CardDescription className="flex items-center gap-1.5 text-emerald-400/80">
              <PiggyBank className="h-3.5 w-3.5 shrink-0" />
              <span className="truncate text-[10px] sm:text-xs">
                <span className="sm:hidden">10% Wealth Engine</span>
                <span className="hidden sm:inline">
                  Thy Purse to Fattening · 10%
                </span>
              </span>
            </CardDescription>
            <CardTitle className="mt-1.5 font-[family-name:var(--font-display)] text-xl font-semibold tracking-tight text-emerald-300 sm:mt-2 sm:text-2xl md:text-3xl">
              {formatCurrency(goldRetained)}
            </CardTitle>
          </div>
          <div className="hidden rounded-lg bg-emerald-500/10 p-2 text-emerald-400 transition-transform duration-300 group-hover:scale-110 sm:block">
            <TrendingUp className="h-5 w-5" />
          </div>
        </CardHeader>
        <CardContent className="flex items-end justify-between gap-2 p-3 pt-0 sm:gap-3 sm:p-6 sm:pt-0">
          <div className="min-w-0">
            <p className="text-[10px] text-slate-500 sm:text-xs">
              Wealth Archive · Yours to Keep
            </p>
            <p className="mt-1 hidden items-center gap-1 text-xs text-emerald-400 sm:inline-flex">
              <ArrowUpRight className="h-3 w-3" />
              Locked from expenditures
            </p>
          </div>
          <div className="hidden sm:block">
            <MiniSparkline data={wealthSpark} color="#34d399" />
          </div>
        </CardContent>
      </Card>

      <Card
        className="group relative w-[min(78vw,17.5rem)] shrink-0 overflow-hidden animate-fade-up border-amber-900/30 sm:w-auto sm:min-w-0"
        style={{ animationDelay: "80ms" }}
      >
        <CardHeader className="flex flex-row items-start justify-between space-y-0 p-3 pb-1.5 sm:p-6 sm:pb-2">
          <div className="min-w-0">
            <CardDescription className="flex items-center gap-1.5 text-amber-400/80">
              <Scale className="h-3.5 w-3.5 shrink-0" />
              <span className="truncate text-[10px] sm:text-xs">
                <span className="sm:hidden">20% Debt Engine</span>
                <span className="hidden sm:inline">Thy Creditors · 20%</span>
              </span>
            </CardDescription>
            <CardTitle className="mt-1.5 font-[family-name:var(--font-display)] text-xl font-semibold tracking-tight text-amber-300 sm:mt-2 sm:text-2xl md:text-3xl">
              {formatCurrency(clearedDebt)}
              <span className="ml-1 text-xs font-normal text-slate-500 sm:text-sm md:text-base">
                / {formatCurrency(originalDebt || 0)}
              </span>
            </CardTitle>
          </div>
          <div className="hidden rounded-lg bg-amber-500/10 p-2 text-amber-400 transition-transform duration-300 group-hover:scale-110 sm:block">
            <CreditCard className="h-5 w-5" />
          </div>
        </CardHeader>
        <CardContent className="space-y-2 p-3 pt-0 sm:space-y-3 sm:p-6 sm:pt-0">
          <Progress
            value={debtClearPct}
            className="h-1.5 sm:h-2"
            indicatorClassName="bg-amber-500"
          />
          <div className="flex items-center justify-between text-[10px] sm:text-xs">
            <span className="text-slate-500">{debtClearPct}% liquidated</span>
            <span className="tabular-nums text-amber-400/90">
              {formatCurrency(remainingDebt)} remaining
            </span>
          </div>
          {!hasActiveDebt && (
            <p className="hidden items-center gap-1 text-xs text-emerald-400 sm:inline-flex">
              <Sparkles className="h-3 w-3" />
              Debt-free — 20% flows to Wealth Archive
            </p>
          )}
        </CardContent>
      </Card>

      <Card
        className="group relative w-[min(78vw,17.5rem)] shrink-0 overflow-hidden animate-fade-up border-slate-700/50 sm:w-auto sm:min-w-0 sm:col-span-2 xl:col-span-1"
        style={{ animationDelay: "160ms" }}
      >
        <CardHeader className="flex flex-row items-start justify-between space-y-0 p-3 pb-1.5 sm:p-6 sm:pb-2">
          <div className="min-w-0">
            <CardDescription className="flex items-center gap-1.5 text-slate-400">
              <Wallet className="h-3.5 w-3.5 shrink-0" />
              <span className="truncate text-[10px] sm:text-xs">
                <span className="sm:hidden">70% Living Pool</span>
                <span className="hidden sm:inline">
                  Necessary Expenditures · 70% · This Month
                </span>
              </span>
            </CardDescription>
            <CardTitle
              className={cn(
                "mt-1.5 font-[family-name:var(--font-display)] text-xl font-semibold tracking-tight sm:mt-2 sm:text-2xl md:text-3xl",
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
              "hidden rounded-lg p-2 transition-transform duration-300 group-hover:scale-110 sm:block",
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
        <CardContent className="space-y-2 p-3 pt-0 sm:space-y-3 sm:p-6 sm:pt-0">
          <Progress
            value={expenditureRemainingPct}
            className="h-2 sm:h-2.5"
            indicatorClassName={progressIndicatorClass}
          />
          <div className="flex items-center justify-between text-[10px] sm:text-xs">
            <span className="text-slate-500">
              {expenditureRemainingPct}% left
            </span>
            <span className="tabular-nums text-slate-400">
              {formatCurrency(totalSpent)} / {formatCurrency(expenditurePool)}
            </span>
          </div>
        </CardContent>
      </Card>
    </section>
  );
}
