"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
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
import { formatDiscreetCurrency } from "@/lib/babylon/discreet";
import {
  formatMonthLabel,
  nextMonthKey,
  previousMonthKey,
} from "@/lib/babylon/engine";
import { phoneBudgetDebtShareNote } from "@/lib/babylon/mobile-budget";
import {
  isMonthlyPlanPeriodKey,
  latestMonthlyPlanRevision,
  monthlyPlanCents,
  nextMonthlyPlanRevisionNumber,
  previewMonthlyPlan,
  seedMonthlyPlanFromRevision,
  seedMonthlyPlanFromTargets,
} from "@/lib/babylon/monthly-plan";
import { totalProtectedMoney } from "@/lib/babylon/protected-money";
import { obligationIntervalLabel } from "@/lib/babylon/recurring-obligations";
import { formatCurrency } from "@/lib/utils";
import type {
  BudgetTarget,
  DebtEntry,
  MonthlyPlanCategoryPurpose,
  MonthlyPlanObligationEvidence,
  MonthlyPlanRevision,
  RecurringObligation,
} from "@/types/babylon";

export interface MonthlyPlanFinalizeSubmission {
  periodKey: string;
  planningBasis: number;
  categories: readonly MonthlyPlanCategoryPurpose[];
}

export type MonthlyPlanFinalizeOutcome =
  | { ok: true; revision: MonthlyPlanRevision }
  | { ok: false; message: string };

interface MonthlyPlanPanelProps {
  suggestedPeriodKey: string;
  plans: readonly MonthlyPlanRevision[];
  budgetTargets: readonly BudgetTarget[];
  debts: readonly DebtEntry[];
  obligations: readonly RecurringObligation[];
  openingWealthBuilding: number;
  openingEmergencyFund: number;
  discreet?: boolean;
  onFinalize: (input: MonthlyPlanFinalizeSubmission) => MonthlyPlanFinalizeOutcome;
}

function parseDraftAmount(text: string): number {
  const trimmed = text.trim();
  if (!trimmed) return Number.NaN;
  const value = Number.parseFloat(trimmed);
  return Number.isFinite(value) ? value : Number.NaN;
}

function formatDueDay(isoDate: string): string {
  const [year, month, day] = isoDate.split("-").map(Number);
  if (!year || !month || !day) return isoDate;
  return new Date(year, month - 1, day).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });
}

function amountFields(
  categories: readonly MonthlyPlanCategoryPurpose[]
): Record<string, string> {
  return Object.fromEntries(
    categories.map((category) => [category.id, String(category.plannedAmount)])
  );
}

