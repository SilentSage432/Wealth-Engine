"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { formatDiscreetCurrency } from "@/lib/babylon/discreet";
import { cn, formatCurrency } from "@/lib/utils";
import type { MonthlyCloseSummary, SurplusDisposition } from "@/types/babylon";

interface MonthlyCloseModalProps {
  open: boolean;
  summary: MonthlyCloseSummary;
  hasActiveDebt: boolean;
  emergencyShield: number;
  emergencyFundTotal: number;
  openingEmergencyFund: number;
  discreet?: boolean;
  onOpenChange: (open: boolean) => void;
  onCloseMonth: (disposition: SurplusDisposition) => boolean;
}

const STEPS = [
  "Period Summary",
  "Surplus",
  "Close and continue",
] as const;

const SWEEPS: Array<{
  id: SurplusDisposition;
  title: string;
  description: (surplus: number, hasDebt: boolean, money: (n: number) => string) => string;
  activeClass: string;
}> = [
  {
    id: "split_50_50",
    title: "Split between Wealth Building and Debt Payoff",
    description: (surplus, hasDebt, money) =>
      hasDebt
        ? `Split ${money(surplus)} between Wealth Building and Debt Payoff.`
        : `Add ${money(surplus)} to Wealth Building. There is no active debt.`,
    activeClass: "border-emerald-500/40 bg-emerald-500/10",
  },
  {
    id: "wealth_boost",
    title: "100% to Wealth Building",
    description: (surplus, _hasDebt, money) =>
      `Add ${money(surplus)} to Wealth Building.`,
    activeClass: "border-emerald-500/40 bg-emerald-500/10",
  },
  {
    id: "rollover",
    title: "Roll into next month's Living Budget",
    description: (surplus, _hasDebt, money) =>
      `Carry ${money(surplus)} into next month's Living Budget.`,
    activeClass: "border-amber-500/40 bg-amber-500/10",
  },
  {
    id: "emergency_shield",
    title: "Add to Emergency Fund",
    description: (surplus, _hasDebt, money) =>
      `Add ${money(surplus)} to the Emergency Fund.`,
    activeClass: "border-amber-500/40 bg-amber-500/10",
  },
];

