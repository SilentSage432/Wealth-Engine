"use client";

import { useEffect, useState, type FormEvent } from "react";
import { Landmark, Pencil, Plus, Trash2 } from "lucide-react";
import { OverviewDisclosure } from "@/components/babylon/overview-disclosure";
import { PhoneMaintenanceDisclosure } from "@/components/babylon/phone-maintenance-disclosure";
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
  depositoryChoiceLabel,
  describeAccountBalance,
  unassociatedDepositoryAccountIds,
} from "@/lib/babylon/balance-observation";
import {
  BALANCE_EVIDENCE_UNAVAILABLE_LABEL,
  describeAccountEvidenceLine,
  describeMoneyAvailableEvidence,
  moneyAvailableEvidenceIsFreshExplanation,
  operationalAccountPosition,
  presentAccountObservation,
  type BalanceObservationLoad,
} from "@/lib/babylon/balance-evidence-load";
import { ACCOUNT_KIND_LABELS } from "@/lib/babylon/constants";
import { formatDiscreetCurrency } from "@/lib/babylon/discreet";
import type { PlaidItemPublic } from "@/lib/babylon/plaid-schema";
import {
  FINANCIAL_ACCOUNT_KINDS,
} from "@/lib/babylon/financial-position";
import {
  accountPurposeLabel,
  FINANCIAL_ACCOUNT_PURPOSES,
} from "@/lib/babylon/account-purpose";
import {
  accountDeployableBalance,
  hasRestrictionConflict,
  restrictedDeclared,
} from "@/lib/babylon/account-restriction";
import {
  ALREADY_SET_ASIDE_LABEL,
  AVAILABLE_AFTER_PLANNED_NEEDS_LABEL,
  AVAILABLE_TO_USE_LABEL,
  availableAfterPlannedNeedsExplain,
  availableToUseExplain,
  alreadySetAsideExplain,
  CURRENTLY_POSITIONED_HINT,
  deriveAvailableToUsePresentation,
  EMERGENCY_FUND_POSITIONED_LABEL,
  EXISTING_EMERGENCY_FUND_LABEL,
  EXISTING_WEALTH_BUILDING_LABEL,
  FINANCIAL_POSITION_HEADING,
  LIQUID_POSITION_LABEL,
  LIQUID_POSITION_SCOPE,
  plannedNeedsShortfallExplain,
  RECORDED_DEBT_LABEL,
  recordedDebtExplain,
  UNAVAILABLE_LABEL,
  unavailableExplain,
  UPCOMING_NEEDS_LABEL,
  WEALTH_BUILDING_POSITIONED_LABEL,
} from "@/lib/babylon/financial-position-composition";
import { formatCurrency } from "@/lib/utils";
import type { AvailableAfterPlannedNeeds } from "@/lib/babylon/available-after-planned-needs";
import type { FirstDesignationReconcileChoice } from "@/lib/babylon/account-purpose";
import type {
  FinancialAccount,
  FinancialAccountInput,
  FinancialAccountKind,
  FinancialAccountPurpose,
} from "@/types/babylon";

export interface FinancialPositionBalanceObservation {
  load: BalanceObservationLoad;
  institutions: readonly Pick<PlaidItemPublic, "id" | "institutionName">[];
  onAssociate: (financialAccountId: string, plaidAccountId: string) => Promise<boolean>;
  onRemoveAssociation: (financialAccountId: string) => Promise<boolean>;
}

type PurposeActionResult =
  | { status: "applied" }
  | {
      status: "needs_reconcile";
      purpose: FinancialAccountPurpose;
      opening: number;
      accountPosition: number;
    }
  | { status: "rejected"; reason: string };

type PurposeClearResult =
  | { status: "applied" }
  | {
      status: "needs_preserve_choice";
      accountPosition: number;
      purpose: FinancialAccountPurpose;
    }
  | { status: "rejected"; reason: string };

