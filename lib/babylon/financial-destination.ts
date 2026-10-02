/**
 * Steward-declared financial destination.
 *
 * This module owns destination declarations and the owned Emergency Fund
 * position they are compared with. It does not allocate, advise, or infer
 * a destination from balances, plans, or history.
 *
 * Owned Emergency Fund position is account-backed emergency_fund effective
 * balances plus the residual openingEmergencyFund designation. Restriction
 * does not reduce it. Tracked emergencyShield is not part of it.
 */

import { currentEmergencyFundPosition } from "@/lib/babylon/account-purpose";
import type { EffectiveAccountPosition } from "@/lib/babylon/balance-observation";
import { roundMoney } from "@/lib/babylon/engine";
import type { FinancialAccount, FinancialDestinationDeclaration } from "@/types/babylon";

export const OWNED_EMERGENCY_FUND_DIMENSION = "owned_emergency_fund" as const;
export const AT_LEAST_RELATION = "at_least" as const;

const REQUIRED_KEYS = [
  "id",
  "dimension",
  "relation",
  "amount",
  "declaredAt",
  "supersedesId",
] as const;

const OPTIONAL_KEYS = ["label", "rationale"] as const;

export const DESTINATION_LABEL_MAX = 80;
export const DESTINATION_RATIONALE_MAX = 240;

const ABSOLUTE_INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Absolute evidence instant. A financial timezone does not reinterpret it. */
export function isDestinationInstant(value: unknown): value is string {
  if (typeof value !== "string" || !ABSOLUTE_INSTANT.test(value)) return false;
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString() === value;
}

function isCanonicalMoney(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isFinite(value) &&
    value >= 0 &&
    roundMoney(value) === value
  );
}

function optionalStewardText(
  value: unknown,
  max: number
): string | null | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string") return null;
  if (value !== value.trim()) return null;
  if (value.length < 1 || value.length > max) return null;
  return value;
}

/**
 * Account-backed Emergency Fund effective balances plus residual
 * openingEmergencyFund. Uses the existing purpose-position sum.
 */
export function ownedEmergencyFundPosition(input: {
  accounts: readonly FinancialAccount[];
  positions: readonly EffectiveAccountPosition[];
  openingEmergencyFund: number;
}): number {
  return roundMoney(
    currentEmergencyFundPosition(input.accounts, input.positions) +
      roundMoney(input.openingEmergencyFund)
  );
}

function parseDeclaration(value: unknown): FinancialDestinationDeclaration | null {
  if (!isRecord(value)) return null;
  const keys = Object.keys(value);
  for (const key of keys) {
    if (
      !(REQUIRED_KEYS as readonly string[]).includes(key) &&
      !(OPTIONAL_KEYS as readonly string[]).includes(key)
    ) {
      return null;
    }
  }
  for (const key of REQUIRED_KEYS) {
    if (!Object.prototype.hasOwnProperty.call(value, key)) return null;
  }
  if (typeof value.id !== "string" || value.id.trim().length === 0 || value.id !== value.id.trim()) {
    return null;
  }
  if (value.dimension !== OWNED_EMERGENCY_FUND_DIMENSION) return null;
  if (value.relation !== AT_LEAST_RELATION) return null;
  if (!isCanonicalMoney(value.amount)) return null;
  if (!isDestinationInstant(value.declaredAt)) return null;
  if (value.supersedesId !== null) {
    if (
      typeof value.supersedesId !== "string" ||
      value.supersedesId.trim().length === 0 ||
      value.supersedesId !== value.supersedesId.trim()
    ) {
      return null;
    }
  }
  const label = optionalStewardText(value.label, DESTINATION_LABEL_MAX);
  if (label === null) return null;
  const rationale = optionalStewardText(value.rationale, DESTINATION_RATIONALE_MAX);
  if (rationale === null) return null;

  const declaration: FinancialDestinationDeclaration = {
    id: value.id,
    dimension: OWNED_EMERGENCY_FUND_DIMENSION,
    relation: AT_LEAST_RELATION,
    amount: value.amount,
    declaredAt: value.declaredAt,
    supersedesId: value.supersedesId,
  };
  if (label !== undefined) declaration.label = label;
  if (rationale !== undefined) declaration.rationale = rationale;
  return declaration;
}

