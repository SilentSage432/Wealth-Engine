/**
 * Steward-declared Wealth Direction.
 *
 * This module owns standing intent for newly received Wealth Building
 * capacity. It does not allocate, move money, or infer intent from a
 * destination, a balance, a plan, or history.
 *
 * The only supported purpose is emergency_fund. The share is integer
 * basis points of IncomeEntry.wealthShare. Dollar splits are derived.
 */

import { roundMoney } from "@/lib/babylon/engine";
import type { FinancialDirectionDeclaration } from "@/types/babylon";

export const EMERGENCY_FUND_DIRECTION_PURPOSE = "emergency_fund" as const;

const REQUIRED_KEYS = [
  "id",
  "purpose",
  "basisPoints",
  "declaredAt",
  "supersedesId",
] as const;

const ABSOLUTE_INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Absolute declaration instant. A financial timezone does not reinterpret it. */
export function isDirectionInstant(value: unknown): value is string {
  if (typeof value !== "string" || !ABSOLUTE_INSTANT.test(value)) return false;
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString() === value;
}

function isBasisPoints(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isInteger(value) &&
    value >= 1 &&
    value <= 10000
  );
}

/**
 * Half-up division of a non-negative integer.
 * Same cent rule the income split uses: floor((n + floor(d / 2)) / d).
 */
function halfUpDiv(numerator: number, denominator: number): number {
  return Math.floor((numerator + Math.floor(denominator / 2)) / denominator);
}

function parseDeclaration(value: unknown): FinancialDirectionDeclaration | null {
  if (!isRecord(value)) return null;
  const keys = Object.keys(value);
  for (const key of keys) {
    if (!(REQUIRED_KEYS as readonly string[]).includes(key)) return null;
  }
  for (const key of REQUIRED_KEYS) {
    if (!Object.prototype.hasOwnProperty.call(value, key)) return null;
  }
  if (
    typeof value.id !== "string" ||
    value.id.trim().length === 0 ||
    value.id !== value.id.trim()
  ) {
    return null;
  }
  if (value.purpose !== EMERGENCY_FUND_DIRECTION_PURPOSE) return null;
  if (!isBasisPoints(value.basisPoints)) return null;
  if (!isDirectionInstant(value.declaredAt)) return null;
  if (value.supersedesId !== null) {
    if (
      typeof value.supersedesId !== "string" ||
      value.supersedesId.trim().length === 0 ||
      value.supersedesId !== value.supersedesId.trim()
    ) {
      return null;
    }
  }
  return {
    id: value.id,
    purpose: EMERGENCY_FUND_DIRECTION_PURPOSE,
    basisPoints: value.basisPoints,
    declaredAt: value.declaredAt,
    supersedesId: value.supersedesId,
  };
}

/**
 * One linked supersession chain, or null.
 * The current declaration is the tail: the row nothing else supersedes.
 */
