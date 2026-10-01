"use client";

import { useMemo } from "react";
import { Briefcase } from "lucide-react";
import { laborHoursForAmount } from "@/lib/babylon/engine";
import { formatDiscreetCurrency } from "@/lib/babylon/discreet";
import { formatCurrency } from "@/lib/utils";

interface SpendingPowerFocusProps {
  expenditureRemaining: number;
  hourlyLaborRate: number;
  discreet?: boolean;
}

/**
 * Desktop Overview labor-hour reading of the current-month expenditure remainder.
 * The dollar, percent, and pool stay on the Golden Triad. Presentation only.
 */
export function SpendingPowerFocus({
  expenditureRemaining,
  hourlyLaborRate,
  discreet = false,
}: SpendingPowerFocusProps) {
  const money = (n: number) =>
    formatDiscreetCurrency(n, discreet, formatCurrency);
  const laborHours = useMemo(
    () => laborHoursForAmount(expenditureRemaining, hourlyLaborRate),
    [expenditureRemaining, hourlyLaborRate]
  );

  return (
    <section aria-label="Spending power" className="animate-fade-up">
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
            ? `Main income · ${money(hourlyLaborRate)}/hr`
            : "Add recurring main income to estimate hours"}
        </p>
      </div>
    </section>
  );
}