/**
 * One linked supersession chain, or null.
 * The current declaration is the tail: the row nothing else supersedes.
 */
export function destinationChain(
  declarations: readonly FinancialDestinationDeclaration[]
): { current: FinancialDestinationDeclaration } | null {
  if (declarations.length === 0) return null;
  const byId = new Map<string, FinancialDestinationDeclaration>();
  for (const row of declarations) {
    if (byId.has(row.id)) return null;
    byId.set(row.id, row);
  }
  const roots = declarations.filter((row) => row.supersedesId === null);
  if (roots.length !== 1) return null;
  const supersededBy = new Map<string, FinancialDestinationDeclaration>();
  for (const row of declarations) {
    if (row.supersedesId === null) continue;
    if (!byId.has(row.supersedesId)) return null;
    if (row.supersedesId === row.id) return null;
    if (supersededBy.has(row.supersedesId)) return null;
    supersededBy.set(row.supersedesId, row);
  }
  let cursor = roots[0]!;
  const seen = new Set<string>();
  while (true) {
    if (seen.has(cursor.id)) return null;
    seen.add(cursor.id);
    const next = supersededBy.get(cursor.id);
    if (!next) break;
    cursor = next;
  }
  if (seen.size !== declarations.length) return null;
  return { current: cursor };
}

/**
 * Strict collection parse.
 * An empty array is a valid absence and returns [].
 * Any malformed row or a broken chain returns null. Partial chains are not kept.
 */
export function parseFinancialDestinations(
  value: unknown
): FinancialDestinationDeclaration[] | null {
  if (!Array.isArray(value)) return null;
  if (value.length === 0) return [];
  const declarations: FinancialDestinationDeclaration[] = [];
  for (const item of value) {
    const parsed = parseDeclaration(item);
    if (!parsed) return null;
    declarations.push(parsed);
  }
  if (!destinationChain(declarations)) return null;
  return declarations;
}

/** Tail of a valid chain. Empty and broken chains have no current declaration. */
export function currentFinancialDestination(
  declarations: readonly FinancialDestinationDeclaration[] | undefined
): FinancialDestinationDeclaration | null {
  if (!declarations || declarations.length === 0) return null;
  return destinationChain(declarations)?.current ?? null;
}

export type AppendDestinationResult =
  | { ok: true; declarations: FinancialDestinationDeclaration[] }
  | { ok: false; reason: string };

/**
 * Append one owned Emergency Fund minimum. Does not mutate the prior rows.
 * The first declaration supersedes nothing. A later one supersedes the current tail.
 */
