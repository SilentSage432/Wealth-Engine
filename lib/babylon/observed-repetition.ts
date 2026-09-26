/**
 * Observed repetition.
 *
 * Current posted observations that share a user, a Plaid account, a sign,
 * and exact normalized cents. Derived only. Not stored. Not a prediction.
 * Category text is evidence and does not decide membership.
 *
 * Positive signed cents mean money out of that Plaid account.
 * Negative signed cents mean money into that Plaid account.
 */

import { roundMoney } from "@/lib/babylon/engine";

/** Narrow observation view. Names, masks, and processing flags stay outside. */
export type ObservedRepetitionObservation = {
  plaidTransactionId: string;
  accountId: string;
  userId: string;
  amount: number;
  category: string | null;
  date: string;
  pending: boolean;
  removed: boolean;
};

/**
 * Account-relative direction.
 * `positive` is money out of that Plaid account.
 * `negative` is money into that Plaid account.
 */
export type ObservedRepetitionDirection = "positive" | "negative";

export type ObservedRepetitionFact =
  | "posted"
  | "current"
  | "same_account"
  | "same_user"
  | "same_sign"
  | "same_normalized_cents"
  | "distinct_transactions"
  | "category_text_equal"
  | "category_text_differs"
  | "category_text_absent"
  | "single_interval"
  | "intervals_agree"
  | "intervals_differ";

export type ObservedRepetition = {
  userId: string;
  accountId: string;
  direction: ObservedRepetitionDirection;
  /** Exact integer cents after `roundMoney`. Sign is account-relative direction. */
  signedCents: number;
  plaidTransactionIds: readonly string[];
  dates: readonly string[];
  /** Consecutive civil-day gaps after date, then transaction-id, order. */
  gapDays: readonly number[];
  categories: readonly (string | null)[];
  evidence: readonly ObservedRepetitionFact[];
};

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
const MS_PER_CIVIL_DAY = 86_400_000;

const BASE_EVIDENCE = [
  "posted",
  "current",
  "same_account",
  "same_user",
  "same_sign",
  "same_normalized_cents",
  "distinct_transactions",
] as const satisfies readonly ObservedRepetitionFact[];

type EligibleObservation = {
  plaidTransactionId: string;
  accountId: string;
  userId: string;
  signedCents: number;
  category: string | null;
  date: string;
  dayNumber: number;
};

function hasText(value: string | null | undefined): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

/** Valid civil date. UTC fields reject impossible days such as February 31. */
function parseCivilDate(
  value: string
): { date: string; dayNumber: number } | null {
  const match = ISO_DATE.exec(value);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const utc = new Date(Date.UTC(year, month - 1, day));
  if (
    utc.getUTCFullYear() !== year ||
    utc.getUTCMonth() !== month - 1 ||
    utc.getUTCDate() !== day
  ) {
    return null;
  }
  return {
    date: value,
    dayNumber: Date.UTC(year, month - 1, day) / MS_PER_CIVIL_DAY,
  };
}

function normalizedSignedCents(amount: number): number {
  return Math.round(roundMoney(amount) * 100);
}

function compareText(left: string, right: string): number {
  if (left === right) return 0;
  return left < right ? -1 : 1;
}

function compareMembers(
  left: EligibleObservation,
  right: EligibleObservation
): number {
  if (left.date !== right.date) return compareText(left.date, right.date);
  return compareText(left.plaidTransactionId, right.plaidTransactionId);
}

function groupKey(member: EligibleObservation): string {
  return JSON.stringify([
    member.userId,
    member.accountId,
    member.signedCents,
  ]);
}

function categoryFacts(
  categories: readonly (string | null)[]
): ObservedRepetitionFact[] {
  const facts: ObservedRepetitionFact[] = [];
  const nonNull: string[] = [];
  let absent = false;
  for (const category of categories) {
    if (category === null) absent = true;
    else nonNull.push(category);
  }
  const distinct = new Set(nonNull);
  if (!absent && distinct.size === 1) facts.push("category_text_equal");
  if (distinct.size >= 2) facts.push("category_text_differs");
  if (absent) facts.push("category_text_absent");
  return facts;
}

function intervalFact(memberCount: number, gapDays: readonly number[]): ObservedRepetitionFact {
  if (memberCount === 2) return "single_interval";
  const first = gapDays[0];
  for (const gap of gapDays) {
    if (gap !== first) return "intervals_differ";
  }
  return "intervals_agree";
}

