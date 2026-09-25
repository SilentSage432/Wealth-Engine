"use client";

import { CalendarClock } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { formatDiscreetCurrency } from "@/lib/babylon/discreet";
import { formatCurrency } from "@/lib/utils";

interface ComingUpItem {
  id: string;
  name: string;
  amount: number;
  dueDate: string;
}

interface UpcomingNeedsProps {
  upcomingNeeds: number;
  comingUp: ComingUpItem[];
  discreet?: boolean;
}

function formatDueDay(isoDate: string): string {
  const [year, month, day] = isoDate.split("-").map(Number);
  if (!year || !month || !day) return isoDate;
  return new Date(year, month - 1, day).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });
}

/**
 * Unpaid Need obligations. Not subtracted from Money Available.
 */
export function UpcomingNeeds({
  upcomingNeeds,
  comingUp,
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
          {comingUp.length > 0 ? (
            <div className="mt-4 border-t border-slate-800/80 pt-3">
              <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-500">
                Coming up
              </p>
              <ul className="mt-2 space-y-1.5">
                {comingUp.map((item) => (
                  <li
                    key={item.id}
                    className="flex items-baseline justify-between gap-3 text-sm"
                  >
                    <span className="min-w-0 text-slate-300">
                      <span className="text-slate-500">
                        {formatDueDay(item.dueDate)}
                      </span>{" "}
                      <span className="truncate">{item.name}</span>
                    </span>
                    <span className="shrink-0 tabular-nums text-slate-200">
                      {money(item.amount)}
                    </span>
                  </li>
                ))}
              </ul>
              <p className="mt-2 text-[11px] leading-relaxed text-slate-500">
                Next unpaid bills, including Wants. The total above counts
                Needs only.
              </p>
            </div>
          ) : null}
        </CardContent>
      </Card>
    </section>
  );
}
