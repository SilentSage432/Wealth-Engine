"use client";

import {
  ArrowDownRight,
  ArrowUpRight,
  CheckCircle2,
  FolderKanban,
  ScrollText,
} from "lucide-react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { cn, formatCurrency, formatRelativeTime } from "@/lib/utils";
import type { ActivityEvent } from "@/types/babylon";

interface RecentActivityStripProps {
  events: ActivityEvent[];
  now?: Date;
}

function ActivityIcon({ event }: { event: ActivityEvent }) {
  if (event.kind === "income") {
    const hustle = event.streamKind === "side_hustle";
    const passive = event.streamKind === "passive";
    return (
      <span
        className={cn(
          "flex h-8 w-8 shrink-0 items-center justify-center rounded-md border",
          hustle
            ? "border-amber-500/40 bg-amber-500/10 text-amber-300"
            : passive
              ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-300"
              : "border-emerald-800/60 bg-emerald-950/40 text-emerald-400"
        )}
      >
        <ArrowUpRight className="h-4 w-4" />
      </span>
    );
  }

  if (event.kind === "expense") {
    return (
      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-rose-900/50 bg-rose-950/40 text-rose-400">
        <ArrowDownRight className="h-4 w-4" />
      </span>
    );
  }

  if (event.kind === "settle") {
    return (
      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-slate-700 bg-slate-900/60 text-slate-300">
        <CheckCircle2 className="h-4 w-4" />
      </span>
    );
  }

  if (event.kind === "close") {
    return (
      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-amber-800/50 bg-amber-950/30 text-amber-300">
        <ScrollText className="h-4 w-4" />
      </span>
    );
  }

  return (
    <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-slate-700 bg-slate-900/60 text-slate-400">
      <FolderKanban className="h-4 w-4" />
    </span>
  );
}

export function RecentActivityStrip({
  events,
  now = new Date(),
}: RecentActivityStripProps) {
  return (
    <section className="animate-fade-up">
      <Card className="border-slate-800/80">
        <CardHeader className="px-4 sm:px-6">
          <CardTitle className="font-[family-name:var(--font-display)] text-lg sm:text-xl">
            Recent Activity
          </CardTitle>
          <CardDescription>
            Last five ledger mutations — income engines, expenses, and category
            shifts
          </CardDescription>
        </CardHeader>
        <CardContent className="px-4 pb-4 sm:px-6">
          {events.length === 0 ? (
            <p className="rounded-lg border border-dashed border-slate-800 bg-slate-950/40 px-4 py-8 text-center text-sm text-slate-500">
              No mutations yet. Record a tribute to begin the activity trail.
            </p>
          ) : (
            <ul className="divide-y divide-slate-800/80">
              {events.map((event) => (
                <li
                  key={event.id}
                  className="flex items-center gap-3 py-3 first:pt-0 last:pb-0"
                >
                  <ActivityIcon event={event} />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-slate-100">
                      {event.title}
                    </p>
                    <p className="truncate text-xs text-slate-500">
                      {event.subtitle ?? event.kind}
                    </p>
                  </div>
                  <div className="shrink-0 text-right">
                    {event.amount !== undefined && (
                      <p
                        className={cn(
                          "tabular-nums text-sm font-medium",
                          event.kind === "expense"
                            ? "text-rose-300/90"
                            : event.kind === "income"
                              ? "text-emerald-300"
                              : "text-slate-300"
                        )}
                      >
                        {event.kind === "expense" ? "−" : ""}
                        {formatCurrency(event.amount)}
                      </p>
                    )}
                    <p className="text-[11px] tabular-nums text-slate-600">
                      {formatRelativeTime(event.createdAt, now)}
                    </p>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </section>
  );
}
