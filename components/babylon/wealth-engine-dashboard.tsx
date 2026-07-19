"use client";

import { AffordabilityAnchor } from "@/components/babylon/affordability-anchor";
import { AnalyticsHub } from "@/components/babylon/analytics-hub";
import { AppSidebar } from "@/components/babylon/app-sidebar";
import { CommandBar } from "@/components/babylon/command-bar";
import { ConfigureBudgetDialog } from "@/components/babylon/configure-budget-dialog";
import { GoldenTriad } from "@/components/babylon/golden-triad";
import { LedgerMatrices } from "@/components/babylon/ledger-matrices";
import { QuickStats } from "@/components/babylon/quick-stats";
import { RecordTributeDialog } from "@/components/babylon/record-tribute-dialog";
import { VaultLoading } from "@/components/babylon/vault-loading";
import { WisdomBox } from "@/components/babylon/wisdom-box";
import { BudgetBlueprint } from "@/components/dashboard/BudgetBlueprint";
import { useBabylonEngine } from "@/hooks/useBabylonEngine";
import { cn } from "@/lib/utils";

export function WealthEngineDashboard() {
  const engine = useBabylonEngine();

  if (!engine.hydrated) {
    return <VaultLoading />;
  }

  const showOverview = engine.activeNav === "overview";
  const showWisdom = engine.activeNav === "wisdom";
  const showLedgers =
    engine.activeNav === "ledgers" || engine.activeNav === "overview";

  return (
    <div className="relative min-h-screen bg-slate-950 text-slate-100 luxury-grid">
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

      <div className="lg:pl-72">
        <CommandBar
          greeting={engine.greeting}
          displayName={engine.displayName}
          localizedDate={engine.localizedDate}
          localizedTime={engine.localizedTime}
          onDisplayNameChange={engine.setDisplayName}
          onOpenSidebar={() => engine.setSidebarOpen(true)}
          onManageCategories={engine.openBlueprint}
          onRecordTribute={() => engine.openTribute("income")}
        />

        <main className="space-y-6 px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
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
                  <BudgetBlueprint
                    variances={engine.budgetVariances}
                    plannedTotal={engine.budgetPlannedTotal}
                    actualTotal={engine.budgetActualTotal}
                    expenditurePool={engine.currentMonthExpenditurePool}
                    onUpdateTarget={engine.updateBudgetTarget}
                  />
                  <AnalyticsHub
                    chartData={engine.chartData}
                    donutData={engine.donutData}
                    currentMonthNeed={engine.currentMonthNeed}
                    currentMonthDesire={engine.currentMonthDesire}
                    currentMonthRemaining={engine.currentMonthRemaining}
                  />
                </>
              )}

              <section
                className={cn(
                  "grid gap-4",
                  showWisdom ? "lg:grid-cols-1" : "lg:grid-cols-3"
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

          {showLedgers && engine.activeNav === "ledgers" && (
            <BudgetBlueprint
              variances={engine.budgetVariances}
              plannedTotal={engine.budgetPlannedTotal}
              actualTotal={engine.budgetActualTotal}
              expenditurePool={engine.currentMonthExpenditurePool}
              onUpdateTarget={engine.updateBudgetTarget}
            />
          )}

          {showLedgers && (
            <LedgerMatrices
              incomes={engine.incomes}
              expenses={engine.expenses}
              debts={engine.debts}
              needSpend={engine.needSpend}
              desireSpend={engine.desireSpend}
              totalSpent={engine.totalSpent}
              budgetTargets={engine.budgetTargets}
              onOpenTribute={engine.openTribute}
              onDeleteIncome={engine.deleteIncome}
              onDeleteExpense={engine.deleteExpense}
              onDeleteDebt={engine.deleteDebt}
            />
          )}

          <footer className="border-t border-slate-800/60 pt-6 pb-2 text-center text-xs text-slate-600">
            Wealth Engine · Powered by the Laws of Gold ·{" "}
            <span className="text-slate-500">
              A part of all you earn is yours to keep
            </span>
          </footer>
        </main>
      </div>

      <RecordTributeDialog
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
      />

      <ConfigureBudgetDialog
        open={engine.blueprintOpen}
        onOpenChange={engine.setBlueprintOpen}
        onAddTarget={engine.addBudgetTarget}
      />
    </div>
  );
}
