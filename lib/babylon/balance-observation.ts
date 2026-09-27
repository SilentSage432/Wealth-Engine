/**
 * Cached Plaid balance observation and steward account association.
 *
 * A stored balance is external evidence. It is not Financial Position.
 * Association is an explicit steward fact. Comparison is exact cents.
 * Nothing here writes the vault.
 */

import { roundMoney } from "@/lib/babylon/engine";
import type { FinancialAccount } from "@/types/babylon";

export const BALANCE_OBSERVATION_SOURCE = "accounts_get" as const;

export const BALANCE_OBSERVATION_COLUMNS =
  "id, user_id, plaid_account_id, current_cents, available_cents, iso_currency_code, unofficial_currency_code, observed_at, source, state" as const;

export const ACCOUNT_ASSOCIATION_COLUMNS =
  "id, user_id, financial_account_id, plaid_account_id, confirmed_at" as const;

const POSTGRES_INT_MAX = 2_147_483_647;

export type BalanceObservationState = "current" | "superseded";

/** One stored reading. `available` is never a stand-in for `current`. */
export type BalanceObservationRecord = {
  userId: string;
  plaidAccountId: string;
  currentCents: number | null;
  availableCents: number | null;
  isoCurrencyCode: string | null;
  unofficialCurrencyCode: string | null;
  observedAt: string;
  source: typeof BALANCE_OBSERVATION_SOURCE;
  state: BalanceObservationState;
};

export type BalanceObservationPublic = {
  id: string;
  userId: string;
  plaidAccountId: string;
  currentCents: number | null;
  availableCents: number | null;
  isoCurrencyCode: string | null;
  unofficialCurrencyCode: string | null;
  observedAt: string;
  source: typeof BALANCE_OBSERVATION_SOURCE;
};

export type AccountAssociationRecord = {
  userId: string;
  financialAccountId: string;
  plaidAccountId: string;
  confirmedAt: string;
};

export type AccountAssociationPublic = AccountAssociationRecord & {
  id: string;
};

export type PlaidBalanceDraft = {
  plaidAccountId: string;
  accountType: string;
  subtype: string;
  currentCents: number | null;
  availableCents: number | null;
  isoCurrencyCode: string | null;
  unofficialCurrencyCode: string | null;
};

export type BalanceComparison =
  | { status: "unassociated" }
  | { status: "unknown" }
  | { status: "match"; currentCents: number }
  | { status: "differs"; currentCents: number; differenceCents: number };

export type AccountBalanceView =
  | { status: "hidden" }
  | { status: "unlinked" }
  | { status: "unknown" }
  | { status: "match"; currentCents: number; observedAt: string }
  | {
      status: "differs";
      currentCents: number;
      observedAt: string;
      differenceCents: number;
      canAccept: boolean;
    };

/**
 * Read-time position for one account.
 * `declared` is the steward fallback. `observed` is an eligible cached current.
 */
export type EffectiveAccountPosition =
  | {
      accountId: string;
      balance: number;
      source: "declared";
      asOf: string;
    }
  | {
      accountId: string;
      balance: number;
      source: "observed";
      currentCents: number;
      observedAt: string;
      observationId: string;
      observationSource: typeof BALANCE_OBSERVATION_SOURCE;
    };

type VaultAccountRef = {
  id: string;
  kind: string;
};

type PlaidAccountRef = {
  userId: string;
  plaidAccountId: string;
  accountType: string | null;
  subtype: string | null;
};

function cloneObservation(row: BalanceObservationRecord): BalanceObservationRecord {
  return { ...row };
}

function cloneAssociation(row: AccountAssociationRecord): AccountAssociationRecord {
  return { ...row };
}

export function recordedBalanceCents(balance: number): number {
  return Math.round(roundMoney(balance) * 100);
}

export function dollarsFromCents(cents: number): number {
  return roundMoney(cents / 100);
}

function fitsIntegerCents(cents: number): boolean {
  return Number.isInteger(cents) && Math.abs(cents) <= POSTGRES_INT_MAX;
}

