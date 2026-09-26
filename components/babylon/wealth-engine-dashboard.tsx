"use client";

import { useCallback, useMemo, useState } from "react";
import { AffordabilityAnchor } from "@/components/babylon/affordability-anchor";
import { AnalyticsHub } from "@/components/babylon/analytics-hub";
import { AppSidebar } from "@/components/babylon/app-sidebar";
import { CommandBar } from "@/components/babylon/command-bar";
import { ConnectedBanksCard } from "@/components/babylon/connected-banks-card";
import { DebtFreedomEngine } from "@/components/babylon/debt-freedom-engine";
import { FinancialPosition } from "@/components/babylon/financial-position";
import { UpcomingNeeds } from "@/components/babylon/upcoming-needs";
import { GoldenTriad } from "@/components/babylon/golden-triad";
import { LedgerMatrices } from "@/components/babylon/ledger-matrices";
import { MobileBottomNav, MOBILE_NAV_CLEARANCE } from "@/components/babylon/mobile-bottom-nav";
import { MobileHeader } from "@/components/babylon/mobile-header";
import { MobileMore } from "@/components/babylon/mobile-more";
import { QuickStats } from "@/components/babylon/quick-stats";
import { SecurityGate } from "@/components/babylon/security-gate.client";
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
import { useBabylonEngine } from "@/hooks/useBabylonEngine";
import { useDesktopLayout } from "@/hooks/useDesktopLayout";
import { usePlaidConnections } from "@/hooks/usePlaidConnections";
import { useTributeHotkeys } from "@/hooks/useTributeHotkeys";
import type { MobileDestination } from "@/lib/babylon/constants";
import { roundMoney } from "@/lib/babylon/engine";
import type { QuickPreset } from "@/lib/babylon/presets";
import { cn } from "@/lib/utils";

