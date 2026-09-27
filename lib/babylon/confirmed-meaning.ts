/**
 * Steward-confirmed meaning of one Plaid observation.
 *
 * This module owns the in-memory rules for that fact. The database functions
 * in `20261001_plaid_confirmed_meaning.sql` are the persisted writer. Neither
 * one classifies a future observation, creates an expense, or changes a cap.
 *
 * Plaid's sign is preserved: positive cents are money out of that account.
 */

import { roundMoney } from "@/lib/babylon/engine";

export const CONFIRMATION_STATES = ["current", "superseded", "revoked"] as const;

export type ConfirmationState = (typeof CONFIRMATION_STATES)[number];

/** Evidence and target captured when the steward confirmed one observation. */
export type ObservationConfirmation = {
  id: string;
  userId: string;
  plaidTransactionId: string;
  budgetTargetId: string;
  categoryName: string;
  signedCents: number;
  postedDate: string;
  transactionName: string;
  categoryText: string | null;
  accountId: string;
  pending: false;
  confirmedAt: string;
  state: ConfirmationState;
};

/** Observation fields the confirmation decision is allowed to read. */
export type ConfirmableObservation = {
  userId: string;
  plaidTransactionId: string;
  pendingTransactionId?: string | null;
  accountId: string;
  amount: number;
  name: string;
  category: string | null;
  date: string;
  pending: boolean;
  removedAt: string | null;
  isProcessed?: boolean;
};

export type BudgetCategoryTarget = {
  id: string;
  categoryName: string;
};

export type ConfirmationRejection =
  | "unauthenticated"
  | "invalid"
  | "not_found"
  | "not_owner"
  | "not_teachable"
  | "unknown_category";

export type ConfirmMeaningResult =
  | {
      status: "confirmed" | "superseded" | "unchanged";
      confirmations: ObservationConfirmation[];
    }
  | {
      status: "rejected";
      reason: ConfirmationRejection;
      confirmations: ObservationConfirmation[];
    };

export type RevokeMeaningResult =
  | { status: "revoked" | "absent"; confirmations: ObservationConfirmation[] }
  | {
      status: "rejected";
      reason: "unauthenticated" | "invalid" | "not_owner";
      confirmations: ObservationConfirmation[];
    };

export const PLAID_CONFIRMATION_COLUMNS =
  "id, user_id, plaid_transaction_id, budget_target_id, category_name, signed_cents, posted_date, transaction_name, category_text, account_id, pending, confirmed_at, state" as const;

export function signedCentsFromAmount(amount: number): number {
  return Math.round(roundMoney(amount) * 100);
}

export function isTeachableObservation(observation: {
  pending: boolean;
  removedAt?: string | null;
}): boolean {
  return observation.pending === false && (observation.removedAt ?? null) === null;
}

export function currentConfirmation(
  confirmations: readonly ObservationConfirmation[],
  userId: string,
  plaidTransactionId: string
): ObservationConfirmation | null {
  return (
    confirmations.find(
      (row) =>
        row.state === "current" &&
        row.userId === userId &&
        row.plaidTransactionId === plaidTransactionId
    ) ?? null
  );
}

function trimmed(value: string | null | undefined): string {
  return value?.trim() ?? "";
}

function cloneConfirmation(row: ObservationConfirmation): ObservationConfirmation {
  return { ...row };
}

function rejectConfirm(
  reason: ConfirmationRejection,
  confirmations: readonly ObservationConfirmation[]
): ConfirmMeaningResult {
  return {
    status: "rejected",
    reason,
    confirmations: confirmations.map(cloneConfirmation),
  };
}

/**
 * Record that this steward confirmed this observation as this budget category.
 * A different current category is superseded. The previous snapshot is not rewritten.
 * The same category again leaves the current snapshot untouched.
 */
