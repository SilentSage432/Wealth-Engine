"use client";

import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { DebtPositionDeclaration } from "@/lib/babylon/debt-semantics";
import { formatDiscreetCurrency } from "@/lib/babylon/discreet";
import { formatCurrency } from "@/lib/utils";
import type { DebtEntry } from "@/types/babylon";

interface DebtPositionRebaseModalProps {
  open: boolean;
  debts: readonly DebtEntry[];
  discreet?: boolean;
  onOpenChange: (open: boolean) => void;
  onComplete: (declarations: readonly DebtPositionDeclaration[]) => string | null;
}

/**
 * All-or-nothing steward authority surface for the debt-position epoch.
 * Closing without completing leaves legacy semantics untouched.
 */
export function DebtPositionRebaseModal({
  open,
  debts,
  discreet = false,
  onOpenChange,
  onComplete,
}: DebtPositionRebaseModalProps) {
  const money = (n: number) =>
    formatDiscreetCurrency(n, discreet, formatCurrency);

  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    const next: Record<string, string> = {};
    for (const debt of debts) {
      next[debt.id] = "";
    }
    setDrafts(next);
    setError(null);
  }, [open, debts]);

  const allFilled = useMemo(() => {
    return debts.every((debt) => {
      const raw = drafts[debt.id]?.trim() ?? "";
      if (!raw) return false;
      const value = Number(raw);
      return Number.isFinite(value) && value >= 0;
    });
  }, [debts, drafts]);

  const handleConfirm = () => {
    setError(null);
    const declarations: DebtPositionDeclaration[] = [];
    for (const debt of debts) {
      const value = Number(drafts[debt.id]?.trim() ?? "");
      if (!Number.isFinite(value) || value < 0) {
        setError(`Enter what ${debt.creditor} says you owe today.`);
        return;
      }
      declarations.push({ debtId: debt.id, currentOwed: value });
    }
    const reason = onComplete(declarations);
    if (reason) {
      setError(reason);
      return;
    }
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto border-slate-700 bg-slate-950 sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="font-[family-name:var(--font-display)] text-xl text-slate-100">
            Establish what you owe
          </DialogTitle>
          <DialogDescription className="text-slate-400">
            Wealth Engine has been tracking modeled progress toward each debt.
            Enter what each creditor says you owe today. This sets your current
            position — not a payment history, and not a judgment of the
            difference.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          {debts.map((debt) => (
            <div
              key={debt.id}
              className="space-y-2 rounded-lg border border-slate-800 bg-slate-900/40 p-3"
            >
              <div className="flex items-baseline justify-between gap-2">
                <p className="font-medium text-slate-100">{debt.creditor}</p>
                <p className="text-xs text-slate-500">
                  WE currently models {money(debt.remainingDebt)}
                </p>
              </div>
              <div className="space-y-1.5">
                <Label
                  htmlFor={`owed-${debt.id}`}
                  className="text-xs text-slate-400"
                >
                  What does {debt.creditor} say you owe today?
                </Label>
                <Input
                  id={`owed-${debt.id}`}
                  type="number"
                  min={0}
                  step="0.01"
                  inputMode="decimal"
                  placeholder="0.00"
                  value={drafts[debt.id] ?? ""}
                  onChange={(event) =>
                    setDrafts((prev) => ({
                      ...prev,
                      [debt.id]: event.target.value,
                    }))
                  }
                  className="border-slate-700 bg-slate-950"
                />
              </div>
            </div>
          ))}
          <p className="text-xs leading-relaxed text-slate-500">
            Enter an amount for every debt before continuing. You can cancel
            anytime — nothing changes until you confirm all of them.
          </p>
          {error && (
            <p className="text-sm text-rose-400" role="alert">
              {error}
            </p>
          )}
        </div>

        <DialogFooter className="gap-2 sm:gap-0">
          <Button
            type="button"
            variant="ghost"
            onClick={() => onOpenChange(false)}
          >
            Cancel
          </Button>
          <Button
            type="button"
            disabled={!allFilled}
            onClick={handleConfirm}
            className="bg-amber-600 text-slate-950 hover:bg-amber-500"
          >
            Record current amounts owed
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