function toStructure(members: readonly EligibleObservation[]): ObservedRepetition {
  const ordered = [...members].sort(compareMembers);
  const gapDays: number[] = [];
  for (let index = 1; index < ordered.length; index += 1) {
    gapDays.push(
      Math.round(ordered[index].dayNumber - ordered[index - 1].dayNumber)
    );
  }
  const categories = ordered.map((member) => member.category);
  const signedCents = ordered[0].signedCents;
  return {
    userId: ordered[0].userId,
    accountId: ordered[0].accountId,
    direction: signedCents > 0 ? "positive" : "negative",
    signedCents,
    plaidTransactionIds: ordered.map((member) => member.plaidTransactionId),
    dates: ordered.map((member) => member.date),
    gapDays,
    categories,
    evidence: [
      ...BASE_EVIDENCE,
      intervalFact(ordered.length, gapDays),
      ...categoryFacts(categories),
    ],
  };
}

function compareStructures(
  left: ObservedRepetition,
  right: ObservedRepetition
): number {
  const user = compareText(left.userId, right.userId);
  if (user !== 0) return user;
  const account = compareText(left.accountId, right.accountId);
  if (account !== 0) return account;
  if (left.direction !== right.direction) {
    return left.direction === "positive" ? -1 : 1;
  }
  if (left.signedCents !== right.signedCents) {
    return left.signedCents - right.signedCents;
  }
  const date = compareText(left.dates[0] ?? "", right.dates[0] ?? "");
  if (date !== 0) return date;
  return compareText(
    left.plaidTransactionIds[0] ?? "",
    right.plaidTransactionIds[0] ?? ""
  );
}

function eligibleObservations(
  observations: readonly ObservedRepetitionObservation[],
  excludedTransactionIds: ReadonlySet<string>
): EligibleObservation[] {
  const transactionCounts = new Map<string, number>();
  for (const observation of observations) {
    const id = observation.plaidTransactionId;
    transactionCounts.set(id, (transactionCounts.get(id) ?? 0) + 1);
  }

  const eligible: EligibleObservation[] = [];
  for (const observation of observations) {
    if (observation.pending !== false || observation.removed !== false) continue;
    if (!hasText(observation.userId)) continue;
    if (!hasText(observation.accountId)) continue;
    if (!hasText(observation.plaidTransactionId)) continue;
    if ((transactionCounts.get(observation.plaidTransactionId) ?? 0) !== 1) {
      continue;
    }
    if (excludedTransactionIds.has(observation.plaidTransactionId)) continue;
    if (observation.category !== null && typeof observation.category !== "string") {
      continue;
    }
    const civil = parseCivilDate(observation.date);
    if (!civil) continue;
    if (typeof observation.amount !== "number" || !Number.isFinite(observation.amount)) {
      continue;
    }
    const signedCents = normalizedSignedCents(observation.amount);
    if (signedCents === 0) continue;
    eligible.push({
      plaidTransactionId: observation.plaidTransactionId,
      accountId: observation.accountId,
      userId: observation.userId,
      signedCents,
      category: observation.category,
      date: civil.date,
      dayNumber: civil.dayNumber,
    });
  }
  return eligible;
}

/**
 * Derive repeated observation structures.
 * One eligible observation is omitted. Two or more that share user, account,
 * sign, and exact cents are returned with their observed gaps.
 * Input order does not change the result. Nothing is predicted or stored.
 */
export function deriveObservedRepetitions(input: {
  observations: readonly ObservedRepetitionObservation[];
  excludedTransactionIds?: ReadonlySet<string>;
}): readonly ObservedRepetition[] {
  const excluded = input.excludedTransactionIds ?? new Set<string>();
  const eligible = eligibleObservations(input.observations, excluded);
  const groups = new Map<string, EligibleObservation[]>();
  for (const member of eligible) {
    const key = groupKey(member);
    const group = groups.get(key);
    if (group) group.push(member);
    else groups.set(key, [member]);
  }

  const structures: ObservedRepetition[] = [];
  for (const members of groups.values()) {
    if (members.length < 2) continue;
    structures.push(toStructure(members));
  }
  structures.sort(compareStructures);
  return structures;
}