function toCents(value: unknown): number | null | "invalid" {
  if (value === null || value === undefined) return null;
  if (typeof value !== "number" || !Number.isFinite(value)) return "invalid";
  const cents = Math.round(roundMoney(value) * 100);
  if (!fitsIntegerCents(cents)) return "invalid";
  return cents;
}

function toCurrency(value: unknown): string | null | "invalid" {
  if (value === null || value === undefined) return null;
  if (typeof value !== "string") return "invalid";
  const trimmed = value.trim();
  if (!trimmed) return null;
  return trimmed.toUpperCase();
}

export function isDepositoryCheckingOrSavings(
  accountType: string | null | undefined,
  subtype: string | null | undefined
): boolean {
  return (
    accountType?.trim().toLowerCase() === "depository" &&
    (subtype?.trim().toLowerCase() === "checking" ||
      subtype?.trim().toLowerCase() === "savings")
  );
}

export function isComparableBalance(input: {
  currentCents: number | null;
  isoCurrencyCode: string | null;
  unofficialCurrencyCode: string | null;
  accountType: string | null;
  subtype: string | null;
}): boolean {
  return (
    isDepositoryCheckingOrSavings(input.accountType, input.subtype) &&
    input.currentCents !== null &&
    fitsIntegerCents(input.currentCents) &&
    input.isoCurrencyCode === "USD" &&
    input.unofficialCurrencyCode === null
  );
}

function readOptionalText(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed || null;
}

/**
 * Balance fields from one `/accounts/get` account.
 * Credit, loan, investment, and any other type are omitted.
 * A depository checking or savings account is kept even when it cannot
 * be compared, so missing currency or a null current stays unknown.
 */
export function parsePlaidBalanceGetResponse(payload: unknown): PlaidBalanceDraft[] | null {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return null;
  const accounts = (payload as { accounts?: unknown }).accounts;
  if (!Array.isArray(accounts)) return null;
  const drafts: PlaidBalanceDraft[] = [];
  for (const entry of accounts) {
    const draft = readStoredBalanceDraft(entry);
    if (draft) drafts.push(draft);
  }
  return drafts;
}

function readStoredBalanceDraft(entry: unknown): PlaidBalanceDraft | null {
  if (!entry || typeof entry !== "object" || Array.isArray(entry)) return null;
  const record = entry as Record<string, unknown>;
  const plaidAccountId = readOptionalText(record.account_id);
  const accountType = readOptionalText(record.type);
  const subtype = readOptionalText(record.subtype);
  if (!plaidAccountId || !accountType || !subtype) return null;
  if (!isDepositoryCheckingOrSavings(accountType, subtype)) return null;

  const balances = record.balances;
  let current: unknown = null;
  let available: unknown = null;
  let iso: unknown = null;
  let unofficial: unknown = null;
  if (balances && typeof balances === "object" && !Array.isArray(balances)) {
    const balanceRecord = balances as Record<string, unknown>;
    current = balanceRecord.current;
    available = balanceRecord.available;
    iso = balanceRecord.iso_currency_code;
    unofficial = balanceRecord.unofficial_currency_code;
  }
  const currentCents = toCents(current);
  const availableCents = toCents(available);
  const isoCurrencyCode = toCurrency(iso);
  const unofficialCurrencyCode = toCurrency(unofficial);
  if (
    currentCents === "invalid" ||
    availableCents === "invalid" ||
    isoCurrencyCode === "invalid" ||
    unofficialCurrencyCode === "invalid"
  ) {
    return null;
  }
  return {
    plaidAccountId,
    accountType,
    subtype,
    currentCents,
    availableCents,
    isoCurrencyCode,
    unofficialCurrencyCode,
  };
}

export function toBalanceObservationJson(drafts: readonly PlaidBalanceDraft[]): {
  plaid_account_id: string;
  account_type: string;
  subtype: string;
  current_cents: number | null;
  available_cents: number | null;
  iso_currency_code: string | null;
  unofficial_currency_code: string | null;
}[] {
  return drafts.map((draft) => ({
    plaid_account_id: draft.plaidAccountId,
    account_type: draft.accountType,
    subtype: draft.subtype,
    current_cents: draft.currentCents,
    available_cents: draft.availableCents,
    iso_currency_code: draft.isoCurrencyCode,
    unofficial_currency_code: draft.unofficialCurrencyCode,
  }));
}

