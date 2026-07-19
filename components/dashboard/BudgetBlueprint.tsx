"use client";

import { useEffect, useState, type FormEvent } from "react";
import { Pencil, Scale, Trash2 } from "lucide-react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
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
import { Progress } from "@/components/ui/progress";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { cn, formatCurrency } from "@/lib/utils";
import type { BudgetCategoryVariance, BudgetTarget } from "@/types/babylon";

interface BudgetBlueprintProps {
  variances: BudgetCategoryVariance[];
  budgetTargets: BudgetTarget[];
  plannedTotal: number;
  actualTotal: number;
  expenditurePool: number;
  onUpdateTargetFull: (
    id: string,
    updatedData: Partial<Omit<BudgetTarget, "id">>
  ) => boolean;
  onDeleteTarget: (id: string, reassignToId?: string | null) => void;
  onAutoScaleCaps?: () => boolean;
}

export function BudgetBlueprint({
  variances,
  budgetTargets,
  plannedTotal,
  actualTotal,
  expenditurePool,
  onUpdateTargetFull,
  onDeleteTarget,
  onAutoScaleCaps,
}: BudgetBlueprintProps) {
  const [editing, setEditing] = useState<BudgetCategoryVariance | null>(null);
  const [draftName, setDraftName] = useState("");
  const [draftCap, setDraftCap] = useState("");
  const [draftEssential, setDraftEssential] = useState(true);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [reassignToId, setReassignToId] = useState<string>("");
  const [scaleFeedback, setScaleFeedback] = useState<string | null>(null);

  useEffect(() => {
    if (!editing) return;
    setDraftName(editing.categoryName);
    setDraftCap(String(editing.plannedAmount));
    setDraftEssential(editing.isEssential);
    setConfirmDelete(false);
    const alternatives = budgetTargets.filter((t) => t.id !== editing.id);
    setReassignToId(alternatives[0]?.id ?? "");
  }, [editing, budgetTargets]);

  const remainingTotal = Math.max(0, plannedTotal - actualTotal);
  const poolPressure =
    expenditurePool > 0
      ? Math.round((plannedTotal / expenditurePool) * 100)
      : null;
  const overPlanAmount =
    plannedTotal > expenditurePool
      ? Math.round((plannedTotal - expenditurePool) * 100) / 100
      : 0;
  const isOverPlanned = overPlanAmount > 0;

  const reassignmentOptions = editing
    ? budgetTargets.filter((t) => t.id !== editing.id)
    : [];

  const closeEditor = () => {
    setEditing(null);
    setConfirmDelete(false);
    setReassignToId("");
  };

  const handleSave = (event: FormEvent) => {
    event.preventDefault();
    if (!editing) return;
    const amount = Number.parseFloat(draftCap);
    const ok = onUpdateTargetFull(editing.id, {
      categoryName: draftName,
      plannedAmount: amount,
      isEssential: draftEssential,
    });
    if (ok) closeEditor();
  };

  const handleDelete = () => {
    if (!editing) return;
    const target =
      reassignmentOptions.length > 0 && reassignToId
        ? reassignToId
        : null;
    onDeleteTarget(editing.id, target);
    closeEditor();
  };

  const canAutoScale =
    Boolean(onAutoScaleCaps) &&
    budgetTargets.length > 0 &&
    expenditurePool > 0 &&
    plannedTotal > 0 &&
    Math.abs(plannedTotal - expenditurePool) > 0.009;

  const handleAutoScale = () => {
    if (!onAutoScaleCaps) return;
    const ok = onAutoScaleCaps();
    setScaleFeedback(
      ok
        ? "Caps scaled proportionally to this month's 70% pool."
        : "Could not auto-scale — need positive caps and a funded 70% pool."
    );
  };

  return (
    <section className="animate-fade-up">
      <Card className="border-slate-800/80">
        <CardHeader className="flex flex-col gap-3 px-4 sm:flex-row sm:items-start sm:justify-between sm:px-6">
          <div className="min-w-0">
            <CardTitle className="font-[family-name:var(--font-display)] text-lg sm:text-xl">
              Budget Blueprint
            </CardTitle>
            <CardDescription>
              Plan targets inside the 70% Necessary Expenditures boundary —
              actual vs. planned for the current month
            </CardDescription>
          </div>
          <div className="flex shrink-0 flex-col items-stretch gap-2 sm:items-end">
            <div className="space-y-0.5 text-left text-xs text-slate-500 sm:text-right">
              <p>
                Planned{" "}
                <span className="tabular-nums text-slate-300">
                  {formatCurrency(plannedTotal)}
                </span>
                {" · "}
                Spent{" "}
                <span className="tabular-nums text-slate-300">
                  {formatCurrency(actualTotal)}
                </span>
              </p>
              <p>
                <span className="tabular-nums text-emerald-400/90">
                  {formatCurrency(remainingTotal)}
                </span>{" "}
                remaining across caps
                {poolPressure !== null && (
                  <span className="ml-1 text-slate-600">
                    · {poolPressure}% of 70% pool
                  </span>
                )}
              </p>
            </div>
            {onAutoScaleCaps && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="min-h-10"
                disabled={!canAutoScale}
                onClick={handleAutoScale}
              >
                <Scale className="h-3.5 w-3.5" />
                Auto-Scale Allocations
              </Button>
            )}
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {scaleFeedback && (
            <p
              role="status"
              className="rounded-md border border-slate-700 bg-slate-950/50 px-3 py-2 text-xs text-slate-300"
            >
              {scaleFeedback}
            </p>
          )}
          {isOverPlanned && (
            <div
              role="alert"
              className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-4 py-3"
            >
              <p className="text-sm font-medium text-amber-200">
                Budget over-planned vs. this month&apos;s 70% pool
              </p>
              <p className="mt-1 text-xs leading-relaxed text-amber-200/80">
                Planned caps total{" "}
                <span className="tabular-nums font-medium text-amber-100">
                  {formatCurrency(plannedTotal)}
                </span>
                , exceeding the Necessary Expenditures pool of{" "}
                <span className="tabular-nums font-medium text-amber-100">
                  {formatCurrency(expenditurePool)}
                </span>{" "}
                by{" "}
                <span className="tabular-nums font-semibold text-amber-100">
                  {formatCurrency(overPlanAmount)}
                </span>
                . Trim category caps or grow this month&apos;s income before
                over-committing living allowance.
              </p>
            </div>
          )}
          {variances.length === 0 ? (
            <div className="rounded-lg border border-dashed border-slate-800 bg-slate-950/40 px-4 py-10 text-center">
              <p className="font-[family-name:var(--font-display)] text-lg text-slate-200">
                No budget buckets defined yet
              </p>
              <p className="mx-auto mt-2 max-w-md text-sm leading-relaxed text-slate-500">
                Use &apos;+ Record Tribute&apos; → Budget Category to map your
                custom blueprint.
              </p>
            </div>
          ) : (
            variances.map((row) => {
              const barPct = Math.min(100, row.usedPct);
              const overCap = row.actualAmount > row.plannedAmount;
              const indicatorClass =
                row.tone === "amber" ? "bg-amber-500" : "bg-emerald-600";

              return (
                <div
                  key={row.id}
                  className="rounded-lg border border-slate-800/70 bg-slate-950/30 px-3 py-3 sm:px-4"
                >
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="min-w-0 space-y-0.5">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="text-sm font-medium text-slate-100">
                          {row.categoryName}
                        </p>
                        <span
                          className={cn(
                            "inline-flex rounded px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wider",
                            row.isEssential
                              ? "bg-emerald-500/10 text-emerald-400/90"
                              : "bg-amber-500/10 text-amber-400/90"
                          )}
                        >
                          {row.isEssential ? "Essential" : "Discretionary"}
                        </span>
                      </div>
                      <p className="text-xs text-slate-500">
                        {overCap ? (
                          <>
                            <span className="tabular-nums text-amber-400">
                              {formatCurrency(
                                row.actualAmount - row.plannedAmount
                              )}{" "}
                              over
                            </span>{" "}
                            of {formatCurrency(row.plannedAmount)}
                          </>
                        ) : (
                          <>
                            <span className="tabular-nums text-slate-300">
                              {formatCurrency(row.remainingAmount)} remaining
                            </span>{" "}
                            of {formatCurrency(row.plannedAmount)}
                          </>
                        )}
                      </p>
                    </div>
                    <div className="flex items-center gap-3 text-right">
                      <div className="hidden sm:block">
                        <p className="text-[10px] uppercase tracking-wider text-slate-600">
                          Actual
                        </p>
                        <p className="tabular-nums text-sm text-slate-300">
                          {formatCurrency(row.actualAmount)}
                        </p>
                      </div>
                      <div>
                        <p className="text-[10px] uppercase tracking-wider text-slate-600">
                          Cap
                        </p>
                        <button
                          type="button"
                          onClick={() => setEditing(row)}
                          className="group inline-flex items-center gap-1.5 rounded-md border border-transparent px-1.5 py-0.5 text-right tabular-nums text-slate-200 transition-colors hover:border-slate-700 hover:bg-slate-950/60"
                          aria-label={`Modify budget bucket ${row.categoryName}`}
                        >
                          <span className="text-sm font-medium">
                            {formatCurrency(row.plannedAmount)}
                          </span>
                          <Pencil className="h-3 w-3 text-slate-600 transition-colors group-hover:text-slate-400" />
                        </button>
                      </div>
                    </div>
                  </div>

                  <div className="relative mt-3">
                    <Progress
                      value={barPct}
                      className="h-2.5 bg-slate-800/90"
                      indicatorClassName={cn(
                        "transition-all duration-500 ease-out",
                        indicatorClass
                      )}
                    />
                    <div className="mt-1.5 flex items-center justify-between text-[10px] tabular-nums text-slate-600">
                      <span>
                        {formatCurrency(row.actualAmount)}
                        <span className="mx-1 text-slate-700">/</span>
                        {formatCurrency(row.plannedAmount)}
                      </span>
                      <span
                        className={cn(
                          row.tone === "amber"
                            ? "text-amber-500"
                            : "text-emerald-600"
                        )}
                      >
                        {row.usedPct}% used
                      </span>
                    </div>
                  </div>
                </div>
              );
            })
          )}
        </CardContent>
      </Card>

      <Dialog
        open={editing !== null}
        onOpenChange={(open) => {
          if (!open) closeEditor();
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="font-[family-name:var(--font-display)] text-2xl">
              Modify Budget Bucket
            </DialogTitle>
            <DialogDescription>
              Update this Necessary Expenditures category or remove it from your
              blueprint.
            </DialogDescription>
          </DialogHeader>

          <form onSubmit={handleSave} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="modify-category-name">Category Name</Label>
              <Input
                id="modify-category-name"
                value={draftName}
                onChange={(e) => setDraftName(e.target.value)}
                required
                autoFocus
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="modify-planned-cap">Planned Cap</Label>
              <Input
                id="modify-planned-cap"
                type="number"
                min="0"
                step="0.01"
                value={draftCap}
                onChange={(e) => setDraftCap(e.target.value)}
                required
              />
            </div>
            <div className="flex items-center justify-between rounded-lg border border-slate-800 bg-slate-950/50 px-4 py-3">
              <div>
                <p className="text-sm font-medium text-slate-200">
                  Essential Need vs. Discretionary Desire
                </p>
                <p className="text-xs text-slate-500">
                  {draftEssential
                    ? "Core Need — housing, food, utilities, life"
                    : "Discretionary Desire — lifestyle creep watch"}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <span
                  className={cn(
                    "text-xs font-medium",
                    draftEssential ? "text-emerald-400" : "text-slate-500"
                  )}
                >
                  Essential
                </span>
                <Switch
                  checked={!draftEssential}
                  onCheckedChange={(checked) => setDraftEssential(!checked)}
                  aria-label="Toggle discretionary desire"
                />
                <span
                  className={cn(
                    "text-xs font-medium",
                    !draftEssential ? "text-amber-400" : "text-slate-500"
                  )}
                >
                  Desire
                </span>
              </div>
            </div>

            <DialogFooter className="flex-col gap-2 sm:flex-row sm:justify-between">
              <Button
                type="button"
                variant="outline"
                className="border-rose-900/50 text-rose-400 hover:border-rose-700 hover:bg-rose-500/10 hover:text-rose-300"
                onClick={() => setConfirmDelete(true)}
              >
                <Trash2 className="h-4 w-4" />
                Delete Category
              </Button>
              <div className="flex w-full gap-2 sm:w-auto">
                <Button
                  type="button"
                  variant="outline"
                  className="flex-1 sm:flex-none"
                  onClick={closeEditor}
                >
                  Cancel
                </Button>
                <Button type="submit" className="flex-1 sm:flex-none">
                  Save Changes
                </Button>
              </div>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <AlertDialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this budget bucket?</AlertDialogTitle>
            <AlertDialogDescription>
              &ldquo;{editing?.categoryName}&rdquo; will be removed from your
              blueprint. Linked expenses can be reassigned to another category,
              or left Uncategorized if none remains. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          {reassignmentOptions.length > 0 ? (
            <div className="space-y-2">
              <Label htmlFor="reassign-category">
                Reassign orphan expenses to
              </Label>
              <Select value={reassignToId} onValueChange={setReassignToId}>
                <SelectTrigger id="reassign-category">
                  <SelectValue placeholder="Select category" />
                </SelectTrigger>
                <SelectContent>
                  {reassignmentOptions.map((target) => (
                    <SelectItem key={target.id} value={target.id}>
                      {target.categoryName}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          ) : (
            <p className="text-xs text-slate-500">
              No alternative buckets remain — linked expenses will become
              Uncategorized.
            </p>
          )}
          <AlertDialogFooter>
            <AlertDialogCancel>Keep Category</AlertDialogCancel>
            <AlertDialogAction
              className="bg-rose-600 text-white shadow-sm hover:bg-rose-500 focus-visible:ring-rose-500/60"
              onClick={handleDelete}
            >
              Delete Category
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}
