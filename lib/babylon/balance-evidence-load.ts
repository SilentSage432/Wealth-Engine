/**
 * Session load truth for cached balance evidence.
 * A successful empty read is ready. A failed read is unavailable.
 * This module does not write the vault or persist evidence.
 */

import {
  deriveEffectiveAccountPosition,
  deriveEffectiveAccountPositions,
  deriveEffectiveMoneyAvailable,
  describeAccountBalance,
  type AccountAssociationPublic,
  type BalanceObservationPublic,
  type EffectiveAccountPosition,
} from "@/lib/babylon/balance-observation";
import { realtimeBalanceAge } from "@/lib/babylon/foreground-balance-refresh";
import { formatAsOfLabel, formatObservedAt, sumAccountBalances } from "@/lib/babylon/financial-position";
import type { PlaidAccountPublic } from "@/lib/babylon/plaid-schema";
import type { FinancialAccount } from "@/types/babylon";

export const BALANCE_EVIDENCE_UNAVAILABLE_LABEL = "Balance evidence unavailable";

export type BalanceObservationEvidence = {
  plaidAccounts: readonly PlaidAccountPublic[];
  observations: readonly BalanceObservationPublic[];
  associations: readonly AccountAssociationPublic[];
};

/** One evidence query. Success may carry an empty list. Error carries no list. */
export type BalanceEvidenceRead<T> =
  | { status: "pending" }
  | { status: "success"; data: T }
  | { status: "error" };

/**
 * Overall evidence load.
 * `unavailable` with evidence is a failed refresh after a success in this session.
 * `unavailable` with null evidence is a first load that never succeeded.
 * `ready` may contain empty arrays.
 */
export type BalanceObservationLoad =
  | { status: "disabled" }
  | { status: "loading" }
  | { status: "ready"; evidence: BalanceObservationEvidence }
  | { status: "unavailable"; evidence: BalanceObservationEvidence | null };

export type AccountObservationPresentation =
  | { status: "hidden" }
  | {
      status: "unavailable";
      observedAt: string | null;
      currentCents: number | null;
    }
  | { status: "ready"; evidence: BalanceObservationEvidence };

function evidenceFromSuccess(input: {
  accounts: BalanceEvidenceRead<BalanceObservationEvidence["plaidAccounts"]>;
  observations: BalanceEvidenceRead<BalanceObservationEvidence["observations"]>;
  associations: BalanceEvidenceRead<BalanceObservationEvidence["associations"]>;
}): BalanceObservationEvidence | null {
  if (
    input.accounts.status !== "success" ||
    input.observations.status !== "success" ||
    input.associations.status !== "success"
  ) {
    return null;
  }
  return {
    plaidAccounts: input.accounts.data,
    observations: input.observations.data,
    associations: input.associations.data,
  };
}

/**
 * Compose the three evidence reads.
 * Any error keeps the retained snapshot. A later full success replaces it,
 * including a successful empty snapshot.
 */
export function deriveBalanceObservationLoad(input: {
  enabled: boolean;
  accounts: BalanceEvidenceRead<BalanceObservationEvidence["plaidAccounts"]>;
  observations: BalanceEvidenceRead<BalanceObservationEvidence["observations"]>;
  associations: BalanceEvidenceRead<BalanceObservationEvidence["associations"]>;
  retained: BalanceObservationEvidence | null;
}): {
  load: BalanceObservationLoad;
  retained: BalanceObservationEvidence | null;
} {
  if (!input.enabled) {
    return { load: { status: "disabled" }, retained: input.retained };
  }
  const failed = [input.accounts, input.observations, input.associations].some(
    (read) => read.status === "error"
  );
  if (failed) {
    return {
      load: { status: "unavailable", evidence: input.retained },
      retained: input.retained,
    };
  }
  const evidence = evidenceFromSuccess(input);
  if (evidence) {
    return { load: { status: "ready", evidence }, retained: evidence };
  }
  return { load: { status: "loading" }, retained: input.retained };
}

export function sameBalanceObservationEvidence(
  left: BalanceObservationEvidence | null,
  right: BalanceObservationEvidence | null
): boolean {
  if (left === right) return true;
  if (!left || !right) return false;
  return (
    left.plaidAccounts === right.plaidAccounts &&
    left.observations === right.observations &&
    left.associations === right.associations
  );
}

function linkedObservation(account: FinancialAccount, evidence: BalanceObservationEvidence) {
  const association =
    evidence.associations.find((row) => row.financialAccountId === account.id) ?? null;
  const plaidAccount = association
    ? (evidence.plaidAccounts.find(
        (row) => row.plaidAccountId === association.plaidAccountId
      ) ?? null)
    : null;
  const observation = association
    ? (evidence.observations.find(
        (row) => row.plaidAccountId === association.plaidAccountId
      ) ?? null)
    : null;
  return describeAccountBalance({
    account,
    associatedPlaidAccountId: association?.plaidAccountId ?? null,
    accountType: plaidAccount?.accountType ?? null,
    subtype: plaidAccount?.subtype ?? null,
    observation,
  });
}

