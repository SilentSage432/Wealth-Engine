"use client";

import { CalendarClock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  applyDueAttentionDecision,
  type DueAttentionItem,
} from "@/lib/babylon/attention";
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
  dueAttention?: readonly DueAttentionItem[];
  onMarkPaid?: (id: string) => void;
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
  dueAttention = [],
  onMarkPaid,
  discreet = false,
}: UpcomingNeedsProps) {
  const money = (value: number) =>
    formatDiscreetCurrency(value, discreet, formatCurrency);
  const markPaid = onMarkPaid ?? (() => undefined);

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
          {dueAttention.length > 0 ? (
            <div className="mt-4 border-t border-slate-800/80 pt-3">
              <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-500">
                Due
              </p>
              <p className="mt-1 text-xs leading-relaxed text-slate-400">
                Declared bills that are due and not recorded as paid. Has this
                one been paid?
              </p>
              <ul className="mt-3 space-y-2">
                {dueAttention.map((item) => (
                  <li
                    key={item.id}
                    className="rounded-lg border border-slate-800 bg-slate-950/40 px-3 py-3"
                  >
                    <div className="flex items-baseline justify-between gap-3 text-sm">
                      <span className="min-w-0 text-slate-200">
                        <span className="text-slate-500">
                          {formatDueDay(item.dueDate)}
                        </span>{" "}
                        <span className="font-medium">{item.name}</span>
                        {item.recurringObligationId ? (
                          <span className="ml-2 text-[11px] font-medium text-slate-500">
                            Monthly
                          </span>
                        ) : null}
                      </span>
                      <span className="shrink-0 tabular-nums text-slate-100">
                        {money(item.amount)}
                      </span>
                    </div>
                    <div className="mt-3 flex flex-wrap gap-2">
                      <Button
                        type="button"
                        size="sm"
                        onClick={() =>
                          applyDueAttentionDecision("paid", item.id, markPaid)
                        }
                        aria-label={`Mark ${item.name} paid`}
                      >
                        Paid
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        onClick={() =>
                          applyDueAttentionDecision("still-upcoming", item.id, markPaid)
                        }
                        aria-label={`${item.name} is still upcoming`}
                      >
                        Still upcoming
                      </Button>
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
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
