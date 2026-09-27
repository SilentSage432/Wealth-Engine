"use client";

import { Button } from "@/components/ui/button";
import {
  listActionableObservedBalances,
  observedBalanceUpdate,
  type AccountAssociationPublic,
  type BalanceObservationPublic,
} from "@/lib/babylon/balance-observation";
import { formatDiscreetCurrency } from "@/lib/babylon/discreet";
import { todayIso } from "@/lib/babylon/engine";
import type { PlaidAccountPublic } from "@/lib/babylon/plaid-schema";
import { formatCurrency } from "@/lib/utils";
import type { FinancialAccount, FinancialAccountInput } from "@/types/babylon";

/** Same action as Financial Position Accept. This is not a Plaid sync. */
export const UPDATE_BALANCE_LABEL = "Update balance";

export function formatObservedAt(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "time unknown";
  return date.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export function formatSignedDifference(
  cents: number,
  money: (value: number) => string
): string {
  const amount = money(Math.abs(cents) / 100);
  if (cents > 0) return `+${amount}`;
  if (cents < 0) return `−${amount}`;
  return amount;
}

/**
 * Eligible observed differences, directly under Money Available.
 * Renders nothing unless the existing Accept action is available.
 */
export function ObservedBalanceUpdates({
  accounts,
  enabled,
  settled,
  plaidAccounts,
  observations,
  associations,
  discreet = false,
  onUpdateAccount,
}: {
  accounts: readonly FinancialAccount[];
  enabled: boolean;
  settled: boolean;
  plaidAccounts: readonly PlaidAccountPublic[];
  observations: readonly BalanceObservationPublic[];
  associations: readonly AccountAssociationPublic[];
  discreet?: boolean;
  onUpdateAccount: (id: string, input: FinancialAccountInput) => boolean;
}) {
  const rows = listActionableObservedBalances({
    accounts,
    enabled,
    settled,
    plaidAccounts,
    observations,
    associations,
  });
  if (rows.length === 0) return null;

  const money = (value: number) =>
    formatDiscreetCurrency(value, discreet, formatCurrency);

  return (
    <ul aria-label="Observed balance differences" className="mt-4 space-y-2">
      {rows.map((row) => (
        <li
          key={row.accountId}
          className="rounded-lg border border-slate-800/80 px-3 py-3"
        >
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="min-w-0 text-sm font-medium text-slate-100">
              {row.accountName}
            </p>
            <Button
              type="button"
              size="sm"
              aria-label={`Update ${row.accountName} balance`}
              onClick={() => {
                const account = accounts.find((item) => item.id === row.accountId);
                if (!account) return;
                const accepted = observedBalanceUpdate({
                  account,
                  associations,
                  plaidAccounts,
                  observations,
                  today: todayIso(),
                });
                if (!accepted) return;
                onUpdateAccount(account.id, accepted);
              }}
            >
              {UPDATE_BALANCE_LABEL}
            </Button>
          </div>
          <p className="mt-1 text-[11px] leading-relaxed text-slate-400">
            Recorded {money(row.recordedBalance)}. Observed{" "}
            {money(row.currentCents / 100)}. Stored {formatObservedAt(row.observedAt)}.
            Difference {formatSignedDifference(row.differenceCents, money)}.
          </p>
        </li>
      ))}
    </ul>
  );
}