export function directionChain(
  declarations: readonly FinancialDirectionDeclaration[]
): { current: FinancialDirectionDeclaration } | null {
  if (declarations.length === 0) return null;
  const byId = new Map<string, FinancialDirectionDeclaration>();
  for (const row of declarations) {
    if (byId.has(row.id)) return null;
    byId.set(row.id, row);
  }
  const roots = declarations.filter((row) => row.supersedesId === null);
  if (roots.length !== 1) return null;
  const supersededBy = new Map<string, FinancialDirectionDeclaration>();
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
export function parseFinancialDirections(
  value: unknown
): FinancialDirectionDeclaration[] | null {
  if (!Array.isArray(value)) return null;
  if (value.length === 0) return [];
  const declarations: FinancialDirectionDeclaration[] = [];
  for (const item of value) {
    const parsed = parseDeclaration(item);
    if (!parsed) return null;
    declarations.push(parsed);
  }
  if (!directionChain(declarations)) return null;
  return declarations;
}

export function currentFinancialDirection(
  declarations: readonly FinancialDirectionDeclaration[] | undefined
): FinancialDirectionDeclaration | null {
  if (!declarations || declarations.length === 0) return null;
  return directionChain(declarations)?.current ?? null;
}

export type WealthDirectionState =
  | { status: "no_direction" }
  | { status: "valid_direction"; declaration: FinancialDirectionDeclaration }
  | { status: "invalid" };

/**
 * Absence is no_direction. That is not 0% toward the Emergency Fund.
 * A readable tail is valid_direction. A broken chain is invalid.
 */
export function wealthDirectionState(
  declarations: readonly FinancialDirectionDeclaration[] | undefined
): WealthDirectionState {
  const rows = declarations ?? [];
  if (rows.length === 0) return { status: "no_direction" };
  const current = directionChain(rows)?.current;
  if (!current) return { status: "invalid" };
  return { status: "valid_direction", declaration: current };
}

export type AppendDirectionResult =
  | { ok: true; declarations: FinancialDirectionDeclaration[] }
  | { ok: false; reason: string };

/**
 * Append one Emergency Fund direction. Does not mutate the prior rows.
 * The first declaration supersedes nothing. A later one supersedes the current tail.
 */
export function appendEmergencyFundDirection(input: {
  declarations: readonly FinancialDirectionDeclaration[] | undefined;
  id: string;
  basisPoints: number;
  declaredAt: string;
}): AppendDirectionResult {
  const existing = input.declarations ?? [];
  if (existing.length > 0 && !directionChain(existing)) {
    return { ok: false, reason: "The existing direction history cannot be extended." };
  }
  if (
    typeof input.id !== "string" ||
    input.id.trim().length === 0 ||
    input.id !== input.id.trim()
  ) {
    return { ok: false, reason: "Enter a direction the ledger can store." };
  }
  if (existing.some((row) => row.id === input.id)) {
    return { ok: false, reason: "Enter a direction the ledger can store." };
  }
  if (!isBasisPoints(input.basisPoints)) {
    return { ok: false, reason: "Enter a share from 0.01% through 100%." };
  }
  if (!isDirectionInstant(input.declaredAt)) {
    return { ok: false, reason: "Enter a direction the ledger can store." };
  }
  const current = currentFinancialDirection(existing);
  const declaration: FinancialDirectionDeclaration = {
    id: input.id,
    purpose: EMERGENCY_FUND_DIRECTION_PURPOSE,
    basisPoints: input.basisPoints,
    declaredAt: input.declaredAt,
    supersedesId: current ? current.id : null,
  };
  return { ok: true, declarations: [...existing, declaration] };
}

export type DirectionIllustration =
  | {
      ok: true;
      source: number;
      basisPoints: number;
      directed: number;
      undirected: number;
    }
  | { ok: false; reason: string };

/**
 * Illustrate the current standing share against an explicitly supplied
 * Wealth Building capacity amount. The caller decides whether that amount
 * is received income. This function does not.
 */
export function illustrateWealthDirection(input: {
  wealthShare: number;
  basisPoints: number;
}): DirectionIllustration {
  if (!isBasisPoints(input.basisPoints)) {
    return { ok: false, reason: "The standing share cannot be applied." };
  }
  if (
    typeof input.wealthShare !== "number" ||
    !Number.isFinite(input.wealthShare) ||
    input.wealthShare < 0 ||
    roundMoney(input.wealthShare) !== input.wealthShare
  ) {
    return { ok: false, reason: "The supplied capacity cannot be illustrated." };
  }
  const wealthCents = Math.round(input.wealthShare * 100);
  const directedCents =
    input.basisPoints === 10000
      ? wealthCents
      : halfUpDiv(wealthCents * input.basisPoints, 10000);
  const undirectedCents = wealthCents - directedCents;
  return {
    ok: true,
    source: input.wealthShare,
    basisPoints: input.basisPoints,
    directed: roundMoney(directedCents / 100),
    undirected: roundMoney(undirectedCents / 100),
  };
}

/** Steward-facing share. 10000 basis points is 100%. */
export function formatDirectionShare(basisPoints: number): string {
  const whole = Math.trunc(basisPoints / 100);
  const fraction = Math.abs(basisPoints % 100);
  if (fraction === 0) return `${whole}%`;
  const digits = String(fraction).padStart(2, "0").replace(/0$/, "");
  return `${whole}.${digits}%`;
}
