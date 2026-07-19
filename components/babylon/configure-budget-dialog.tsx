"use client";

import { useEffect, useState, type FormEvent } from "react";
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
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import type { BudgetTarget } from "@/types/babylon";

interface ConfigureBudgetDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onAddTarget: (target: Omit<BudgetTarget, "id">) => boolean;
}

export function ConfigureBudgetDialog({
  open,
  onOpenChange,
  onAddTarget,
}: ConfigureBudgetDialogProps) {
  const [categoryName, setCategoryName] = useState("");
  const [plannedAmount, setPlannedAmount] = useState("");
  const [isEssential, setIsEssential] = useState(true);

  useEffect(() => {
    if (!open) return;
    setCategoryName("");
    setPlannedAmount("");
    setIsEssential(true);
  }, [open]);

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault();
    const amount = Number.parseFloat(plannedAmount);
    const ok = onAddTarget({
      categoryName,
      plannedAmount: amount,
      isEssential,
    });
    if (ok) {
      setCategoryName("");
      setPlannedAmount("");
      setIsEssential(true);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="font-[family-name:var(--font-display)] text-2xl">
            Configure Budget Blueprint
          </DialogTitle>
          <DialogDescription>
            Map a custom Necessary Expenditures bucket — name it, set a monthly
            cap, and classify it as essential or discretionary.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="budget-category-name">Category Name</Label>
            <Input
              id="budget-category-name"
              placeholder='e.g. Sustenance, Insurance, Custom Hobby'
              value={categoryName}
              onChange={(e) => setCategoryName(e.target.value)}
              required
              autoFocus
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="budget-planned-cap">Planned Monthly Cap</Label>
            <Input
              id="budget-planned-cap"
              type="number"
              min="0"
              step="0.01"
              placeholder="0.00"
              value={plannedAmount}
              onChange={(e) => setPlannedAmount(e.target.value)}
              required
            />
            <p className="text-[11px] text-slate-500">
              Soft ceiling inside the 70% living-allowance boundary.
            </p>
          </div>

          <div className="flex items-center justify-between rounded-lg border border-slate-800 bg-slate-950/50 px-4 py-3">
            <div>
              <p className="text-sm font-medium text-slate-200">
                Essential Need vs. Discretionary Desire
              </p>
              <p className="text-xs text-slate-500">
                {isEssential
                  ? "Core Need — housing, food, utilities, life"
                  : "Discretionary Desire — lifestyle creep watch"}
              </p>
            </div>
            <div className="flex items-center gap-2">
              <span
                className={cn(
                  "text-xs font-medium",
                  isEssential ? "text-emerald-400" : "text-slate-500"
                )}
              >
                Essential
              </span>
              <Switch
                checked={!isEssential}
                onCheckedChange={(checked) => setIsEssential(!checked)}
                aria-label="Toggle discretionary desire"
              />
              <span
                className={cn(
                  "text-xs font-medium",
                  !isEssential ? "text-amber-400" : "text-slate-500"
                )}
              >
                Desire
              </span>
            </div>
          </div>

          <DialogFooter className="mt-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
            >
              Cancel
            </Button>
            <Button type="submit">Add Budget Bucket</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
