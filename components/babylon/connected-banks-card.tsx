"use client";

import { Landmark } from "lucide-react";
import { OverviewDisclosure } from "@/components/babylon/overview-disclosure";
import { Card, CardContent } from "@/components/ui/card";
import { PlaidLinkButton } from "@/components/babylon/plaid-link-button";
import { VaultErrorBoundary } from "@/components/babylon/vault-error-boundary";
import { emitVaultToast } from "@/lib/babylon/vault-toast";
import { cn } from "@/lib/utils";

export type ConnectionRepairItem = {
  itemId: string;
  institutionName: string;
};

interface ConnectedBanksCardProps {
  connectedCount: number;
  isLoading?: boolean;
  launching?: boolean;
  initializing?: boolean;
  isCloudSynced: boolean;
  className?: string;
  /** Full is the desktop card. Compact tightens the phone Connections row. */
  density?: "full" | "compact";
  /** Owned Items that need explicit Link update-mode repair. */
  repairs?: readonly ConnectionRepairItem[];
  onConnect?: () => void;
  onRepair?: (itemId: string) => void;
  onRequireAuth?: () => void;
  /**
   * Desktop Overview only. A signed-in healthy connection keeps the count
   * visible and starts Connect Bank closed. Repair, signed-out, loading, and
   * zero-bank states stay fully open.
   */
  disclosureWhenHealthy?: boolean;
}

function statusCopy(count: number, isCloudSynced: boolean): string {
  if (!isCloudSynced) return "Sign in to connect a bank.";
  if (count <= 0) return "No accounts linked yet";
  if (count === 1) return "1 bank connected";
  return `${count} banks connected`;
}

/**
 * Command Deck quick-action — shows linked institution count and opens Plaid Link.
 * Always mounts PlaidLinkButton; never swaps it off the DOM for auth / init states.
 */
export function ConnectedBanksCard({
  connectedCount,
  isLoading = false,
  launching = false,
  initializing = false,
  isCloudSynced,
  className,
  density = "full",
  repairs = [],
  onConnect,
  onRepair,
  onRequireAuth,
  disclosureWhenHealthy = false,
}: ConnectedBanksCardProps) {
  const handleClick = () => {
    if (!isCloudSynced) {
      onRequireAuth?.();
      return;
    }
    if (!onConnect || initializing) {
      emitVaultToast({
        tone: "info",
        message: "Initializing Plaid connection...",
        durationMs: 0,
      });
      return;
    }
    onConnect();
  };

  const connectButton = (
    <PlaidLinkButton
      variant="button"
      label={isCloudSynced ? "Connect Bank" : "Sign In"}
      launching={launching && repairs.length === 0}
      initializing={initializing}
      onClick={handleClick}
      className="shrink-0"
    />
  );

  const healthySummary =
    disclosureWhenHealthy &&
    isCloudSynced &&
    !isLoading &&
    repairs.length === 0 &&
    connectedCount > 0;

  if (healthySummary) {
    return (
      <VaultErrorBoundary compact>
        <Card
          className={cn(
            "border-slate-800 bg-slate-900/60 transition-colors hover:border-emerald-800/60",
            className
          )}
        >
          <CardContent className="p-0">
            <OverviewDisclosure
              regionId="connected-banks-actions"
              summary={
                <div className="flex items-center gap-3">
                  <div className="rounded-xl bg-emerald-500/10 p-3 text-emerald-300">
                    <Landmark className="h-5 w-5" aria-hidden="true" />
                  </div>
                  <div className="min-w-0">
                    <p className="text-xs uppercase tracking-wider text-slate-500">
                      Connected Bank Accounts
                    </p>
                    <p className="font-[family-name:var(--font-display)] text-lg font-semibold text-slate-50 sm:text-xl">
                      {statusCopy(connectedCount, isCloudSynced)}
                    </p>
                  </div>
                </div>
              }
            >
              <div className="px-4 pb-4">{connectButton}</div>
            </OverviewDisclosure>
          </CardContent>
        </Card>
      </VaultErrorBoundary>
    );
  }

  return (
    <VaultErrorBoundary compact>
      <Card
        className={cn(
          "border-slate-800 bg-slate-900/60 transition-colors hover:border-emerald-800/60",
          className
        )}
      >
        <CardContent
          className={cn(
            "flex flex-col gap-3",
            density === "compact" ? "p-3" : "gap-4 p-5"
          )}
        >
          <div className="flex flex-wrap items-center gap-3">
            <div
              className={cn(
                "rounded-xl bg-emerald-500/10 text-emerald-300",
                density === "compact" ? "p-2" : "p-3"
              )}
            >
              <Landmark className="h-5 w-5" aria-hidden="true" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-xs uppercase tracking-wider text-slate-500">
                Connected Bank Accounts
              </p>
              <p
                className={cn(
                  "font-[family-name:var(--font-display)] font-semibold text-slate-50",
                  density === "compact" ? "text-base" : "text-lg sm:text-xl"
                )}
              >
                {isLoading
                  ? "Checking links…"
                  : statusCopy(connectedCount, isCloudSynced)}
              </p>
            </div>
            {connectButton}
          </div>

          {isCloudSynced && repairs.length > 0 ? (
            <div
              className="space-y-2 rounded-lg border border-amber-900/50 bg-amber-950/30 px-3 py-2"
              role="status"
              aria-label="Bank connection needs attention"
            >
              <p className="text-sm font-medium text-amber-100">
                Bank connection needs attention
              </p>
              <p className="text-xs text-amber-100/80">
                Previously observed information may still show as cached until
                this connection is restored.
              </p>
              <ul className="space-y-2">
                {repairs.map((repair) => (
                  <li
                    key={repair.itemId}
                    className="flex flex-wrap items-center justify-between gap-2"
                  >
                    <span className="min-w-0 truncate text-sm text-slate-200">
                      {repair.institutionName}
                    </span>
                    <PlaidLinkButton
                      variant="button"
                      label="Reconnect bank"
                      launching={launching}
                      initializing={initializing}
                      onClick={() => onRepair?.(repair.itemId)}
                      className="shrink-0"
                    />
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </CardContent>
      </Card>
    </VaultErrorBoundary>
  );
}
