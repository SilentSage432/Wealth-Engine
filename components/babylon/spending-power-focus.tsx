"use client";

import { useMemo } from "react";
import { Briefcase, Wallet } from "lucide-react";
import { laborHoursForAmount } from "@/lib/babylon/engine";
import { cn, formatCurrency } from "@/lib/utils";
import type { ExpenditureBarTone } from "@/types/babylon";

interface SpendingPowerFocusProps {
  expenditureRemaining: number;
  expenditurePool: number;
  expenditureRemainingPct: number;
  expenditureBarTone: ExpenditureBarTone;
  hourlyLaborRate: number;
}

/**
 * Mobile "2-second check" — remaining 70% pool + labor-hour equivalent.
 * Presentation only; values come from Application/Domain.
 */
export function SpendingPowerFocus({
  expenditureRemaining,
  expenditurePool,
  expenditureRemainingPct,
  expenditureBarTone,
  hourlyLaborRate,
}: SpendingPowerFocusProps) {
  const laborHours = useMemo(
    () => laborHoursForAmount(expenditureRemaining, hourlyLaborRate),
    [expenditureRemaining, hourlyLaborRate]
  );

  const toneClass =
    expenditureBarTone === "crimson"
      ? "text-rose-300"
      : expenditureBarTone === "amber"
        ? "text-amber-300"
        : "text-emerald-300";

  const ringClass =
    expenditureBarTone === "crimson"
      ? "border-rose-900/40 bg-rose-950/20"
      : expenditureBarTone === "amber"
        ? "border-amber-900/40 bg-amber-950/20"
        : "border-emerald-900/40 bg-emerald-950/20";

  return (
    <section
      aria-label="Spending power"
      className="animate-fade-up grid grid-cols-1 gap-3 sm:grid-cols-2"
    >
      <div
        className={cn(
          "rounded-xl border px-4 py-4 sm:px-5 sm:py-5",
          ringClass
        )}
      >
        <p className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-500">
          <Wallet className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          Living pool remaining · 70%
        </p>
        <p
          className={cn(
            "mt-2 font-[family-name:var(--font-display)] text-4xl font-semibold tracking-tight tabular-nums sm:text-5xl",
            toneClass
          )}
        >
          {formatCurrency(expenditureRemaining)}
        </p>
        <p className="mt-2 text-xs text-slate-500">
          {expenditureRemainingPct}% of{" "}
          <span className="tabular-nums text-slate-400">
            {formatCurrency(expenditurePool)}
          </span>{" "}
          this month
        </p>
      </div>

      <div className="rounded-xl border border-slate-800/80 bg-slate-900/50 px-4 py-4 sm:px-5 sm:py-5">
        <p className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-500">
          <Briefcase className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          Affordability Anchor
        </p>
        <p className="mt-2 font-[family-name:var(--font-display)] text-2xl font-semibold tracking-tight text-slate-100 sm:text-3xl">
          {laborHours === null ? (
            <span className="text-slate-500">—</span>
          ) : (
            <>
              Representing{" "}
              <span className="tabular-nums text-amber-300">{laborHours}</span>{" "}
              hrs of work
            </>
          )}
        </p>
        <p className="mt-2 text-xs text-slate-500">
          {hourlyLaborRate > 0
            ? `Primary labor · ${formatCurrency(hourlyLaborRate)}/hr`
            : "Add recurring primary income to compute labor hours"}
        </p>
      </div>
    </section>
  );
}
