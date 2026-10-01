"use client";

import { useRef, useState, type ChangeEvent, type ReactNode } from "react";
import {
  Cloud,
  Download,
  Loader2,
  LogOut,
  ShieldCheck,
  Trash2,
  Upload,
} from "lucide-react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
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
import { PhoneMaintenanceDisclosure } from "@/components/babylon/phone-maintenance-disclosure";
import { wealthEngineBuildLabel } from "@/lib/babylon/build-identity";
import {
  BOOTSTRAP_CONFIRM,
  HYDRATE_CONFIRM,
} from "@/lib/babylon/cloud-setup";
import type { MonthlyPlanLayer2 } from "@/lib/babylon/monthly-plan-semantic";
import {
  canConfirmPreservedCopies,
  CURRENT_BACKUP_CONFIRMATION_LABEL,
  CURRENT_BACKUP_PROMPT,
} from "@/lib/babylon/preserved-copy-reconciliation";
import type { VaultStructuralDiff } from "@/lib/babylon/vault-structural-diff";
import { vaultSyncCopy, type VaultSyncView } from "@/lib/babylon/vault-sync";
import { cn } from "@/lib/utils";

export type ConflictCopyCompareResult =
  | {
      ok: true;
      cloudRevision: number;
      schemaVersion: number;
      baselineRevision: number | null;
      diff: VaultStructuralDiff;
      monthlyPlans: MonthlyPlanLayer2;
    }
  | { ok: false; reason: string };

export type ReconciliationPreviewResult =
  | { ok: true; intro: string; bullets: string[]; closing: string }
  | { ok: false; message: string };

export type ReconciliationConfirmResult =
  | { ok: true }
  | { ok: false; message: string };

interface VaultMaintenancePanelProps {
  onExportBackup: () => void;
  onImportBackup: (raw: unknown) => string | null;
  onClearAllData: () => void;
  isCloudSynced: boolean;
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
}

interface VaultCloudSessionProps {
  isCloudSynced: boolean;
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
  onExportBackup: () => void;
}

interface VaultDataBackupsProps {
  onExportBackup: () => void;
  onImportBackup: (raw: unknown) => string | null;
  children?: ReactNode;
  /**
   * Phone More only. Quiet backup controls start closed.
   * An import result stays visible. Desktop leaves this off.
   */
  startClosedWhenQuiet?: boolean;
}

const RESET_TRIGGER_CLASS =
  "mt-1 flex w-full items-center justify-center gap-1.5 rounded-md px-2 py-1.5 text-[11px] text-rose-400/70 transition-colors hover:bg-rose-500/5 hover:text-rose-400";

/**
 * Cloud session, backup, reset, and the 10/20/70 reference.
 * Composed by the desktop sidebar and the phone More destination.
 * Does not own navigation.
 */
export function VaultMaintenancePanel({
  onExportBackup,
  onImportBackup,
  onClearAllData,
  isCloudSynced,
  vaultSync,
  cloudBusy = false,
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
}: VaultMaintenancePanelProps) {
  return (
    <>
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
      <VaultDataBackups
        onExportBackup={onExportBackup}
        onImportBackup={onImportBackup}
      >
        <VaultResetLedger onClearAllData={onClearAllData} />
      </VaultDataBackups>
      <AllocationReference />
    </>
  );
}

