"use client";

import { CalendarClock } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { formatDiscreetCurrency } from "@/lib/babylon/discreet";
import { formatCurrency } from "@/lib/utils";

interface UpcomingNeedsProps {
  upcomingNeeds: number;
  discreet?: boolean;
}

/**
 * Unpaid Need obligations. Not subtracted from Money Available.
 */
export function UpcomingNeeds({
  upcomingNeeds,
  discreet = false,
}: UpcomingNeedsProps) {
  const money = (value: number) =>
    formatDiscreetCurrency(value, discreet, formatCurrency);

  return (
    <section aria-label="Upcoming Needs" className="animate-fade-up">
      <Card className="border-slate-800/80">
        <CardContent className="p-4 sm:p-5">
          <p className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-500">
            <CalendarClock className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
            Upcoming Needs
          </p>
          <p className="mt-1 font-[family-name:var(--font-display)] text-3xl font-semibold tracking-tight text-slate-50 tabular-nums sm:text-4xl">
            {money(upcomingNeeds)}
          </p>
          <p className="mt-2 max-w-xl text-xs leading-relaxed text-slate-500">
            Known Needs that are not paid yet. This is not subtracted from
            Money Available. Mark them paid in the Ledger.
          </p>
        </CardContent>
      </Card>
    </section>
  );
}
