"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { BarChart3, ScrollText, Zap } from "lucide-react";
import { AffordabilityAnchor } from "@/components/babylon/affordability-anchor";
import { AnalyticsHub } from "@/components/babylon/analytics-hub";
import { AppSidebar } from "@/components/babylon/app-sidebar";
import { CommandBar } from "@/components/babylon/command-bar";
import { DebtFreedomEngine } from "@/components/babylon/debt-freedom-engine";
import { GoldenTriad } from "@/components/babylon/golden-triad";
import { LedgerMatrices } from "@/components/babylon/ledger-matrices";
import { QuickStats } from "@/components/babylon/quick-stats";
import { SecurityGate } from "@/components/babylon/security-gate";
import { SpeedTributeBar } from "@/components/babylon/speed-tribute-bar";
import { SpendingPowerFocus } from "@/components/babylon/spending-power-focus";
import { VaultLoading } from "@/components/babylon/vault-loading";
import { WisdomBox } from "@/components/babylon/wisdom-box";
import { BudgetBlueprint } from "@/components/dashboard/BudgetBlueprint";
import { RecentActivityStrip } from "@/components/dashboard/RecentActivityStrip";
import { TributeEnginesPanel } from "@/components/dashboard/TributeEnginesPanel";
import { MonthlyCloseModal } from "@/components/modals/MonthlyCloseModal";
import { AuthModal } from "@/components/modals/AuthModal";
import { PaycheckSplitterModal } from "@/components/modals/PaycheckSplitterModal";
import { RecordTransactionModal } from "@/components/modals/RecordTransactionModal";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useBabylonEngine } from "@/hooks/useBabylonEngine";
import { useTributeHotkeys } from "@/hooks/useTributeHotkeys";
import { roundMoney } from "@/lib/babylon/engine";
import type { QuickPreset } from "@/lib/babylon/presets";
import { cn } from "@/lib/utils";
import type { NavSection } from "@/types/babylon";

type MobileDeckTab = "command" | "analytics" | "ledgers";

function navToMobileTab(nav: NavSection): MobileDeckTab | null {
  if (nav === "overview") return "command";
  if (nav === "ledgers") return "ledgers";
  return null;
}