export function WealthEngineDashboard() {
  const engine = useBabylonEngine();
  const {
    openTribute,
    hydrated,
    tributeOpen,
    monthlyCloseOpen,
    authOpen,
    paycheckOpen,
    isCloudSynced,
    setAuthOpen,
  } = engine;

  const plaid = usePlaidConnections({ enabled: hydrated && isCloudSynced });
  const { launchLink, launching, connectedCount, isLoading } = plaid;

  const handleLinkBank = useCallback(() => {
    if (!isCloudSynced) {
      setAuthOpen(true);
      return;
    }
    void launchLink();
  }, [isCloudSynced, launchLink, setAuthOpen]);

  // Phone destinations only. Desktop keeps activeNav and does not mirror this.
  const [mobileDestination, setMobileDestination] =
    useState<MobileDestination>("home");
  const [accountEditorOpen, setAccountEditorOpen] = useState(false);
  const desktopLayout = useDesktopLayout();

  const openTributeHotkey = useCallback(() => {
    openTribute("income");
  }, [openTribute]);

  useTributeHotkeys(openTributeHotkey, {
    enabled:
      hydrated &&
      !tributeOpen &&
      !monthlyCloseOpen &&
      !authOpen &&
      !paycheckOpen &&
      !accountEditorOpen,
  });

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
    return (
      <SecurityGate>
        <VaultLoading />
      </SecurityGate>
    );
  }

  const showWisdom = engine.activeNav === "wisdom";
  const showOverview = engine.activeNav === "overview";
  const showLedgers = engine.activeNav === "ledgers";
  const discreet = engine.isDiscreetMode;

  const financialPosition = (
    <FinancialPosition
      accounts={engine.accounts}
      moneyAvailable={engine.moneyAvailable}
      openingWealthBuilding={engine.openingWealthBuilding}
      openingEmergencyFund={engine.openingEmergencyFund}
      protectedMoney={engine.protectedMoney}
      protectedOverAvailable={engine.protectedOverAvailable}
      upcomingNeeds={engine.upcomingNeeds}
      availableAfterPlannedNeeds={engine.availableAfterPlannedNeeds}
      discreet={discreet}
      onAddAccount={engine.addAccount}
      onUpdateAccount={engine.updateAccount}
      onRemoveAccount={engine.removeAccount}
      onUpdateProtected={engine.updateProtectedDesignations}
      onEditorOpenChange={setAccountEditorOpen}
    />
  );

  const upcomingNeedsCard = (
    <UpcomingNeeds
      upcomingNeeds={engine.upcomingNeeds}
      comingUp={engine.comingUp}
      dueAttention={engine.dueAttention}
      onMarkPaid={engine.toggleExpenseSettled}
      discreet={discreet}
    />
  );

  const triad = (
    <GoldenTriad
      goldRetained={engine.goldRetained}
      wealthBuildingTotal={engine.wealthBuildingTotal}
      openingWealthBuilding={engine.openingWealthBuilding}
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
      recurringObligations={engine.recurringObligations}
      onUpdateExpense={engine.updateExpenseOccurrence}
      onUpdateRecurringObligation={engine.updateRecurringObligation}
    />
  );

  const banksCard = (
    <ConnectedBanksCard
      connectedCount={connectedCount}
      isLoading={isLoading}
      launching={launching}
      initializing={!hydrated}
      isCloudSynced={isCloudSynced}
      onConnect={handleLinkBank}
      onRequireAuth={() => setAuthOpen(true)}
    />
  );

  return (
    <SecurityGate>
      <div className="relative min-h-dvh overflow-x-clip bg-slate-950 text-slate-100 luxury-grid">
        {desktopLayout && (
          <AppSidebar
            open={engine.sidebarOpen}
            activeNav={engine.activeNav}
            onClose={() => engine.setSidebarOpen(false)}
            onSelectNav={engine.selectNav}
            onExportBackup={engine.exportBackup}
            onImportBackup={engine.importBackup}
            onClearAllData={engine.clearAllData}
            isCloudSynced={engine.isCloudSynced}
            vaultSync={engine.vaultSync}
            cloudBusy={engine.cloudBusy}
            cloudUsername={engine.greetingName}
            onConnectCloud={() => engine.setAuthOpen(true)}
            onSignOutCloud={engine.signOutCloud}
            onBootstrapCloud={engine.confirmCloudBootstrap}
            onHydrateCloud={engine.confirmCloudHydrate}
            onCheckCloud={engine.confirmCloudCheck}
          />
        )}

        <div className={cn("min-w-0", desktopLayout && "pl-72")}>
          <div className="sticky top-0 z-30 bg-slate-950">
            {desktopLayout ? (
              <>
                <CommandBar
                  username={engine.username}
                  monthAlreadyClosed={engine.monthlyCloseSummary.alreadyClosed}
                  isDiscreetMode={discreet}
                  plaidLaunching={launching}
                  plaidInitializing={!hydrated}
                  onUsernameChange={engine.setUsername}
                  onOpenSidebar={() => engine.setSidebarOpen(true)}
                  onRecordTribute={() => engine.openTribute("income")}
                  onOpenMonthlyClose={() => engine.setMonthlyCloseOpen(true)}
                  openMonthMessage={engine.monthCloseAttention?.message ?? null}
                  onToggleDiscreetMode={engine.toggleDiscreetMode}
                  onLinkBank={handleLinkBank}
                />
                <SpeedTributeBar onSelectPreset={handlePresetSelect} />
              </>
            ) : (
              <MobileHeader
                username={engine.username}
                isDiscreetMode={discreet}
                openMonthMessage={engine.monthCloseAttention?.message ?? null}
                onToggleDiscreetMode={engine.toggleDiscreetMode}
                onRecordTribute={() => engine.openTribute("income")}
                onOpenMonthlyClose={() => engine.setMonthlyCloseOpen(true)}
              />
            )}
          </div>

          <main
            className={cn(
              "mx-auto w-full max-w-screen-2xl space-y-4 px-3 sm:space-y-6 sm:px-6 lg:px-8",
              desktopLayout
                ? "py-4 sm:py-6 lg:py-8"
                : cn("pt-4 sm:pt-6", MOBILE_NAV_CLEARANCE)
            )}
          >
            {!desktopLayout && mobileDestination === "home" && (
              <div className="space-y-4">
                {financialPosition}
                {upcomingNeedsCard}
                {focusCards}
                {triad}
                {banksCard}
                {debtFreedom}
                <RecentActivityStrip events={engine.recentActivity} />
                <WisdomBox
                  wisdomIndex={engine.wisdomIndex}
                  expanded={false}
                  onSelectIndex={engine.setWisdomIndex}
                />
              </div>
            )}

            {!desktopLayout && mobileDestination === "budget" && (
              <div className="space-y-4">
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
              </div>
            )}

            {!desktopLayout && mobileDestination === "ledger" && (
              <div className="space-y-4">{ledgers}</div>
            )}

            {!desktopLayout && mobileDestination === "more" && (
              <MobileMore
                username={engine.username}
                onUsernameChange={engine.setUsername}
                monthAlreadyClosed={engine.monthlyCloseSummary.alreadyClosed}
                onOpenMonthlyClose={() => engine.setMonthlyCloseOpen(true)}
                wisdomIndex={engine.wisdomIndex}
                onSelectWisdomIndex={engine.setWisdomIndex}
                connectedCount={connectedCount}
                banksLoading={isLoading}
                plaidLaunching={launching}
                plaidInitializing={!hydrated}
                isCloudSynced={isCloudSynced}
                onConnectBank={handleLinkBank}
                onRequireAuth={() => setAuthOpen(true)}
                onExportBackup={engine.exportBackup}
                onImportBackup={engine.importBackup}
                onClearAllData={engine.clearAllData}
                vaultSync={engine.vaultSync}
                cloudBusy={engine.cloudBusy}
                cloudUsername={engine.greetingName}
                onConnectCloud={() => engine.setAuthOpen(true)}
                onSignOutCloud={engine.signOutCloud}
                onBootstrapCloud={engine.confirmCloudBootstrap}
                onHydrateCloud={engine.confirmCloudHydrate}
                onCheckCloud={engine.confirmCloudCheck}
              />
            )}

            {desktopLayout && (
            <div className="space-y-6">
              {(showOverview || showWisdom) && (
                <>
                  {showOverview && (
                    <>
                      {financialPosition}
                      {upcomingNeedsCard}
                      {focusCards}
                      {triad}
                      {banksCard}
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
            )}

            <footer className="border-t border-slate-800/60 pt-6 pb-2 text-center text-xs text-slate-600">
              Wealth Engine
            </footer>
          </main>
        </div>

        {!desktopLayout && (
          <MobileBottomNav
            destination={mobileDestination}
            onDestinationChange={setMobileDestination}
          />
        )}

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
          emergencyFundTotal={engine.emergencyFundTotal}
          openingEmergencyFund={engine.openingEmergencyFund}
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