/**
 * What one account row may say about evidence.
 * Cash, loading, and signed-out stay hidden.
 * Unavailable does not report unlinked or unknown.
 */
export function presentAccountObservation(input: {
  account: FinancialAccount;
  load: BalanceObservationLoad;
}): AccountObservationPresentation {
  if (input.account.kind === "cash") return { status: "hidden" };
  if (input.load.status === "disabled" || input.load.status === "loading") {
    return { status: "hidden" };
  }
  if (input.load.status === "unavailable") {
    const view = input.load.evidence
      ? linkedObservation(input.account, input.load.evidence)
      : null;
    if (view && (view.status === "match" || view.status === "differs")) {
      return {
        status: "unavailable",
        observedAt: view.observedAt,
        currentCents: view.currentCents,
      };
    }
    return { status: "unavailable", observedAt: null, currentCents: null };
  }
  return { status: "ready", evidence: input.load.evidence };
}

/**
 * Evidence that may establish effective position.
 * Ready evidence and a retained successful snapshot qualify.
 * Loading, signed-out, and a failure with nothing retained do not.
 */
export function evidenceForOperationalPosition(
  load: BalanceObservationLoad | undefined
): BalanceObservationEvidence | null {
  if (!load) return null;
  if (load.status === "ready") return load.evidence;
  if (load.status === "unavailable") return load.evidence;
  return null;
}

/** Account-row provenance. Aged institution evidence is not called fresh. */
export function describeAccountEvidenceLine(input: {
  position: EffectiveAccountPosition;
  nowMs: number;
}): string {
  if (input.position.source === "declared") {
    return `Declared · ${formatAsOfLabel(input.position.asOf)}`;
  }
  const when = formatObservedAt(input.position.observedAt);
  if (input.position.observationSource === "accounts_get") {
    return `Cached Plaid balance · ${when}`;
  }
  if (realtimeBalanceAge(input.position.observedAt, input.nowMs) === "fresh") {
    return `Institution-refreshed balance · ${when}`;
  }
  return `Institution balance from ${when}`;
}

/**
 * Money Available caption.
 * Loading may show the declaration, and it says so.
 */
export function describeMoneyAvailableEvidence(input: {
  load: BalanceObservationLoad | undefined;
  positions: readonly EffectiveAccountPosition[];
  nowMs: number;
}): string {
  if (!input.load || input.load.status === "loading") {
    return "Declared balance, while evidence resolves.";
  }
  if (input.load.status === "disabled") {
    return "Declared balances.";
  }
  if (input.load.status === "unavailable" && input.load.evidence === null) {
    return "Declared balance. Stored balance evidence is unavailable.";
  }
  const observed = input.positions.filter((position) => position.source === "observed");
  if (observed.length === 0) {
    return "Declared balances.";
  }
  const kinds = new Set(
    observed.map((position) => {
      if (position.observationSource === "accounts_get") return "cached" as const;
      return realtimeBalanceAge(position.observedAt, input.nowMs) === "fresh"
        ? ("fresh" as const)
        : ("aged" as const);
    })
  );
  if (kinds.size === 1 && kinds.has("cached")) {
    return "Cached Plaid balance where an eligible reading exists. Declared balances otherwise.";
  }
  if (kinds.size === 1 && kinds.has("fresh")) {
    return "Institution-refreshed balance where an eligible reading exists. Declared balances otherwise.";
  }
  if (kinds.size === 1 && kinds.has("aged")) {
    return "Earlier institution balance where an eligible reading exists. Declared balances otherwise.";
  }
  if (kinds.has("aged")) return "This figure includes an earlier institution balance.";
  return "Cached Plaid balance and an institution-refreshed balance are both in this figure.";
}

/** Operational Money Available. Declarations until usable evidence exists. */
export function operationalMoneyAvailable(input: {
  accounts: readonly FinancialAccount[];
  load: BalanceObservationLoad | undefined;
}): number {
  const evidence = evidenceForOperationalPosition(input.load);
  if (!evidence) return sumAccountBalances(input.accounts);
  return deriveEffectiveMoneyAvailable({
    accounts: input.accounts,
    plaidAccounts: evidence.plaidAccounts,
    observations: evidence.observations,
    associations: evidence.associations,
  });
}

/** One account's operational position under the same load rule. */
export function operationalAccountPosition(input: {
  account: FinancialAccount;
  load: BalanceObservationLoad | undefined;
}): EffectiveAccountPosition {
  const evidence = evidenceForOperationalPosition(input.load);
  if (!evidence) {
    return deriveEffectiveAccountPosition({
      account: input.account,
      associatedPlaidAccountId: null,
      accountType: null,
      subtype: null,
      observation: null,
    });
  }
  return (
    deriveEffectiveAccountPositions({
      accounts: [input.account],
      plaidAccounts: evidence.plaidAccounts,
      observations: evidence.observations,
      associations: evidence.associations,
    })[0] ??
    deriveEffectiveAccountPosition({
      account: input.account,
      associatedPlaidAccountId: null,
      accountType: null,
      subtype: null,
      observation: null,
    })
  );
}
