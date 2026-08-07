"use client";

import { Landmark, Loader2, Plus } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface ConnectedBanksCardProps {
  connectedCount: number;
  isLoading?: boolean;
  launching?: boolean;
  isCloudSynced: boolean;
  className?: string;
  onConnect: () => void;
  onRequireAuth?: () => void;
}

function statusCopy(count: number, isCloudSynced: boolean): string {
  if (!isCloudSynced) return "Sign in to sync bank connections.";
  if (count <= 0) return "No accounts linked yet";
  if (count === 1) return "1 Bank Account Synced";
  return `${count} Bank Accounts Synced`;
}

/**
 * Command Deck quick-action — shows linked institution count and opens Plaid Link.
 */
export function ConnectedBanksCard({
  connectedCount,
  isLoading = false,
  launching = false,
  isCloudSynced,
  className,
  onConnect,
  onRequireAuth,
}: ConnectedBanksCardProps) {
  const handleClick = () => {
    if (!isCloudSynced) {
      onRequireAuth?.();
      return;
    }
    onConnect();
  };

  return (
    <Card
      className={cn(
        "border-slate-800 bg-slate-900/60 transition-colors hover:border-emerald-800/60",
        className
      )}
    >
      <CardContent className="flex items-center gap-4 p-5">
        <div className="rounded-xl bg-emerald-500/10 p-3 text-emerald-300">
          <Landmark className="h-5 w-5" aria-hidden="true" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-xs uppercase tracking-wider text-slate-500">
            Connected Bank Accounts
          </p>
          <p className="font-[family-name:var(--font-display)] text-lg font-semibold text-slate-50 sm:text-xl">
            {isLoading ? "Checking links…" : statusCopy(connectedCount, isCloudSynced)}
          </p>
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="shrink-0"
          onClick={handleClick}
          disabled={launching}
          aria-label={
            isCloudSynced ? "Link a new bank account" : "Sign in to link a bank"
          }
        >
          {launching ? (
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
          ) : (
            <Plus className="h-4 w-4" aria-hidden="true" />
          )}
          {isCloudSynced ? "Link Bank" : "Sign In"}
        </Button>
      </CardContent>
    </Card>
  );
}