export function appendOwnedEmergencyFundDestination(input: {
  declarations: readonly FinancialDestinationDeclaration[] | undefined;
  id: string;
  amount: number;
  declaredAt: string;
  label?: string;
  rationale?: string;
}): AppendDestinationResult {
  const existing = input.declarations ?? [];
  if (existing.length > 0 && !destinationChain(existing)) {
    return { ok: false, reason: "The existing destination history cannot be extended." };
  }
  if (typeof input.id !== "string" || input.id.trim().length === 0 || input.id !== input.id.trim()) {
    return { ok: false, reason: "Enter a destination the ledger can store." };
  }
  if (existing.some((row) => row.id === input.id)) {
    return { ok: false, reason: "Enter a destination the ledger can store." };
  }
  if (typeof input.amount !== "number" || !Number.isFinite(input.amount) || input.amount < 0) {
    return { ok: false, reason: "Enter a minimum of zero or more." };
  }
  const amount = roundMoney(input.amount);
  if (!isDestinationInstant(input.declaredAt)) {
    return { ok: false, reason: "Enter a destination the ledger can store." };
  }
  let label: string | undefined;
  if (input.label !== undefined) {
    if (typeof input.label !== "string") {
      return { ok: false, reason: "Enter a shorter label." };
    }
    const trimmed = input.label.trim();
    if (trimmed.length > DESTINATION_LABEL_MAX) {
      return { ok: false, reason: "Enter a shorter label." };
    }
    if (trimmed.length > 0) label = trimmed;
  }
  let rationale: string | undefined;
  if (input.rationale !== undefined) {
    if (typeof input.rationale !== "string") {
      return { ok: false, reason: "Enter a shorter note." };
    }
    const trimmed = input.rationale.trim();
    if (trimmed.length > DESTINATION_RATIONALE_MAX) {
      return { ok: false, reason: "Enter a shorter note." };
    }
    if (trimmed.length > 0) rationale = trimmed;
  }

  const current = currentFinancialDestination(existing);
  const declaration: FinancialDestinationDeclaration = {
    id: input.id,
    dimension: OWNED_EMERGENCY_FUND_DIMENSION,
    relation: AT_LEAST_RELATION,
    amount,
    declaredAt: input.declaredAt,
    supersedesId: current ? current.id : null,
  };
  if (label !== undefined) declaration.label = label;
  if (rationale !== undefined) declaration.rationale = rationale;

  return { ok: true, declarations: [...existing, declaration] };
}

export type DestinationTrustReason = "protected_overflow" | "cloud_conflict";

export type DestinationRelationship =
  | { status: "no_destination" }
  | {
      status: "unknown";
      reasons: readonly DestinationTrustReason[];
      /** The steward declaration, when the chain can be read. Distances are omitted. */
      declaration: FinancialDestinationDeclaration | null;
    }
  | {
      status: "known";
      relationship: "below" | "at_or_above";
      position: number;
      targetAmount: number;
      remaining: number;
      amountAbove: number;
      declaredAt: string;
      declaration: FinancialDestinationDeclaration;
    };

function moneyCents(value: number): number {
  return Math.round(roundMoney(value) * 100);
}

/**
 * Current relationship of owned Emergency Fund position to the current declaration.
 * No declaration is no_destination, including when position evidence is untrustworthy.
 * A declaration with untrustworthy position is unknown and carries no distance.
 */
export function deriveEmergencyFundDestinationRelationship(input: {
  declarations: readonly FinancialDestinationDeclaration[] | undefined;
  ownedEmergencyFundPosition: number;
  protectedOverflow: boolean;
  cloudConflict: boolean;
}): DestinationRelationship {
  const declared = input.declarations ?? [];
  const current = currentFinancialDestination(declared);
  if (!current) {
    if (declared.length > 0) {
      return { status: "unknown", reasons: [], declaration: null };
    }
    return { status: "no_destination" };
  }

  const reasons: DestinationTrustReason[] = [];
  if (input.protectedOverflow) reasons.push("protected_overflow");
  if (input.cloudConflict) reasons.push("cloud_conflict");
  if (!Number.isFinite(input.ownedEmergencyFundPosition) || reasons.length > 0) {
    return { status: "unknown", reasons, declaration: current };
  }

  const position = roundMoney(input.ownedEmergencyFundPosition);
  const targetAmount = current.amount;
  const positionCents = moneyCents(position);
  const targetCents = moneyCents(targetAmount);
  const relationship = positionCents < targetCents ? "below" : "at_or_above";
  const remaining =
    relationship === "below"
      ? roundMoney((targetCents - positionCents) / 100)
      : 0;
  const amountAbove =
    relationship === "at_or_above"
      ? roundMoney((positionCents - targetCents) / 100)
      : 0;

  return {
    status: "known",
    relationship,
    position,
    targetAmount,
    remaining,
    amountAbove,
    declaredAt: current.declaredAt,
    declaration: current,
  };
}
