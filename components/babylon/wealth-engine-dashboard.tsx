"use client";

import { useCallback } from "react";
import { AffordabilityAnchor } from "@/components/babylon/affordability-anchor";
import { AnalyticsHub } from "@/components/babylon/analytics-hub";
import { AppSidebar } from "@/components/babylon/app-sidebar";
import { CommandBar } from "@/components/babylon/command-bar";
import { GoldenTriad } from "@/components/babylon/golden-triad";
import { LedgerMatrices } from "@/components/babylon/ledger-matrices";
import { QuickStats } from "@/components/babylon/quick-stats";
import { VaultLoading } from "@/components/babylon/vault-loading";
import { WisdomBox } from "@/components/babylon/wisdom-box";
import { BudgetBlueprint } from "@/components/dashboard/BudgetBlueprint";
import { RecentActivityStrip } from "@/components/dashboard/RecentActivityStrip";
import { TributeEnginesPanel } from "@/components/dashboard/TributeEnginesPanel";
import { MonthlyCloseModal } from "@/components/modals/MonthlyCloseModal";
import { RecordTransactionModal } from "@/components/modals/RecordTransactionModal";
import { useBabylonEngine } from "@/hooks/useBabylonEngine";
import { useTributeHotkeys } from "@/hooks/useTributeHotkeys";
import { cn } from "@/lib/utils";