export function MonthlyCloseModal({
  open,
  summary,
  hasActiveDebt,
  emergencyShield,
  emergencyFundTotal,
  openingEmergencyFund,
  discreet = false,
  onOpenChange,
  onCloseMonth,
}: MonthlyCloseModalProps) {
  const [step, setStep] = useState(0);
  const [disposition, setDisposition] =
    useState<SurplusDisposition>("split_50_50");
  const [error, setError] = useState<string | null>(null);

  const money = (n: number) =>
    formatDiscreetCurrency(n, discreet, formatCurrency);

  useEffect(() => {
    if (!open) return;
    setStep(0);
    setDisposition("split_50_50");
    setError(null);
  }, [open]);

  const surplus = Math.max(0, summary.surplusOrDeficit);
  const isDeficit = summary.surplusOrDeficit < 0;

  const handleConfirm = () => {
    setError(null);
    if (summary.alreadyClosed) {
      setError("This calendar month is already closed.");
      return;
    }
    const ok = onCloseMonth(disposition);
    if (!ok) {
      setError("Could not close the month. Try again.");
    }
  };

  const dispositionLabel =
    SWEEPS.find((s) => s.id === disposition)?.title ?? disposition;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[min(90vh,900px)] overflow-y-auto scrollbar-thin sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="font-[family-name:var(--font-display)] text-xl sm:text-2xl">
            Close Month
          </DialogTitle>
          <DialogDescription>
            Close {summary.monthLabel}. Review the month, choose what to do
            with any surplus, and save the record.
          </DialogDescription>
        </DialogHeader>

        <ol className="mb-4 flex gap-2">
          {STEPS.map((label, index) => (
            <li
              key={label}
              className={cn(
                "flex-1 rounded-md border px-2 py-2 text-center text-[10px] font-medium uppercase tracking-wider sm:text-[11px]",
                index === step
                  ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-300"
                  : index < step
                    ? "border-slate-700 bg-slate-900/60 text-slate-400"
                    : "border-slate-800 bg-slate-950/40 text-slate-600"
              )}
            >
              {index + 1}. {label}
            </li>
          ))}
        </ol>

        {step === 0 && (
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <Metric label="Total Income" value={money(summary.totalIncome)} tone="emerald" />
              <Metric label="Total Spent" value={money(summary.totalSpent)} tone="rose" />
              <Metric label="Wealth Building · 10%" value={money(summary.wealthAllocated)} tone="emerald" />
              <Metric label="Debt Payoff · 20%" value={money(summary.debtAllocated)} tone="amber" />
            </div>
            <div className="rounded-lg border border-slate-800 bg-slate-950/50 p-4">
              <p className="text-[10px] uppercase tracking-wider text-slate-500">
                Living Budget remaining
              </p>
              <p className="mt-1 tabular-nums text-sm text-slate-400">
                Living Budget {money(summary.expenditurePool)} · Spent{" "}
                {money(summary.totalSpent)}
              </p>
              <p
                className={cn(
                  "mt-2 font-[family-name:var(--font-display)] text-2xl font-semibold tabular-nums",
                  isDeficit ? "text-rose-300" : "text-emerald-300"
                )}
              >
                {isDeficit ? "Deficit " : "Surplus "}
                {money(Math.abs(summary.surplusOrDeficit))}
              </p>
              <p className="mt-1 text-xs text-slate-500">
                Emergency Fund balance:{" "}
                <span className="tabular-nums text-slate-300">
                  {money(emergencyFundTotal)}
                </span>
              </p>
              {openingEmergencyFund > 0 ? (
                <p className="mt-1 text-xs text-slate-500">
                  Existing {money(openingEmergencyFund)} · From month close{" "}
                  {money(emergencyShield)}
                </p>
              ) : null}
            </div>
            {summary.alreadyClosed && (
              <p className="rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-200">
                {summary.monthLabel} is already closed. The next month starts
                with the calendar.
              </p>
            )}
          </div>
        )}

        {step === 1 && (
          <div className="space-y-3">
            <p className="text-sm leading-relaxed text-slate-400">
              Choose what to do with any Living Budget still left before
              closing the month.
            </p>
            {surplus <= 0 ? (
              <div className="rounded-lg border border-dashed border-slate-800 bg-slate-950/40 px-4 py-6 text-center text-sm text-slate-500">
                No surplus remains in the Living Budget
                {isDeficit ? " — this month closed with a deficit." : "."} You
                can still close the month.
              </div>
            ) : (
              <div className="grid gap-2">
                {SWEEPS.map((sweep) => (
                  <button
                    key={sweep.id}
                    type="button"
                    onClick={() => setDisposition(sweep.id)}
                    className={cn(
                      "rounded-lg border px-4 py-3 text-left transition-colors",
                      disposition === sweep.id
                        ? sweep.activeClass
                        : "border-slate-800 bg-slate-950/40 hover:border-slate-700"
                    )}
                  >
                    <p className="text-sm font-medium text-slate-100">
                      {sweep.title}
                    </p>
                    <p className="mt-1 text-xs text-slate-500">
                      {sweep.description(surplus, hasActiveDebt, money)}
                    </p>
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        {step === 2 && (
          <div className="space-y-3">
            <div className="rounded-lg border border-slate-800 bg-slate-950/50 p-4 text-sm leading-relaxed text-slate-400">
              <p>
                Confirming will close{" "}
                <span className="text-slate-200">{summary.monthLabel}</span>,
                mark this month&apos;s open expenses as paid, and apply{" "}
                <span className="text-slate-200">{dispositionLabel}</span>
                {surplus > 0 ? ` (${money(surplus)})` : ""}.
              </p>
              <p className="mt-3 text-xs text-slate-500">
                The closed month is saved for the cumulative allocation chart.
              </p>
            </div>
            {error && (
              <p
                role="alert"
                className="rounded-md border border-rose-900/60 bg-rose-500/10 px-3 py-2 text-sm text-rose-300"
              >
                {error}
              </p>
            )}
          </div>
        )}

        <DialogFooter className="mt-6 flex-col gap-2 sm:flex-row sm:justify-between">
          <Button
            type="button"
            variant="outline"
            onClick={() => {
              if (step === 0) onOpenChange(false);
              else setStep((s) => s - 1);
            }}
          >
            {step === 0 ? "Cancel" : "Back"}
          </Button>
          {step < 2 ? (
            <Button
              type="button"
              onClick={() => setStep((s) => s + 1)}
              disabled={summary.alreadyClosed && step === 0}
            >
              Continue
            </Button>
          ) : (
            <Button
              type="button"
              onClick={handleConfirm}
              disabled={summary.alreadyClosed}
            >
              Close month
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Metric({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone: "emerald" | "amber" | "rose";
}) {
  return (
    <div className="rounded-lg border border-slate-800 bg-slate-950/40 px-3 py-3">
      <p className="text-[10px] uppercase tracking-wider text-slate-500">
        {label}
      </p>
      <p
        className={cn(
          "mt-1 tabular-nums text-lg font-semibold",
          tone === "emerald" && "text-emerald-300",
          tone === "amber" && "text-amber-300",
          tone === "rose" && "text-rose-300"
        )}
      >
        {value}
      </p>
    </div>
  );
}
