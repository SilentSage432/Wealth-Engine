"use client";

import { useState } from "react";
import { CalendarCheck } from "lucide-react";
import { ConnectedBanksCard } from "@/components/babylon/connected-banks-card";
import { ObservationTeaching } from "@/components/babylon/observation-teaching";
import { DeviceNotifications } from "@/components/babylon/device-notifications";
import { FinancialTimeZoneField } from "@/components/babylon/financial-time-zone-field";
import {
  FinancialPosition,
  type FinancialPositionBalanceObservation,
} from "@/components/babylon/financial-position";
import {
  AllocationReference,
  VaultCloudSession,
  VaultDataBackups,
  VaultResetLedger,
  type ConflictCopyCompareResult,
  type ReconciliationConfirmResult,
  type ReconciliationPreviewResult,
} from "@/components/babylon/vault-maintenance-panel";
import { PhoneMaintenanceDisclosure } from "@/components/babylon/phone-maintenance-disclosure";
import { ProfileNameField } from "@/components/babylon/profile-name-field";
import { WisdomBox } from "@/components/babylon/wisdom-box";
import { Button } from "@/components/ui/button";
import type { AvailableAfterPlannedNeeds } from "@/lib/babylon/available-after-planned-needs";
import type { FirstDesignationReconcileChoice } from "@/lib/babylon/account-purpose";
import { phoneCloudSessionStartsClosed } from "@/lib/babylon/mobile-more";
import { vaultSyncCopy, type VaultSyncView } from "@/lib/babylon/vault-sync";
import type {
  BudgetTarget,
  FinancialAccount,
  FinancialAccountInput,
  FinancialAccountPurpose,
} from "@/types/babylon";

type PurposeActionResult =
  | { status: "applied" }
  | {
      status: "needs_reconcile";
      purpose: FinancialAccountPurpose;
      opening: number;
      accountPosition: number;
    }
  | { status: "rejected"; reason: string };

type PurposeClearResult =
  | { status: "applied" }
  | {
      status: "needs_preserve_choice";
      accountPosition: number;
      purpose: FinancialAccountPurpose;
    }
  | { status: "rejected"; reason: string };

interface MobileMoreProps {
  username: string;
  onUsernameChange: (value: string) => void;
  monthAlreadyClosed: boolean;
  onOpenMonthlyClose: () => void;
  wisdomIndex: number;
  onSelectWisdomIndex: (index: number) => void;
  connectedCount: number;
  banksLoading: boolean;
  plaidLaunching: boolean;
  plaidInitializing: boolean;
  isCloudSynced: boolean;
  repairs?: readonly { itemId: string; institutionName: string }[];
  onConnectBank: () => void;
  onRepairBank?: (itemId: string) => void;
  onRequireAuth: () => void;
  budgetTargets: readonly BudgetTarget[];
  onExportBackup: () => void;
  onImportBackup: (raw: unknown) => string | null;
  onClearAllData: () => void;
  vaultSync: VaultSyncView;
  cloudBusy?: boolean;
  conflictRefreshNote?: string | null;
  cloudUsername: string;
  onConnectCloud: () => void;
  onSignOutCloud: () => void | Promise<boolean>;
  onBootstrapCloud: () => void | Promise<void>;
  onHydrateCloud: () => void | Promise<void>;
  onCheckCloud: () => void | Promise<void>;
  onCompareConflictCopies?: () => Promise<ConflictCopyCompareResult>;
  reconciliationActive?: boolean;
  onPreviewReconciliation?: () => Promise<ReconciliationPreviewResult>;
  onConfirmReconciliation?: () => Promise<ReconciliationConfirmResult>;
  onCancelReconciliation?: () => void;
  accounts: FinancialAccount[];
  moneyAvailable: number;
  restrictedEffectiveTotal?: number;
  deployablePosition?: number;
  openingWealthBuilding: number;
  openingEmergencyFund: number;
  protectedMoney: number;
  wealthBuildingPosition: number;
  emergencyFundPosition: number;
  protectedOverAvailable: boolean;
  upcomingNeeds: number;
  availableAfterPlannedNeeds: AvailableAfterPlannedNeeds;
  obligationsReadable?: boolean;
  remainingDebt: number;
  discreet: boolean;
  onAddAccount: (input: FinancialAccountInput) => boolean;
  onUpdateAccount: (id: string, input: FinancialAccountInput) => boolean;
  onRemoveAccount: (
    id: string,
    preserve?: "allow_drop" | "keep_as_existing" | "cancel"
  ) => PurposeClearResult | { status: "applied" };
  onSetAccountPurpose: (
    accountId: string,
    purpose: FinancialAccountPurpose,
    reconcile?: FirstDesignationReconcileChoice | "cancel"
  ) => PurposeActionResult;
  onClearAccountPurpose: (
    accountId: string,
    preserve?: "allow_drop" | "keep_as_existing" | "cancel"
  ) => PurposeClearResult;
  onUpdateProtected: (wealth: number, emergency: number) => string | null;
  onEditorOpenChange?: (open: boolean) => void;
  balanceObservation?: FinancialPositionBalanceObservation;
  financialTimeZone?: string;
  onEstablishFinancialTimeZone: (zone: string) => boolean;
}