export function WealthEngineDashboard() {
  const engine = useBabylonEngine();
  const { openTribute, hydrated, tributeOpen, monthlyCloseOpen } = engine;

  const openTributeHotkey = useCallback(() => {
    openTribute("income");
  }, [openTribute]);

  useTributeHotkeys(openTributeHotkey, {
    enabled: hydrated && !tributeOpen && !monthlyCloseOpen,
  });

  if (!hydrated) {
    return <VaultLoading />;
  }

  const showOverview = engine.activeNav === "overview";
  const showWisdom = engine.activeNav === "wisdom";
  const showLedgers = engine.activeNav === "ledgers";

  return (
    <div className="relative min-h-dvh overflow-x-clip bg-slate-950 text-slate-100 luxury-grid">
      {engine.sidebarOpen && (
        <button
          type="button"
          aria-label="Close navigation"
          className="fixed inset-0 z-40 bg-black/60 backdrop-blur-sm lg:hidden"
          onClick={() => engine.setSidebarOpen(false)}
        />
      )}

      <AppSidebar
        open={engine.sidebarOpen}
        activeNav={engine.activeNav}
        onClose={() => engine.setSidebarOpen(false)}
        onSelectNav={engine.selectNav}
        onExportBackup={engine.exportBackup}
        onImportBackup={engine.importBackup}
        onClearAllData={engine.clearAllData}
      />

      <div className="min-w-0 lg:pl-72">
        <CommandBar
          greeting={engine.greeting}
          username={engine.username}
          localizedDate={engine.localizedDate}
          localizedTime={engine.localizedTime}
          monthAlreadyClosed={engine.monthlyCloseSummary.alreadyClosed}
          onUsernameChange={engine.setUsername}
          onOpenSidebar={() => engine.setSidebarOpen(true)}
          onRecordTribute={() => engine.openTribute("income")}
          onOpenMonthlyClose={() => engine.setMonthlyCloseOpen(true)}
        />

        <main className="mx-auto w-full max-w-screen-2xl space-y-5 px-3 py-5 sm:space-y-6 sm:px-6 sm:py-6 lg:px-8 lg:py-8">
          {(showOverview || showWisdom) && (
            <>
              {showOverview && (
                <>
                  <GoldenTriad
                    goldRetained={engine.goldRetained}
                    wealthSpark={engine.wealthSpark}
                    clearedDebt={engine.clearedDebt}
                    originalDebt={engine.originalDebt}
                    remainingDebt={engine.remainingDebt}
                    debtClearPct={engine.debtClearPct}
                    hasActiveDebt={engine.hasActiveDebt}
                    expenditureRemaining={engine.expenditureRemaining}
                    expenditureRemainingPct={engine.expenditureRemainingPct}
                    expenditureBarTone={engine.expenditureBarTone}
                    progressIndicatorClass={engine.progressIndicatorClass}
                    totalSpent={engine.totalSpent}
                    expenditurePool={engine.expenditurePool}
                  />
                  <AffordabilityAnchor
                    desiresPoolRemaining={engine.desiresPoolRemaining}
                    hourlyLaborRate={engine.hourlyLaborRate}
                  />
                  <TributeEnginesPanel snapshot={engine.tributeEngines} />
                  <BudgetBlueprint
                    variances={engine.budgetVariances}
                    budgetTargets={engine.budgetTargets}
                    plannedTotal={engine.budgetPlannedTotal}
                    actualTotal={engine.budgetActualTotal}
                    expenditurePool={engine.currentMonthExpenditurePool}
                    onUpdateTargetFull={engine.updateBudgetTargetFull}
                    onDeleteTarget={engine.deleteBudgetTarget}
                    onAutoScaleCaps={engine.autoScaleBudgetCaps}
                  />
                  <AnalyticsHub
                    chartData={engine.chartData}
                    donutData={engine.donutData}
                    currentMonthNeed={engine.currentMonthNeed}
                    currentMonthDesire={engine.currentMonthDesire}
                    currentMonthRemaining={engine.currentMonthRemaining}
                  />
                  <RecentActivityStrip events={engine.recentActivity} />
                </>
              )}

              <section
                className={cn(
                  "grid gap-4",
                  showWisdom ? "grid-cols-1" : "grid-cols-1 lg:grid-cols-3"
                )}
              >
                {showOverview && (
                  <QuickStats
                    totalIncome={engine.totalIncome}
                    debtAllocated={engine.debtAllocated}
                  />
                )}
                <WisdomBox
                  wisdomIndex={engine.wisdomIndex}
                  expanded={showWisdom}
                  onSelectIndex={engine.setWisdomIndex}
                />
              </section>
            </>
          )}

          {showLedgers && (
            <>
              <BudgetBlueprint
                variances={engine.budgetVariances}
                budgetTargets={engine.budgetTargets}
                plannedTotal={engine.budgetPlannedTotal}
                actualTotal={engine.budgetActualTotal}
                expenditurePool={engine.currentMonthExpenditurePool}
                onUpdateTargetFull={engine.updateBudgetTargetFull}
                onDeleteTarget={engine.deleteBudgetTarget}
                onAutoScaleCaps={engine.autoScaleBudgetCaps}
              />
              <LedgerMatrices
                incomes={engine.incomes}
                expenses={engine.expenses}
                debts={engine.debts}
                needSpend={engine.needSpend}
                desireSpend={engine.desireSpend}
                totalSpent={engine.lifetimeSpent}
                budgetTargets={engine.budgetTargets}
                onOpenTribute={engine.openTribute}
                onDeleteIncome={engine.deleteIncome}
                onDeleteExpense={engine.deleteExpense}
                onDeleteDebt={engine.deleteDebt}
                onToggleExpenseSettled={engine.toggleExpenseSettled}
              />
            </>
          )}

          <footer className="border-t border-slate-800/60 pt-6 pb-2 text-center text-xs text-slate-600">
            Wealth Engine · Powered by the Laws of Gold ·{" "}
            <span className="text-slate-500">
              A part of all you earn is yours to keep
            </span>
          </footer>
        </main>
      </div>

      <RecordTransactionModal
        open={engine.tributeOpen}
        mode={engine.tributeMode}
        hasActiveDebt={engine.hasActiveDebt}
        budgetTargets={engine.budgetTargets}
        onOpenChange={engine.setTributeOpen}
        onModeChange={engine.setTributeMode}
        onPreviewAllocation={engine.previewAllocation}
        onRecordIncome={engine.addIncome}
        onRecordExpense={engine.addExpense}
        onRecordDebt={engine.addDebt}
        onAddBudgetTarget={engine.addBudgetTarget}
      />

      <MonthlyCloseModal
        open={engine.monthlyCloseOpen}
        summary={engine.monthlyCloseSummary}
        hasActiveDebt={engine.hasActiveDebt}
        emergencyShield={engine.emergencyShield}
        onOpenChange={engine.setMonthlyCloseOpen}
        onCloseMonth={engine.closeMonth}
      />
    </div>
  );
}