function evidenceEqual(
  row: BalanceObservationRecord,
  draft: PlaidBalanceDraft
): boolean {
  return (
    row.currentCents === draft.currentCents &&
    row.availableCents === draft.availableCents &&
    row.isoCurrencyCode === draft.isoCurrencyCode &&
    row.unofficialCurrencyCode === draft.unofficialCurrencyCode
  );
}

function draftIsStoreable(draft: PlaidBalanceDraft): boolean {
  return (
    isDepositoryCheckingOrSavings(draft.accountType, draft.subtype) &&
    (draft.currentCents === null || fitsIntegerCents(draft.currentCents)) &&
    (draft.availableCents === null || fitsIntegerCents(draft.availableCents))
  );
}

/**
 * Latest row per account, plus at most one superseded predecessor.
 * An unchanged reading refreshes the stored time and does not add a row.
 */
export function applyBalanceObservations(
  rows: readonly BalanceObservationRecord[],
  input: {
    userId: string;
    observedAt: string;
    drafts: readonly PlaidBalanceDraft[];
    foreignAccountIds?: readonly { userId: string; plaidAccountId: string }[];
  }
): { status: "applied" | "rejected"; observations: BalanceObservationRecord[] } {
  const unchanged = rows.map(cloneObservation);
  for (const draft of input.drafts) {
    if (!draftIsStoreable(draft)) continue;
    const conflict =
      rows.some(
        (row) =>
          row.plaidAccountId === draft.plaidAccountId && row.userId !== input.userId
      ) ||
      (input.foreignAccountIds ?? []).some(
        (account) =>
          account.plaidAccountId === draft.plaidAccountId &&
          account.userId !== input.userId
      );
    if (conflict) return { status: "rejected", observations: unchanged };
  }

  const next = rows.map(cloneObservation);
  for (const draft of input.drafts) {
    if (!draftIsStoreable(draft)) continue;
    const currentIndex = next.findIndex(
      (row) =>
        row.userId === input.userId &&
        row.plaidAccountId === draft.plaidAccountId &&
        row.state === "current"
    );
    if (currentIndex < 0) {
      next.push({
        userId: input.userId,
        plaidAccountId: draft.plaidAccountId,
        currentCents: draft.currentCents,
        availableCents: draft.availableCents,
        isoCurrencyCode: draft.isoCurrencyCode,
        unofficialCurrencyCode: draft.unofficialCurrencyCode,
        observedAt: input.observedAt,
        source: BALANCE_OBSERVATION_SOURCE,
        state: "current",
      });
      continue;
    }
    const current = next[currentIndex];
    if (evidenceEqual(current, draft)) {
      next[currentIndex] = { ...current, observedAt: input.observedAt };
      continue;
    }
    const withoutPrior = next.filter(
      (row, index) =>
        index === currentIndex ||
        row.userId !== input.userId ||
        row.plaidAccountId !== draft.plaidAccountId ||
        row.state !== "superseded"
    );
    const supersededIndex = withoutPrior.findIndex(
      (row) =>
        row.userId === input.userId &&
        row.plaidAccountId === draft.plaidAccountId &&
        row.state === "current"
    );
    withoutPrior[supersededIndex] = {
      ...withoutPrior[supersededIndex],
      state: "superseded",
    };
    withoutPrior.push({
      userId: input.userId,
      plaidAccountId: draft.plaidAccountId,
      currentCents: draft.currentCents,
      availableCents: draft.availableCents,
      isoCurrencyCode: draft.isoCurrencyCode,
      unofficialCurrencyCode: draft.unofficialCurrencyCode,
      observedAt: input.observedAt,
      source: BALANCE_OBSERVATION_SOURCE,
      state: "current",
    });
    next.length = 0;
    next.push(...withoutPrior);
  }
  return { status: "applied", observations: next };
}