export function MonthlyPlanPanel({
  suggestedPeriodKey,
  plans,
  budgetTargets,
  debts,
  obligations,
  openingWealthBuilding,
  openingEmergencyFund,
  discreet = false,
  onFinalize,
}: MonthlyPlanPanelProps) {
  const [periodKey, setPeriodKey] = useState(suggestedPeriodKey);
  const [drafting, setDrafting] = useState(false);
  const [basisText, setBasisText] = useState("");
  const [purposes, setPurposes] = useState<MonthlyPlanCategoryPurpose[]>([]);
  const [amountText, setAmountText] = useState<Record<string, string>>({});
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [finalizeMessage, setFinalizeMessage] = useState<string | null>(null);

  const money = (value: number) =>
    formatDiscreetCurrency(value, discreet, formatCurrency);
  const moneyFromCents = (centValue: number) => money(centValue / 100);
  const label = formatMonthLabel(periodKey);
  const latest = latestMonthlyPlanRevision(plans, periodKey);
  const protectedTotal = totalProtectedMoney(
    openingWealthBuilding,
    openingEmergencyFund
  );

  const draftCategories = purposes.map((purpose) => ({
    ...purpose,
    plannedAmount: parseDraftAmount(amountText[purpose.id] ?? ""),
  }));
  const preview = drafting
    ? previewMonthlyPlan({
        periodKey,
        planningBasis: parseDraftAmount(basisText),
        categories: draftCategories,
        debts,
        obligations,
      })
    : null;
  const nextRevision = nextMonthlyPlanRevisionNumber(plans, periodKey);

  const openDraft = (mode: "first" | "revise", sourcePeriod: string) => {
    const current = latestMonthlyPlanRevision(plans, sourcePeriod);
    if (mode === "revise" && current) {
      const seed = seedMonthlyPlanFromRevision(current);
      setBasisText(String(seed.planningBasis));
      setPurposes(seed.categories);
      setAmountText(amountFields(seed.categories));
    } else {
      const seed = seedMonthlyPlanFromTargets(budgetTargets);
      setBasisText("");
      setPurposes(seed);
      setAmountText(amountFields(seed));
    }
    setFinalizeMessage(null);
    setConfirmOpen(false);
    setDrafting(true);
  };

  const movePeriod = (direction: -1 | 1) => {
    const next =
      direction < 0 ? previousMonthKey(periodKey) : nextMonthKey(periodKey);
    if (!isMonthlyPlanPeriodKey(next)) return;
    setPeriodKey(next);
    if (!drafting) return;
    const existing = latestMonthlyPlanRevision(plans, next);
    openDraft(existing ? "revise" : "first", next);
  };

  const discardDraft = () => {
    setDrafting(false);
    setConfirmOpen(false);
    setFinalizeMessage(null);
    setBasisText("");
    setPurposes([]);
    setAmountText({});
  };

  const confirmFinalize = () => {
    if (!preview?.canFinalize) return;
    const outcome = onFinalize({
      periodKey,
      planningBasis: parseDraftAmount(basisText),
      categories: draftCategories,
    });
    if (!outcome.ok) {
      setFinalizeMessage(outcome.message);
      return;
    }
    setConfirmOpen(false);
    setFinalizeMessage(null);
    setDrafting(false);
    setBasisText("");
    setPurposes([]);
    setAmountText({});
  };

  const obligationsFor = (categoryId: string) =>
    preview?.obligations.filter(
      (obligation) => obligation.budgetCategoryId === categoryId
    ) ?? [];
  const unmatchedObligations =
    preview?.obligations.filter(
      (obligation) =>
        !purposes.some((purpose) => purpose.id === obligation.budgetCategoryId)
    ) ?? [];

  return (
    <section aria-label="Monthly Plan" className="space-y-3">
      <Card className="border-slate-800/80">
        <CardContent className="space-y-4 p-4">
          <div className="flex items-center justify-between gap-3">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => movePeriod(-1)}
              aria-label="Previous period"
            >
              Previous
            </Button>
            <p className="text-center text-sm font-medium text-slate-100">
              {label}
            </p>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => movePeriod(1)}
              aria-label="Next period"
            >
              Next
            </Button>
          </div>

          {!drafting && latest ? (
            <RevisionSummary
              revision={latest}
              money={money}
              onRevise={() => openDraft("revise", periodKey)}
            />
          ) : null}

          {!drafting && !latest ? (
            <div className="space-y-3">
              <p className="text-sm text-slate-200">No plan for {label}</p>
              <Button type="button" onClick={() => openDraft("first", periodKey)}>
                Plan {label}
              </Button>
            </div>
          ) : null}

          {drafting && preview ? (
            <div className="space-y-5">
              <div className="space-y-2">
                <Label htmlFor="planning-basis">Planning Basis</Label>
                <p className="text-xs leading-relaxed text-slate-500">
                  An assumption used to derive this period&apos;s 10/20/70 split.
                </p>
                <Input
                  id="planning-basis"
                  type="number"
                  min="0"
                  step="0.01"
                  inputMode="decimal"
                  value={basisText}
                  onChange={(event) => setBasisText(event.target.value)}
                />
                {basisText.trim() !== "" && preview.basisMessage ? (
                  <p role="alert" className="text-xs text-amber-200">
                    {preview.basisMessage}
                  </p>
                ) : null}
              </div>

              {preview.split ? (
                <div className="space-y-2" aria-label="10/20/70 split">
                  <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-500">
                    10 / 20 / 70
                  </p>
                  <SplitLine
                    title="Wealth Building"
                    amount={money(preview.split.wealthShare)}
                  />
                  <SplitLine
                    title="Debt"
                    amount={money(preview.split.debtShare)}
                    note={
                      preview.split.debtRedirected
                        ? phoneBudgetDebtShareNote(false)
                        : undefined
                    }
                  />
                  <SplitLine
                    title="Living"
                    amount={money(preview.split.expenditureShare)}
                  />
                  <p className="text-xs leading-relaxed text-slate-500">
                    The rates are fixed. This split is derived from the Planning
                    Basis.
                  </p>
                </div>
              ) : null}

              <div className="space-y-2" aria-label="Debt context">
                <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-500">
                  Debt
                </p>
                <p className="text-xs leading-relaxed text-slate-400">
                  Debt share{" "}
                  <span className="tabular-nums text-slate-200">
                    {preview.split ? money(preview.split.debtShare) : "—"}
                  </span>
                  {preview.debtMinimumCents !== null ? (
                    <>
                      {" "}
                      · Minimums{" "}
                      <span className="tabular-nums text-slate-200">
                        {moneyFromCents(preview.debtMinimumCents)}
                      </span>
                    </>
                  ) : null}
                </p>
                {debts.length === 0 ? (
                  <p className="text-xs text-slate-500">No debts are recorded.</p>
                ) : (
                  <ul className="space-y-2">
                    {debts.map((debt) => (
                      <li
                        key={debt.id}
                        className="flex items-baseline justify-between gap-3 text-sm"
                      >
                        <span className="min-w-0 text-slate-200">
                          {debt.creditor}
                          <span className="mt-0.5 block text-xs text-slate-500">
                            Remaining {money(debt.remainingDebt)}
                          </span>
                        </span>
                        <span className="shrink-0 tabular-nums text-slate-100">
                          {money(debt.monthlyAllocation)}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
                {preview.debtMessage ? (
                  <p
                    role="alert"
                    className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs leading-relaxed text-amber-200"
                  >
                    {preview.debtMessage}
                  </p>
                ) : null}
              </div>

              <div className="space-y-3" aria-label="Living purposes">
                <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-500">
                  Living purposes
                </p>
                {preview.split ? (
                  <p className="text-xs text-slate-400">
                    Living share{" "}
                    <span className="tabular-nums text-slate-200">
                      {money(preview.split.expenditureShare)}
                    </span>
                    {preview.assignedCents !== null ? (
                      <>
                        {" "}
                        · Assigned{" "}
                        <span className="tabular-nums text-slate-200">
                          {moneyFromCents(preview.assignedCents)}
                        </span>
                      </>
                    ) : null}
                  </p>
                ) : null}
                {purposes.length === 0 ? (
                  <p className="text-xs leading-relaxed text-slate-400">
                    Monthly Planning uses the categories already defined in
                    Wealth Engine. Create a category from Add, then return to
                    this plan.
                  </p>
                ) : (
                  <ul className="space-y-4">
                    {purposes.map((purpose) => {
                      const tagged = obligationsFor(purpose.id);
                      const obligationCents =
                        preview.obligationCentsByCategoryId[purpose.id] ?? 0;
                      const amount = parseDraftAmount(amountText[purpose.id] ?? "");
                      const shortfall = Number.isFinite(amount)
                        ? obligationCents - monthlyPlanCents(amount)
                        : 0;
                      return (
                        <li key={purpose.id} className="space-y-2">
                          <div className="flex items-baseline justify-between gap-3">
                            <p className="text-sm text-slate-100">
                              {purpose.categoryName}
                            </p>
                            <p className="text-[11px] font-medium uppercase tracking-wider text-slate-500">
                              {purpose.isEssential ? "Need" : "Want"}
                            </p>
                          </div>
                          <Label htmlFor={`purpose-${purpose.id}`} className="sr-only">
                            {purpose.categoryName} amount
                          </Label>
                          <Input
                            id={`purpose-${purpose.id}`}
                            type="number"
                            min="0"
                            step="0.01"
                            inputMode="decimal"
                            value={amountText[purpose.id] ?? ""}
                            onChange={(event) =>
                              setAmountText((current) => ({
                                ...current,
                                [purpose.id]: event.target.value,
                              }))
                            }
                          />
                          {tagged.length > 0 ? (
                            <ul className="space-y-1">
                              {tagged.map((obligation) => (
                                <ObligationLine
                                  key={obligation.id}
                                  obligation={obligation}
                                  money={money}
                                  insidePurpose
                                />
                              ))}
                            </ul>
                          ) : null}
                          {shortfall > 0 ? (
                            <p className="text-xs leading-relaxed text-slate-400">
                              Due bills inside this purpose total{" "}
                              <span className="tabular-nums text-slate-200">
                                {moneyFromCents(obligationCents)}
                              </span>
                              . This purpose assigns{" "}
                              <span className="tabular-nums text-slate-200">
                                {money(amount)}
                              </span>
                              .
                            </p>
                          ) : null}
                        </li>
                      );
                    })}
                  </ul>
                )}
                {unmatchedObligations.length > 0 ? (
                  <div className="space-y-1">
                    <p className="text-xs text-slate-500">
                      Due this period, without a purpose in this draft.
                    </p>
                    <ul className="space-y-1">
                      {unmatchedObligations.map((obligation) => (
                        <ObligationLine
                          key={obligation.id}
                          obligation={obligation}
                          money={money}
                          categoryName={
                            budgetTargets.find(
                              (target) => target.id === obligation.budgetCategoryId
                            )?.categoryName
                          }
                        />
                      ))}
                    </ul>
                  </div>
                ) : null}
                {preview.categoryMessage ? (
                  <p role="alert" className="text-xs text-amber-200">
                    {preview.categoryMessage}
                  </p>
                ) : null}
                {preview.remainingCents !== null && preview.remainingCents > 0 ? (
                  <p role="status" className="text-xs leading-relaxed text-slate-300">
                    Remaining to assign {moneyFromCents(preview.remainingCents)}.{" "}
                    {preview.assignmentMessage}
                  </p>
                ) : null}
                {preview.remainingCents !== null && preview.remainingCents < 0 ? (
                  <p
                    role="alert"
                    className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs leading-relaxed text-amber-200"
                  >
                    Over-assigned by {moneyFromCents(Math.abs(preview.remainingCents))}.{" "}
                    {preview.assignmentMessage}
                  </p>
                ) : null}
                {preview.remainingCents === 0 ? (
                  <p role="status" className="text-xs text-slate-400">
                    Assigned matches the Living share.
                  </p>
                ) : null}
              </div>

              <div className="space-y-1" aria-label="Protected Money">
                <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-500">
                  Protected Money
                </p>
                <p className="text-sm tabular-nums text-slate-100">
                  {money(protectedTotal)}
                </p>
                <p className="text-xs leading-relaxed text-slate-400">
                  Existing Wealth Building {money(openingWealthBuilding)} · Existing
                  Emergency Fund {money(openingEmergencyFund)}
                </p>
                <p className="text-xs leading-relaxed text-slate-500">
                  These amounts are already included in account balances. They
                  are not additional money. Protected Money is context for this
                  period and is not part of the Planning Basis.
                </p>
              </div>

              {nextRevision > 1 ? (
                <p className="text-xs leading-relaxed text-slate-500">
                  Earlier revisions of this period remain saved.
                </p>
              ) : null}

              <div className="flex flex-wrap gap-2">
                <Button type="button" variant="outline" onClick={discardDraft}>
                  Cancel
                </Button>
                <Button
                  type="button"
                  disabled={!preview.canFinalize}
                  onClick={() => {
                    setFinalizeMessage(null);
                    setConfirmOpen(true);
                  }}
                >
                  Finalize
                </Button>
              </div>
            </div>
          ) : null}
        </CardContent>
      </Card>

      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="font-[family-name:var(--font-display)]">
              Finalize {label}
            </DialogTitle>
            <DialogDescription>
              This saves a Monthly Plan revision. Live categories stay as they
              are. Income is not recorded. Money Available is not changed.
            </DialogDescription>
          </DialogHeader>
          <dl className="space-y-2 text-sm">
            <ReviewRow label="Period" value={periodKey} />
            <ReviewRow
              label="Planning Basis"
              value={money(parseDraftAmount(basisText) || 0)}
            />
            <ReviewRow
              label="Living share"
              value={
                preview?.split ? money(preview.split.expenditureShare) : "—"
              }
            />
            <ReviewRow label="Revision" value={String(nextRevision)} />
          </dl>
          {finalizeMessage ? (
            <p role="alert" className="text-xs leading-relaxed text-amber-200">
              {finalizeMessage}
            </p>
          ) : null}
          <DialogFooter className="gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => setConfirmOpen(false)}
            >
              Back
            </Button>
            <Button type="button" onClick={confirmFinalize}>
              Finalize revision {nextRevision}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}

function SplitLine({
  title,
  amount,
  note,
}: {
  title: string;
  amount: string;
  note?: string;
}) {
  return (
    <div>
      <div className="flex items-baseline justify-between gap-3 text-sm">
        <p className="text-slate-200">{title}</p>
        <p className="shrink-0 tabular-nums text-slate-100">{amount}</p>
      </div>
      {note ? <p className="mt-1 text-xs text-slate-500">{note}</p> : null}
    </div>
  );
}

function ReviewRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="text-slate-500">{label}</dt>
      <dd className="tabular-nums text-slate-100">{value}</dd>
    </div>
  );
}

function ObligationLine({
  obligation,
  money,
  categoryName,
  insidePurpose = false,
}: {
  obligation: MonthlyPlanObligationEvidence;
  money: (value: number) => string;
  categoryName?: string;
  insidePurpose?: boolean;
}) {
  return (
    <li className="text-xs leading-relaxed text-slate-400">
      <span className="text-slate-500">{formatDueDay(obligation.dueDate)}</span>{" "}
      <span className="text-slate-200">{obligation.name}</span>{" "}
      <span className="tabular-nums text-slate-200">{money(obligation.amount)}</span>
      {" · "}
      {obligationIntervalLabel(obligation.intervalMonths)}
      {categoryName ? ` · ${categoryName}` : null}
      {insidePurpose ? (
        <span className="mt-0.5 block text-slate-500">
          This bill is expected inside this purpose.
        </span>
      ) : null}
    </li>
  );
}

function RevisionSummary({
  revision,
  money,
  onRevise,
}: {
  revision: MonthlyPlanRevision;
  money: (value: number) => string;
  onRevise: () => void;
}) {
  return (
    <div className="space-y-3">
      <p className="text-sm text-slate-100">
        {formatMonthLabel(revision.periodKey)} · Revision {revision.revision}
      </p>
      <p className="text-xs leading-relaxed text-slate-400">
        Planning Basis{" "}
        <span className="tabular-nums text-slate-200">
          {money(revision.planningBasis)}
        </span>
        {" · "}
        Living{" "}
        <span className="tabular-nums text-slate-200">
          {money(revision.expenditureShare)}
        </span>
      </p>
      <ul className="space-y-1">
        {revision.categories.map((category) => (
          <li
            key={category.id}
            className="flex items-baseline justify-between gap-3 text-sm"
          >
            <span className="text-slate-300">
              {category.categoryName}
              <span className="ml-2 text-[11px] uppercase tracking-wider text-slate-500">
                {category.isEssential ? "Need" : "Want"}
              </span>
            </span>
            <span className="tabular-nums text-slate-100">
              {money(category.plannedAmount)}
            </span>
          </li>
        ))}
      </ul>
      {revision.revision > 1 ? (
        <p className="text-xs leading-relaxed text-slate-500">
          Earlier revisions of this period remain saved.
        </p>
      ) : null}
      <Button type="button" variant="outline" onClick={onRevise}>
        Revise
      </Button>
    </div>
  );
}
