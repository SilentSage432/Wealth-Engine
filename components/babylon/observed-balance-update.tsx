"use client";

import { Button } from "@/components/ui/button";
import { observedBalanceUpdate } from "@/lib/babylon/balance-observation";
import {
  actionableObservedBalancesForLoad,
  BALANCE_EVIDENCE_UNAVAILABLE_LABEL,
  retainedObservedBalanceRows,
  type BalanceObservationLoad,
} from "@/lib/babylon/balance-evidence-load";
import { formatDiscreetCurrency } from "@/lib/babylon/discreet";
import { todayIso } from "@/lib/babylon/engine";
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
  load,
  discreet = false,
  onUpdateAccount,
}: {
  accounts: readonly FinancialAccount[];
  load: BalanceObservationLoad;
  discreet?: boolean;
  onUpdateAccount: (id: string, input: FinancialAccountInput) => boolean;
}) {
  const money = (value: number) =>
    formatDiscreetCurrency(value, discreet, formatCurrency);

  if (load.status === "unavailable") {
    const retained = retainedObservedBalanceRows({ accounts, load });
    if (retained.length === 0) return null;
    return (
      <ul aria-label="Observed balance differences" className="mt-4 space-y-2">
        {retained.map((row) => (
          <li
            key={row.accountId}
            className="rounded-lg border border-slate-800/80 px-3 py-3"
          >
            <p className="min-w-0 text-sm font-medium text-slate-100">
              {row.accountName}
            </p>
            <p className="mt-1 text-[11px] leading-relaxed text-slate-500">
              {BALANCE_EVIDENCE_UNAVAILABLE_LABEL}
            </p>
            <p className="mt-1 text-[11px] leading-relaxed text-slate-400">
              Observed {money(row.currentCents / 100)}. Stored{" "}
              {formatObservedAt(row.observedAt)}.
            </p>
          </li>
        ))}
      </ul>
    );
  }

  const rows = actionableObservedBalancesForLoad({ accounts, load });
  if (rows.length === 0 || load.status !== "ready") return null;
  const evidence = load.evidence;

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
                  associations: evidence.associations,
                  plaidAccounts: evidence.plaidAccounts,
                  observations: evidence.observations,
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