function GroupHeading({ children }: { children: string }) {
  return (
    <h2 className="text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-500">
      {children}
    </h2>
  );
}

export function MobileMore({
  username,
  onUsernameChange,
  monthAlreadyClosed,
  onOpenMonthlyClose,
  wisdomIndex,
  onSelectWisdomIndex,
  connectedCount,
  banksLoading,
  plaidLaunching,
  plaidInitializing,
  isCloudSynced,
  repairs = [],
  onConnectBank,
  onRepairBank,
  onRequireAuth,
  budgetTargets,
  onExportBackup,
  onImportBackup,
  onClearAllData,
  vaultSync,
  cloudBusy,
  conflictRefreshNote = null,
  cloudUsername,
  onConnectCloud,
  onSignOutCloud,
  onBootstrapCloud,
  onHydrateCloud,
  onCheckCloud,
  onCompareConflictCopies,
  reconciliationActive = false,
  onPreviewReconciliation,
  onConfirmReconciliation,
  onCancelReconciliation,
  accounts,
  moneyAvailable,
  restrictedEffectiveTotal = 0,
  deployablePosition,
  openingWealthBuilding,
  openingEmergencyFund,
  protectedMoney,
  wealthBuildingPosition,
  emergencyFundPosition,
  protectedOverAvailable,
  upcomingNeeds,
  availableAfterPlannedNeeds,
  obligationsReadable = true,
  remainingDebt,
  discreet,
  onAddAccount,
  onUpdateAccount,
  onRemoveAccount,
  onSetAccountPurpose,
  onClearAccountPurpose,
  onUpdateProtected,
  onEditorOpenChange,
  balanceObservation,
  financialTimeZone,
  onEstablishFinancialTimeZone,
}: MobileMoreProps) {
  const [guidanceOpen, setGuidanceOpen] = useState(false);
  const [referenceOpen, setReferenceOpen] = useState(false);

  return (
    <div className="min-w-0 space-y-6">
      <section className="space-y-3" aria-label="Financial setup">
        <GroupHeading>Financial setup</GroupHeading>
        <PhoneMaintenanceDisclosure
          regionId="more-profile-name"
          allowClosed
          summary={
            username.trim()
              ? `Profile name · ${username.trim()}`
              : "Profile name is blank."
          }
        >
          <ProfileNameField value={username} onChange={onUsernameChange} />
        </PhoneMaintenanceDisclosure>
        <FinancialPosition
          presentation="manage"
          accounts={accounts}
          moneyAvailable={moneyAvailable}
          restrictedEffectiveTotal={restrictedEffectiveTotal}
          deployablePosition={deployablePosition}
          openingWealthBuilding={openingWealthBuilding}
          openingEmergencyFund={openingEmergencyFund}
          protectedMoney={protectedMoney}
          wealthBuildingPosition={wealthBuildingPosition}
          emergencyFundPosition={emergencyFundPosition}
          protectedOverAvailable={protectedOverAvailable}
          upcomingNeeds={upcomingNeeds}
          availableAfterPlannedNeeds={availableAfterPlannedNeeds}
          obligationsReadable={obligationsReadable}
          remainingDebt={remainingDebt}
          discreet={discreet}
          onAddAccount={onAddAccount}
          onUpdateAccount={onUpdateAccount}
          onRemoveAccount={onRemoveAccount}
          onSetAccountPurpose={onSetAccountPurpose}
          onClearAccountPurpose={onClearAccountPurpose}
          onUpdateProtected={onUpdateProtected}
          onEditorOpenChange={onEditorOpenChange}
          balanceObservation={balanceObservation}
        />
        <Button
          type="button"
          variant="outline"
          className="w-full"
          onClick={onOpenMonthlyClose}
          disabled={monthAlreadyClosed}
          aria-label={
            monthAlreadyClosed ? "Month already closed" : "Close this month"
          }
        >
          <CalendarCheck className="h-4 w-4" aria-hidden="true" />
          {monthAlreadyClosed ? "Month closed" : "Close Month"}
        </Button>
      </section>

      <section className="space-y-3" aria-label="Connections">
        <GroupHeading>Connections</GroupHeading>
        <ConnectedBanksCard
          density="compact"
          connectedCount={connectedCount}
          isLoading={banksLoading}
          launching={plaidLaunching}
          initializing={plaidInitializing}
          isCloudSynced={isCloudSynced}
          repairs={repairs}
          onConnect={onConnectBank}
          onRepair={onRepairBank}
          onRequireAuth={onRequireAuth}
        />
        <ObservationTeaching
          enabled={isCloudSynced}
          budgetTargets={budgetTargets}
          discreet={discreet}
        />
      </section>

      <section className="space-y-3" aria-label="Guidance">
        <GroupHeading>Guidance</GroupHeading>
        <button
          type="button"
          className="flex min-h-11 w-full items-center justify-between rounded-lg border border-slate-800 px-3 text-sm text-slate-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/60"
          aria-expanded={guidanceOpen}
          aria-controls="more-financial-guidance"
          onClick={() => setGuidanceOpen((open) => !open)}
        >
          Financial Guidance
          <span className="text-xs text-slate-500">
            {guidanceOpen ? "Hide" : "Show"}
          </span>
        </button>
        {guidanceOpen ? (
          <div id="more-financial-guidance">
            <WisdomBox
              wisdomIndex={wisdomIndex}
              expanded
              onSelectIndex={onSelectWisdomIndex}
            />
          </div>
        ) : null}
        <button
          type="button"
          className="flex min-h-11 w-full items-center justify-between rounded-lg border border-slate-800 px-3 text-sm text-slate-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/60"
          aria-expanded={referenceOpen}
          aria-controls="more-allocation-reference"
          onClick={() => setReferenceOpen((open) => !open)}
        >
          10/20/70
          <span className="text-xs text-slate-500">
            {referenceOpen ? "Hide" : "Show"}
          </span>
        </button>
        {referenceOpen ? (
          <div id="more-allocation-reference">
            <AllocationReference />
          </div>
        ) : null}
      </section>

      <section className="space-y-3" aria-label="Data and cloud">
        <GroupHeading>Data and cloud</GroupHeading>
        <PhoneMaintenanceDisclosure
          regionId="more-cloud-session"
          allowClosed={phoneCloudSessionStartsClosed({
            isCloudSynced,
            syncKind: vaultSync.kind,
            cloudBusy: Boolean(cloudBusy),
            reconciliationActive,
            conflictRefreshNote,
          })}
          summary={
            <span className="block min-w-0">
              <span className="block truncate font-medium text-slate-100">
                {cloudUsername.trim() || "Signed in"}
              </span>
              <span className="mt-0.5 block text-xs text-emerald-400">
                {vaultSyncCopy(vaultSync).title}
              </span>
            </span>
          }
        >
          <VaultCloudSession
            isCloudSynced={isCloudSynced}
            vaultSync={vaultSync}
            cloudBusy={cloudBusy}
            conflictRefreshNote={conflictRefreshNote}
            cloudUsername={cloudUsername}
            onConnectCloud={onConnectCloud}
            onSignOutCloud={onSignOutCloud}
            onBootstrapCloud={onBootstrapCloud}
            onHydrateCloud={onHydrateCloud}
            onCheckCloud={onCheckCloud}
            onCompareConflictCopies={onCompareConflictCopies}
            reconciliationActive={reconciliationActive}
            onPreviewReconciliation={onPreviewReconciliation}
            onConfirmReconciliation={onConfirmReconciliation}
            onCancelReconciliation={onCancelReconciliation}
            onExportBackup={onExportBackup}
          />
        </PhoneMaintenanceDisclosure>
        <FinancialTimeZoneField
          financialTimeZone={financialTimeZone}
          onEstablish={onEstablishFinancialTimeZone}
        />
        <DeviceNotifications />
        <VaultDataBackups
          startClosedWhenQuiet
          onExportBackup={onExportBackup}
          onImportBackup={onImportBackup}
        />
      </section>

      <section className="space-y-3" aria-label="Danger zone">
        <GroupHeading>Danger zone</GroupHeading>
        <PhoneMaintenanceDisclosure
          regionId="more-danger-zone"
          allowClosed
          summary={
            <span className="text-xs font-normal leading-relaxed text-slate-400">
              Reset ledger deletes the income, categories, expenses, and debts
              stored on this device. It asks you to confirm first.
            </span>
          }
        >
          <VaultResetLedger
            onClearAllData={onClearAllData}
            triggerClassName="flex min-h-11 w-full items-center justify-center gap-2 rounded-md border border-rose-900/60 px-3 text-sm text-rose-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-500/60"
          />
        </PhoneMaintenanceDisclosure>
      </section>
    </div>
  );
}