function MonthlyPlanEvidence({
  evidence,
}: {
  evidence: MonthlyPlanLayer2;
}) {
  if (evidence.status === "hidden") return null;
  if (evidence.status === "multiple") {
    return (
      <div className="rounded-md border border-slate-800/80 bg-slate-950/50 px-2.5 py-2 text-[11px] text-slate-300">
        <p className="font-medium text-slate-200">Monthly plan comparison</p>
        <p className="mt-1 text-slate-400">
          Multiple unique monthly plans require further review.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-2 rounded-md border border-slate-800/80 bg-slate-950/50 px-2.5 py-2 text-[11px] text-slate-300">
      <p className="font-medium text-slate-200">Monthly plan comparison</p>
      {evidence.local && (
        <div>
          <p className="text-slate-400">This device</p>
          <p>{evidence.local.monthLabel}</p>
          <p>Revision {evidence.local.revision}</p>
          <p>
            Supersedes earlier plan: {evidence.local.supersedesEarlier ? "Yes" : "No"}
          </p>
        </div>
      )}
      {evidence.cloud && (
        <div>
          <p className="text-slate-400">Cloud</p>
          <p>{evidence.cloud.monthLabel}</p>
          <p>Revision {evidence.cloud.revision}</p>
          <p>
            Supersedes earlier plan: {evidence.cloud.supersedesEarlier ? "Yes" : "No"}
          </p>
        </div>
      )}
      <p className="text-slate-200">{evidence.copy}</p>
    </div>
  );
}

function CollectionRows({
  title,
  diff,
  group,
}: {
  title: string;
  diff: VaultStructuralDiff;
  group: "financial" | "planning" | "system";
}) {
  const rows = diff.collections.filter((row) => row.group === group);
  if (rows.length === 0) return null;
  return (
    <div className="space-y-2">
      <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-500">
        {title}
      </p>
      <ul className="space-y-2">
        {rows.map((row) => (
          <li
            key={row.key}
            className="rounded-md border border-slate-800/80 bg-slate-950/50 px-2.5 py-2 text-[11px] text-slate-300"
          >
            <p className="font-medium text-slate-200">{row.label}</p>
            <p className="mt-1 text-slate-400">
              Local only: {row.localOnly} · Cloud only: {row.cloudOnly} ·
              Different on both: {row.sharedDifferent}
            </p>
          </li>
        ))}
      </ul>
    </div>
  );
}

function ScalarRows({
  title,
  diff,
  group,
}: {
  title: string;
  diff: VaultStructuralDiff;
  group: "financial" | "planning" | "system";
}) {
  const rows = diff.scalars.filter((row) => row.group === group);
  if (rows.length === 0) return null;
  return (
    <div className="space-y-2">
      <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-500">
        {title}
      </p>
      <ul className="space-y-1.5">
        {rows.map((row) => (
          <li
            key={row.key}
            className="flex items-center justify-between gap-2 text-[11px] text-slate-300"
          >
            <span>{row.label}</span>
            <span className="text-slate-400">
              {row.status === "same" ? "Same" : "Different"}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function ReconcilePreservedCopies({
  disabled,
  onPreview,
  onConfirm,
  onCancel,
  onExportBackup,
}: {
  disabled: boolean;
  onPreview: () => Promise<ReconciliationPreviewResult>;
  onConfirm: () => Promise<ReconciliationConfirmResult>;
  onCancel: () => void;
  onExportBackup: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [backupConfirmed, setBackupConfirmed] = useState(false);
  const [preview, setPreview] = useState<Extract<
    ReconciliationPreviewResult,
    { ok: true }
  > | null>(null);

  const close = () => {
    if (busy) return;
    onCancel();
    setOpen(false);
    setError(null);
    setPreview(null);
    setBackupConfirmed(false);
  };

  const start = async () => {
    setOpen(true);
    setBusy(true);
    setError(null);
    setPreview(null);
    setBackupConfirmed(false);
    try {
      const outcome = await onPreview();
      if (!outcome.ok) {
        setError(outcome.message);
        return;
      }
      setPreview(outcome);
    } finally {
      setBusy(false);
    }
  };

  const confirm = async () => {
    setBusy(true);
    setError(null);
    try {
      const outcome = await onConfirm();
      if (!outcome.ok) {
        setPreview(null);
        setError(outcome.message);
        return;
      }
      setPreview(null);
      setOpen(false);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled={disabled}
        className="h-8 w-full justify-center border-slate-800 bg-transparent text-xs text-slate-300 hover:bg-slate-900 hover:text-slate-100"
        onClick={() => {
          void start();
        }}
      >
        Reconcile preserved copies
      </Button>
      <Dialog
        open={open}
        onOpenChange={(next) => {
          if (!next) close();
          else setOpen(true);
        }}
      >
        <DialogContent className="max-h-[min(90dvh,40rem)] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Reconcile preserved copies</DialogTitle>
            <DialogDescription>
              This checks the current cloud copy before anything is written.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 text-left">
            {busy && (
              <p className="flex items-center gap-2 text-xs text-slate-300">
                <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
                {preview ? "Writing the combined copy…" : "Reading cloud vault…"}
              </p>
            )}
            {error && <p className="text-xs text-amber-300/90">{error}</p>}
            {preview && !busy && (
              <>
                <p className="text-xs leading-relaxed text-slate-200">
                  {preview.intro}
                </p>
                <p className="text-xs text-slate-300">This will:</p>
                <ul className="list-disc space-y-1 pl-4 text-xs leading-relaxed text-slate-200">
                  {preview.bullets.map((line) => (
                    <li key={line}>{line}</li>
                  ))}
                </ul>
                <p className="text-xs leading-relaxed text-slate-300">
                  {preview.closing}
                </p>
                <p className="text-xs leading-relaxed text-slate-200">
                  {CURRENT_BACKUP_PROMPT}
                </p>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="h-8 border-slate-800 bg-transparent text-xs text-slate-300"
                  onClick={onExportBackup}
                >
                  Export backup
                </Button>
                <label className="flex items-start gap-2 text-xs leading-relaxed text-slate-200">
                  <input
                    type="checkbox"
                    className="mt-0.5"
                    checked={backupConfirmed}
                    onChange={(event) => setBackupConfirmed(event.target.checked)}
                  />
                  {CURRENT_BACKUP_CONFIRMATION_LABEL}
                </label>
              </>
            )}
          </div>
          <DialogFooter className="gap-2 sm:justify-end">
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={busy}
              className="border-slate-800 bg-transparent text-xs text-slate-300"
              onClick={close}
            >
              Cancel
            </Button>
            {preview && !error && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={
                  !canConfirmPreservedCopies({
                    previewReady: true,
                    currentBackupConfirmed: backupConfirmed,
                    busy,
                  })
                }
                className="border-slate-800 bg-transparent text-xs text-slate-100"
                onClick={() => {
                  void confirm();
                }}
              >
                Reconcile copies
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

function ConflictCopyCompare({
  vaultSync,
  onCompare,
  disabled = false,
}: {
  vaultSync: Extract<VaultSyncView, { kind: "conflict" }>;
  onCompare: () => Promise<ConflictCopyCompareResult>;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<Extract<
    ConflictCopyCompareResult,
    { ok: true }
  > | null>(null);

  const runCompare = async () => {
    setBusy(true);
    setError(null);
    try {
      const outcome = await onCompare();
      if (!outcome.ok) {
        setResult(null);
        setError(outcome.reason);
        return;
      }
      setResult(outcome);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="h-8 w-full justify-center border-slate-800 bg-transparent text-xs text-slate-300 hover:bg-slate-900 hover:text-slate-100"
        disabled={busy || disabled}
        onClick={() => {
          setOpen(true);
          void runCompare();
        }}
      >
        Compare copies
      </Button>
      <Dialog
        open={open}
        onOpenChange={(next) => {
          setOpen(next);
          if (!next) {
            setError(null);
            setResult(null);
            setBusy(false);
          }
        }}
      >
        <DialogContent className="max-h-[min(90dvh,40rem)] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Compare preserved copies</DialogTitle>
            <DialogDescription>
              This comparison does not change either copy. It shows where this
              device and the current cloud vault differ structurally.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 text-left">
            <p className="text-[11px] text-slate-400">
              Comparing: This device
              {vaultSync.baselineRevision !== null
                ? ` (last verified together at revision ${vaultSync.baselineRevision})`
                : ""}
              {" · "}
              {result
                ? `Cloud revision ${result.cloudRevision}`
                : "Cloud (loading…)"}
            </p>

            {busy && (
              <p className="flex items-center gap-2 text-xs text-slate-300">
                <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
                Reading cloud vault…
              </p>
            )}

            {error && (
              <div className="space-y-2">
                <p className="text-xs text-amber-300/90">{error}</p>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="h-8 text-xs"
                  disabled={busy}
                  onClick={() => void runCompare()}
                >
                  Try again
                </Button>
              </div>
            )}

            {result && !busy && (
              <>
                <div className="space-y-1.5 rounded-md border border-slate-800 bg-slate-950/60 p-3">
                  {result.diff.summaryLines.map((line) => (
                    <p
                      key={line}
                      className="text-xs leading-relaxed text-slate-200"
                    >
                      {line}
                    </p>
                  ))}
                  <p className="pt-1 text-[11px] text-slate-400">
                    Document identity:{" "}
                    {result.diff.documentIdentity === "same"
                      ? "Same"
                      : "Different"}
                  </p>
                </div>

                <CollectionRows
                  title="Financial records"
                  diff={result.diff}
                  group="financial"
                />
                <ScalarRows
                  title="Financial state"
                  diff={result.diff}
                  group="financial"
                />
                <CollectionRows
                  title="Planning"
                  diff={result.diff}
                  group="planning"
                />
                <MonthlyPlanEvidence evidence={result.monthlyPlans} />
                <CollectionRows
                  title="System / metadata"
                  diff={result.diff}
                  group="system"
                />
                <ScalarRows
                  title="System scalars"
                  diff={result.diff}
                  group="system"
                />
              </>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

export function VaultCloudSession({
  isCloudSynced,
  vaultSync,
  cloudBusy = false,
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
  onExportBackup,
}: VaultCloudSessionProps) {
  const [signingOut, setSigningOut] = useState(false);

  const handleSignOut = async () => {
    setSigningOut(true);
    try {
      await onSignOutCloud();
    } finally {
      setSigningOut(false);
    }
  };

  return (
    <div className="rounded-lg border border-slate-800/80 bg-slate-950/60 p-3">
      {isCloudSynced ? (
        <div className="space-y-2.5">
          <div className="min-w-0">
            <p className="truncate text-sm font-medium text-slate-100">
              {cloudUsername}
            </p>
            <p className="mt-0.5 flex items-center gap-1.5 text-[11px] text-emerald-400">
              <span
                className="inline-block h-1.5 w-1.5 rounded-full bg-emerald-400"
                aria-hidden
              />
              <span aria-live="polite">{vaultSyncCopy(vaultSync).title}</span>
            </p>
            {vaultSyncCopy(vaultSync).detail && (
              <p className="mt-1 text-[11px] leading-snug text-slate-400">
                {vaultSyncCopy(vaultSync).detail}
              </p>
            )}
            {vaultSync.kind === "conflict" && cloudBusy && (
              <p className="mt-1 text-[11px] leading-snug text-slate-400">
                Checking whether this conflict is still current…
              </p>
            )}
            {vaultSync.kind === "conflict" && conflictRefreshNote && (
              <p className="mt-1 text-[11px] leading-snug text-amber-300/90">
                {conflictRefreshNote}
              </p>
            )}
          </div>
          {vaultSync.kind === "offer_bootstrap" && (
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={cloudBusy}
                  className="h-8 w-full justify-center border-emerald-900/50 bg-emerald-500/5 text-xs text-emerald-300 hover:bg-emerald-500/10 hover:text-emerald-200"
                >
                  Use this device to initialize cloud state
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Initialize the cloud vault?</AlertDialogTitle>
                  <AlertDialogDescription>{BOOTSTRAP_CONFIRM}</AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                  <AlertDialogAction onClick={() => void onBootstrapCloud()}>
                    Initialize cloud vault
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          )}
          {vaultSync.kind === "offer_hydrate" && (
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={cloudBusy}
                  className="h-8 w-full justify-center border-emerald-900/50 bg-emerald-500/5 text-xs text-emerald-300 hover:bg-emerald-500/10 hover:text-emerald-200"
                >
                  Load my Wealth Engine from cloud
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Load the cloud vault?</AlertDialogTitle>
                  <AlertDialogDescription>{HYDRATE_CONFIRM}</AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                  <AlertDialogAction onClick={() => void onHydrateCloud()}>
                    Load cloud vault
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          )}
          {vaultSync.kind === "conflict" && onCompareConflictCopies && (
            // Recheck stays a separate read. Compare copies remains available.
            <ConflictCopyCompare
              vaultSync={vaultSync}
              onCompare={onCompareConflictCopies}
              disabled={reconciliationActive}
            />
          )}
          {vaultSync.kind === "conflict" &&
            onPreviewReconciliation &&
            onConfirmReconciliation &&
            onCancelReconciliation && (
              <ReconcilePreservedCopies
                disabled={cloudBusy || reconciliationActive}
                onPreview={onPreviewReconciliation}
                onConfirm={onConfirmReconciliation}
                onCancel={onCancelReconciliation}
                onExportBackup={onExportBackup}
              />
            )}
          {(vaultSync.kind === "offline_pending" ||
            vaultSync.kind === "pending_verification" ||
            vaultSync.kind === "local_dirty" ||
            vaultSync.kind === "conflict" ||
            vaultSync.kind === "cloud_unavailable" ||
            vaultSync.kind === "unexpected_revision") && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={cloudBusy || reconciliationActive}
              className="h-8 w-full justify-center border-slate-800 bg-transparent text-xs text-slate-300 hover:bg-slate-900 hover:text-slate-100"
              onClick={() => {
                void onCheckCloud();
              }}
            >
              Check cloud
            </Button>
          )}
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={signingOut}
            className="h-8 w-full justify-center border-slate-800 bg-transparent text-xs text-slate-400 hover:bg-slate-900 hover:text-slate-100"
            onClick={() => void handleSignOut()}
            aria-label="Sign out"
          >
            {signingOut ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <LogOut className="h-3.5 w-3.5" />
            )}
            Sign Out
          </Button>
          <p className="text-[10px] text-slate-500">{wealthEngineBuildLabel()}</p>
        </div>
      ) : (
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="h-9 w-full justify-center border-emerald-900/50 bg-emerald-500/5 text-xs text-emerald-300 hover:bg-emerald-500/10 hover:text-emerald-200"
          onClick={onConnectCloud}
        >
          <Cloud className="h-3.5 w-3.5" aria-hidden />
          Sign in
        </Button>
      )}
    </div>
  );
}

export function VaultDataBackups({
  onExportBackup,
  onImportBackup,
  children,
  startClosedWhenQuiet = false,
}: VaultDataBackupsProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [importStatus, setImportStatus] = useState<string | null>(null);
  const [importError, setImportError] = useState(false);

  const handleFileChange = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;

    try {
      const text = await file.text();
      const parsed: unknown = JSON.parse(text);
      const error = onImportBackup(parsed);
      if (error) {
        setImportError(true);
        setImportStatus(error);
        return;
      }
      setImportError(false);
      setImportStatus("Backup restored.");
    } catch {
      setImportError(true);
      setImportStatus("Could not read that file as JSON.");
    }
  };

  const backups = (
    <div className="space-y-2">
      <p className="px-0.5 text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-500">
        Data backups
      </p>
      <div className="grid grid-cols-2 gap-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="h-9 justify-center border-slate-800 bg-slate-950/50 text-xs text-slate-300 hover:bg-slate-900 hover:text-slate-100"
          onClick={onExportBackup}
        >
          <Download className="h-3.5 w-3.5" />
          Export
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="h-9 justify-center border-slate-800 bg-slate-950/50 text-xs text-slate-300 hover:bg-slate-900 hover:text-slate-100"
          onClick={() => fileInputRef.current?.click()}
        >
          <Upload className="h-3.5 w-3.5" />
          Import
        </Button>
      </div>
      <input
        ref={fileInputRef}
        type="file"
        accept="application/json,.json"
        className="hidden"
        onChange={handleFileChange}
        aria-label="Import backup JSON"
      />
      {importStatus && (
        <p
          className={cn(
            "px-0.5 text-[11px] leading-snug",
            importError ? "text-rose-400" : "text-emerald-500/90"
          )}
        >
          {importStatus}
        </p>
      )}
      {children}
    </div>
  );

  if (!startClosedWhenQuiet) return backups;

  return (
    <PhoneMaintenanceDisclosure
      regionId="more-data-backups"
      allowClosed={importStatus === null}
      summary={
        <span className="block">
          <span className="block text-sm text-slate-200">Data backups</span>
          <span className="mt-0.5 block text-xs font-normal text-slate-400">
            No import result on this device.
          </span>
        </span>
      }
    >
      {backups}
    </PhoneMaintenanceDisclosure>
  );
}

export function VaultResetLedger({
  onClearAllData,
  triggerClassName = RESET_TRIGGER_CLASS,
}: {
  onClearAllData: () => void;
  triggerClassName?: string;
}) {
  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <button type="button" className={triggerClassName}>
          <Trash2 className="h-3 w-3" aria-hidden="true" />
          Reset ledger
        </button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Clear this ledger?</AlertDialogTitle>
          <AlertDialogDescription>
            This permanently deletes all income, categories, expenses, and
            debts stored on this device. It cannot be undone unless you have
            an exported backup.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction
            className="bg-rose-600 text-white shadow-sm hover:bg-rose-500 focus-visible:ring-rose-500/60"
            onClick={onClearAllData}
          >
            Delete ledger data
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

export function AllocationReference() {
  return (
    <Card className="border-emerald-900/40 bg-gradient-to-br from-slate-900 to-slate-950">
      <CardContent className="space-y-3 p-4">
        <div className="flex items-center gap-2 text-emerald-400">
          <ShieldCheck className="h-4 w-4" aria-hidden="true" />
          <span className="text-xs font-semibold uppercase tracking-wider">
            10 / 20 / 70
          </span>
        </div>
        <p className="text-xs leading-relaxed text-slate-400">
          Each time you add income, 10% goes to Wealth Building, 20% goes to
          Debt Payoff, and 70% is the Living Budget. With no active debt, the
          20% also goes to Wealth Building.
        </p>
        <div className="grid grid-cols-3 gap-1.5 text-center text-[10px]">
          <div className="rounded-md bg-emerald-500/10 py-1.5 text-emerald-400">
            10%
          </div>
          <div className="rounded-md bg-amber-500/10 py-1.5 text-amber-400">
            20%
          </div>
          <div className="rounded-md bg-slate-800 py-1.5 text-slate-300">
            70%
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
