"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  currentConfirmation,
  type ObservationConfirmation,
} from "@/lib/babylon/confirmed-meaning";
import { formatDiscreetCurrency } from "@/lib/babylon/discreet";
import {
  confirmPlaidObservationMeaning,
  listPlaidObservationConfirmations,
  listTeachablePlaidObservations,
  revokePlaidObservationMeaning,
} from "@/lib/babylon/plaid-client";
import type { PlaidObservationPublic } from "@/lib/babylon/plaid-schema";
import { formatCurrency } from "@/lib/utils";
import type { BudgetTarget } from "@/types/babylon";

interface ObservationTeachingProps {
  enabled: boolean;
  budgetTargets: readonly BudgetTarget[];
  discreet: boolean;
}

function evidenceAmount(amount: number, discreet: boolean): string {
  const money = formatDiscreetCurrency(Math.abs(amount), discreet, formatCurrency);
  return amount < 0 ? `${money} in` : money;
}

function meaningLabel(
  confirmation: ObservationConfirmation | null,
  budgetTargets: readonly BudgetTarget[]
): string {
  if (!confirmation) return "Meaning unknown";
  const live = budgetTargets.find(
    (target) => target.id === confirmation.budgetTargetId
  );
  if (live) return live.categoryName;
  return confirmation.categoryName;
}

/**
 * Steward-opened teaching for one current posted observation.
 * Desktop Overview and phone Connections both mount this. It does not
 * prompt, notify, or place unknown observations into Attention.
 */
export function ObservationTeaching({
  enabled,
  budgetTargets,
  discreet,
}: ObservationTeachingProps) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [observations, setObservations] = useState<PlaidObservationPublic[]>([]);
  const [confirmations, setConfirmations] = useState<ObservationConfirmation[]>(
    []
  );
  const [selectedId, setSelectedId] = useState<string | null>(null);

  if (!enabled) return null;

  const selected =
    observations.find((observation) => observation.plaidTransactionId === selectedId) ??
    null;
  const selectedMeaning = selected
    ? currentConfirmation(confirmations, selected.userId, selected.plaidTransactionId)
    : null;
  const selectedLive = selectedMeaning
    ? budgetTargets.some((target) => target.id === selectedMeaning.budgetTargetId)
    : false;

  async function load() {
    setLoading(true);
    const [nextObservations, nextConfirmations] = await Promise.all([
      listTeachablePlaidObservations(),
      listPlaidObservationConfirmations(),
    ]);
    setObservations(nextObservations);
    setConfirmations(nextConfirmations);
    setLoading(false);
  }

  async function openTeaching() {
    const next = !open;
    setOpen(next);
    if (next) await load();
  }

  async function chooseCategory(budgetTargetId: string) {
    if (!selected || busy) return;
    setBusy(true);
    const result = await confirmPlaidObservationMeaning(
      selected.plaidTransactionId,
      budgetTargetId
    );
    if (result && result.status !== "rejected") await load();
    setBusy(false);
  }

  async function removeMeaning() {
    if (!selected || busy) return;
    setBusy(true);
    const result = await revokePlaidObservationMeaning(selected.plaidTransactionId);
    if (result && result.status === "revoked") await load();
    setBusy(false);
  }

  return (
    <section className="space-y-3" aria-label="Teach a transaction">
      <Button
        type="button"
        variant="outline"
        className="w-full"
        aria-expanded={open}
        onClick={() => void openTeaching()}
      >
        {open ? "Hide teaching" : "Teach a transaction"}
      </Button>
      {open && (
        <div className="space-y-3 rounded-xl border border-slate-800 bg-slate-900/60 p-3">
          <p className="text-sm text-slate-300">
            Tell Wealth Engine what one posted transaction meant. This remembers
            your confirmation. It does not decide the next one.
          </p>
          {loading && <p className="text-sm text-slate-500">Loading transactions…</p>}
          {!loading && observations.length === 0 && (
            <p className="text-sm text-slate-500">
              No posted transactions are waiting to be taught.
            </p>
          )}
          {!loading && observations.length > 0 && (
            <ul className="max-h-80 space-y-2 overflow-y-auto">
              {observations.map((observation) => {
                const meaning = currentConfirmation(
                  confirmations,
                  observation.userId,
                  observation.plaidTransactionId
                );
                const label = meaningLabel(meaning, budgetTargets);
                const chosen = observation.plaidTransactionId === selectedId;
                return (
                  <li key={observation.id}>
                    <button
                      type="button"
                      className={`w-full rounded-lg border px-3 py-2 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/60 ${
                        chosen
                          ? "border-emerald-700 bg-emerald-950/40"
                          : "border-slate-800 hover:border-slate-700"
                      }`}
                      aria-pressed={chosen}
                      onClick={() => setSelectedId(observation.plaidTransactionId)}
                    >
                      <span className="block text-sm text-slate-100">
                        {evidenceAmount(observation.amount, discreet)} · {observation.name}
                      </span>
                      <span className="block text-xs text-slate-500">
                        {observation.date}
                        {observation.category ? ` · ${observation.category}` : ""}
                        {" · "}
                        {meaning ? label : "Meaning unknown"}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
          {selected && (
            <div className="space-y-2">
              <p className="text-sm text-slate-200">
                {selectedMeaning
                  ? selectedLive
                    ? `You confirmed this as ${meaningLabel(selectedMeaning, budgetTargets)}.`
                    : `You confirmed this as ${selectedMeaning.categoryName}. That category is no longer in the vault.`
                  : "Meaning unknown"}
              </p>
              {budgetTargets.length === 0 ? (
                <p className="text-sm text-slate-500">
                  Add a spending category in the budget before teaching this transaction.
                </p>
              ) : (
                <div className="flex flex-wrap gap-2">
                  {budgetTargets.map((target) => (
                    <Button
                      key={target.id}
                      type="button"
                      size="sm"
                      variant={
                        selectedMeaning?.budgetTargetId === target.id
                          ? "default"
                          : "secondary"
                      }
                      disabled={busy}
                      onClick={() => void chooseCategory(target.id)}
                    >
                      {target.categoryName}
                    </Button>
                  ))}
                </div>
              )}
              {selectedMeaning && (
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  disabled={busy}
                  onClick={() => void removeMeaning()}
                >
                  Remove this meaning
                </Button>
              )}
            </div>
          )}
        </div>
      )}
    </section>
  );
}
