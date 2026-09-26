"use client";

import { CalendarCheck } from "lucide-react";
import { ConnectedBanksCard } from "@/components/babylon/connected-banks-card";
import { VaultMaintenancePanel } from "@/components/babylon/vault-maintenance-panel";
import { WisdomBox } from "@/components/babylon/wisdom-box";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { GREETING_NAME_FALLBACK } from "@/lib/babylon/constants";
import type { VaultSyncView } from "@/lib/babylon/vault-sync";

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
}: MobileMoreProps) {
  return (
    <div className="space-y-4">
      <section className="space-y-2">
        <h2 className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-500">
          Profile
        </h2>
        <Input
          value={username}
          onChange={(event) => onUsernameChange(event.target.value)}
          onBlur={(event) => onUsernameChange(event.target.value)}
          placeholder={GREETING_NAME_FALLBACK}
          aria-label="Profile name"
          className="border-slate-800 bg-slate-900/50"
        />
      </section>

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

      <ConnectedBanksCard
        connectedCount={connectedCount}
        isLoading={banksLoading}
        launching={plaidLaunching}
        initializing={plaidInitializing}
        isCloudSynced={isCloudSynced}
        onConnect={onConnectBank}
        onRequireAuth={onRequireAuth}
      />

      <WisdomBox
        wisdomIndex={wisdomIndex}
        expanded
        onSelectIndex={onSelectWisdomIndex}
      />

      <div className="space-y-3">
        <VaultMaintenancePanel
          onExportBackup={onExportBackup}
          onImportBackup={onImportBackup}
          onClearAllData={onClearAllData}
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
      </div>
    </div>
  );
}
