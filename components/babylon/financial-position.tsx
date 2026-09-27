"use client";

import { useEffect, useState, type FormEvent } from "react";
import { Landmark, Pencil, Plus, Trash2 } from "lucide-react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  formatObservedAt,
  formatSignedDifference,
  ObservedBalanceUpdates,
  UPDATE_BALANCE_LABEL,
} from "@/components/babylon/observed-balance-update";
import {
  depositoryChoiceLabel,
  describeAccountBalance,
  observedBalanceUpdate,
  unassociatedDepositoryAccountIds,
  type AccountBalanceView,
} from "@/lib/babylon/balance-observation";
import {
  BALANCE_EVIDENCE_UNAVAILABLE_LABEL,
  presentAccountObservation,
  type BalanceObservationLoad,
} from "@/lib/babylon/balance-evidence-load";
import { ACCOUNT_KIND_LABELS } from "@/lib/babylon/constants";
import { formatDiscreetCurrency } from "@/lib/babylon/discreet";
import { todayIso } from "@/lib/babylon/engine";
import type { PlaidItemPublic } from "@/lib/babylon/plaid-schema";
import {
  FINANCIAL_ACCOUNT_KINDS,
  formatAsOfLabel,
} from "@/lib/babylon/financial-position";
import { formatCurrency } from "@/lib/utils";
import type { AvailableAfterPlannedNeeds } from "@/lib/babylon/available-after-planned-needs";
import type {
  FinancialAccount,
  FinancialAccountInput,
  FinancialAccountKind,
} from "@/types/babylon";

export interface FinancialPositionBalanceObservation {
  load: BalanceObservationLoad;
  institutions: readonly Pick<PlaidItemPublic, "id" | "institutionName">[];
  onAssociate: (financialAccountId: string, plaidAccountId: string) => Promise<boolean>;
  onRemoveAssociation: (financialAccountId: string) => Promise<boolean>;
}

interface FinancialPositionProps {
  accounts: FinancialAccount[];
  moneyAvailable: number;
  openingWealthBuilding: number;
  openingEmergencyFund: number;
  protectedMoney: number;
  protectedOverAvailable: boolean;
  upcomingNeeds: number;
  availableAfterPlannedNeeds: AvailableAfterPlannedNeeds;
  discreet?: boolean;
  /** Full keeps the orientation readings. Manage keeps account and designation editing. */
  presentation?: "full" | "manage";
  onAddAccount: (input: FinancialAccountInput) => boolean;
  onUpdateAccount: (id: string, input: FinancialAccountInput) => boolean;
  onRemoveAccount: (id: string) => void;
  onUpdateProtected: (wealth: number, emergency: number) => string | null;
  onEditorOpenChange?: (open: boolean) => void;
  /** Present when the signed-in steward can see cached bank balances. */
  balanceObservation?: FinancialPositionBalanceObservation;
}

const EMPTY_DRAFT = {
  name: "",
  kind: "checking" as FinancialAccountKind,
  balance: "",
  asOf: "",
};

