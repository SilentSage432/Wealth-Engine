"use client";

import { useState } from "react";
import { AffordabilityAnchor } from "@/components/babylon/affordability-anchor";
import { AnalyticsHub } from "@/components/babylon/analytics-hub";
import { DebtFreedomEngine } from "@/components/babylon/debt-freedom-engine";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { BudgetBlueprint } from "@/components/dashboard/BudgetBlueprint";
import { TributeEnginesPanel } from "@/components/dashboard/TributeEnginesPanel";
import { formatDiscreetCurrency } from "@/lib/babylon/discreet";
import { laborHoursForAmount } from "@/lib/babylon/engine";
import {
  phoneBudgetDebtShareNote,
  type PhoneBudgetDeeper,
} from "@/lib/babylon/mobile-budget";
import { formatCurrency } from "@/lib/utils";
import type {
  BudgetCategoryVariance,
  BudgetTarget,
  ChartMonthPoint,
  DebtEntry,
  DonutSlice,
  PeriodArchive,
  TributeEngineSnapshot,
} from "@/types/babylon";

interface MobileBudgetProps {
  expenditureRemaining: number;
  expenditurePool: number;
  totalSpent: number;
  expenditureRemainingPct: number;
  hasActiveDebt: boolean;
  wealthAllocated: number;
  debtAllocated: number;
  discreet: boolean;
  variances: BudgetCategoryVariance[];
  budgetTargets: BudgetTarget[];
  plannedTotal: number;
  actualTotal: number;
  onUpdateTargetFull: (
    id: string,
    updatedData: Partial<Omit<BudgetTarget, "id">>
  ) => boolean;
  onDeleteTarget: (id: string, reassignToId?: string | null) => void;
  onAutoScaleCaps: () => boolean;
  debts: DebtEntry[];
  monthlyDebtBudget: number;
  currentMonthKey: string;
  periodArchives: PeriodArchive[];
  chartData: ChartMonthPoint[];
  donutData: DonutSlice[];
  currentMonthNeed: number;
  currentMonthDesire: number;
  currentMonthRemaining: number;
  tributeSnapshot: TributeEngineSnapshot;
  desiresPoolRemaining: number;
  hourlyLaborRate: number;
}

function SectionLabel({ children }: { children: string }) {
  return (
    <h2 className="text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-500">
      {children}
    </h2>
  );
}