interface FinancialPositionProps {
  accounts: FinancialAccount[];
  moneyAvailable: number;
  /** Aggregate steward-unavailable effective total. */
  restrictedEffectiveTotal?: number;
  /** DeployablePosition for Available-to-use presentation. Derived, not persisted. */
  deployablePosition?: number;
  openingWealthBuilding: number;
  openingEmergencyFund: number;
  protectedMoney: number;
  wealthBuildingPosition: number;
  emergencyFundPosition: number;
  protectedOverAvailable: boolean;
  upcomingNeeds: number;
  availableAfterPlannedNeeds: AvailableAfterPlannedNeeds;
  /** False when the recurrence read cannot be composed. Figures stay unshown. */
  obligationsReadable?: boolean;
  /** Sum of recorded DebtEntry remaining balances. Sibling context only. */
  remainingDebt: number;
  discreet?: boolean;
  /** Full keeps the orientation readings. Manage keeps account and designation editing. */
  presentation?: "full" | "manage";
  /** Phone projection shows the position and hides account authorship. */
  readOnly?: boolean;
  onAddAccount?: (input: FinancialAccountInput) => boolean;
  onUpdateAccount?: (id: string, input: FinancialAccountInput) => boolean;
  onRemoveAccount?: (
    id: string,
    preserve?: "allow_drop" | "keep_as_existing" | "cancel"
  ) => PurposeClearResult | { status: "applied" };
  onSetAccountPurpose?: (
    accountId: string,
    purpose: FinancialAccountPurpose,
    reconcile?: FirstDesignationReconcileChoice | "cancel"
  ) => PurposeActionResult;
  onClearAccountPurpose?: (
    accountId: string,
    preserve?: "allow_drop" | "keep_as_existing" | "cancel"
  ) => PurposeClearResult;
  onUpdateProtected?: (wealth: number, emergency: number) => string | null;
  onEditorOpenChange?: (open: boolean) => void;
  /** Default for a new account as-of date. Blank when financial today is unknown. */
  financialToday?: string | null;
  /** Present when the signed-in steward can see cached bank balances. */
  balanceObservation?: FinancialPositionBalanceObservation;
}

const HOW_THIS_IS_CALCULATED_LABEL = "How this is calculated";
const RESTRICTION_CONFLICT_COPY =
  "The declared unavailable amount is greater than the current account position. Unavailable money is still owned; available from this account is zero until the amounts agree.";
const UNKNOWN_BALANCE_COPY = "Observed balance is unknown.";
const NEGATIVE_READING_COPY =
  "This stored reading is negative, so the declared balance is used.";

const FINANCIAL_POSITION_CALCULATION_IDS = [
  "financial-position-hero-calculation",
  "financial-position-set-aside-calculation",
  "financial-position-aapn-derivation",
  "financial-position-aapn-calculation",
  "financial-position-debt-calculation",
].join(" ");

const EMPTY_DRAFT = {
  name: "",
  kind: "checking" as FinancialAccountKind,
  balance: "",
  asOf: "",
  restrictedAmount: "",
};