function AccountObservation({
  account,
  balanceObservation,
  linkChoice,
  linking,
  liveFinancialAccountIds,
  money,
  onLinkChoice,
  onAssociate,
  onRemoveAssociation,
  onAccept,
}: {
  account: FinancialAccount;
  balanceObservation: FinancialPositionProps["balanceObservation"];
  linkChoice: string | undefined;
  linking: boolean;
  liveFinancialAccountIds: readonly string[];
  money: (value: number) => string;
  onLinkChoice: (plaidAccountId: string) => void;
  onAssociate: () => void;
  onRemoveAssociation: () => void;
  onAccept: () => void;
}) {
  if (!balanceObservation) return null;
  const presentation = presentAccountObservation({
    account,
    load: balanceObservation.load,
  });
  if (presentation.status === "hidden") return null;
  if (presentation.status === "unavailable") {
    return (
      <div className="basis-full space-y-2">
        <p className="text-[11px] leading-relaxed text-slate-500">
          {BALANCE_EVIDENCE_UNAVAILABLE_LABEL}
        </p>
        {presentation.observedAt !== null && presentation.currentCents !== null ? (
          <p className="text-[11px] leading-relaxed text-slate-500">
            Observed {money(presentation.currentCents / 100)}. Stored{" "}
            {formatObservedAt(presentation.observedAt)}.
          </p>
        ) : null}
      </div>
    );
  }
  const evidence = presentation.evidence;
  const association =
    evidence.associations.find((row) => row.financialAccountId === account.id) ??
    null;
  const plaidAccount = association
    ? evidence.plaidAccounts.find(
        (row) => row.plaidAccountId === association.plaidAccountId
      ) ?? null
    : null;
  const observation = association
    ? evidence.observations.find(
        (row) => row.plaidAccountId === association.plaidAccountId
      ) ?? null
    : null;
  const view: AccountBalanceView = describeAccountBalance({
    account,
    associatedPlaidAccountId: association?.plaidAccountId ?? null,
    accountType: plaidAccount?.accountType ?? null,
    subtype: plaidAccount?.subtype ?? null,
    observation,
  });
  if (view.status === "hidden") return null;

  const ownerId =
    evidence.plaidAccounts[0]?.userId ??
    evidence.associations[0]?.userId ??
    evidence.observations[0]?.userId ??
    "";
  const choiceIds =
    view.status === "unlinked"
      ? unassociatedDepositoryAccountIds({
          userId: ownerId,
          plaidAccounts: evidence.plaidAccounts,
          associations: evidence.associations,
          liveFinancialAccountIds,
        })
      : [];
  const institutions = new Map(
    balanceObservation.institutions.map((item) => [item.id, item.institutionName])
  );

  return (
    <div className="basis-full space-y-2">
      {view.status === "unlinked" ? (
        choiceIds.length === 0 ? (
          <p className="text-[11px] leading-relaxed text-slate-500">
            No unlinked checking or savings account is available.
          </p>
        ) : (
          <div className="flex flex-wrap items-center gap-2">
            <Select value={linkChoice} onValueChange={onLinkChoice}>
              <SelectTrigger
                className="h-8 w-full max-w-xs text-xs"
                aria-label={`Link ${account.name}`}
              >
                <SelectValue placeholder="Choose account" />
              </SelectTrigger>
              <SelectContent>
                {choiceIds.map((plaidAccountId) => {
                  const choice = evidence.plaidAccounts.find(
                    (row) => row.plaidAccountId === plaidAccountId
                  );
                  if (!choice) return null;
                  return (
                    <SelectItem key={plaidAccountId} value={plaidAccountId}>
                      {depositoryChoiceLabel({
                        name: choice.name,
                        mask: choice.mask,
                        subtype: choice.subtype,
                        institutionName: institutions.get(choice.plaidItemId) ?? null,
                      })}
                    </SelectItem>
                  );
                })}
              </SelectContent>
            </Select>
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={!linkChoice || linking}
              onClick={onAssociate}
            >
              Associate
            </Button>
          </div>
        )
      ) : null}
      {view.status === "unknown" ? (
        <p className="text-[11px] leading-relaxed text-slate-500">
          Observed balance is unknown.
        </p>
      ) : null}
      {view.status === "match" ? (
        <p className="text-[11px] leading-relaxed text-slate-500">
          Observed {money(view.currentCents / 100)}. Stored {formatObservedAt(view.observedAt)}.
        </p>
      ) : null}
      {view.status === "differs" ? (
        <div className="flex flex-wrap items-center gap-2">
          <p className="text-[11px] leading-relaxed text-slate-400">
            Observed {money(view.currentCents / 100)}. Stored{" "}
            {formatObservedAt(view.observedAt)}. Difference{" "}
            {formatSignedDifference(view.differenceCents, money)}.
          </p>
          {view.canAccept ? (
            <Button
              type="button"
              size="sm"
              onClick={onAccept}
              aria-label={`Update ${account.name} balance`}
            >
              {UPDATE_BALANCE_LABEL}
            </Button>
          ) : (
            <p className="text-[11px] leading-relaxed text-amber-200">
              This observed balance is negative, so it cannot be accepted.
            </p>
          )}
        </div>
      ) : null}
      {view.status !== "unlinked" ? (
        <Button
          type="button"
          size="sm"
          variant="ghost"
          className="h-7 px-2 text-[11px] text-slate-500"
          disabled={linking}
          onClick={onRemoveAssociation}
        >
          Remove link
        </Button>
      ) : null}
    </div>
  );
}

