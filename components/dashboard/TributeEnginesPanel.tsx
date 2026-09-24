"use client";

import { ArrowDownRight, ArrowUpRight, Sparkles, Zap } from "lucide-react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { STREAM_KIND_LABELS } from "@/lib/babylon/constants";
import { cn, formatCurrency } from "@/lib/utils";
import type { IncomeStreamKind, TributeEngineSnapshot } from "@/types/babylon";

interface TributeEnginesPanelProps {
  snapshot: TributeEngineSnapshot;
}

const KIND_ACCENT: Record<
  IncomeStreamKind,
  { badge: string; bar: string; icon?: "zap" | "sparkles" }
> = {
  primary: {
    badge: "bg-slate-700/60 text-slate-200",
    bar: "bg-slate-400",
  },
  side_hustle: {
    badge: "bg-amber-500/15 text-amber-300",
    bar: "bg-amber-500",
    icon: "zap",
  },
  passive: {
    badge: "bg-emerald-500/15 text-emerald-300",
    bar: "bg-emerald-500",
    icon: "sparkles",
  },
  other: {
    badge: "bg-slate-800 text-slate-400",
    bar: "bg-slate-600",
  },
};

const KIND_TOOLTIPS: Partial<Record<IncomeStreamKind, string>> = {
  side_hustle:
    "Side income is money earned outside main income. It still splits 10/20/70.",
  passive:
    "Passive income is money that does not depend on more of your hours. It still splits 10/20/70.",
  primary:
    "Main income is the recurring paycheck used for affordability hours.",
  other: "Other income is irregular money that still splits 10/20/70.",
};

export function TributeEnginesPanel({ snapshot }: TributeEnginesPanelProps) {
  return (
    <TooltipProvider delayDuration={200}>
      <section className="animate-fade-up">
        <Card className="border-slate-800/80">
          <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <CardTitle className="font-[family-name:var(--font-display)] text-lg sm:text-xl">
                Income Breakdown
              </CardTitle>
              <CardDescription>
                This month&apos;s income by type, and how each type changed from
                last month.
              </CardDescription>
            </div>
            <div className="shrink-0 text-left sm:text-right">
              <p className="text-[10px] uppercase tracking-wider text-slate-500">
                Income this month
              </p>
              <p className="font-[family-name:var(--font-display)] text-2xl font-semibold tabular-nums text-slate-50">
                {formatCurrency(snapshot.monthTotal)}
              </p>
            </div>
          </CardHeader>
          <CardContent className="space-y-5">
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="rounded-lg border border-slate-800/70 bg-slate-950/40 px-3.5 py-3">
                <p className="text-[10px] uppercase tracking-wider text-slate-500">
                  Main Income
                </p>
                <p className="mt-1 font-[family-name:var(--font-display)] text-xl font-semibold tabular-nums text-slate-100">
                  {formatCurrency(snapshot.primaryAmount)}
                </p>
                <p className="mt-1 text-xs text-slate-500">
                  {snapshot.primaryPct}% of this month&apos;s income
                </p>
              </div>
              <div className="rounded-lg border border-amber-900/30 bg-amber-950/10 px-3.5 py-3">
                <p className="text-[10px] uppercase tracking-wider text-amber-500/80">
                  Other Income
                </p>
                <p className="mt-1 font-[family-name:var(--font-display)] text-xl font-semibold tabular-nums text-amber-200">
                  {formatCurrency(snapshot.secondaryAmount)}
                </p>
                <p className="mt-1 text-xs text-slate-500">
                  {snapshot.secondaryPct}% · side, passive, and other
                </p>
              </div>
            </div>

            {snapshot.monthTotal <= 0 ? (
              <p className="rounded-lg border border-dashed border-slate-800 px-4 py-8 text-center text-sm text-slate-500">
                Add income this month to see the breakdown.
              </p>
            ) : (
              <ul className="space-y-3">
                {snapshot.byKind.map((row) => {
                  const accent = KIND_ACCENT[row.kind];
                  const tip = KIND_TOOLTIPS[row.kind];
                  const MomIcon =
                    row.momPct === null
                      ? null
                      : row.momPct >= 0
                        ? ArrowUpRight
                        : ArrowDownRight;

                  const badge = (
                    <span
                      className={cn(
                        "inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider",
                        accent.badge,
                        tip &&
                          "cursor-help underline decoration-dotted decoration-slate-600 underline-offset-2"
                      )}
                    >
                      {accent.icon === "zap" && (
                        <Zap className="h-3 w-3" aria-hidden="true" />
                      )}
                      {accent.icon === "sparkles" && (
                        <Sparkles className="h-3 w-3" aria-hidden="true" />
                      )}
                      {STREAM_KIND_LABELS[row.kind]}
                    </span>
                  );

                  return (
                    <li
                      key={row.kind}
                      className="rounded-lg border border-slate-800/60 bg-slate-950/30 px-3 py-3"
                    >
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="flex items-center gap-2">
                          {tip ? (
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <button
                                  type="button"
                                  className="rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/50"
                                  aria-label={`${STREAM_KIND_LABELS[row.kind]} — explain contribution`}
                                >
                                  {badge}
                                </button>
                              </TooltipTrigger>
                              <TooltipContent side="top" align="start">
                                {tip}
                              </TooltipContent>
                            </Tooltip>
                          ) : (
                            badge
                          )}
                          <span className="tabular-nums text-sm text-slate-200">
                            {formatCurrency(row.amount)}
                          </span>
                        </div>
                        <div className="flex items-center gap-3 text-xs tabular-nums text-slate-500">
                          <span>{row.pctOfMonth}% of month</span>
                          {MomIcon && row.momPct !== null ? (
                            <span
                              className={cn(
                                "inline-flex items-center gap-0.5 font-medium",
                                row.momPct >= 0
                                  ? "text-emerald-400"
                                  : "text-rose-400"
                              )}
                            >
                              <MomIcon className="h-3.5 w-3.5" aria-hidden="true" />
                              {row.momPct > 0 ? "+" : ""}
                              {row.momPct}% MoM
                            </span>
                          ) : row.amount > 0 ? (
                            <span className="text-slate-600">New this month</span>
                          ) : null}
                        </div>
                      </div>
                      <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-slate-800/90">
                        <div
                          className={cn(
                            "h-full rounded-full transition-all duration-500",
                            accent.bar
                          )}
                          style={{
                            width: `${Math.min(100, row.pctOfMonth)}%`,
                          }}
                        />
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </CardContent>
        </Card>
      </section>
    </TooltipProvider>
  );
}
