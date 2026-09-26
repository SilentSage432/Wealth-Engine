/**
 * Correlated Internal Movement.
 *
 * Two posted Plaid observations read as opposite sides of one movement
 * between accounts already visible on the same Plaid Item. Derived only.
 * Not stored, not confirmed, and not a ledger transfer.
 */

import { roundMoney } from "@/lib/babylon/engine";

/** Narrow observation view. Names, masks, and processing flags stay outside. */
export type CorrelatedMovementObservation = {
  plaidTransactionId: string;
  accountId: string;
  userId: string;
  amount: number;
  category: string | null;
  date: string;
  pending: boolean;
  removed: boolean;
};

/** Narrow account view. Identity only: no name, mask, or balance. */
export type CorrelatedMovementAccount = {
  userId: string;
  plaidItemId: string;
  plaidAccountId: string;
  accountType: string | null;
  subtype: string | null;
};

export type CorrelatedInternalMovementKind =
  | "internal_transfer"
  | "credit_card_payment";

export type CorrelatedInternalMovementFact =
  | "posted"
  | "current"
  | "different_transaction"
  | "different_account"
  | "known_account_identity"
  | "same_user"
  | "same_item"
  | "same_date"
  | "opposite_amount"
  | "transfer_category_pair"
  | "credit_payment_pair"
  | "depository_accounts"
  | "credit_and_depository_accounts"
  | "unique_counterpart";

export type CorrelatedInternalMovement = {
  sourcePlaidTransactionId: string;
  destinationPlaidTransactionId: string;
  sourcePlaidAccountId: string;
  destinationPlaidAccountId: string;
  plaidItemId: string;
  date: string;
  absoluteAmount: number;
  kind: CorrelatedInternalMovementKind;
  evidence: readonly CorrelatedInternalMovementFact[];
};

const TRANSFER_WITHDRAWAL = "Transfer / Withdrawal";
const TRANSFER_DEPOSIT = "Transfer / Deposit";
const CREDIT_CARD_PAYMENT = "Payment / Credit Card";

const TRANSFER_EVIDENCE = [
  "posted",
  "current",
  "different_transaction",
  "different_account",
  "known_account_identity",
  "same_user",
  "same_item",
  "same_date",
  "opposite_amount",
  "transfer_category_pair",
  "depository_accounts",
  "unique_counterpart",
] as const satisfies readonly CorrelatedInternalMovementFact[];

const CREDIT_PAYMENT_EVIDENCE = [
  "posted",
  "current",
  "different_transaction",
  "different_account",
  "known_account_identity",
  "same_user",
  "same_item",
  "same_date",
  "opposite_amount",
  "credit_payment_pair",
  "credit_and_depository_accounts",
  "unique_counterpart",
] as const satisfies readonly CorrelatedInternalMovementFact[];

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

type EligibleObservation = {
  observation: CorrelatedMovementObservation;
  account: CorrelatedMovementAccount;
  cents: number;
};

type Candidate = {
  moneyOut: EligibleObservation;
  moneyIn: EligibleObservation;
  kind: CorrelatedInternalMovementKind;
  absoluteCents: number;
};

function hasText(value: string | null | undefined): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

/** Same calendar-day check used when an observation date is stored. */
function isIsoDate(value: string): boolean {
  const match = ISO_DATE.exec(value);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(year, month - 1, day);
  return (
    date.getFullYear() === year &&
    date.getMonth() === month - 1 &&
    date.getDate() === day
  );
}

function normalizedCents(amount: number): number {
  return Math.round(roundMoney(amount) * 100);
}

function accountKey(userId: string, plaidAccountId: string): string {
  return JSON.stringify([userId, plaidAccountId]);
}

function isInternalTransfer(
  moneyOut: EligibleObservation,
  moneyIn: EligibleObservation
): boolean {
  return (
    moneyOut.account.accountType === "depository" &&
    moneyIn.account.accountType === "depository" &&
    moneyOut.observation.category === TRANSFER_WITHDRAWAL &&
    moneyIn.observation.category === TRANSFER_DEPOSIT
  );
}

function isCreditCardPayment(
  moneyOut: EligibleObservation,
  moneyIn: EligibleObservation
): boolean {
  return (
    moneyOut.account.accountType === "depository" &&
    moneyIn.account.accountType === "credit" &&
    moneyIn.account.subtype === "credit card" &&
    moneyOut.observation.category === CREDIT_CARD_PAYMENT &&
    moneyIn.observation.category === CREDIT_CARD_PAYMENT
  );
}

function movementKind(
  left: EligibleObservation,
  right: EligibleObservation
): CorrelatedInternalMovementKind | null {
  if (left.observation.plaidTransactionId === right.observation.plaidTransactionId) {
    return null;
  }
  if (left.observation.accountId === right.observation.accountId) return null;
  if (left.observation.userId !== right.observation.userId) return null;
  if (left.account.plaidItemId !== right.account.plaidItemId) return null;
  if (left.observation.date !== right.observation.date) return null;
  if (Math.abs(left.cents) !== Math.abs(right.cents)) return null;
  if (left.cents === 0 || right.cents === 0) return null;
  if (Math.sign(left.cents) === Math.sign(right.cents)) return null;

  const moneyOut = left.cents > 0 ? left : right;
  const moneyIn = left.cents < 0 ? left : right;
  const transfer = isInternalTransfer(moneyOut, moneyIn);
  const cardPayment = isCreditCardPayment(moneyOut, moneyIn);
  if (transfer === cardPayment) return null;
  return transfer ? "internal_transfer" : "credit_card_payment";
}

