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
import { cn, formatCurrency } from "@/lib/utils";
import type { MonthlyCloseSummary, SurplusDisposition } from "@/types/babylon";

interface MonthlyCloseModalProps {
  open: boolean;
  summary: MonthlyCloseSummary;
  hasActiveDebt: boolean;
  emergencyShield: number;
  onOpenChange: (open: boolean) => void;
  onCloseMonth: (disposition: SurplusDisposition) => boolean;
}

const STEPS = [
  "Period Summary",
  "Surplus Disposition",
  "Archive & Roll Forward",
] as const;

export function MonthlyCloseModal({
  open,
  summary,
  hasActiveDebt,
  emergencyShield,
  onOpenChange,
  onCloseMonth,
}: MonthlyCloseModalProps) {
  const [step, setStep] = useState(0);
  const [disposition, setDisposition] =
    useState<SurplusDisposition>("debt_wealth");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setStep(0);
    setDisposition("debt_wealth");
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
      setError("Could not close the period. Try again.");
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[min(90vh,900px)] overflow-y-auto scrollbar-thin sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="font-[family-name:var(--font-display)] text-xl sm:text-2xl">
            Monthly Close Ritual
          </DialogTitle>
          <DialogDescription>
            Close {summary.monthLabel} cleanly — summarize, dispose surplus, and
            archive the period.
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
              <Metric
                label="Total Income"
                value={formatCurrency(summary.totalIncome)}
                tone="emerald"
              />
              <Metric
                label="Total Spent"
                value={formatCurrency(summary.totalSpent)}
                tone="rose"
              />
              <Metric
                label="10% Wealth"
                value={formatCurrency(summary.wealthAllocated)}
                tone="emerald"
              />
              <Metric
                label="20% Debt"
                value={formatCurrency(summary.debtAllocated)}
                tone="amber"
              />
            </div>
            <div className="rounded-lg border border-slate-800 bg-slate-950/50 p-4">
              <p className="text-[10px] uppercase tracking-wider text-slate-500">
                70% Pool · Remaining
              </p>
              <p className="mt-1 tabular-nums text-sm text-slate-400">
                Pool {formatCurrency(summary.expenditurePool)} · Spent{" "}
                {formatCurrency(summary.totalSpent)}
              </p>
              <p
                className={cn(
                  "mt-2 font-[family-name:var(--font-display)] text-2xl font-semibold tabular-nums",
                  isDeficit ? "text-rose-300" : "text-emerald-300"
                )}
              >
                {isDeficit ? "Deficit " : "Surplus "}
                {formatCurrency(Math.abs(summary.surplusOrDeficit))}
              </p>
              <p className="mt-1 text-xs text-slate-500">
                Emergency shield on hand:{" "}
                <span className="tabular-nums text-slate-300">
                  {formatCurrency(emergencyShield)}
                </span>
              </p>
            </div>
            {summary.alreadyClosed && (
              <p className="rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-200">
                {summary.monthLabel} is already archived. Opening next month
                begins automatically with the calendar.
              </p>
            )}
          </div>
        )}

        {step === 1 && (
          <div className="space-y-3">
            <p className="text-sm leading-relaxed text-slate-400">
              According to Babylonian principle, unspent living allowance should
              not idle. Direct surplus into the Debt/Wealth multiplier or tuck
              it into your emergency shield.
            </p>
            {surplus <= 0 ? (
              <div className="rounded-lg border border-dashed border-slate-800 bg-slate-950/40 px-4 py-6 text-center text-sm text-slate-500">
                No surplus remains in the 70% pool
                {isDeficit ? " — the period closed in deficit." : "."} You may
                still archive and roll forward.
              </div>
            ) : (
              <div className="grid gap-2">
                <button
                  type="button"
                  onClick={() => setDisposition("debt_wealth")}
                  className={cn(
                    "rounded-lg border px-4 py-3 text-left transition-colors",
                    disposition === "debt_wealth"
                      ? "border-emerald-500/40 bg-emerald-500/10"
                      : "border-slate-800 bg-slate-950/40 hover:border-slate-700"
                  )}
                >
                  <p className="text-sm font-medium text-slate-100">
                    Accelerate Debt / Wealth
                  </p>
                  <p className="mt-1 text-xs text-slate-500">
                    {hasActiveDebt
                      ? `Split ${formatCurrency(surplus)} — ⅓ Wealth Archive, ⅔ creditor waterfall.`
                      : `Direct ${formatCurrency(surplus)} entirely into the Wealth Archive (no active debt).`}
                  </p>
                </button>
                <button
                  type="button"
                  onClick={() => setDisposition("emergency_shield")}
                  className={cn(
                    "rounded-lg border px-4 py-3 text-left transition-colors",
                    disposition === "emergency_shield"
                      ? "border-amber-500/40 bg-amber-500/10"
                      : "border-slate-800 bg-slate-950/40 hover:border-slate-700"
                  )}
                >
                  <p className="text-sm font-medium text-slate-100">
                    Emergency Shield Reservoir
                  </p>
                  <p className="mt-1 text-xs text-slate-500">
                    Tuck {formatCurrency(surplus)} into the shield for future
                    protection.
                  </p>
                </button>
              </div>
            )}
          </div>
        )}

        {step === 2 && (
          <div className="space-y-3">
            <div className="rounded-lg border border-slate-800 bg-slate-950/50 p-4 text-sm leading-relaxed text-slate-400">
              <p>
                Confirming will archive{" "}
                <span className="text-slate-200">{summary.monthLabel}</span>,
                settle open expenses dated in this month, apply your surplus
                disposition
                {surplus > 0 ? (
                  <>
                    {" "}
                    (
                    {disposition === "emergency_shield"
                      ? "emergency shield"
                      : "Debt/Wealth multiplier"}
                    )
                  </>
                ) : null}
                , and roll the operational baseline forward to the next calendar
                key.
              </p>
              <p className="mt-3 text-xs text-slate-500">
                Historical incomes, allocations, and charts remain intact —
                only the period seal advances.
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
              Seal Period
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
