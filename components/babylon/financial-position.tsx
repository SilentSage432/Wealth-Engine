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
import { ACCOUNT_KIND_LABELS } from "@/lib/babylon/constants";
import { formatDiscreetCurrency } from "@/lib/babylon/discreet";
import { todayIso } from "@/lib/babylon/engine";
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
  onAddAccount: (input: FinancialAccountInput) => boolean;
  onUpdateAccount: (id: string, input: FinancialAccountInput) => boolean;
  onRemoveAccount: (id: string) => void;
  onUpdateProtected: (wealth: number, emergency: number) => string | null;
  onEditorOpenChange?: (open: boolean) => void;
}

const EMPTY_DRAFT = {
  name: "",
  kind: "checking" as FinancialAccountKind,
  balance: "",
  asOf: "",
};

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
  onAddAccount,
  onUpdateAccount,
  onRemoveAccount,
  onUpdateProtected,
  onEditorOpenChange,
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

  return (
    <section aria-label="Financial Position" className="animate-fade-up">
      <Card className="border-slate-800/80">
        <CardContent className="space-y-4 p-4 sm:p-5">
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

          {accounts.length === 0 ? (
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
                </li>
              ))}
            </ul>
          )}
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
                if (pendingRemove) onRemoveAccount(pendingRemove.id);
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
