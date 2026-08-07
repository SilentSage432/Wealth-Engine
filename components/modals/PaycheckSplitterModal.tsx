"use client";

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
import type { AllocationSplit, IncomeInput } from "@/types/babylon";

interface PaycheckSplitterModalProps {
  open: boolean;
  pending: IncomeInput | null;
  preview: AllocationSplit | null;
  hasActiveDebt: boolean;
  discreet?: boolean;
  onOpenChange: (open: boolean) => void;
  onExecute: () => boolean;
  onCancel: () => void;
}

export function PaycheckSplitterModal({
  open,
  pending,
  preview,
  hasActiveDebt,
  discreet = false,
  onOpenChange,
  onExecute,
  onCancel,
}: PaycheckSplitterModalProps) {
  const money = (n: number) =>
    formatDiscreetCurrency(n, discreet, formatCurrency);

  const handleExecute = () => {
    const ok = onExecute();
    if (ok) onOpenChange(false);
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) onCancel();
        onOpenChange(next);
      }}
    >
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="font-[family-name:var(--font-display)] text-xl">
            Paycheck 10/20/70 Splitter
          </DialogTitle>
          <DialogDescription>
            Review the Babylon allocation for{" "}
            <span className="text-slate-300">
              {pending?.source ?? "this tribute"}
            </span>{" "}
            before it hits your vault.
          </DialogDescription>
        </DialogHeader>

        {pending && preview && (
          <div className="space-y-3">
            <div className="rounded-lg border border-slate-800 bg-slate-950/50 px-4 py-3">
              <p className="text-[10px] uppercase tracking-wider text-slate-500">
                Gross tribute
              </p>
              <p className="mt-1 font-[family-name:var(--font-display)] text-3xl tabular-nums text-slate-50">
                {money(pending.amount)}
              </p>
            </div>

            <SplitRow
              label="10% Wealth Engine"
              hint="Emergency shield / investments archive"
              amount={preview.wealthShare}
              tone="emerald"
              money={money}
            />
            <SplitRow
              label="20% Debt Engine"
              hint={
                hasActiveDebt
                  ? "Auto-applied to priority creditors"
                  : "Redirected to Wealth (debt-free)"
              }
              amount={preview.debtShare}
              tone="amber"
              money={money}
              redirected={preview.debtRedirected}
            />
            <SplitRow
              label="70% Expenditure Pool"
              hint="Current month living allowance"
              amount={preview.expenditureShare}
              tone="slate"
              money={money}
            />
          </div>
        )}

        <DialogFooter className="mt-4 gap-2 sm:justify-between">
          <Button type="button" variant="outline" onClick={onCancel}>
            Cancel
          </Button>
          <Button type="button" variant="amber" onClick={handleExecute}>
            Execute Allocation
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function SplitRow({
  label,
  hint,
  amount,
  tone,
  money,
  redirected,
}: {
  label: string;
  hint: string;
  amount: number;
  tone: "emerald" | "amber" | "slate";
  money: (n: number) => string;
  redirected?: boolean;
}) {
  return (
    <div
      className={cn(
        "rounded-lg border px-4 py-3",
        tone === "emerald" && "border-emerald-900/40 bg-emerald-950/20",
        tone === "amber" && "border-amber-900/40 bg-amber-950/20",
        tone === "slate" && "border-slate-800 bg-slate-950/40"
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-sm font-medium text-slate-100">{label}</p>
          <p className="mt-0.5 text-xs text-slate-500">{hint}</p>
          {redirected && (
            <p className="mt-1 text-[10px] uppercase tracking-wider text-emerald-400/80">
              Debt share redirected
            </p>
          )}
        </div>
        <p
          className={cn(
            "shrink-0 font-[family-name:var(--font-display)] text-xl tabular-nums",
            tone === "emerald" && "text-emerald-300",
            tone === "amber" && "text-amber-300",
            tone === "slate" && "text-slate-200"
          )}
        >
          {money(amount)}
        </p>
      </div>
    </div>
  );
}
