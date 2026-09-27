/**
 * Session load truth for cached balance evidence.
 * A successful empty read is ready. A failed read is unavailable.
 * This module does not write the vault or persist evidence.
 */

import {
  describeAccountBalance,
  listActionableObservedBalances,
  type AccountAssociationPublic,
  type ActionableObservedBalance,
  type BalanceObservationPublic,
} from "@/lib/babylon/balance-observation";
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

/** Update balance rows. Only a ready load can establish an eligible difference. */
export function actionableObservedBalancesForLoad(input: {
  accounts: readonly FinancialAccount[];
  load: BalanceObservationLoad;
}): ActionableObservedBalance[] {
  if (input.load.status !== "ready") return [];
  return listActionableObservedBalances({
    accounts: input.accounts,
    enabled: true,
    settled: true,
    plaidAccounts: input.load.evidence.plaidAccounts,
    observations: input.load.evidence.observations,
    associations: input.load.evidence.associations,
  });
}

/**
 * Retained differences after a failed refresh.
 * These rows keep their original observedAt. They are not an accept action.
 */
export function retainedObservedBalanceRows(input: {
  accounts: readonly FinancialAccount[];
  load: BalanceObservationLoad;
}): ActionableObservedBalance[] {
  if (input.load.status !== "unavailable" || !input.load.evidence) return [];
  return listActionableObservedBalances({
    accounts: input.accounts,
    enabled: true,
    settled: true,
    plaidAccounts: input.load.evidence.plaidAccounts,
    observations: input.load.evidence.observations,
    associations: input.load.evidence.associations,
  });
}