function eligibleObservations(
  observations: readonly CorrelatedMovementObservation[],
  accounts: readonly CorrelatedMovementAccount[]
): EligibleObservation[] {
  const transactionCounts = new Map<string, number>();
  for (const observation of observations) {
    const id = observation.plaidTransactionId;
    transactionCounts.set(id, (transactionCounts.get(id) ?? 0) + 1);
  }

  const accountsByKey = new Map<string, CorrelatedMovementAccount[]>();
  for (const account of accounts) {
    const key = accountKey(account.userId, account.plaidAccountId);
    const group = accountsByKey.get(key);
    if (group) group.push(account);
    else accountsByKey.set(key, [account]);
  }

  const eligible: EligibleObservation[] = [];
  for (const observation of observations) {
    if (observation.pending || observation.removed) continue;
    if (!hasText(observation.userId)) continue;
    if (!hasText(observation.plaidTransactionId)) continue;
    if (!hasText(observation.accountId)) continue;
    if ((transactionCounts.get(observation.plaidTransactionId) ?? 0) !== 1) continue;
    if (!isIsoDate(observation.date)) continue;
    if (!Number.isFinite(observation.amount)) continue;
    const cents = normalizedCents(observation.amount);
    if (cents === 0) continue;

    const matches = accountsByKey.get(
      accountKey(observation.userId, observation.accountId)
    );
    if (!matches || matches.length !== 1) continue;
    const account = matches[0];
    if (!hasText(account.accountType) || !hasText(account.plaidItemId)) continue;

    eligible.push({ observation, account, cents });
  }
  return eligible;
}

function compareMovements(
  left: { movement: CorrelatedInternalMovement; absoluteCents: number },
  right: { movement: CorrelatedInternalMovement; absoluteCents: number }
): number {
  if (left.movement.date !== right.movement.date) {
    return left.movement.date < right.movement.date ? -1 : 1;
  }
  if (left.absoluteCents !== right.absoluteCents) {
    return left.absoluteCents - right.absoluteCents;
  }
  if (left.movement.kind !== right.movement.kind) {
    return left.movement.kind < right.movement.kind ? -1 : 1;
  }
  if (
    left.movement.sourcePlaidTransactionId !==
    right.movement.sourcePlaidTransactionId
  ) {
    return left.movement.sourcePlaidTransactionId <
      right.movement.sourcePlaidTransactionId
      ? -1
      : 1;
  }
  if (
    left.movement.destinationPlaidTransactionId !==
    right.movement.destinationPlaidTransactionId
  ) {
    return left.movement.destinationPlaidTransactionId <
      right.movement.destinationPlaidTransactionId
      ? -1
      : 1;
  }
  return 0;
}

/**
 * Derive correlated internal movements from observations and account identity.
 * Unmatched and ambiguous observations are omitted. Input order does not
 * change the result. Future inflow or outflow reasoning may treat the
 * returned transaction ids as exclusions. This function does not record them.
 */
export function deriveCorrelatedInternalMovements(input: {
  observations: readonly CorrelatedMovementObservation[];
  accounts: readonly CorrelatedMovementAccount[];
}): readonly CorrelatedInternalMovement[] {
  const eligible = eligibleObservations(input.observations, input.accounts);
  const candidates: Candidate[] = [];
  const partners = new Map<string, string[]>();

  for (let index = 0; index < eligible.length; index += 1) {
    for (let other = index + 1; other < eligible.length; other += 1) {
      const left = eligible[index];
      const right = eligible[other];
      const kind = movementKind(left, right);
      if (!kind) continue;
      const moneyOut = left.cents > 0 ? left : right;
      const moneyIn = left.cents < 0 ? left : right;
      candidates.push({
        moneyOut,
        moneyIn,
        kind,
        absoluteCents: Math.abs(moneyOut.cents),
      });
      const sourceId = moneyOut.observation.plaidTransactionId;
      const destinationId = moneyIn.observation.plaidTransactionId;
      const sourcePartners = partners.get(sourceId);
      if (sourcePartners) sourcePartners.push(destinationId);
      else partners.set(sourceId, [destinationId]);
      const destinationPartners = partners.get(destinationId);
      if (destinationPartners) destinationPartners.push(sourceId);
      else partners.set(destinationId, [sourceId]);
    }
  }

  const ranked: {
    movement: CorrelatedInternalMovement;
    absoluteCents: number;
  }[] = [];

  for (const candidate of candidates) {
    const sourceId = candidate.moneyOut.observation.plaidTransactionId;
    const destinationId = candidate.moneyIn.observation.plaidTransactionId;
    const sourcePartners = partners.get(sourceId);
    const destinationPartners = partners.get(destinationId);
    if (!sourcePartners || sourcePartners.length !== 1) continue;
    if (!destinationPartners || destinationPartners.length !== 1) continue;
    if (sourcePartners[0] !== destinationId) continue;
    if (destinationPartners[0] !== sourceId) continue;

    ranked.push({
      absoluteCents: candidate.absoluteCents,
      movement: {
        sourcePlaidTransactionId: sourceId,
        destinationPlaidTransactionId: destinationId,
        sourcePlaidAccountId: candidate.moneyOut.observation.accountId,
        destinationPlaidAccountId: candidate.moneyIn.observation.accountId,
        plaidItemId: candidate.moneyOut.account.plaidItemId,
        date: candidate.moneyOut.observation.date,
        absoluteAmount: roundMoney(candidate.absoluteCents / 100),
        kind: candidate.kind,
        evidence:
          candidate.kind === "internal_transfer"
            ? TRANSFER_EVIDENCE
            : CREDIT_PAYMENT_EVIDENCE,
      },
    });
  }

  ranked.sort(compareMovements);
  return ranked.map((entry) => entry.movement);
}