export function currentBalanceObservation(
  rows: readonly BalanceObservationRecord[],
  userId: string,
  plaidAccountId: string
): BalanceObservationRecord | null {
  return (
    rows.find(
      (row) =>
        row.userId === userId &&
        row.plaidAccountId === plaidAccountId &&
        row.state === "current"
    ) ?? null
  );
}

export function compareRecordedBalance(input: {
  associated: boolean;
  recordedBalance: number;
  accountType: string | null;
  subtype: string | null;
  observation: {
    currentCents: number | null;
    availableCents: number | null;
    isoCurrencyCode: string | null;
    unofficialCurrencyCode: string | null;
  } | null;
}): BalanceComparison {
  if (!input.associated) return { status: "unassociated" };
  if (
    !input.observation ||
    !isComparableBalance({
      currentCents: input.observation.currentCents,
      isoCurrencyCode: input.observation.isoCurrencyCode,
      unofficialCurrencyCode: input.observation.unofficialCurrencyCode,
      accountType: input.accountType,
      subtype: input.subtype,
    })
  ) {
    return { status: "unknown" };
  }
  const currentCents = input.observation.currentCents;
  if (currentCents === null) return { status: "unknown" };
  const differenceCents = currentCents - recordedBalanceCents(input.recordedBalance);
  if (differenceCents === 0) return { status: "match", currentCents };
  return { status: "differs", currentCents, differenceCents };
}

type ObservedBalanceLink = {
  associations: readonly { financialAccountId: string; plaidAccountId: string }[];
  plaidAccounts: readonly {
    plaidAccountId: string;
    accountType: string | null;
    subtype: string | null;
  }[];
  observations: readonly BalanceObservationPublic[];
};

function observedBalanceLink(accountId: string, input: ObservedBalanceLink) {
  const association =
    input.associations.find((row) => row.financialAccountId === accountId) ?? null;
  const plaidAccount = association
    ? (input.plaidAccounts.find(
        (row) => row.plaidAccountId === association.plaidAccountId
      ) ?? null)
    : null;
  const observation = association
    ? (input.observations.find(
        (row) => row.plaidAccountId === association.plaidAccountId
      ) ?? null)
    : null;
  return {
    associatedPlaidAccountId: association?.plaidAccountId ?? null,
    accountType: plaidAccount?.accountType ?? null,
    subtype: plaidAccount?.subtype ?? null,
    observation,
  };
}

export function describeAccountBalance(input: {
  account: FinancialAccount;
  associatedPlaidAccountId: string | null;
  accountType: string | null;
  subtype: string | null;
  observation: BalanceObservationPublic | null;
}): AccountBalanceView {
  if (input.account.kind === "cash") return { status: "hidden" };
  if (!input.associatedPlaidAccountId) return { status: "unlinked" };
  const comparison = compareRecordedBalance({
    associated: true,
    recordedBalance: input.account.balance,
    accountType: input.accountType,
    subtype: input.subtype,
    observation: input.observation,
  });
  if (comparison.status === "unknown" || comparison.status === "unassociated") {
    return { status: "unknown" };
  }
  if (!input.observation) return { status: "unknown" };
  if (comparison.status === "match") {
    return {
      status: "match",
      currentCents: comparison.currentCents,
      observedAt: input.observation.observedAt,
    };
  }
  return {
    status: "differs",
    currentCents: comparison.currentCents,
    observedAt: input.observation.observedAt,
    differenceCents: comparison.differenceCents,
    canAccept: comparison.currentCents >= 0,
  };
}

/**
 * Effective position from the evidence already comparable for this account.
 * A matching eligible current stays observed. Ineligible evidence keeps the
 * declaration. This reads. It does not write the account or the observation.
 */
export function deriveEffectiveAccountPosition(input: {
  account: FinancialAccount;
  associatedPlaidAccountId: string | null;
  accountType: string | null;
  subtype: string | null;
  observation: BalanceObservationPublic | null;
}): EffectiveAccountPosition {
  const view = describeAccountBalance(input);
  const observation = input.observation;
  if (
    observation &&
    (view.status === "match" || (view.status === "differs" && view.canAccept))
  ) {
    return {
      accountId: input.account.id,
      balance: dollarsFromCents(view.currentCents),
      source: "observed",
      currentCents: view.currentCents,
      observedAt: view.observedAt,
      observationId: observation.id,
      observationSource: observation.source,
    };
  }
  return {
    accountId: input.account.id,
    balance: input.account.balance,
    source: "declared",
    asOf: input.account.asOf,
  };
}