export function FinancialPosition({
  accounts,
  moneyAvailable,
  openingWealthBuilding,
  openingEmergencyFund,
  protectedMoney,
  protectedOverAvailable,
  upcomingNeeds,
  availableAfterPlannedNeeds,
  discreet = false,
  presentation = "full",
  onAddAccount,
  onUpdateAccount,
  onRemoveAccount,
  onUpdateProtected,
  onEditorOpenChange,
  balanceObservation,
}: FinancialPositionProps) {
  const money = (value: number) =>
    formatDiscreetCurrency(value, discreet, formatCurrency);

  const [editorOpen, setEditorOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState(EMPTY_DRAFT);
  const [formError, setFormError] = useState<string | null>(null);
  const [pendingRemove, setPendingRemove] = useState<FinancialAccount | null>(
    null
  );
  const [linkChoice, setLinkChoice] = useState<Record<string, string>>({});
  const [linkingId, setLinkingId] = useState<string | null>(null);
  const [protectedOpen, setProtectedOpen] = useState(false);
  const [wealthDraft, setWealthDraft] = useState("");
  const [emergencyDraft, setEmergencyDraft] = useState("");
  const [protectedError, setProtectedError] = useState<string | null>(null);

  useEffect(() => {
    onEditorOpenChange?.(
      editorOpen || pendingRemove !== null || protectedOpen
    );
  }, [editorOpen, pendingRemove, protectedOpen, onEditorOpenChange]);

  const openAdd = () => {
    setEditingId(null);
    setDraft({ ...EMPTY_DRAFT, asOf: todayIso() });
    setFormError(null);
    setEditorOpen(true);
  };

  const openEdit = (account: FinancialAccount) => {
    setEditingId(account.id);
    setDraft({
      name: account.name,
      kind: account.kind,
      balance: String(account.balance),
      asOf: account.asOf,
    });
    setFormError(null);
    setEditorOpen(true);
  };

  const closeEditor = () => {
    setEditorOpen(false);
    setFormError(null);
  };

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault();
    const input: FinancialAccountInput = {
      name: draft.name,
      kind: draft.kind,
      balance: Number.parseFloat(draft.balance),
      asOf: draft.asOf,
    };
    const ok = editingId
      ? onUpdateAccount(editingId, input)
      : onAddAccount(input);
    if (!ok) {
      setFormError("Enter a name, a balance of zero or more, and an updated date.");
      return;
    }
    closeEditor();
  };

  const openProtected = () => {
    setWealthDraft(String(openingWealthBuilding));
    setEmergencyDraft(String(openingEmergencyFund));
    setProtectedError(null);
    setProtectedOpen(true);
  };

  const handleProtectedSubmit = (event: FormEvent) => {
    event.preventDefault();
    const error = onUpdateProtected(
      Number.parseFloat(wealthDraft),
      Number.parseFloat(emergencyDraft)
    );
    if (error) {
      setProtectedError(error);
      return;
    }
    setProtectedOpen(false);
    setProtectedError(null);
  };

  const accountList =
    accounts.length === 0 ? (
      <p className="text-sm text-slate-500">No accounts yet.</p>
    ) : (
      <ul className="divide-y divide-slate-800/80 rounded-lg border border-slate-800/80">
        {accounts.map((account) => (
          <li
            key={account.id}
            className="flex flex-wrap items-center gap-3 px-3 py-3 sm:px-4"
          >
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium text-slate-100">
                {account.name}
              </p>
              <p className="text-[11px] text-slate-500">
                {ACCOUNT_KIND_LABELS[account.kind]}
                {" · "}
                Updated {formatAsOfLabel(account.asOf)}
              </p>
            </div>
            <p className="font-[family-name:var(--font-display)] text-lg font-semibold tabular-nums text-slate-100">
              {money(account.balance)}
            </p>
            <div className="flex items-center gap-1">
              <Button
                type="button"
                variant="ghost"
                size="icon"
                onClick={() => openEdit(account)}
                aria-label={`Edit Account ${account.name}`}
              >
                <Pencil className="h-3.5 w-3.5" aria-hidden="true" />
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="text-slate-500 hover:text-rose-400"
                onClick={() => setPendingRemove(account)}
                aria-label={`Remove Account ${account.name}`}
              >
                <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
              </Button>
            </div>
            <AccountObservation
              account={account}
              balanceObservation={balanceObservation}
              linkChoice={linkChoice[account.id]}
              linking={linkingId === account.id}
              liveFinancialAccountIds={accounts.map((row) => row.id)}
              money={money}
              onLinkChoice={(plaidAccountId) =>
                setLinkChoice((prev) => ({ ...prev, [account.id]: plaidAccountId }))
              }
              onAssociate={async () => {
                const plaidAccountId = linkChoice[account.id];
                if (!plaidAccountId || !balanceObservation || linkingId) return;
                setLinkingId(account.id);
                const ok = await balanceObservation.onAssociate(
                  account.id,
                  plaidAccountId
                );
                if (ok) {
                  setLinkChoice((prev) => {
                    const next = { ...prev };
                    delete next[account.id];
                    return next;
                  });
                }
                setLinkingId(null);
              }}
              onRemoveAssociation={async () => {
                if (!balanceObservation || linkingId) return;
                setLinkingId(account.id);
                await balanceObservation.onRemoveAssociation(account.id);
                setLinkingId(null);
              }}
              onAccept={() => {
                if (!balanceObservation) return;
                if (balanceObservation.load.status !== "ready") return;
                const ready = balanceObservation.load.evidence;
                const accepted = observedBalanceUpdate({
                  account,
                  associations: ready.associations,
                  plaidAccounts: ready.plaidAccounts,
                  observations: ready.observations,
                  today: todayIso(),
                });
                if (!accepted) return;
                onUpdateAccount(account.id, accepted);
              }}
            />
          </li>
        ))}
      </ul>
    );

  return (
    <section aria-label="Financial Position" className="animate-fade-up">
      <Card className="border-slate-800/80">
        <CardContent className="space-y-4 p-4 sm:p-5">
          {presentation === "full" ? (
          <>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-500">
                <Landmark className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                Financial Position
              </p>
              <p className="mt-2 text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-500">
                Money Available
              </p>
              <p className="mt-1 font-[family-name:var(--font-display)] text-3xl font-semibold tracking-tight text-slate-50 tabular-nums sm:text-4xl">
                {money(moneyAvailable)}
              </p>
              <p className="mt-2 max-w-xl text-xs leading-relaxed text-slate-500">
                Money you&apos;ve entered as currently available. This is
                separate from your Living Budget.
              </p>
            </div>
            <Button type="button" size="sm" onClick={openAdd}>
              <Plus className="h-3.5 w-3.5" aria-hidden="true" />
              Add Account
            </Button>
          </div>
          {balanceObservation ? (
            <ObservedBalanceUpdates
              accounts={accounts}
              load={balanceObservation.load}
              discreet={discreet}
              onUpdateAccount={onUpdateAccount}
            />
          ) : null}
          </>
          ) : (
          <div className="flex items-center justify-between gap-3">
            <h3 className="text-sm font-medium text-slate-100">Accounts</h3>
            <Button type="button" size="sm" onClick={openAdd}>
              <Plus className="h-3.5 w-3.5" aria-hidden="true" />
              Add Account
            </Button>
          </div>
          )}

          {presentation === "manage" ? accountList : null}

          <div className="rounded-lg border border-slate-800/80 px-3 py-3 sm:px-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-500">
                  Protected Money
                </p>
                <p className="mt-1 font-[family-name:var(--font-display)] text-xl font-semibold tabular-nums text-slate-100">
                  {money(protectedMoney)}
                </p>
              </div>
              <Button type="button" size="sm" variant="outline" onClick={openProtected}>
                Edit
              </Button>
            </div>
            <p className="mt-2 text-xs leading-relaxed text-slate-400">
              Existing Wealth Building {money(openingWealthBuilding)} · Existing
              Emergency Fund {money(openingEmergencyFund)}
            </p>
            <p className="mt-1 text-xs leading-relaxed text-slate-500">
              These amounts are already included in your account balances. They
              are not additional money.
            </p>
            {protectedOverAvailable ? (
              <p role="alert" className="mt-2 text-xs leading-relaxed text-amber-200">
                Protected designations exceed your current Money Available.
                Update your protected amounts or Financial Position.
              </p>
            ) : null}
          </div>

          {presentation === "full" ? (
          <div className="rounded-lg border border-slate-800/80 px-3 py-3 sm:px-4">
            <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-500">
              Available After Planned Needs
            </p>
            <p className="mt-1 font-[family-name:var(--font-display)] text-3xl font-semibold tracking-tight text-slate-50 tabular-nums sm:text-4xl">
              {money(availableAfterPlannedNeeds.availableAfterPlannedNeeds)}
            </p>
            <dl className="mt-3 space-y-1 text-xs text-slate-400">
              <div className="flex items-baseline justify-between gap-3">
                <dt>Money Available</dt>
                <dd className="tabular-nums text-slate-200">
                  {money(moneyAvailable)}
                </dd>
              </div>
              <div className="flex items-baseline justify-between gap-3">
                <dt>Protected Money</dt>
                <dd className="tabular-nums text-slate-200">
                  −{money(protectedMoney)}
                </dd>
              </div>
              <div className="flex items-baseline justify-between gap-3">
                <dt>Upcoming Needs</dt>
                <dd className="tabular-nums text-slate-200">
                  −{money(upcomingNeeds)}
                </dd>
              </div>
            </dl>
            {availableAfterPlannedNeeds.plannedNeedsShortfall > 0 ? (
              <p className="mt-3 text-xs leading-relaxed text-amber-200">
                Planned Needs Shortfall{" "}
                <span className="tabular-nums">
                  {money(availableAfterPlannedNeeds.plannedNeedsShortfall)}
                </span>
                . {money(availableAfterPlannedNeeds.plannedNeedsShortfall)} short
                of covering protected money and known Upcoming Needs.
              </p>
            ) : null}
            <p className="mt-3 text-xs leading-relaxed text-slate-500">
              This counts every known unpaid Need. It does not subtract Wants,
              your Living Budget, or allocations from past income. It is not a
              promise that the remainder is safe to spend.
            </p>
            <p className="mt-1 text-xs leading-relaxed text-slate-500">
              Financial Position is manual. After money leaves your accounts,
              update your account balances to keep this figure current.
            </p>
          </div>
          ) : null}

          {presentation === "full" ? accountList : null}
        </CardContent>
      </Card>

      <Dialog
        open={protectedOpen}
        onOpenChange={(open) => {
          setProtectedOpen(open);
          if (!open) setProtectedError(null);
        }}
      >
        <DialogContent className="sm:max-w-md">
          <form onSubmit={handleProtectedSubmit} className="space-y-4">
            <DialogHeader>
              <DialogTitle>Already Set Aside</DialogTitle>
              <DialogDescription>
                Money already designated for Wealth Building or the Emergency
                Fund before Wealth Engine tracked it. These amounts are already
                included in your account balances. They are not additional
                money.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-2">
              <Label htmlFor="existing-wealth">Existing Wealth Building</Label>
              <Input
                id="existing-wealth"
                type="number"
                min="0"
                step="0.01"
                inputMode="decimal"
                value={wealthDraft}
                onChange={(event) => setWealthDraft(event.target.value)}
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="existing-emergency">Existing Emergency Fund</Label>
              <Input
                id="existing-emergency"
                type="number"
                min="0"
                step="0.01"
                inputMode="decimal"
                value={emergencyDraft}
                onChange={(event) => setEmergencyDraft(event.target.value)}
                required
              />
            </div>
            {protectedError ? (
              <p role="alert" className="text-xs leading-relaxed text-amber-200">
                {protectedError}
              </p>
            ) : null}
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => setProtectedOpen(false)}
              >
                Cancel
              </Button>
              <Button type="submit">Save</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog
        open={editorOpen}
        onOpenChange={(open) => {
          if (!open) closeEditor();
          else setEditorOpen(true);
        }}
      >
        <DialogContent className="sm:max-w-md">
          <form onSubmit={handleSubmit} className="space-y-4">
            <DialogHeader>
              <DialogTitle>
                {editingId ? "Edit Account" : "Add Account"}
              </DialogTitle>
              <DialogDescription>
                A balance records money that already exists. It is not income.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-2">
              <Label htmlFor="account-name">Name</Label>
              <Input
                id="account-name"
                value={draft.name}
                onChange={(event) =>
                  setDraft((prev) => ({ ...prev, name: event.target.value }))
                }
                placeholder="e.g. Checking"
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="account-kind">Type</Label>
              <Select
                value={draft.kind}
                onValueChange={(value) =>
                  setDraft((prev) => ({
                    ...prev,
                    kind: value as FinancialAccountKind,
                  }))
                }
              >
                <SelectTrigger id="account-kind" aria-label="Account type">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {FINANCIAL_ACCOUNT_KINDS.map((kind) => (
                    <SelectItem key={kind} value={kind}>
                      {ACCOUNT_KIND_LABELS[kind]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="account-balance">Balance</Label>
                <Input
                  id="account-balance"
                  type="number"
                  min="0"
                  step="0.01"
                  inputMode="decimal"
                  value={draft.balance}
                  onChange={(event) =>
                    setDraft((prev) => ({
                      ...prev,
                      balance: event.target.value,
                    }))
                  }
                  required
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="account-as-of">Updated</Label>
                <Input
                  id="account-as-of"
                  type="date"
                  value={draft.asOf}
                  onChange={(event) =>
                    setDraft((prev) => ({ ...prev, asOf: event.target.value }))
                  }
                  required
                />
              </div>
            </div>
            {formError && (
              <p role="alert" className="text-xs text-rose-300">
                {formError}
              </p>
            )}
            <DialogFooter>
              <Button type="button" variant="outline" onClick={closeEditor}>
                Cancel
              </Button>
              <Button type="submit">
                {editingId ? "Save" : "Add Account"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <AlertDialog
        open={pendingRemove !== null}
        onOpenChange={(open) => {
          if (!open) setPendingRemove(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove Account</AlertDialogTitle>
            <AlertDialogDescription>
              Remove {pendingRemove?.name ?? "this account"} from Financial
              Position. This does not change income, expenses, or your Living
              Budget.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-rose-600 text-white shadow-sm hover:bg-rose-500 focus-visible:ring-rose-500/60"
              onClick={() => {
                if (!pendingRemove) return;
                const evidence =
                  balanceObservation?.load.status === "ready" ||
                  balanceObservation?.load.status === "unavailable"
                    ? balanceObservation.load.evidence
                    : null;
                const linked = evidence?.associations.some(
                  (row) => row.financialAccountId === pendingRemove.id
                );
                if (linked) {
                  void balanceObservation?.onRemoveAssociation(pendingRemove.id);
                }
                onRemoveAccount(pendingRemove.id);
                setPendingRemove(null);
              }}
            >
              Remove Account
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}
