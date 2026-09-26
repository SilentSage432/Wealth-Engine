"use client";

import { useState } from "react";
import { CalendarCheck } from "lucide-react";
import { ConnectedBanksCard } from "@/components/babylon/connected-banks-card";
import { FinancialPosition } from "@/components/babylon/financial-position";
import {
  AllocationReference,
  VaultCloudSession,
  VaultDataBackups,
  VaultResetLedger,
} from "@/components/babylon/vault-maintenance-panel";
import { WisdomBox } from "@/components/babylon/wisdom-box";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { AvailableAfterPlannedNeeds } from "@/lib/babylon/available-after-planned-needs";
import { GREETING_NAME_FALLBACK } from "@/lib/babylon/constants";
import type { VaultSyncView } from "@/lib/babylon/vault-sync";
import type {
  FinancialAccount,
  FinancialAccountInput,
} from "@/types/babylon";

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
  onConnectBank: () => void;
  onRequireAuth: () => void;
  onExportBackup: () => void;
  onImportBackup: (raw: unknown) => string | null;
  onClearAllData: () => void;
  vaultSync: VaultSyncView;
  cloudBusy?: boolean;
  cloudUsername: string;
  onConnectCloud: () => void;
  onSignOutCloud: () => void | Promise<boolean>;
  onBootstrapCloud: () => void | Promise<void>;
  onHydrateCloud: () => void | Promise<void>;
  onCheckCloud: () => void | Promise<void>;
  accounts: FinancialAccount[];
  moneyAvailable: number;
  openingWealthBuilding: number;
  openingEmergencyFund: number;
  protectedMoney: number;
  protectedOverAvailable: boolean;
  upcomingNeeds: number;
  availableAfterPlannedNeeds: AvailableAfterPlannedNeeds;
  discreet: boolean;
  onAddAccount: (input: FinancialAccountInput) => boolean;
  onUpdateAccount: (id: string, input: FinancialAccountInput) => boolean;
  onRemoveAccount: (id: string) => void;
  onUpdateProtected: (wealth: number, emergency: number) => string | null;
  onEditorOpenChange?: (open: boolean) => void;
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
  onConnectBank,
  onRequireAuth,
  onExportBackup,
  onImportBackup,
  onClearAllData,
  vaultSync,
  cloudBusy,
  cloudUsername,
  onConnectCloud,
  onSignOutCloud,
  onBootstrapCloud,
  onHydrateCloud,
  onCheckCloud,
  accounts,
  moneyAvailable,
  openingWealthBuilding,
  openingEmergencyFund,
  protectedMoney,
  protectedOverAvailable,
  upcomingNeeds,
  availableAfterPlannedNeeds,
  discreet,
  onAddAccount,
  onUpdateAccount,
  onRemoveAccount,
  onUpdateProtected,
  onEditorOpenChange,
}: MobileMoreProps) {
  const [guidanceOpen, setGuidanceOpen] = useState(false);
  const [referenceOpen, setReferenceOpen] = useState(false);

  return (
    <div className="min-w-0 space-y-6">
      <section className="space-y-3" aria-label="Financial setup">
        <GroupHeading>Financial setup</GroupHeading>
        <label className="block space-y-1">
          <span className="text-xs text-slate-400">Profile name</span>
          <Input
            value={username}
            onChange={(event) => onUsernameChange(event.target.value)}
            onBlur={(event) => onUsernameChange(event.target.value)}
            placeholder={GREETING_NAME_FALLBACK}
            aria-label="Profile name"
            className="border-slate-800 bg-slate-900/50"
          />
        </label>
        <FinancialPosition
          presentation="manage"
          accounts={accounts}
          moneyAvailable={moneyAvailable}
          openingWealthBuilding={openingWealthBuilding}
          openingEmergencyFund={openingEmergencyFund}
          protectedMoney={protectedMoney}
          protectedOverAvailable={protectedOverAvailable}
          upcomingNeeds={upcomingNeeds}
          availableAfterPlannedNeeds={availableAfterPlannedNeeds}
          discreet={discreet}
          onAddAccount={onAddAccount}
          onUpdateAccount={onUpdateAccount}
          onRemoveAccount={onRemoveAccount}
          onUpdateProtected={onUpdateProtected}
          onEditorOpenChange={onEditorOpenChange}
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
          onConnect={onConnectBank}
          onRequireAuth={onRequireAuth}
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
        <VaultCloudSession
          isCloudSynced={isCloudSynced}
          vaultSync={vaultSync}
          cloudBusy={cloudBusy}
          cloudUsername={cloudUsername}
          onConnectCloud={onConnectCloud}
          onSignOutCloud={onSignOutCloud}
          onBootstrapCloud={onBootstrapCloud}
          onHydrateCloud={onHydrateCloud}
          onCheckCloud={onCheckCloud}
        />
        <VaultDataBackups
          onExportBackup={onExportBackup}
          onImportBackup={onImportBackup}
        />
      </section>

      <section className="space-y-3" aria-label="Danger zone">
        <GroupHeading>Danger zone</GroupHeading>
        <p className="text-xs leading-relaxed text-slate-400">
          Reset ledger deletes the income, categories, expenses, and debts
          stored on this device. It asks you to confirm first.
        </p>
        <VaultResetLedger
          onClearAllData={onClearAllData}
          triggerClassName="flex min-h-11 w-full items-center justify-center gap-2 rounded-md border border-rose-900/60 px-3 text-sm text-rose-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-500/60"
        />
      </section>
    </div>
  );
}