/**
 * One effective position per account, in vault order.
 * Eligibility stays inside deriveEffectiveAccountPosition.
 */
export function deriveEffectiveAccountPositions(
  input: ObservedBalanceLink & { accounts: readonly FinancialAccount[] }
): EffectiveAccountPosition[] {
  return input.accounts.map((account) => {
    const linked = observedBalanceLink(account.id, input);
    return deriveEffectiveAccountPosition({
      account,
      associatedPlaidAccountId: linked.associatedPlaidAccountId,
      accountType: linked.accountType,
      subtype: linked.subtype,
      observation: linked.observation,
    });
  });
}

/** Rounded sum of effective positions. Does not write an account. */
export function deriveEffectiveMoneyAvailable(
  input: ObservedBalanceLink & { accounts: readonly FinancialAccount[] }
): number {
  return roundMoney(
    deriveEffectiveAccountPositions(input).reduce(
      (sum, position) => sum + position.balance,
      0
    )
  );
}

export function depositoryChoiceLabel(input: {
  name: string | null;
  mask: string | null;
  subtype: string | null;
  institutionName: string | null;
}): string {
  const subtype = input.subtype?.trim().toLowerCase();
  const fallback = subtype === "savings" ? "Savings" : "Checking";
  const name = input.name?.trim() || fallback;
  const mask = input.mask?.trim() ? `····${input.mask.trim()}` : null;
  const institution = input.institutionName?.trim() || null;
  return [name, mask, institution].filter((part): part is string => Boolean(part)).join(" · ");
}

export function unassociatedDepositoryAccountIds(input: {
  userId: string;
  plaidAccounts: readonly PlaidAccountRef[];
  associations: readonly AccountAssociationRecord[];
  liveFinancialAccountIds: readonly string[];
}): string[] {
  const live = new Set(input.liveFinancialAccountIds);
  const occupied = new Set(
    input.associations
      .filter(
        (association) =>
          association.userId === input.userId &&
          live.has(association.financialAccountId)
      )
      .map((association) => association.plaidAccountId)
  );
  return input.plaidAccounts
    .filter(
      (account) =>
        account.userId === input.userId &&
        isDepositoryCheckingOrSavings(account.accountType, account.subtype) &&
        !occupied.has(account.plaidAccountId)
    )
    .map((account) => account.plaidAccountId);
}