export function confirmObservationMeaning(input: {
  actorUserId: string;
  observation: ConfirmableObservation | null;
  budgetTarget: BudgetCategoryTarget | null;
  confirmations: readonly ObservationConfirmation[];
  now: string;
  nextId: string;
}): ConfirmMeaningResult {
  const actorUserId = trimmed(input.actorUserId);
  if (!actorUserId) {
    return rejectConfirm("unauthenticated", input.confirmations);
  }
  if (!trimmed(input.now) || !trimmed(input.nextId)) {
    return rejectConfirm("invalid", input.confirmations);
  }

  const observation = input.observation;
  if (!observation) return rejectConfirm("not_found", input.confirmations);
  if (observation.userId !== actorUserId) {
    return rejectConfirm("not_owner", input.confirmations);
  }
  if (
    !isTeachableObservation(observation) ||
    !Number.isFinite(observation.amount) ||
    !trimmed(observation.plaidTransactionId) ||
    !trimmed(observation.accountId) ||
    !trimmed(observation.name) ||
    !trimmed(observation.date)
  ) {
    return rejectConfirm("not_teachable", input.confirmations);
  }

  const categoryName = trimmed(input.budgetTarget?.categoryName);
  const budgetTargetId = trimmed(input.budgetTarget?.id);
  if (!input.budgetTarget || !budgetTargetId || !categoryName) {
    return rejectConfirm("unknown_category", input.confirmations);
  }

  const confirmations = input.confirmations.map(cloneConfirmation);
  const currentIndex = confirmations.findIndex(
    (row) =>
      row.state === "current" &&
      row.userId === actorUserId &&
      row.plaidTransactionId === observation.plaidTransactionId
  );
  const current = currentIndex >= 0 ? confirmations[currentIndex] : null;
  if (current && current.budgetTargetId === budgetTargetId) {
    return { status: "unchanged", confirmations };
  }

  let status: "confirmed" | "superseded" = "confirmed";
  if (current) {
    confirmations[currentIndex] = { ...current, state: "superseded" };
    status = "superseded";
  }

  const categoryText = trimmed(observation.category);
  confirmations.push({
    id: input.nextId.trim(),
    userId: actorUserId,
    plaidTransactionId: observation.plaidTransactionId.trim(),
    budgetTargetId,
    categoryName,
    signedCents: signedCentsFromAmount(observation.amount),
    postedDate: observation.date.trim(),
    transactionName: observation.name.trim(),
    categoryText: categoryText ? categoryText : null,
    accountId: observation.accountId.trim(),
    pending: false,
    confirmedAt: input.now.trim(),
    state: "current",
  });

  return { status, confirmations };
}

/**
 * Leave no current confirmation for this owner and observation.
 * Superseded and revoked rows stay, including their original snapshots.
 */
export function revokeObservationMeaning(input: {
  actorUserId: string;
  plaidTransactionId: string;
  confirmations: readonly ObservationConfirmation[];
}): RevokeMeaningResult {
  const actorUserId = trimmed(input.actorUserId);
  if (!actorUserId) {
    return {
      status: "rejected",
      reason: "unauthenticated",
      confirmations: input.confirmations.map(cloneConfirmation),
    };
  }
  const plaidTransactionId = trimmed(input.plaidTransactionId);
  if (!plaidTransactionId) {
    return {
      status: "rejected",
      reason: "invalid",
      confirmations: input.confirmations.map(cloneConfirmation),
    };
  }

  const confirmations = input.confirmations.map(cloneConfirmation);
  const currentIndex = confirmations.findIndex(
    (row) =>
      row.state === "current" &&
      row.userId === actorUserId &&
      row.plaidTransactionId === plaidTransactionId
  );
  if (currentIndex < 0) return { status: "absent", confirmations };
  const current = confirmations[currentIndex];
  if (!current) return { status: "absent", confirmations };
  confirmations[currentIndex] = { ...current, state: "revoked" };
  return { status: "revoked", confirmations };
}

export function toObservationConfirmation(row: {
  id: string;
  user_id: string;
  plaid_transaction_id: string;
  budget_target_id: string;
  category_name: string;
  signed_cents: number | string;
  posted_date: string;
  transaction_name: string;
  category_text: string | null;
  account_id: string;
  pending: boolean;
  confirmed_at: string;
  state: string;
}): ObservationConfirmation | null {
  if (row.pending !== false) return null;
  if (!CONFIRMATION_STATES.includes(row.state as ConfirmationState)) return null;
  const signedCents =
    typeof row.signed_cents === "number"
      ? row.signed_cents
      : Number(row.signed_cents);
  if (!Number.isInteger(signedCents)) return null;
  return {
    id: row.id,
    userId: row.user_id,
    plaidTransactionId: row.plaid_transaction_id,
    budgetTargetId: row.budget_target_id,
    categoryName: row.category_name,
    signedCents,
    postedDate: row.posted_date,
    transactionName: row.transaction_name,
    categoryText: row.category_text,
    accountId: row.account_id,
    pending: false,
    confirmedAt: row.confirmed_at,
    state: row.state as ConfirmationState,
  };
}
