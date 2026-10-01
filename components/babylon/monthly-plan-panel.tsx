"use client";

import { useEffect, useState } from "react";
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
import { FINANCIAL_CALENDAR_UNKNOWN } from "@/lib/babylon/civil-time";
import { formatDiscreetCurrency } from "@/lib/babylon/discreet";
import {
  formatMonthLabel,
  nextMonthKey,
  previousMonthKey,
} from "@/lib/babylon/engine";
import { phoneBudgetDebtShareNote } from "@/lib/babylon/mobile-budget";
import {
  formatPlanMonthTitle,
  livingPurposeMapState,
  mergeFirstDraftAmountFields,
  mergeFirstDraftPurposes,
  planResultWealthBuilding,
  planSplitProportions,
  totalRemainingDebtCents,
} from "@/lib/babylon/monthly-plan-map";
import {
  isMonthlyPlanPeriodKey,
  latestMonthlyPlanRevision,
  monthlyPlanCents,
  nextMonthlyPlanRevisionNumber,
  previewMonthlyPlan,
  seedMonthlyPlanFromRevision,
  seedMonthlyPlanFromTargets,
} from "@/lib/babylon/monthly-plan";
import { obligationIntervalLabel } from "@/lib/babylon/recurring-obligations";
import { cn, formatCurrency } from "@/lib/utils";
import { FundThisMonthSection } from "@/components/babylon/fund-this-month";
import type {
  BudgetTarget,
  DebtEntry,
  MonthlyPlanCategoryPurpose,
  MonthlyPlanObligationEvidence,
  MonthlyPlanRevision,
  PaySchedule,
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
  suggestedPeriodKey: string | null;
  financialToday?: string | null;
  plans: readonly MonthlyPlanRevision[];
  budgetTargets: readonly BudgetTarget[];
  debts: readonly DebtEntry[];
  obligations: readonly RecurringObligation[];
  openingWealthBuilding: number;
  openingEmergencyFund: number;
  paySchedules: readonly PaySchedule[];
  discreet?: boolean;
  /** Desktop Overview compresses a finalized map. Phone leaves this unset. */
  disclosure?: boolean;
  /** Phone projection shows the stored map and hides finalize, revise, and pay-schedule authorship. */
  readOnly?: boolean;
  onFinalize: (input: MonthlyPlanFinalizeSubmission) => MonthlyPlanFinalizeOutcome;
  onUpsertPaySchedule: (
    schedule: PaySchedule
  ) => { ok: true } | { ok: false; message: string };
  onRemovePaySchedule: (id: string) => void;
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

function ratioWidth(ratio: number): string {
  if (ratio <= 0) return "0%";
  return `${Math.max(2, Math.min(100, ratio * 100)).toFixed(2)}%`;
}

export function MonthlyPlanPanel({
  suggestedPeriodKey,
  financialToday = null,
  plans,
  budgetTargets,
  debts,
  obligations,
  openingWealthBuilding,
  openingEmergencyFund,
  paySchedules,
  discreet = false,
  disclosure = false,
  readOnly = false,
  onFinalize,
  onUpsertPaySchedule,
  onRemovePaySchedule,
}: MonthlyPlanPanelProps) {
  const [periodKey, setPeriodKey] = useState<string | null>(suggestedPeriodKey);
  const [drafting, setDrafting] = useState(false);
  const [draftOrigin, setDraftOrigin] = useState<"first" | "revise" | null>(
    null
  );
  const [basisText, setBasisText] = useState("");
  const [purposes, setPurposes] = useState<MonthlyPlanCategoryPurpose[]>([]);
  const [amountText, setAmountText] = useState<Record<string, string>>({});
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [finalizeMessage, setFinalizeMessage] = useState<string | null>(null);
  const [showDebtDetail, setShowDebtDetail] = useState(false);
  const [showCommitments, setShowCommitments] = useState(false);

  const money = (value: number) =>
    formatDiscreetCurrency(value, discreet, formatCurrency);
  const moneyFromCents = (centValue: number) => money(centValue / 100);
  const shortLabel = periodKey ? formatMonthLabel(periodKey) : "";
  const monthTitle = periodKey ? formatPlanMonthTitle(periodKey) : "";
  const latest = periodKey ? latestMonthlyPlanRevision(plans, periodKey) : null;

  const draftCategories = purposes.map((purpose) => ({
    ...purpose,
    plannedAmount: parseDraftAmount(amountText[purpose.id] ?? ""),
  }));
  const preview =
    drafting && periodKey
      ? previewMonthlyPlan({
          periodKey,
          planningBasis: parseDraftAmount(basisText),
          categories: draftCategories,
          debts,
          obligations,
        })
      : null;
  const nextRevision = periodKey
    ? nextMonthlyPlanRevisionNumber(plans, periodKey)
    : 1;
  const mapState = livingPurposeMapState(
    preview?.remainingCents ?? null,
    preview?.assignedCents ?? null
  );
  const wealthOverlay =
    preview?.split != null
      ? planResultWealthBuilding(
          openingWealthBuilding,
          preview.split.wealthShare
        )
      : null;
  const proportions =
    preview?.split != null && preview.basisValid
      ? planSplitProportions(preview.split, parseDraftAmount(basisText) || 0)
      : null;
  const remainingDebtCents = totalRemainingDebtCents(debts);

  useEffect(() => {
    setPeriodKey((current) => current ?? suggestedPeriodKey);
  }, [suggestedPeriodKey]);

  useEffect(() => {
    if (!drafting || draftOrigin !== "first") return;
    setPurposes((current) => mergeFirstDraftPurposes(current, budgetTargets));
    setAmountText((current) =>
      mergeFirstDraftAmountFields(current, budgetTargets)
    );
  }, [drafting, draftOrigin, budgetTargets]);

  if (!periodKey) {
    return (
      <section className="rounded-xl border border-slate-800/80 bg-slate-900/40 p-4 sm:p-5">
        <p className="text-sm text-slate-300">{FINANCIAL_CALENDAR_UNKNOWN}</p>
      </section>
    );
  }

  const openDraft = (mode: "first" | "revise", sourcePeriod: string) => {
    if (readOnly) return;
    const current = latestMonthlyPlanRevision(plans, sourcePeriod);
    if (mode === "revise" && current) {
      const seed = seedMonthlyPlanFromRevision(current);
      setBasisText(String(seed.planningBasis));
      setPurposes(seed.categories);
      setAmountText(amountFields(seed.categories));
      setDraftOrigin("revise");
    } else {
      const seed = seedMonthlyPlanFromTargets(budgetTargets);
      setBasisText("");
      setPurposes(seed);
      setAmountText(amountFields(seed));
      setDraftOrigin("first");
    }
    setFinalizeMessage(null);
    setConfirmOpen(false);
    setShowDebtDetail(false);
    setShowCommitments(false);
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
    setDraftOrigin(null);
    setConfirmOpen(false);
    setFinalizeMessage(null);
    setBasisText("");
    setPurposes([]);
    setAmountText({});
    setShowDebtDetail(false);
    setShowCommitments(false);
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
    setDraftOrigin(null);
    setBasisText("");
    setPurposes([]);
    setAmountText({});
    setShowDebtDetail(false);
    setShowCommitments(false);
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
  const knownCommitmentCount = preview?.obligations.length ?? 0;

  return (
    <section aria-label="Monthly Plan" className="space-y-3">
      <Card className="border-slate-800/80 bg-gradient-to-b from-slate-950/80 to-slate-950/40">
        <CardContent className="space-y-4 p-4 sm:p-5">
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
            <div className="min-w-0 text-center">
              <p className="font-[family-name:var(--font-display)] text-base leading-tight text-slate-50 sm:text-lg">
                {monthTitle}&apos;s financial map
              </p>
              <p className="mt-0.5 text-[11px] uppercase tracking-[0.16em] text-slate-500">
                {shortLabel}
              </p>
            </div>
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
            disclosure ? (
              <FundThisMonthSection
                disclosure
                revision={latest}
                paySchedules={paySchedules}
                money={money}
                onUpsertPaySchedule={onUpsertPaySchedule}
                onRemovePaySchedule={onRemovePaySchedule}
                financialToday={financialToday}
                readOnly={readOnly}
                planSummary={
                  <div>
                    <p className="text-sm font-medium text-slate-100">
                      Monthly Plan
                    </p>
                    <p className="mt-1 text-xs text-slate-400">
                      {monthTitle} · Revision {latest.revision}
                    </p>
                    <p className="mt-1 text-xs text-slate-400">
                      Planned around{" "}
                      <span className="tabular-nums text-slate-200">
                        {money(latest.planningBasis)}
                      </span>
                      {" · "}
                      Living{" "}
                      <span className="tabular-nums text-slate-200">
                        {money(latest.expenditureShare)}
                      </span>
                    </p>
                  </div>
                }
              >
                <RevisionSummary
                  revision={latest}
                  money={money}
                  monthTitle={monthTitle}
                  onRevise={
                    readOnly ? undefined : () => openDraft("revise", periodKey)
                  }
                />
              </FundThisMonthSection>
            ) : (
              <>
                <RevisionSummary
                  revision={latest}
                  money={money}
                  monthTitle={monthTitle}
                  onRevise={
                    readOnly ? undefined : () => openDraft("revise", periodKey)
                  }
                />
                <FundThisMonthSection
                  revision={latest}
                  paySchedules={paySchedules}
                  money={money}
                  onUpsertPaySchedule={onUpsertPaySchedule}
                  onRemovePaySchedule={onRemovePaySchedule}
                  financialToday={financialToday}
                  readOnly={readOnly}
                />
              </>
            )
          ) : null}

          {!drafting && !latest ? (
            <div className="space-y-3 rounded-xl border border-slate-800/80 bg-slate-950/50 p-4">
              <p className="text-sm text-slate-200">
                No map for {monthTitle} yet.
              </p>
              {readOnly ? null : (
              <Button type="button" onClick={() => openDraft("first", periodKey)}>
                Map {monthTitle}
              </Button>
              )}
            </div>
          ) : null}

          {!readOnly && drafting && preview ? (
            <div className="space-y-5">
              <div className="space-y-2">
                <Label
                  htmlFor="planning-basis"
                  className="text-sm font-medium text-slate-100"
                >
                  Plan {monthTitle} around
                </Label>
                <div className="relative">
                  <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-slate-500">
                    $
                  </span>
                  <Input
                    id="planning-basis"
                    type="number"
                    min="0"
                    step="0.01"
                    inputMode="decimal"
                    value={basisText}
                    onChange={(event) => setBasisText(event.target.value)}
                    className="h-12 pl-7 text-lg tabular-nums"
                    aria-describedby="planning-amount-hint"
                  />
                </div>
                <p id="planning-amount-hint" className="text-xs text-slate-500">
                  Working assumption — not income.
                </p>
                {basisText.trim() !== "" && preview.basisMessage ? (
                  <p role="alert" className="text-xs text-amber-200">
                    {preview.basisMessage}
                  </p>
                ) : null}
              </div>

              {preview.split && proportions ? (
                <div
                  className="space-y-3 rounded-xl border border-slate-800/90 bg-slate-950/60 p-3 sm:p-4"
                  aria-label="10/20/70 split"
                >
                  <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-500">
                    Canonical purpose
                  </p>
                  <div
                    className="flex h-3 overflow-hidden rounded-full bg-slate-900"
                    aria-hidden="true"
                  >
                    <span
                      className="bg-emerald-500/80 transition-[width] duration-300 ease-out motion-reduce:transition-none"
                      style={{ width: ratioWidth(proportions.wealthRatio) }}
                    />
                    <span
                      className="bg-amber-500/70 transition-[width] duration-300 ease-out motion-reduce:transition-none"
                      style={{ width: ratioWidth(proportions.debtRatio) }}
                    />
                    <span
                      className="bg-sky-500/70 transition-[width] duration-300 ease-out motion-reduce:transition-none"
                      style={{ width: ratioWidth(proportions.livingRatio) }}
                    />
                  </div>
                  <div className="grid gap-2 sm:grid-cols-3">
                    <SplitLane
                      title="Wealth Building"
                      amount={money(preview.split.wealthShare)}
                      tone="wealth"
                      ratio={proportions.wealthRatio}
                    />
                    <SplitLane
                      title="Debt"
                      amount={money(preview.split.debtShare)}
                      tone="debt"
                      ratio={proportions.debtRatio}
                      note={
                        preview.split.debtRedirected
                          ? phoneBudgetDebtShareNote(false)
                          : undefined
                      }
                    />
                    <SplitLane
                      title="Living"
                      amount={money(preview.split.expenditureShare)}
                      tone="living"
                      ratio={proportions.livingRatio}
                    />
                  </div>
                </div>
              ) : null}

              <div className="sticky top-0 z-10 -mx-1 bg-slate-950/95 px-1 py-1 backdrop-blur-sm supports-[backdrop-filter]:bg-slate-950/80">
                <LivingCompletionBanner
                  state={mapState}
                  moneyFromCents={moneyFromCents}
                />
              </div>
              <div className="grid gap-4 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.2fr)]">
                <aside className="space-y-4">
                  {wealthOverlay ? (
                    <div
                      className="space-y-2 rounded-xl border border-emerald-900/40 bg-emerald-950/20 p-3"
                      aria-label="Wealth Building plan result"
                    >
                      <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-emerald-400/80">
                        What this builds
                      </p>
                      <OverlayRow
                        label="Already protected"
                        value={money(wealthOverlay.alreadyProtected)}
                      />
                      <OverlayRow
                        label="This plan"
                        value={money(wealthOverlay.thisPlan)}
                      />
                      <div className="border-t border-emerald-900/40 pt-2">
                        <OverlayRow
                          label="If this plan is executed"
                          value={money(wealthOverlay.ifExecuted)}
                          emphasize
                        />
                      </div>
                      <p className="text-[11px] leading-relaxed text-slate-500">
                        Planned position if this map is followed — not cash on
                        hand.
                      </p>
                      {openingEmergencyFund > 0 ? (
                        <p className="text-[11px] leading-relaxed text-slate-500">
                          Existing Emergency Fund{" "}
                          <span className="tabular-nums text-slate-400">
                            {money(openingEmergencyFund)}
                          </span>{" "}
                          stays separate protected context.
                        </p>
                      ) : null}
                    </div>
                  ) : null}

                  <div
                    className="space-y-2 rounded-xl border border-slate-800/90 bg-slate-950/50 p-3"
                    aria-label="Debt context"
                  >
                    <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-500">
                      Debt
                    </p>
                    <OverlayRow
                      label="Current remaining"
                      value={moneyFromCents(remainingDebtCents)}
                    />
                    <OverlayRow
                      label="This plan"
                      value={
                        preview.split ? money(preview.split.debtShare) : "—"
                      }
                    />
                    {preview.debtMinimumCents !== null ? (
                      <OverlayRow
                        label="Minimums"
                        value={moneyFromCents(preview.debtMinimumCents)}
                      />
                    ) : null}
                    <p className="text-[11px] leading-relaxed text-slate-500">
                      Plan share working against debt — not a payment yet.
                    </p>
                    {debts.length > 0 ? (
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="h-8 px-2 text-xs text-slate-400"
                        onClick={() => setShowDebtDetail((open) => !open)}
                        aria-expanded={showDebtDetail}
                      >
                        {showDebtDetail ? "Hide creditors" : "Show creditors"}
                      </Button>
                    ) : (
                      <p className="text-xs text-slate-500">
                        No debts are recorded.
                      </p>
                    )}
                    {showDebtDetail ? (
                      <ul className="space-y-2 border-t border-slate-800/80 pt-2">
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
                    ) : null}
                    {preview.debtMessage ? (
                      <p
                        role="alert"
                        className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs leading-relaxed text-amber-200"
                      >
                        {preview.debtMessage}
                      </p>
                    ) : null}
                  </div>
                </aside>

                <div className="space-y-3" aria-label="Living purposes">
                  <div className="flex flex-wrap items-end justify-between gap-2">
                    <div>
                      <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-500">
                        Living purposes
                      </p>
                      {preview.split ? (
                        <p className="mt-1 text-xs text-slate-400">
                          Living pool{" "}
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
                    </div>
                    {knownCommitmentCount > 0 ? (
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="h-8 px-2 text-xs text-slate-400"
                        onClick={() => setShowCommitments((open) => !open)}
                        aria-expanded={showCommitments}
                      >
                        {knownCommitmentCount} known commitment
                        {knownCommitmentCount === 1 ? "" : "s"}
                      </Button>
                    ) : null}
                  </div>

                  {showCommitments && knownCommitmentCount > 0 ? (
                    <div
                      className="space-y-2 rounded-lg border border-slate-800/80 bg-slate-950/40 p-3"
                      aria-label="Known commitments"
                    >
                      <p className="text-[11px] leading-relaxed text-slate-500">
                        Wealth Engine already knows these for {monthTitle}. They
                        do not choose the purpose amounts.
                      </p>
                      <ul className="space-y-1">
                        {preview.obligations.map((obligation) => (
                          <ObligationLine
                            key={obligation.id}
                            obligation={obligation}
                            money={money}
                            categoryName={
                              budgetTargets.find(
                                (target) =>
                                  target.id === obligation.budgetCategoryId
                              )?.categoryName ??
                              purposes.find(
                                (purpose) =>
                                  purpose.id === obligation.budgetCategoryId
                              )?.categoryName
                            }
                          />
                        ))}
                      </ul>
                    </div>
                  ) : null}

                  {purposes.length === 0 ? (
                    <p className="text-xs leading-relaxed text-slate-400">
                      Living purposes come from Wealth Engine categories. Use
                      Add → Category to create them. Keep this map open, or
                      reopen the draft — they appear from current categories.
                    </p>
                  ) : (
                    <ul className="space-y-3">
                      {purposes.map((purpose) => {
                        const tagged = obligationsFor(purpose.id);
                        const obligationCents =
                          preview.obligationCentsByCategoryId[purpose.id] ?? 0;
                        const amount = parseDraftAmount(
                          amountText[purpose.id] ?? ""
                        );
                        const shortfall = Number.isFinite(amount)
                          ? obligationCents - monthlyPlanCents(amount)
                          : 0;
                        const share =
                          preview.livingCents && preview.livingCents > 0
                            ? Math.max(
                                0,
                                monthlyPlanCents(
                                  Number.isFinite(amount) ? amount : 0
                                ) / preview.livingCents
                              )
                            : 0;
                        return (
                          <li
                            key={purpose.id}
                            className="rounded-xl border border-slate-800/80 bg-slate-950/40 p-3"
                          >
                            <div className="mb-2 flex items-baseline justify-between gap-3">
                              <p className="text-sm font-medium text-slate-100">
                                {purpose.categoryName}
                              </p>
                              <p className="text-[11px] font-medium uppercase tracking-wider text-slate-500">
                                {purpose.isEssential ? "Need" : "Want"}
                              </p>
                            </div>
                            <div
                              className="mb-2 h-1 overflow-hidden rounded-full bg-slate-900"
                              aria-hidden="true"
                            >
                              <span
                                className="block h-full bg-sky-500/60 transition-[width] duration-300 ease-out motion-reduce:transition-none"
                                style={{ width: ratioWidth(share) }}
                              />
                            </div>
                            <Label
                              htmlFor={`purpose-${purpose.id}`}
                              className="sr-only"
                            >
                              {purpose.categoryName} amount
                            </Label>
                            <div className="relative">
                              <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-slate-500">
                                $
                              </span>
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
                                className="h-11 pl-7 tabular-nums"
                              />
                            </div>
                            {tagged.length > 0 ? (
                              <ul className="mt-2 space-y-1">
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
                              <p className="mt-2 text-xs leading-relaxed text-slate-400">
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
                                (target) =>
                                  target.id === obligation.budgetCategoryId
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
                </div>
              </div>

              {nextRevision > 1 ? (
                <p className="text-xs leading-relaxed text-slate-500">
                  Earlier revisions of this period remain saved.
                </p>
              ) : null}

              <div className="flex flex-wrap gap-2 border-t border-slate-800/80 pt-4">
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
                  {mapState.kind === "complete"
                    ? "Finalize map"
                    : "Finalize"}
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
              Finalize {monthTitle}&apos;s map
            </DialogTitle>
            <DialogDescription>
              This saves a Monthly Plan revision. Live categories stay as they
              are. Income is not recorded. Liquid Position is not changed.
            </DialogDescription>
          </DialogHeader>
          <dl className="space-y-2 text-sm">
            <ReviewRow label="Period" value={periodKey} />
            <ReviewRow
              label="Plan around"
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

function LivingCompletionBanner({
  state,
  moneyFromCents,
}: {
  state: ReturnType<typeof livingPurposeMapState>;
  moneyFromCents: (cents: number) => string;
}) {
  if (state.kind === "awaiting_basis") {
    return (
      <p
        role="status"
        className="rounded-xl border border-slate-800/80 bg-slate-950/50 px-3 py-3 text-sm text-slate-400"
      >
        Enter a working amount to open the Living pool.
      </p>
    );
  }
  if (state.kind === "complete") {
    return (
      <p
        role="status"
        className="rounded-xl border border-emerald-500/40 bg-emerald-500/10 px-3 py-3 text-sm text-emerald-100"
      >
        Every planned dollar has a purpose.
      </p>
    );
  }
  if (state.kind === "overcommitted") {
    return (
      <p
        role="alert"
        className="rounded-xl border border-amber-500/40 bg-amber-500/10 px-3 py-3 text-sm text-amber-100"
      >
        Overcommitted by {moneyFromCents(state.overCents)}. Living purposes
        exceed the Living pool.
      </p>
    );
  }
  return (
    <p
      role="status"
      className="rounded-xl border border-sky-500/30 bg-sky-500/10 px-3 py-3 text-sm text-sky-100"
    >
      {moneyFromCents(state.remainingCents)} still needs a purpose.
    </p>
  );
}

function SplitLane({
  title,
  amount,
  tone,
  ratio,
  note,
}: {
  title: string;
  amount: string;
  tone: "wealth" | "debt" | "living";
  ratio: number;
  note?: string;
}) {
  const bar =
    tone === "wealth"
      ? "bg-emerald-500/80"
      : tone === "debt"
        ? "bg-amber-500/70"
        : "bg-sky-500/70";
  return (
    <div className="rounded-lg border border-slate-800/70 bg-slate-950/40 p-2.5">
      <p className="text-[11px] uppercase tracking-[0.14em] text-slate-500">
        {title}
      </p>
      <p className="mt-1 text-base tabular-nums text-slate-50">{amount}</p>
      <div className="mt-2 h-1 overflow-hidden rounded-full bg-slate-900">
        <span
          className={cn(
            "block h-full transition-[width] duration-300 ease-out motion-reduce:transition-none",
            bar
          )}
          style={{ width: ratioWidth(ratio) }}
        />
      </div>
      {note ? <p className="mt-1.5 text-[11px] text-slate-500">{note}</p> : null}
    </div>
  );
}

function OverlayRow({
  label,
  value,
  emphasize = false,
}: {
  label: string;
  value: string;
  emphasize?: boolean;
}) {
  return (
    <div className="flex items-baseline justify-between gap-3 text-sm">
      <p className={emphasize ? "text-slate-200" : "text-slate-400"}>{label}</p>
      <p
        className={cn(
          "shrink-0 tabular-nums",
          emphasize ? "text-base text-emerald-100" : "text-slate-100"
        )}
      >
        {value}
      </p>
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
          Known commitment inside this purpose.
        </span>
      ) : null}
    </li>
  );
}

function RevisionSummary({
  revision,
  money,
  monthTitle,
  onRevise,
}: {
  revision: MonthlyPlanRevision;
  money: (value: number) => string;
  monthTitle: string;
  onRevise?: () => void;
}) {
  const wealth = planResultWealthBuilding(
    revision.protectedContext.openingWealthBuilding,
    revision.wealthShare
  );
  const proportions = planSplitProportions(
    {
      wealthShare: revision.wealthShare,
      debtShare: revision.debtShare,
      expenditureShare: revision.expenditureShare,
      debtRedirected: revision.debtRedirected,
    },
    revision.planningBasis
  );
  return (
    <div className="space-y-4">
      <div className="space-y-1">
        <p className="text-sm text-slate-100">
          {monthTitle} · Revision {revision.revision}
        </p>
        <p className="text-xs leading-relaxed text-slate-400">
          Planned around{" "}
          <span className="tabular-nums text-slate-200">
            {money(revision.planningBasis)}
          </span>
          {" · "}
          Living{" "}
          <span className="tabular-nums text-slate-200">
            {money(revision.expenditureShare)}
          </span>
        </p>
      </div>

      <div
        className="grid gap-2 sm:grid-cols-3"
        aria-label="Finalized 10/20/70 split"
      >
        <SplitLane
          title="Wealth Building"
          amount={money(revision.wealthShare)}
          tone="wealth"
          ratio={proportions.wealthRatio}
        />
        <SplitLane
          title="Debt"
          amount={money(revision.debtShare)}
          tone="debt"
          ratio={proportions.debtRatio}
          note={
            revision.debtRedirected
              ? phoneBudgetDebtShareNote(false)
              : undefined
          }
        />
        <SplitLane
          title="Living"
          amount={money(revision.expenditureShare)}
          tone="living"
          ratio={proportions.livingRatio}
        />
      </div>

      <div
        className="rounded-xl border border-emerald-900/40 bg-emerald-950/20 p-3"
        aria-label="Wealth Building plan result"
      >
        <OverlayRow
          label="Already protected"
          value={money(wealth.alreadyProtected)}
        />
        <OverlayRow label="This plan" value={money(wealth.thisPlan)} />
        <div className="mt-2 border-t border-emerald-900/40 pt-2">
          <OverlayRow
            label="If this plan is executed"
            value={money(wealth.ifExecuted)}
            emphasize
          />
        </div>
      </div>

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
      <p role="status" className="text-sm text-emerald-200/90">
        Every planned dollar has a purpose.
      </p>
      {revision.revision > 1 ? (
        <p className="text-xs leading-relaxed text-slate-500">
          Earlier revisions of this period remain saved.
        </p>
      ) : null}
      {onRevise ? (
      <Button type="button" variant="outline" onClick={onRevise}>
        Revise map
      </Button>
      ) : null}
    </div>
  );
}
