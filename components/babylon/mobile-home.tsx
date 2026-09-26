"use client";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  applyDueAttentionDecision,
  type DueAttentionItem,
} from "@/lib/babylon/attention";
import type { AvailableAfterPlannedNeeds } from "@/lib/babylon/available-after-planned-needs";
import type { MobileDestination } from "@/lib/babylon/constants";
import { formatDiscreetCurrency } from "@/lib/babylon/discreet";
import {
  phoneHomeActivityPreview,
  phoneHomeShowsDueAttention,
  phoneHomeUpcomingPreview,
} from "@/lib/babylon/mobile-home";
import { formatCurrency, formatRelativeTime } from "@/lib/utils";
import type { ActivityEvent, ExpenseEntry } from "@/types/babylon";

interface MobileHomeProps {
  moneyAvailable: number;
  protectedMoney: number;
  protectedOverAvailable: boolean;
  availableAfterPlannedNeeds: AvailableAfterPlannedNeeds;
  upcomingNeeds: number;
  expenses: readonly ExpenseEntry[];
  dueAttention: readonly DueAttentionItem[];
  onMarkPaid: (id: string) => void;
  recentActivity: readonly ActivityEvent[];
  discreet: boolean;
  onNavigate: (destination: MobileDestination) => void;
}

function formatDueDay(isoDate: string): string {
  const [year, month, day] = isoDate.split("-").map(Number);
  if (!year || !month || !day) return isoDate;
  return new Date(year, month - 1, day).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });
}

function SectionLabel({ children }: { children: string }) {
  return (
    <h2 className="text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-500">
      {children}
    </h2>
  );
}

export function MobileHome({
  moneyAvailable,
  protectedMoney,
  protectedOverAvailable,
  availableAfterPlannedNeeds,
  upcomingNeeds,
  expenses,
  dueAttention,
  onMarkPaid,
  recentActivity,
  discreet,
  onNavigate,
}: MobileHomeProps) {
  const money = (value: number) =>
    formatDiscreetCurrency(value, discreet, formatCurrency);
  const dueIds = new Set(dueAttention.map((item) => item.id));
  const upcomingPreview = phoneHomeUpcomingPreview(expenses, dueIds);
  const activity = phoneHomeActivityPreview(recentActivity);
  const shortfall = availableAfterPlannedNeeds.plannedNeedsShortfall;

  return (
    <div className="space-y-3">
      {phoneHomeShowsDueAttention(dueAttention.length) ? (
        <section aria-label="Due">
          <Card className="border-slate-800/80">
            <CardContent className="p-4">
              <SectionLabel>Due</SectionLabel>
              <p className="mt-1 text-sm text-slate-300">Has this been paid?</p>
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
                          applyDueAttentionDecision("paid", item.id, onMarkPaid)
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
                          applyDueAttentionDecision(
                            "still-upcoming",
                            item.id,
                            onMarkPaid
                          )
                        }
                        aria-label={`${item.name} is still upcoming`}
                      >
                        Still upcoming
                      </Button>
                    </div>
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
        </section>
      ) : null}

      <section aria-label="Financial Position">
        <Card className="border-slate-800/80">
          <CardContent className="p-4">
            <SectionLabel>Money Available</SectionLabel>
            <p className="mt-1 font-[family-name:var(--font-display)] text-4xl font-semibold tracking-tight text-slate-50 tabular-nums">
              {money(moneyAvailable)}
            </p>
            <p className="mt-2 text-xs leading-relaxed text-slate-500">
              Balances you entered, separate from your Living Budget.
            </p>
            <div className="mt-4 border-t border-slate-800/80 pt-3">
              <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-500">
                Protected Money
              </p>
              <p className="mt-1 font-[family-name:var(--font-display)] text-xl font-semibold tabular-nums text-slate-100">
                {money(protectedMoney)}
              </p>
              <p className="mt-1 text-xs leading-relaxed text-slate-500">
                Already included in Money Available.
              </p>
              {protectedOverAvailable ? (
                <p role="alert" className="mt-2 text-xs leading-relaxed text-amber-200">
                  Protected designations exceed Money Available.
                </p>
              ) : null}
            </div>
            <Button
              type="button"
              variant="outline"
              className="mt-4"
              onClick={() => onNavigate("more")}
            >
              Manage accounts
            </Button>
          </CardContent>
        </Card>
      </section>

      <section aria-label="Available After Planned Needs">
        <Card className="border-slate-800/80">
          <CardContent className="p-4">
            <SectionLabel>Available After Planned Needs</SectionLabel>
            <p className="mt-1 font-[family-name:var(--font-display)] text-4xl font-semibold tracking-tight text-slate-50 tabular-nums">
              {money(availableAfterPlannedNeeds.availableAfterPlannedNeeds)}
            </p>
            <p className="mt-2 text-xs leading-relaxed text-slate-500">
              After protected money and known unpaid Needs.
            </p>
            {shortfall > 0 ? (
              <p className="mt-3 text-xs leading-relaxed text-amber-200">
                Planned Needs Shortfall{" "}
                <span className="tabular-nums">{money(shortfall)}</span>.
                Protected money and unpaid Needs exceed Money Available.
              </p>
            ) : null}
          </CardContent>
        </Card>
      </section>

      <section aria-label="Upcoming Needs">
        <Card className="border-slate-800/80">
          <CardContent className="p-4">
            <SectionLabel>Upcoming Needs</SectionLabel>
            <p className="mt-1 font-[family-name:var(--font-display)] text-2xl font-semibold tabular-nums text-slate-50">
              {money(upcomingNeeds)}
            </p>
            <p className="mt-2 text-xs leading-relaxed text-slate-500">
              Known unpaid Needs. Next bills can include Wants.
            </p>
            {upcomingPreview.length > 0 ? (
              <ul className="mt-3 space-y-1.5">
                {upcomingPreview.map((item) => (
                  <li
                    key={item.id}
                    className="flex items-baseline justify-between gap-3 text-sm"
                  >
                    <span className="min-w-0 text-slate-300">
                      <span className="text-slate-500">
                        {formatDueDay(item.dueDate)}
                      </span>{" "}
                      <span>{item.name}</span>
                    </span>
                    <span className="shrink-0 tabular-nums text-slate-200">
                      {money(item.amount)}
                    </span>
                  </li>
                ))}
              </ul>
            ) : null}
            <Button
              type="button"
              variant="outline"
              className="mt-4"
              onClick={() => onNavigate("ledger")}
            >
              View Ledger
            </Button>
          </CardContent>
        </Card>
      </section>

      <section aria-label="Recent activity">
        <Card className="border-slate-800/80">
          <CardContent className="p-4">
            <SectionLabel>Recent</SectionLabel>
            {activity.length === 0 ? (
              <p className="mt-2 text-sm text-slate-500">No recent changes.</p>
            ) : (
              <ul className="mt-2 space-y-2">
                {activity.map((event) => (
                  <li
                    key={event.id}
                    className="flex items-baseline justify-between gap-3 text-sm"
                  >
                    <span className="min-w-0 truncate text-slate-200">
                      {event.title}
                    </span>
                    <span className="shrink-0 text-right text-slate-400">
                      {event.amount !== undefined ? (
                        <span className="mr-2 tabular-nums text-slate-200">
                          {event.kind === "expense" ? "−" : ""}
                          {money(event.amount)}
                        </span>
                      ) : null}
                      <span className="text-[11px] tabular-nums text-slate-500">
                        {formatRelativeTime(event.createdAt)}
                      </span>
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </section>
    </div>
  );
}