export function associateFinancialAccount(
  associations: readonly AccountAssociationRecord[],
  input: {
    userId: string;
    financialAccountId: string;
    plaidAccountId: string;
    confirmedAt: string;
    vaultAccounts: readonly VaultAccountRef[];
    plaidAccount: PlaidAccountRef | null;
    foreignPlaidAccountIds?: readonly { userId: string; plaidAccountId: string }[];
  }
): {
  status: "associated" | "unchanged" | "rejected";
  reason?: string;
  associations: AccountAssociationRecord[];
} {
  const unchanged = associations.map(cloneAssociation);
  const financialAccountId = input.financialAccountId.trim();
  const plaidAccountId = input.plaidAccountId.trim();
  if (!financialAccountId || !plaidAccountId) {
    return { status: "rejected", reason: "invalid", associations: unchanged };
  }
  const foreign = (input.foreignPlaidAccountIds ?? []).some(
    (account) => account.plaidAccountId === plaidAccountId && account.userId !== input.userId
  );
  const foreignAssociation = associations.some(
    (association) =>
      association.plaidAccountId === plaidAccountId && association.userId !== input.userId
  );
  if (foreign || foreignAssociation || (input.plaidAccount && input.plaidAccount.userId !== input.userId)) {
    return { status: "rejected", reason: "cross_owner", associations: unchanged };
  }
  if (!input.plaidAccount || input.plaidAccount.plaidAccountId !== plaidAccountId) {
    return { status: "rejected", reason: "unknown_account", associations: unchanged };
  }
  if (!isDepositoryCheckingOrSavings(input.plaidAccount.accountType, input.plaidAccount.subtype)) {
    return { status: "rejected", reason: "ineligible_account", associations: unchanged };
  }
  const vaultAccount = input.vaultAccounts.find((account) => account.id === financialAccountId);
  if (!vaultAccount) {
    return { status: "rejected", reason: "account_not_in_vault", associations: unchanged };
  }
  if (vaultAccount.kind !== "checking" && vaultAccount.kind !== "savings") {
    return { status: "rejected", reason: "ineligible_account", associations: unchanged };
  }

  const same = associations.find(
    (association) =>
      association.userId === input.userId &&
      association.financialAccountId === financialAccountId &&
      association.plaidAccountId === plaidAccountId
  );
  if (same) return { status: "unchanged", associations: unchanged };

  const financialTaken = associations.find(
    (association) =>
      association.userId === input.userId &&
      association.financialAccountId === financialAccountId
  );
  if (financialTaken) {
    return { status: "rejected", reason: "already_associated", associations: unchanged };
  }

  const plaidTaken = associations.find(
    (association) =>
      association.userId === input.userId && association.plaidAccountId === plaidAccountId
  );
  const live = new Set(input.vaultAccounts.map((account) => account.id));
  let next = associations.map(cloneAssociation);
  if (plaidTaken) {
    if (live.has(plaidTaken.financialAccountId)) {
      return { status: "rejected", reason: "already_associated", associations: unchanged };
    }
    next = next.filter(
      (association) =>
        association.userId !== input.userId ||
        association.plaidAccountId !== plaidAccountId
    );
  }
  next.push({
    userId: input.userId,
    financialAccountId,
    plaidAccountId,
    confirmedAt: input.confirmedAt,
  });
  return { status: "associated", associations: next };
}

export function removeFinancialAccountAssociation(
  associations: readonly AccountAssociationRecord[],
  input: { userId: string; financialAccountId: string }
): {
  status: "removed" | "absent";
  associations: AccountAssociationRecord[];
} {
  const financialAccountId = input.financialAccountId.trim();
  const next = associations.filter(
    (association) =>
      association.userId !== input.userId ||
      association.financialAccountId !== financialAccountId
  );
  if (next.length === associations.length) {
    return { status: "absent", associations: associations.map(cloneAssociation) };
  }
  return { status: "removed", associations: next };
}

export function toBalanceObservationPublic(row: {
  id: string;
  user_id: string;
  plaid_account_id: string;
  current_cents: number | null;
  available_cents: number | null;
  iso_currency_code: string | null;
  unofficial_currency_code: string | null;
  observed_at: string;
  source: string;
  state: string;
}): BalanceObservationPublic | null {
  if (row.state !== "current") return null;
  if (row.source !== BALANCE_OBSERVATION_SOURCE) return null;
  if (!row.plaid_account_id.trim() || !row.observed_at) return null;
  const currentCents = row.current_cents;
  const availableCents = row.available_cents;
  if (
    (currentCents !== null && !fitsIntegerCents(currentCents)) ||
    (availableCents !== null && !fitsIntegerCents(availableCents))
  ) {
    return null;
  }
  return {
    id: row.id,
    userId: row.user_id,
    plaidAccountId: row.plaid_account_id,
    currentCents,
    availableCents,
    isoCurrencyCode: row.iso_currency_code,
    unofficialCurrencyCode: row.unofficial_currency_code,
    observedAt: row.observed_at,
    source: BALANCE_OBSERVATION_SOURCE,
  };
}

export function toAccountAssociationPublic(row: {
  id: string;
  user_id: string;
  financial_account_id: string;
  plaid_account_id: string;
  confirmed_at: string;
}): AccountAssociationPublic | null {
  if (!row.financial_account_id.trim() || !row.plaid_account_id.trim()) return null;
  return {
    id: row.id,
    userId: row.user_id,
    financialAccountId: row.financial_account_id,
    plaidAccountId: row.plaid_account_id,
    confirmedAt: row.confirmed_at,
  };
}