export function MobileBudget({
  expenditureRemaining,
  expenditurePool,
  totalSpent,
  expenditureRemainingPct,
  hasActiveDebt,
  wealthAllocated,
  debtAllocated,
  discreet,
  variances,
  budgetTargets,
  plannedTotal,
  actualTotal,
  onUpdateTargetFull,
  onDeleteTarget,
  onAutoScaleCaps,
  debts,
  monthlyDebtBudget,
  currentMonthKey,
  periodArchives,
  chartData,
  donutData,
  currentMonthNeed,
  currentMonthDesire,
  currentMonthRemaining,
  tributeSnapshot,
  desiresPoolRemaining,
  hourlyLaborRate,
}: MobileBudgetProps) {
  const [deeper, setDeeper] = useState<PhoneBudgetDeeper | null>(null);
  const [showDebtChart, setShowDebtChart] = useState(false);
  const money = (value: number) =>
    formatDiscreetCurrency(value, discreet, formatCurrency);
  const laborHours = laborHoursForAmount(
    expenditureRemaining,
    hourlyLaborRate
  );

  const toggleDeeper = (panel: PhoneBudgetDeeper) => {
    setDeeper((current) => (current === panel ? null : panel));
  };

  return (
    <div className="space-y-3">
      <section aria-label="Living Budget">
        <Card className="border-slate-800/80">
          <CardContent className="p-4">
            <SectionLabel>Living Budget</SectionLabel>
            <p className="mt-1 font-[family-name:var(--font-display)] text-4xl font-semibold tracking-tight text-slate-50 tabular-nums">
              {money(expenditureRemaining)}
            </p>
            <p className="mt-2 text-xs leading-relaxed text-slate-500">
              {expenditureRemainingPct}% left. {money(totalSpent)} spent of{" "}
              {money(expenditurePool)} this month.
            </p>
            {laborHours !== null ? (
              <p className="mt-1 text-xs leading-relaxed text-slate-500">
                About {laborHours} hours of main income.
              </p>
            ) : null}
          </CardContent>
        </Card>
      </section>

      <section aria-label="10/20/70">
        <Card className="border-slate-800/80">
          <CardContent className="p-4">
            <SectionLabel>10 / 20 / 70</SectionLabel>
            <ul className="mt-3 space-y-3">
              <li>
                <div className="flex items-baseline justify-between gap-3">
                  <p className="text-sm text-slate-200">
                    <span className="mr-2 tabular-nums text-slate-500">10%</span>
                    Wealth Building
                  </p>
                  <p className="shrink-0 tabular-nums text-sm text-slate-100">
                    {money(wealthAllocated)}
                  </p>
                </div>
                <p className="mt-1 text-xs leading-relaxed text-slate-500">
                  This month&apos;s Wealth Building.
                  {hasActiveDebt
                    ? ""
                    : " Includes the 20% Debt Payoff share."}
                </p>
              </li>
              <li>
                <div className="flex items-baseline justify-between gap-3">
                  <p className="text-sm text-slate-200">
                    <span className="mr-2 tabular-nums text-slate-500">20%</span>
                    Debt Payoff
                  </p>
                  <p className="shrink-0 tabular-nums text-sm text-slate-100">
                    {money(debtAllocated)}
                  </p>
                </div>
                <p className="mt-1 text-xs leading-relaxed text-slate-500">
                  {phoneBudgetDebtShareNote(hasActiveDebt)}
                </p>
              </li>
              <li>
                <p className="text-sm text-slate-200">
                  <span className="mr-2 tabular-nums text-slate-500">70%</span>
                  Living Budget
                </p>
                <p className="mt-1 text-xs leading-relaxed text-slate-500">
                  The amount above is what remains of this share.
                </p>
              </li>
            </ul>
          </CardContent>
        </Card>
      </section>

      <BudgetBlueprint
        layout="phone"
        discreet={discreet}
        variances={variances}
        budgetTargets={budgetTargets}
        plannedTotal={plannedTotal}
        actualTotal={actualTotal}
        expenditurePool={expenditurePool}
        onUpdateTargetFull={onUpdateTargetFull}
        onDeleteTarget={onDeleteTarget}
        onAutoScaleCaps={onAutoScaleCaps}
      />

      <DebtFreedomEngine
        density="compact"
        showVelocityChart={showDebtChart}
        debts={debts}
        monthlyDebtBudget={monthlyDebtBudget}
        currentMonthKey={currentMonthKey}
        periodArchives={periodArchives}
        discreet={discreet}
      />
      {periodArchives.length > 0 ? (
        <Button
          type="button"
          variant="outline"
          aria-expanded={showDebtChart}
          onClick={() => setShowDebtChart((open) => !open)}
        >
          {showDebtChart ? "Hide payoff chart" : "View payoff chart"}
        </Button>
      ) : null}

      <section aria-label="Deeper analysis">
        <Card className="border-slate-800/80">
          <CardContent className="space-y-2 p-4">
            <SectionLabel>Deeper analysis</SectionLabel>
            <Button
              type="button"
              variant="outline"
              className="w-full"
              aria-expanded={deeper === "income"}
              onClick={() => toggleDeeper("income")}
            >
              {deeper === "income" ? "Hide income breakdown" : "View income breakdown"}
            </Button>
            {deeper === "income" ? (
              <TributeEnginesPanel snapshot={tributeSnapshot} discreet={discreet} />
            ) : null}
            <Button
              type="button"
              variant="outline"
              className="w-full"
              aria-expanded={deeper === "charts"}
              onClick={() => toggleDeeper("charts")}
            >
              {deeper === "charts" ? "Hide charts" : "View charts"}
            </Button>
            {deeper === "charts" ? (
              <AnalyticsHub
                discreet={discreet}
                chartData={chartData}
                donutData={donutData}
                currentMonthNeed={currentMonthNeed}
                currentMonthDesire={currentMonthDesire}
                currentMonthRemaining={currentMonthRemaining}
              />
            ) : null}
            <Button
              type="button"
              variant="outline"
              className="w-full"
              aria-expanded={deeper === "affordability"}
              onClick={() => toggleDeeper("affordability")}
            >
              {deeper === "affordability"
                ? "Hide affordability"
                : "Check affordability"}
            </Button>
            {deeper === "affordability" ? (
              <AffordabilityAnchor
                discreet={discreet}
                desiresPoolRemaining={desiresPoolRemaining}
                hourlyLaborRate={hourlyLaborRate}
              />
            ) : null}
          </CardContent>
        </Card>
      </section>
    </div>
  );
}
