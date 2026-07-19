"use client";

import { useRef, useState, type ChangeEvent } from "react";
import {
  Cloud,
  Download,
  Landmark,
  Loader2,
  LogOut,
  ShieldCheck,
  Trash2,
  Upload,
  X,
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
import { NAV_ITEMS } from "@/lib/babylon/constants";
import { cn } from "@/lib/utils";
import type { NavSection } from "@/types/babylon";

interface AppSidebarProps {
  open: boolean;
  activeNav: NavSection;
  onClose: () => void;
  onSelectNav: (section: NavSection) => void;
  onExportBackup: () => void;
  onImportBackup: (raw: unknown) => string | null;
  onClearAllData: () => void;
  isCloudSynced: boolean;
  cloudHydrating?: boolean;
  cloudUsername: string;
  onConnectCloud: () => void;
  onSignOutCloud: () => void | Promise<boolean>;
}

export function AppSidebar({
  open,
  activeNav,
  onClose,
  onSelectNav,
  onExportBackup,
  onImportBackup,
  onClearAllData,
  isCloudSynced,
  cloudHydrating = false,
  cloudUsername,
  onConnectCloud,
  onSignOutCloud,
}: AppSidebarProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [importStatus, setImportStatus] = useState<string | null>(null);
  const [importError, setImportError] = useState(false);
  const [signingOut, setSigningOut] = useState(false);

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

  const handleSignOut = async () => {
    setSigningOut(true);
    try {
      await onSignOutCloud();
    } finally {
      setSigningOut(false);
    }
  };

  return (
    <aside
      className={cn(
        "fixed inset-y-0 left-0 z-50 flex w-[min(18rem,100vw)] max-w-full flex-col border-r border-slate-800/80 bg-slate-950/95 backdrop-blur-xl transition-transform duration-300 ease-out lg:translate-x-0",
        open
          ? "translate-x-0 pointer-events-auto"
          : "-translate-x-full pointer-events-none lg:pointer-events-auto"
      )}
    >
      <div className="flex items-center justify-between border-b border-slate-800/80 px-5 py-5">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-emerald-500 to-emerald-700 shadow-lg shadow-emerald-900/40">
            <Landmark className="h-5 w-5 text-white" />
          </div>
          <div>
            <p className="font-[family-name:var(--font-display)] text-xl font-semibold leading-none tracking-wide text-slate-50">
              Wealth Engine
            </p>
            <p className="mt-1 text-[10px] uppercase tracking-[0.2em] text-emerald-500/80">
              Babylon Ledger
            </p>
          </div>
        </div>
        <Button
          variant="ghost"
          size="icon"
          className="lg:hidden"
          onClick={onClose}
        >
          <X className="h-4 w-4" />
        </Button>
      </div>

      <nav className="flex flex-1 flex-col gap-1 p-4">
        {NAV_ITEMS.map((item) => {
          const Icon = item.icon;
          const active = activeNav === item.id;
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => onSelectNav(item.id)}
              className={cn(
                "flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-all duration-200",
                active
                  ? "bg-emerald-500/10 text-emerald-400 shadow-inner"
                  : "text-slate-400 hover:bg-slate-900 hover:text-slate-100"
              )}
            >
              <Icon className="h-4 w-4" />
              {item.label}
            </button>
          );
        })}
      </nav>

      <div className="space-y-3 border-t border-slate-800/80 p-4">
        <div className="rounded-lg border border-slate-800/80 bg-slate-950/60 p-3">
          {isCloudSynced ? (
            <div className="space-y-2.5">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-slate-100">
                    {cloudUsername}
                  </p>
                  <p className="mt-0.5 flex items-center gap-1.5 text-[11px] text-emerald-400">
                    <span
                      className="inline-block h-1.5 w-1.5 rounded-full bg-emerald-400"
                      aria-hidden
                    />
                    <span aria-live="polite">
                      {cloudHydrating ? "Migrating…" : "Synced"}
                    </span>
                  </p>
                </div>
                {cloudHydrating && (
                  <Loader2
                    className="mt-0.5 h-3.5 w-3.5 shrink-0 animate-spin text-emerald-400"
                    aria-hidden
                  />
                )}
              </div>
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={signingOut}
                className="h-8 w-full justify-center border-slate-800 bg-transparent text-xs text-slate-400 hover:bg-slate-900 hover:text-slate-100"
                onClick={() => void handleSignOut()}
                aria-label="Sign out of cloud vault"
              >
                {signingOut ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <LogOut className="h-3.5 w-3.5" />
                )}
                Sign Out
              </Button>
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
              ☁️ Connect Cloud Vault
            </Button>
          )}
        </div>

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

          <AlertDialog>
            <AlertDialogTrigger asChild>
              <button
                type="button"
                className="mt-1 flex w-full items-center justify-center gap-1.5 rounded-md px-2 py-1.5 text-[11px] text-rose-400/70 transition-colors hover:bg-rose-500/5 hover:text-rose-400"
              >
                <Trash2 className="h-3 w-3" />
                Reset Ledger Workspace
              </button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>
                  Are you absolutely sure you want to purge the ledger?
                </AlertDialogTitle>
                <AlertDialogDescription>
                  This action will permanently delete all recorded income
                  streams, custom budget categories, expenditures, and debt
                  ledgers from this device. This step cannot be undone unless
                  you have an exported backup file.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction
                  className="bg-rose-600 text-white shadow-sm hover:bg-rose-500 focus-visible:ring-rose-500/60"
                  onClick={onClearAllData}
                >
                  Purge Workspace Data
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>

        <Card className="border-emerald-900/40 bg-gradient-to-br from-slate-900 to-slate-950">
          <CardContent className="space-y-3 p-4">
            <div className="flex items-center gap-2 text-emerald-400">
              <ShieldCheck className="h-4 w-4" />
              <span className="text-xs font-semibold uppercase tracking-wider">
                10 / 20 / 70
              </span>
            </div>
            <p className="text-xs leading-relaxed text-slate-400">
              Autonomous allocation keeps a tenth forever yours, satisfies
              creditors with a fifth, and lives within seven-tenths.
            </p>
            <div className="grid grid-cols-3 gap-1.5 text-center text-[10px]">
              <div className="rounded-md bg-emerald-500/10 py-1.5 text-emerald-400">
                Keep
              </div>
              <div className="rounded-md bg-amber-500/10 py-1.5 text-amber-400">
                Debt
              </div>
              <div className="rounded-md bg-slate-800 py-1.5 text-slate-300">
                Live
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    </aside>
  );
}