export function WealthEngineDashboard() {
  const engine = useBabylonEngine();
  const {
    openTribute,
    hydrated,
    tributeOpen,
    monthlyCloseOpen,
    authOpen,
    paycheckOpen,
  } = engine;

  const [mobileTab, setMobileTab] = useState<MobileDeckTab>("command");

  const openTributeHotkey = useCallback(() => {
    openTribute("income");
  }, [openTribute]);

  useTributeHotkeys(openTributeHotkey, {
    enabled:
      hydrated &&
      !tributeOpen &&
      !monthlyCloseOpen &&
      !authOpen &&
      !paycheckOpen,
  });

  useEffect(() => {
    const mapped = navToMobileTab(engine.activeNav);
    if (mapped) setMobileTab(mapped);
  }, [engine.activeNav]);

  const handleMobileTabChange = useCallback(
    (value: string) => {
      const tab = value as MobileDeckTab;
      setMobileTab(tab);
      if (tab === "command") engine.selectNav("overview");
      if (tab === "ledgers") engine.selectNav("ledgers");
      if (tab === "analytics") engine.selectNav("overview");
    },
    [engine.selectNav]
  );

  const handlePresetSelect = useCallback(
    (preset: QuickPreset) => {
      openTribute(preset.type === "income" ? "income" : "expense");
    },
    [openTribute]
  );

  const monthlyDebtBudget = useMemo(() => {
    const fromAllocations = roundMoney(
      engine.allocations
        .filter((a) => a.monthKey === engine.currentMonthKey)
        .reduce((sum, a) => sum + a.debt, 0)
    );
    const fromMins = roundMoney(
      engine.debts.reduce((sum, d) => sum + Math.max(0, d.monthlyAllocation), 0)
    );
    return Math.max(fromAllocations, fromMins);
  }, [engine.allocations, engine.currentMonthKey, engine.debts]);

  if (!hydrated) {
    return <VaultLoading />;
  }

  const showWisdom = engine.activeNav === "wisdom";
  const showOverview = engine.activeNav === "overview";
  const showLedgers = engine.activeNav === "ledgers";
  const discreet = engine.isDiscreetMode;

  const triad = (
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
      discreet={discreet}
    />
  );

  const focusCards = (
    <SpendingPowerFocus
      expenditureRemaining={engine.expenditureRemaining}
      expenditurePool={engine.expenditurePool}
      expenditureRemainingPct={engine.expenditureRemainingPct}
      expenditureBarTone={engine.expenditureBarTone}
      hourlyLaborRate={engine.hourlyLaborRate}
      discreet={discreet}
    />
  );

  const debtFreedom = (
    <DebtFreedomEngine
      debts={engine.debts}
      monthlyDebtBudget={monthlyDebtBudget}
      currentMonthKey={engine.currentMonthKey}
      periodArchives={engine.periodArchives}
      discreet={discreet}
    />
  );

  const budgetBlueprint = (
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
  );

  const ledgers = (
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
  );

  return (
    <SecurityGate>
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
          isCloudSynced={engine.isCloudSynced}
          cloudHydrating={engine.cloudHydrating}
          cloudUsername={engine.greetingName}
          onConnectCloud={() => engine.setAuthOpen(true)}
          onSignOutCloud={engine.signOutCloud}
        />

        <div className="min-w-0 lg:pl-72">
          <div className="sticky top-0 z-30 bg-slate-950/90 backdrop-blur-xl">
            <CommandBar
              greeting={engine.greeting}
              username={engine.username}
              localizedDate={engine.localizedDate}
              localizedTime={engine.localizedTime}
              monthAlreadyClosed={engine.monthlyCloseSummary.alreadyClosed}
              isDiscreetMode={discreet}
              onUsernameChange={engine.setUsername}
              onOpenSidebar={() => engine.setSidebarOpen(true)}
              onRecordTribute={() => engine.openTribute("income")}
              onOpenMonthlyClose={() => engine.setMonthlyCloseOpen(true)}
              onToggleDiscreetMode={engine.toggleDiscreetMode}
            />
            <SpeedTributeBar onSelectPreset={handlePresetSelect} />
          </div>

          <main className="mx-auto w-full max-w-screen-2xl space-y-4 px-3 py-4 sm:space-y-6 sm:px-6 sm:py-6 lg:px-8 lg:py-8">
            <div className={cn(showWisdom ? "hidden" : "lg:hidden")}>
              <Tabs
                value={mobileTab}
                onValueChange={handleMobileTabChange}
                className="w-full"
              >
                <TabsList className="grid h-auto w-full grid-cols-3 gap-1 bg-slate-900/80 p-1">
                  <TabsTrigger
                    value="command"
                    className="gap-1.5 px-2 py-2.5 text-xs sm:text-sm"
                  >
                    <Zap className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                    Command
                  </TabsTrigger>
                  <TabsTrigger
                    value="analytics"
                    className="gap-1.5 px-2 py-2.5 text-xs sm:text-sm"
                  >
                    <BarChart3
                      className="h-3.5 w-3.5 shrink-0"
                      aria-hidden="true"
                    />
                    Analytics
                  </TabsTrigger>
                  <TabsTrigger
                    value="ledgers"
                    className="gap-1.5 px-2 py-2.5 text-xs sm:text-sm"
                  >
                    <ScrollText
                      className="h-3.5 w-3.5 shrink-0"
                      aria-hidden="true"
                    />
                    Ledgers
                  </TabsTrigger>
                </TabsList>

                <TabsContent value="command" className="mt-4 space-y-4">
                  {focusCards}
                  {triad}
                  {debtFreedom}
                  <RecentActivityStrip events={engine.recentActivity} />
                  <WisdomBox
                    wisdomIndex={engine.wisdomIndex}
                    expanded={false}
                    onSelectIndex={engine.setWisdomIndex}
                  />
                </TabsContent>

                <TabsContent value="analytics" className="mt-4 space-y-4">
                  <TributeEnginesPanel snapshot={engine.tributeEngines} />
                  {budgetBlueprint}
                  <AnalyticsHub
                    chartData={engine.chartData}
                    donutData={engine.donutData}
                    currentMonthNeed={engine.currentMonthNeed}
                    currentMonthDesire={engine.currentMonthDesire}
                    currentMonthRemaining={engine.currentMonthRemaining}
                  />
                  <AffordabilityAnchor
                    desiresPoolRemaining={engine.desiresPoolRemaining}
                    hourlyLaborRate={engine.hourlyLaborRate}
                  />
                </TabsContent>

                <TabsContent value="ledgers" className="mt-4 space-y-4">
                  {budgetBlueprint}
                  {ledgers}
                </TabsContent>
              </Tabs>
            </div>

            {showWisdom && (
              <div className="lg:hidden">
                <WisdomBox
                  wisdomIndex={engine.wisdomIndex}
                  expanded
                  onSelectIndex={engine.setWisdomIndex}
                />
              </div>
            )}

            <div className="hidden space-y-6 lg:block">
              {(showOverview || showWisdom) && (
                <>
                  {showOverview && (
                    <>
                      {focusCards}
                      {triad}
                      {debtFreedom}
                      <AffordabilityAnchor
                        desiresPoolRemaining={engine.desiresPoolRemaining}
                        hourlyLaborRate={engine.hourlyLaborRate}
                      />
                      <TributeEnginesPanel snapshot={engine.tributeEngines} />
                      {budgetBlueprint}
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
                  {budgetBlueprint}
                  {ledgers}
                </>
              )}
            </div>

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
          onRecordIncome={engine.proposeIncomeSplit}
          onRecordExpense={engine.addExpense}
          onRecordDebt={engine.addDebt}
          onAddBudgetTarget={engine.addBudgetTarget}
        />

        <PaycheckSplitterModal
          open={engine.paycheckOpen}
          pending={engine.paycheckPending}
          preview={engine.paycheckPreview}
          hasActiveDebt={engine.hasActiveDebt}
          discreet={discreet}
          onOpenChange={(open) => {
            if (!open) engine.cancelPaycheckSplit();
          }}
          onExecute={engine.executePaycheckSplit}
          onCancel={engine.cancelPaycheckSplit}
        />

        <MonthlyCloseModal
          open={engine.monthlyCloseOpen}
          summary={engine.monthlyCloseSummary}
          hasActiveDebt={engine.hasActiveDebt}
          emergencyShield={engine.emergencyShield}
          discreet={discreet}
          onOpenChange={engine.setMonthlyCloseOpen}
          onCloseMonth={engine.closeMonth}
        />

        <AuthModal
          open={engine.authOpen}
          onOpenChange={engine.setAuthOpen}
          defaultUsername={engine.username}
          onAuthenticated={engine.handleAuthenticated}
        />
      </div>
    </SecurityGate>
  );
}
