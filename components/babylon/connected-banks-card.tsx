"use client";

import { Landmark } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { PlaidLinkButton } from "@/components/babylon/plaid-link-button";
import { VaultErrorBoundary } from "@/components/babylon/vault-error-boundary";
import { emitVaultToast } from "@/lib/babylon/vault-toast";
import { cn } from "@/lib/utils";

interface ConnectedBanksCardProps {
  connectedCount: number;
  isLoading?: boolean;
  launching?: boolean;
  initializing?: boolean;
  isCloudSynced: boolean;
  className?: string;
  /** Full is the desktop card. Compact tightens the phone Connections row. */
  density?: "full" | "compact";
  onConnect?: () => void;
  onRequireAuth?: () => void;
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
  onConnect,
  onRequireAuth,
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
            "flex flex-wrap items-center gap-3",
            density === "compact" ? "p-3" : "gap-4 p-5"
          )}
        >
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
          <PlaidLinkButton
            variant="button"
            label={isCloudSynced ? "Connect Bank" : "Sign In"}
            launching={launching}
            initializing={initializing}
            onClick={handleClick}
            className="shrink-0"
          />
        </CardContent>
      </Card>
    </VaultErrorBoundary>
  );
}