function readAccountObservation(
  account: FinancialAccount,
  balanceObservation: FinancialPositionProps["balanceObservation"]
) {
  if (!balanceObservation) return null;
  const presentation = presentAccountObservation({
    account,
    load: balanceObservation.load,
  });
  if (presentation.status === "hidden") return null;
  if (presentation.status === "unavailable") {
    return { status: "unavailable" as const };
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
  const view = describeAccountBalance({
    account,
    associatedPlaidAccountId: association?.plaidAccountId ?? null,
    accountType: plaidAccount?.accountType ?? null,
    subtype: plaidAccount?.subtype ?? null,
    observation,
  });
  return {
    status: "ready" as const,
    evidence,
    view,
  };
}

function AccountObservation({
  account,
  balanceObservation,
  linkChoice,
  linking,
  liveFinancialAccountIds,
  onLinkChoice,
  onAssociate,
  onRemoveAssociation,
}: {
  account: FinancialAccount;
  balanceObservation: FinancialPositionProps["balanceObservation"];
  linkChoice: string | undefined;
  linking: boolean;
  liveFinancialAccountIds: readonly string[];
  onLinkChoice: (plaidAccountId: string) => void;
  onAssociate: () => void;
  onRemoveAssociation: () => void;
}) {
  if (!balanceObservation) return null;
  const model = readAccountObservation(account, balanceObservation);
  if (!model) return null;
  if (model.status === "unavailable") {
    return (
      <div className="basis-full space-y-2">
        <p className="text-[11px] leading-relaxed text-slate-500">
          {BALANCE_EVIDENCE_UNAVAILABLE_LABEL}
        </p>
      </div>
    );
  }
  const { evidence, view } = model;
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
              {UNKNOWN_BALANCE_COPY}
            </p>
          ) : null}
          {view.status === "differs" && !view.canAccept ? (
            <p className="text-[11px] leading-relaxed text-amber-200">
              {NEGATIVE_READING_COPY}
            </p>
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
  restrictedEffectiveTotal = 0,
  deployablePosition,
  openingWealthBuilding,
  openingEmergencyFund,
  protectedMoney,
  wealthBuildingPosition,
  emergencyFundPosition,
  protectedOverAvailable,
  upcomingNeeds,
  availableAfterPlannedNeeds,
  obligationsReadable = true,
  remainingDebt,
  discreet = false,
  presentation = "full",
  readOnly = false,
  onAddAccount,
  onUpdateAccount,
  onRemoveAccount,
  onSetAccountPurpose,
  onClearAccountPurpose,
  onUpdateProtected,
  onEditorOpenChange,
  financialToday = null,
  balanceObservation,
}: FinancialPositionProps) {
  const money = (value: number) =>
    formatDiscreetCurrency(value, discreet, formatCurrency);
  const obligationFigure = (value: number) =>
    obligationsReadable ? money(value) : "Unknown";
  const availableToUsePresentation = deriveAvailableToUsePresentation({
    moneyAvailable,
    restrictedEffectiveTotal,
    deployablePosition,
  });

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
  const [purposeError, setPurposeError] = useState<string | null>(null);
  const [calculationOpen, setCalculationOpen] = useState(false);
  const [reconcile, setReconcile] = useState<{
    accountId: string;
    purpose: FinancialAccountPurpose;
    opening: number;
    accountPosition: number;
  } | null>(null);
  const [preserveChoice, setPreserveChoice] = useState<{
    kind: "clear" | "remove";
    account: FinancialAccount;
    accountPosition: number;
    purpose: FinancialAccountPurpose;
  } | null>(null);
  const [changeConfirm, setChangeConfirm] = useState<{
    accountId: string;
    from: FinancialAccountPurpose;
    to: FinancialAccountPurpose;
  } | null>(null);

  useEffect(() => {
    onEditorOpenChange?.(
      editorOpen ||
        pendingRemove !== null ||
        protectedOpen ||
        reconcile !== null ||
        preserveChoice !== null ||
        changeConfirm !== null
    );
  }, [
    editorOpen,
    pendingRemove,
    protectedOpen,
    reconcile,
    preserveChoice,
    changeConfirm,
    onEditorOpenChange,
  ]);

  const openAdd = () => {
    setEditingId(null);
    setDraft({ ...EMPTY_DRAFT, asOf: financialToday ?? "" });
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
      restrictedAmount:
        account.restrictedAmount !== undefined
          ? String(account.restrictedAmount)
          : "",
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
    if (readOnly || !onAddAccount || !onUpdateAccount) return;
    const restrictedRaw = draft.restrictedAmount.trim();
    const restrictedParsed =
      restrictedRaw === "" ? 0 : Number.parseFloat(restrictedRaw);
    const input: FinancialAccountInput = {
      name: draft.name,
      kind: draft.kind,
      balance: Number.parseFloat(draft.balance),
      asOf: draft.asOf,
      restrictedAmount: restrictedParsed,
    };
    const ok = editingId
      ? onUpdateAccount(editingId, input)
      : onAddAccount(input);
    if (!ok) {
      setFormError(
        "Enter a name, a balance of zero or more, an updated date, and unavailable of zero or more."
      );
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
    if (readOnly || !onUpdateProtected) return;
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

  const applyPurpose = (
    accountId: string,
    purpose: FinancialAccountPurpose,
    choice?: FirstDesignationReconcileChoice | "cancel"
  ) => {
    if (readOnly || !onSetAccountPurpose) return;
    const result = onSetAccountPurpose(accountId, purpose, choice);
    if (result.status === "needs_reconcile") {
      setReconcile({
        accountId,
        purpose: result.purpose,
        opening: result.opening,
        accountPosition: result.accountPosition,
      });
      return;
    }
    if (result.status === "rejected") {
      setPurposeError(result.reason);
      return;
    }
    setPurposeError(null);
    setReconcile(null);
    setChangeConfirm(null);
  };

  const requestPurpose = (
    account: FinancialAccount,
    purpose: FinancialAccountPurpose | "none"
  ) => {
    setPurposeError(null);
    if (purpose === "none") {
      if (account.purpose === undefined || readOnly || !onClearAccountPurpose) return;
      const result = onClearAccountPurpose(account.id);
      if (result.status === "needs_preserve_choice") {
        setPreserveChoice({
          kind: "clear",
          account,
          accountPosition: result.accountPosition,
          purpose: result.purpose,
        });
        return;
      }
      if (result.status === "rejected") {
        setPurposeError(result.reason);
      }
      return;
    }
    if (account.purpose && account.purpose !== purpose) {
      setChangeConfirm({
        accountId: account.id,
        from: account.purpose,
        to: purpose,
      });
      return;
    }
    applyPurpose(account.id, purpose);
  };

  const accountList =
    accounts.length === 0 ? (
      <p className="text-sm text-slate-500">No accounts yet.</p>
    ) : (
      <ul className="divide-y divide-slate-800/80 rounded-lg border border-slate-800/80">
        {accounts.map((account) => {
          const accountPosition = operationalAccountPosition({
            account,
            load: balanceObservation?.load,
          });
          const declaredUnavailable = restrictedDeclared(account);
          const accountAvailable = accountDeployableBalance(
            accountPosition.balance,
            declaredUnavailable
          );
          const restrictionConflict = hasRestrictionConflict(
            accountPosition.balance,
            declaredUnavailable
          );
          const showUnavailable = declaredUnavailable > 0;
          return (
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
                {describeAccountEvidenceLine({
                  position: accountPosition,
                  nowMs: Date.now(),
                })}
              </p>
              {account.purpose ? (
                <p className="mt-1 text-[11px] font-medium text-emerald-300/90">
                  {accountPurposeLabel(account.purpose)}
                </p>
              ) : null}
              {showUnavailable ? (
                <dl className="mt-2 space-y-0.5 text-[11px] text-slate-400">
                  <div className="flex items-baseline justify-between gap-3 max-w-xs">
                    <dt>Position</dt>
                    <dd className="tabular-nums text-slate-200">
                      {money(accountPosition.balance)}
                    </dd>
                  </div>
                  <div className="flex items-baseline justify-between gap-3 max-w-xs">
                    <dt>{UNAVAILABLE_LABEL}</dt>
                    <dd className="tabular-nums text-slate-200">
                      {money(declaredUnavailable)}
                    </dd>
                  </div>
                  <div className="flex items-baseline justify-between gap-3 max-w-xs">
                    <dt>Available</dt>
                    <dd className="tabular-nums text-slate-200">
                      {money(accountAvailable)}
                    </dd>
                  </div>
                </dl>
              ) : null}
              {restrictionConflict ? (
                <p
                  role="alert"
                  className="mt-2 max-w-xs text-[11px] leading-relaxed text-amber-200"
                >
                  {RESTRICTION_CONFLICT_COPY}
                </p>
              ) : null}
              {readOnly ? null : (
              <div className="mt-2 max-w-xs">
                <Select
                  value={account.purpose ?? "none"}
                  onValueChange={(value) =>
                    requestPurpose(
                      account,
                      value === "none"
                        ? "none"
                        : (value as FinancialAccountPurpose)
                    )
                  }
                >
                  <SelectTrigger
                    className="h-8 text-xs"
                    aria-label={`Purpose for ${account.name}`}
                  >
                    <SelectValue placeholder="No special purpose" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">No special purpose</SelectItem>
                    {FINANCIAL_ACCOUNT_PURPOSES.map((purpose) => (
                      <SelectItem key={purpose} value={purpose}>
                        {accountPurposeLabel(purpose)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              )}
            </div>
            <p className="font-[family-name:var(--font-display)] text-lg font-semibold tabular-nums text-slate-100">
              {money(accountPosition.balance)}
            </p>
            {readOnly ? null : (
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
            )}
            <AccountObservation
              account={account}
              balanceObservation={balanceObservation}
              linkChoice={linkChoice[account.id]}
              linking={linkingId === account.id}
              liveFinancialAccountIds={accounts.map((row) => row.id)}
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
            />
          </li>
          );
        })}
      </ul>
    );

  const editingAccount = editingId
    ? (accounts.find((account) => account.id === editingId) ?? null)
    : null;
  const editingDeclaresFallback = editingAccount
    ? operationalAccountPosition({
        account: editingAccount,
        load: balanceObservation?.load,
      }).source === "observed"
    : false;

  const evidenceInput = {
    load: balanceObservation?.load,
    positions: accounts.map((account) =>
      operationalAccountPosition({
        account,
        load: balanceObservation?.load,
      })
    ),
    nowMs: Date.now(),
  };
  const evidenceDescription = describeMoneyAvailableEvidence(evidenceInput);
  const freshEvidenceExplanation =
    moneyAvailableEvidenceIsFreshExplanation(evidenceInput);
  const accountNotices = accounts.flatMap((account) => {
          const notices: {
            key: string;
            name: string;
            text: string;
            tone: "alert" | "unknown" | "negative";
          }[] = [];
          const accountPosition = operationalAccountPosition({
            account,
            load: balanceObservation?.load,
          });
          if (
            hasRestrictionConflict(
              accountPosition.balance,
              restrictedDeclared(account)
            )
          ) {
            notices.push({
              key: `${account.id}-restriction`,
              name: account.name,
              text: RESTRICTION_CONFLICT_COPY,
              tone: "alert",
            });
          }
          const model = readAccountObservation(account, balanceObservation);
          if (model?.status === "ready" && model.view.status === "unknown") {
            notices.push({
              key: `${account.id}-unknown`,
              name: account.name,
              text: UNKNOWN_BALANCE_COPY,
              tone: "unknown",
            });
          }
          if (
            model?.status === "ready" &&
            model.view.status === "differs" &&
            !model.view.canAccept
          ) {
            notices.push({
              key: `${account.id}-negative`,
              name: account.name,
              text: NEGATIVE_READING_COPY,
              tone: "negative",
            });
          }
          return notices;
        });

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
                {FINANCIAL_POSITION_HEADING}
              </p>
              {availableToUsePresentation.heroKind === "available-to-use" ? (
                <>
                  <p
                    className="mt-2 text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-500"
                    data-position-hero="available-to-use"
                  >
                    {AVAILABLE_TO_USE_LABEL}
                  </p>
                  <p className="mt-1 font-[family-name:var(--font-display)] text-3xl font-semibold tracking-tight text-slate-50 tabular-nums sm:text-4xl">
                    {money(availableToUsePresentation.availableToUse)}
                  </p>
                  <dl
                    className="mt-3 space-y-1 text-xs text-slate-400"
                    data-position-support="owned-unavailable"
                  >
                    <div className="flex items-baseline justify-between gap-3 max-w-xs">
                      <dt>{LIQUID_POSITION_LABEL}</dt>
                      <dd className="tabular-nums text-slate-200">
                        {money(moneyAvailable)}
                      </dd>
                    </div>
                    <div className="flex items-baseline justify-between gap-3 max-w-xs">
                      <dt>{UNAVAILABLE_LABEL}</dt>
                      <dd className="tabular-nums text-slate-200">
                        {availableToUsePresentation.unavailableAsSubtraction
                          ? `−${money(restrictedEffectiveTotal)}`
                          : money(restrictedEffectiveTotal)}
                      </dd>
                    </div>
                  </dl>
                </>
              ) : (
                <>
                  <p
                    className="mt-2 text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-500"
                    data-position-hero="liquid-position"
                  >
                    {LIQUID_POSITION_LABEL}
                  </p>
                  <p className="mt-1 font-[family-name:var(--font-display)] text-3xl font-semibold tracking-tight text-slate-50 tabular-nums sm:text-4xl">
                    {money(moneyAvailable)}
                  </p>
                </>
              )}
              {freshEvidenceExplanation ? null : (
                <p className="mt-2 max-w-xl text-xs leading-relaxed text-slate-500">
                  {evidenceDescription}
                </p>
              )}
              {balanceObservation?.load.status === "unavailable" ? (
                <p className="mt-2 text-xs leading-relaxed text-slate-500">
                  {BALANCE_EVIDENCE_UNAVAILABLE_LABEL}
                </p>
              ) : null}
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="mt-3"
                aria-expanded={calculationOpen}
                aria-controls={FINANCIAL_POSITION_CALCULATION_IDS}
                onClick={() => setCalculationOpen((open) => !open)}
              >
                {HOW_THIS_IS_CALCULATED_LABEL}
              </Button>
              <div id="financial-position-hero-calculation" hidden={!calculationOpen}>
                {availableToUsePresentation.heroKind === "available-to-use" ? (
                  <>
                    <p className="mt-2 max-w-xl text-xs leading-relaxed text-slate-500">
                      {availableToUseExplain()}
                    </p>
                    <p className="mt-1 max-w-xl text-xs leading-relaxed text-slate-500">
                      {unavailableExplain(restrictedEffectiveTotal)}
                      {freshEvidenceExplanation ? <> {evidenceDescription}</> : null}{" "}
                      Separate from your Living Budget.
                    </p>
                  </>
                ) : (
                  <p className="mt-2 max-w-xl text-xs leading-relaxed text-slate-500">
                    {LIQUID_POSITION_SCOPE}{" "}
                    {freshEvidenceExplanation ? <>{evidenceDescription} </> : null}
                    Separate from your Living Budget.
                  </p>
                )}
              </div>
            </div>
            {readOnly ? null : (
            <Button type="button" size="sm" onClick={openAdd}>
              <Plus className="h-3.5 w-3.5" aria-hidden="true" />
              Add Account
            </Button>
            )}
          </div>
          </>
          ) : (
          <div className="flex items-center justify-between gap-3">
            <h3 className="text-sm font-medium text-slate-100">Accounts</h3>
            {readOnly ? null : (
            <Button type="button" size="sm" onClick={openAdd}>
              <Plus className="h-3.5 w-3.5" aria-hidden="true" />
              Add Account
            </Button>
            )}
          </div>
          )}

          {presentation === "manage" && accounts.length === 0 ? accountList : null}
          {presentation === "manage" && accounts.length > 0 ? (
            <>
              <PhoneMaintenanceDisclosure
                regionId="more-account-machinery"
                allowClosed={
                  linkingId === null &&
                  balanceObservation?.load.status !== "loading" &&
                  balanceObservation?.load.status !== "unavailable"
                }
                summary={
                  <span className="block">
                    <span className="block text-sm font-medium text-slate-100">
                      {accounts.length === 1
                        ? "1 account"
                        : `${accounts.length} accounts`}
                    </span>
                    {accounts.map((account) => {
                      const position = operationalAccountPosition({
                        account,
                        load: balanceObservation?.load,
                      });
                      return (
                        <span
                          key={account.id}
                          className="mt-1 block text-xs font-normal leading-relaxed text-slate-400"
                        >
                          <span className="text-slate-200">{account.name}</span>
                          {" · "}
                          <span className="tabular-nums text-slate-200">
                            {money(position.balance)}
                          </span>
                          {" · "}
                          {describeAccountEvidenceLine({
                            position,
                            nowMs: Date.now(),
                          })}
                        </span>
                      );
                    })}
                  </span>
                }
              >
                {accountList}
              </PhoneMaintenanceDisclosure>
              {accountNotices.length > 0 ? (
                <div className="space-y-2">
                  {accountNotices.map((notice) => (
                    <p
                      key={notice.key}
                      role={notice.tone === "alert" ? "alert" : undefined}
                      className={
                        notice.tone === "unknown"
                          ? "text-[11px] leading-relaxed text-slate-500"
                          : "text-[11px] leading-relaxed text-amber-200"
                      }
                    >
                      <span className="font-medium text-slate-100">
                        {notice.name}.
                      </span>{" "}
                      {notice.text}
                    </p>
                  ))}
                </div>
              ) : null}
            </>
          ) : null}

          <div className="rounded-lg border border-slate-800/80 px-3 py-3 sm:px-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-500">
                  {ALREADY_SET_ASIDE_LABEL}
                </p>
                <p className="mt-1 font-[family-name:var(--font-display)] text-xl font-semibold tabular-nums text-slate-100">
                  {money(protectedMoney)}
                </p>
              </div>
              {readOnly ? null : (
              <Button type="button" size="sm" variant="outline" onClick={openProtected}>
                Edit
              </Button>
              )}
            </div>
            <p className="mt-2 text-xs leading-relaxed text-slate-400">
              {EXISTING_WEALTH_BUILDING_LABEL} {money(openingWealthBuilding)} ·{" "}
              {EXISTING_EMERGENCY_FUND_LABEL} {money(openingEmergencyFund)}
            </p>
            {wealthBuildingPosition > 0 || emergencyFundPosition > 0 ? (
              <p className="mt-1 text-xs leading-relaxed text-slate-400">
                {WEALTH_BUILDING_POSITIONED_LABEL}{" "}
                <span className="tabular-nums">{money(wealthBuildingPosition)}</span>{" "}
                {CURRENTLY_POSITIONED_HINT}
                {" · "}
                {EMERGENCY_FUND_POSITIONED_LABEL}{" "}
                <span className="tabular-nums">{money(emergencyFundPosition)}</span>{" "}
                {CURRENTLY_POSITIONED_HINT}
              </p>
            ) : null}
            {presentation === "full" ? (
              <div
                id="financial-position-set-aside-calculation"
                hidden={!calculationOpen}
              >
                <p className="mt-1 text-xs leading-relaxed text-slate-500">
                  {alreadySetAsideExplain(protectedMoney)}
                </p>
              </div>
            ) : (
              <p className="mt-1 text-xs leading-relaxed text-slate-500">
                {alreadySetAsideExplain(protectedMoney)}
              </p>
            )}
            {purposeError ? (
              <p role="alert" className="mt-2 text-xs leading-relaxed text-amber-200">
                {purposeError}
              </p>
            ) : null}
            {protectedOverAvailable ? (
              <p role="alert" className="mt-2 text-xs leading-relaxed text-amber-200">
                Already-set-aside amounts exceed your current Liquid Position.
                Update those amounts or Financial Position.
              </p>
            ) : null}
          </div>

          {presentation === "full" ? (
          <div className="rounded-lg border border-slate-800/80 px-3 py-3 sm:px-4">
            <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-500">
              {AVAILABLE_AFTER_PLANNED_NEEDS_LABEL}
            </p>
            <p className="mt-1 font-[family-name:var(--font-display)] text-3xl font-semibold tracking-tight text-slate-50 tabular-nums sm:text-4xl">
              {obligationFigure(availableAfterPlannedNeeds.availableAfterPlannedNeeds)}
            </p>
            {calculationOpen ? null : (
              <div className="mt-3 flex items-baseline justify-between gap-3 text-xs text-slate-400">
                <span>{UPCOMING_NEEDS_LABEL}</span>
                <span className="tabular-nums text-slate-200">
                  {obligationFigure(upcomingNeeds)}
                </span>
              </div>
            )}
            <div
              id="financial-position-aapn-derivation"
              hidden={!calculationOpen}
            >
              <dl className="mt-3 space-y-1 text-xs text-slate-400">
                {availableToUsePresentation.showAvailableToUse ? (
                  <div className="flex items-baseline justify-between gap-3">
                    <dt>{AVAILABLE_TO_USE_LABEL}</dt>
                    <dd className="tabular-nums text-slate-200">
                      {money(availableToUsePresentation.availableToUse)}
                    </dd>
                  </div>
                ) : (
                  <div className="flex items-baseline justify-between gap-3">
                    <dt>{LIQUID_POSITION_LABEL}</dt>
                    <dd className="tabular-nums text-slate-200">
                      {money(moneyAvailable)}
                    </dd>
                  </div>
                )}
                <div className="flex items-baseline justify-between gap-3">
                  <dt>{ALREADY_SET_ASIDE_LABEL}</dt>
                  <dd className="tabular-nums text-slate-200">
                    {money(protectedMoney)}
                  </dd>
                </div>
                <div className="flex items-baseline justify-between gap-3">
                  <dt>{UPCOMING_NEEDS_LABEL}</dt>
                  <dd className="tabular-nums text-slate-200">
                    {obligationFigure(upcomingNeeds)}
                  </dd>
                </div>
              </dl>
            </div>
            {obligationsReadable && availableAfterPlannedNeeds.plannedNeedsShortfall > 0 ? (
              <p className="mt-3 text-xs leading-relaxed text-amber-200">
                Planned Needs Shortfall{" "}
                <span className="tabular-nums">
                  {money(availableAfterPlannedNeeds.plannedNeedsShortfall)}
                </span>{" "}
                {plannedNeedsShortfallExplain()}
              </p>
            ) : null}
            <div
              id="financial-position-aapn-calculation"
              hidden={!calculationOpen}
            >
              <p className="mt-3 text-xs leading-relaxed text-slate-500">
                {availableAfterPlannedNeedsExplain()}
              </p>
              <p className="mt-1 text-xs leading-relaxed text-slate-500">
                Liquid Position uses an observed eligible balance when Wealth
                Engine has one, and the balance you entered otherwise. It does
                not explain why a balance changed.
              </p>
            </div>
          </div>
          ) : null}

          {presentation === "full" && accounts.length === 0 ? accountList : null}
          {presentation === "full" && accounts.length > 0 ? (
            <div className="rounded-lg border border-slate-800/80">
              <OverviewDisclosure
                regionId="financial-position-accounts"
                summary={
                  <div>
                    <p className="text-sm font-medium text-slate-100">Accounts</p>
                    <p className="mt-1 text-xs text-slate-400">
                      {accounts.length === 1
                        ? "1 account"
                        : `${accounts.length} accounts`}
                      {" · "}
                      {LIQUID_POSITION_LABEL}{" "}
                      <span className="tabular-nums text-slate-200">
                        {money(moneyAvailable)}
                      </span>
                    </p>
                    {freshEvidenceExplanation ? null : (
                      <p className="mt-1 text-xs leading-relaxed text-slate-500">
                        {evidenceDescription}
                      </p>
                    )}
                  </div>
                }
              >
                {accountList}
              </OverviewDisclosure>
              {accountNotices.length > 0 ? (
                <div className="space-y-2 px-4 pb-3">
                  {accountNotices.map((notice) => (
                    <p
                      key={notice.key}
                      role={notice.tone === "alert" ? "alert" : undefined}
                      className={
                        notice.tone === "unknown"
                          ? "text-[11px] leading-relaxed text-slate-500"
                          : "text-[11px] leading-relaxed text-amber-200"
                      }
                    >
                      <span className="font-medium text-slate-100">
                        {notice.name}.
                      </span>{" "}
                      {notice.text}
                    </p>
                  ))}
                </div>
              ) : null}
            </div>
          ) : null}

          {presentation === "full" ? (
            <div className="rounded-lg border border-slate-800/80 px-3 py-3 sm:px-4">
              <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-500">
                {RECORDED_DEBT_LABEL}
              </p>
              <p className="mt-1 font-[family-name:var(--font-display)] text-xl font-semibold tabular-nums text-slate-100">
                {money(remainingDebt)}
              </p>
              <div id="financial-position-debt-calculation" hidden={!calculationOpen}>
                <p className="mt-2 text-xs leading-relaxed text-slate-500">
                  {recordedDebtExplain(remainingDebt)}
                </p>
              </div>
            </div>
          ) : null}
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
              <DialogTitle>{ALREADY_SET_ASIDE_LABEL}</DialogTitle>
              <DialogDescription>
                Existing designations inside Liquid Position. Not additional
                cash, and not the Wealth Building or Emergency Fund totals
                tracked from income and month close.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-2">
              <Label htmlFor="existing-wealth">
                {EXISTING_WEALTH_BUILDING_LABEL}
              </Label>
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
              <Label htmlFor="existing-emergency">
                {EXISTING_EMERGENCY_FUND_LABEL}
              </Label>
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
                {editingDeclaresFallback
                  ? " This edits the declared fallback. The amount shown stays the observed balance."
                  : null}
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
            <div className="space-y-2">
              <Label htmlFor="account-unavailable">Unavailable</Label>
              <Input
                id="account-unavailable"
                type="number"
                min="0"
                step="0.01"
                inputMode="decimal"
                value={draft.restrictedAmount}
                onChange={(event) =>
                  setDraft((prev) => ({
                    ...prev,
                    restrictedAmount: event.target.value,
                  }))
                }
                placeholder="0"
                aria-describedby="account-unavailable-hint"
              />
              <p
                id="account-unavailable-hint"
                className="text-[11px] leading-relaxed text-slate-500"
              >
                How much of this account is currently unavailable? Still owned.
                Not a purpose, and not inferred from your bank.
              </p>
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
                if (!onRemoveAccount) return;
                const result = onRemoveAccount(pendingRemove.id);
                if (result.status === "needs_preserve_choice") {
                  setPreserveChoice({
                    kind: "remove",
                    account: pendingRemove,
                    accountPosition: result.accountPosition,
                    purpose: result.purpose,
                  });
                  setPendingRemove(null);
                  return;
                }
                if (result.status === "rejected") {
                  setPurposeError(result.reason);
                  return;
                }
                setPendingRemove(null);
              }}
            >
              Remove Account
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog
        open={reconcile !== null}
        onOpenChange={(open) => {
          if (!open) {
            if (reconcile && onSetAccountPurpose) {
              onSetAccountPurpose(reconcile.accountId, reconcile.purpose, "cancel");
            }
            setReconcile(null);
          }
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {reconcile
                ? accountPurposeLabel(reconcile.purpose)
                : "Already Set Aside"}
            </AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-2 text-sm text-slate-400">
                <p>
                  Existing{" "}
                  {reconcile
                    ? accountPurposeLabel(reconcile.purpose)
                    : "designation"}
                  :{" "}
                  <span className="tabular-nums text-slate-200">
                    {money(reconcile?.opening ?? 0)}
                  </span>
                </p>
                <p>
                  This account&apos;s current position:{" "}
                  <span className="tabular-nums text-slate-200">
                    {money(reconcile?.accountPosition ?? 0)}
                  </span>
                </p>
                <p>How should Already Set Aside use them?</p>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="flex-col gap-2 sm:flex-col">
            <AlertDialogAction
              onClick={() => {
                if (!reconcile) return;
                applyPurpose(
                  reconcile.accountId,
                  reconcile.purpose,
                  "keep_remainder"
                );
              }}
            >
              Use account and keep any remainder as Existing
            </AlertDialogAction>
            <AlertDialogAction
              onClick={() => {
                if (!reconcile) return;
                applyPurpose(
                  reconcile.accountId,
                  reconcile.purpose,
                  "replace_existing"
                );
              }}
            >
              Use account and clear Existing for this purpose
            </AlertDialogAction>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog
        open={preserveChoice !== null}
        onOpenChange={(open) => {
          if (!open) setPreserveChoice(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {preserveChoice?.kind === "remove"
                ? "Remove purpose account"
                : "Clear account purpose"}
            </AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-2 text-sm text-slate-400">
                <p>
                  {accountPurposeLabel(
                    preserveChoice?.purpose ?? "wealth_building"
                  )}{" "}
                  position includes{" "}
                  <span className="tabular-nums text-slate-200">
                    {money(preserveChoice?.accountPosition ?? 0)}
                  </span>{" "}
                  in this account. Already Set Aside will drop by that amount
                  unless you keep it as Existing.
                </p>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="flex-col gap-2 sm:flex-col">
            <AlertDialogAction
              onClick={() => {
                if (!preserveChoice) return;
                if (!onClearAccountPurpose || !onRemoveAccount) return;
                if (preserveChoice.kind === "clear") {
                  const result = onClearAccountPurpose(
                    preserveChoice.account.id,
                    "allow_drop"
                  );
                  if (result.status === "rejected") {
                    setPurposeError(result.reason);
                    return;
                  }
                } else {
                  const result = onRemoveAccount(
                    preserveChoice.account.id,
                    "allow_drop"
                  );
                  if (result.status === "rejected") {
                    setPurposeError(result.reason);
                    return;
                  }
                }
                setPreserveChoice(null);
              }}
            >
              Remove from Already Set Aside
            </AlertDialogAction>
            <AlertDialogAction
              onClick={() => {
                if (!preserveChoice) return;
                if (!onClearAccountPurpose || !onRemoveAccount) return;
                if (preserveChoice.kind === "clear") {
                  const result = onClearAccountPurpose(
                    preserveChoice.account.id,
                    "keep_as_existing"
                  );
                  if (result.status === "rejected") {
                    setPurposeError(result.reason);
                    return;
                  }
                } else {
                  const result = onRemoveAccount(
                    preserveChoice.account.id,
                    "keep_as_existing"
                  );
                  if (result.status === "rejected") {
                    setPurposeError(result.reason);
                    return;
                  }
                }
                setPreserveChoice(null);
              }}
            >
              Keep as Existing {accountPurposeLabel(
                preserveChoice?.purpose ?? "wealth_building"
              )}
            </AlertDialogAction>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog
        open={changeConfirm !== null}
        onOpenChange={(open) => {
          if (!open) setChangeConfirm(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Change account purpose</AlertDialogTitle>
            <AlertDialogDescription>
              Change from{" "}
              {changeConfirm
                ? accountPurposeLabel(changeConfirm.from)
                : "current purpose"}{" "}
              to{" "}
              {changeConfirm
                ? accountPurposeLabel(changeConfirm.to)
                : "new purpose"}
              . Liquid Position and allocation history do not change.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (!changeConfirm) return;
                applyPurpose(changeConfirm.accountId, changeConfirm.to);
              }}
            >
              Change purpose
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}
