/**
 * Debt purpose vs debt position (WE-ALLOCATION-EXECUTION-005).
 *
 * PURPOSE — money assigned toward debt (allocations + per-creditor attribution).
 * POSITION — steward-authoritative current owed (DebtEntry.remainingDebt after epoch).
 * EXECUTION — future; not implemented here.
 *
 * Legacy vaults (debtSemanticsVersion 1) keep applyDebtAllocation mutating
 * remainingDebt as modeled purpose progress until the steward completes rebase.
 */

import { roundMoney } from "@/lib/babylon/engine";
import type { DebtEntry, DebtPurposeAttribution } from "@/types/babylon";

export type { DebtPurposeAttribution };

/** Legacy: remainingDebt mutates from allocation (modeled progress). */
export const DEBT_SEMANTICS_LEGACY = 1 as const;

/** Position epoch: remainingDebt is authoritative owed; allocation does not mutate it. */
export const DEBT_SEMANTICS_POSITION = 2 as const;

export type DebtSemanticsVersion =
  | typeof DEBT_SEMANTICS_LEGACY
  | typeof DEBT_SEMANTICS_POSITION;

export type DebtPositionDeclaration = {
  debtId: string;
  currentOwed: number;
};

export function isDebtPositionEpoch(
  debtSemanticsVersion: number
): boolean {
  return debtSemanticsVersion === DEBT_SEMANTICS_POSITION;
}

/**
 * Missing marker: empty debt list → position era (nothing to rebase).
 * Any existing debt without marker stays legacy until steward transition.
 */
export function resolveDebtSemanticsVersion(
  raw: unknown,
  debtCount: number
): DebtSemanticsVersion {
  if (raw === DEBT_SEMANTICS_POSITION) return DEBT_SEMANTICS_POSITION;
  if (raw === DEBT_SEMANTICS_LEGACY) return DEBT_SEMANTICS_LEGACY;
  return debtCount === 0 ? DEBT_SEMANTICS_POSITION : DEBT_SEMANTICS_LEGACY;
}

export function needsDebtPositionTransition(input: {
  debtSemanticsVersion: number;
  debts: readonly DebtEntry[];
}): boolean {
  return (
    !isDebtPositionEpoch(input.debtSemanticsVersion) &&
    input.debts.length > 0
  );
}

/**
 * Snowball purpose attribution. Does not mutate debts.
 * Order: ascending remainingDebt, then id (stable ties).
 * Never attributes more than each debt's authoritative remainingDebt.
 * Aggregate AllocationEvent.debt may still exceed sum(attributions).
 */
export function attributeDebtPurpose(
  debts: readonly DebtEntry[],
  amount: number
): Array<{ debtId: string; amount: number }> {
  if (amount <= 0 || debts.length === 0) return [];

  let remaining = roundMoney(amount);
  const ordered = debts
    .filter((debt) => debt.remainingDebt > 0)
    .map((debt) => ({ ...debt }))
    .sort((a, b) => {
      const byBalance = a.remainingDebt - b.remainingDebt;
      if (byBalance !== 0) return byBalance;
      return a.id.localeCompare(b.id);
    });

  const out: Array<{ debtId: string; amount: number }> = [];
  for (const debt of ordered) {
    if (remaining <= 0) break;
    const room = roundMoney(Math.max(0, debt.remainingDebt));
    if (room <= 0) continue;
    const applied = roundMoney(Math.min(room, remaining));
    if (applied <= 0) continue;
    out.push({ debtId: debt.id, amount: applied });
    remaining = roundMoney(remaining - applied);
  }
  return out;
}

export function buildDebtPurposeAttributions(input: {
  debts: readonly DebtEntry[];
  amount: number;
  allocationEventId: string;
  date: string;
  monthKey: string;
  createId: () => string;
}): DebtPurposeAttribution[] {
  return attributeDebtPurpose(input.debts, input.amount).map((row) => ({
    id: input.createId(),
    allocationEventId: input.allocationEventId,
    debtId: row.debtId,
    amount: row.amount,
    date: input.date,
    monthKey: input.monthKey,
  }));
}

/**
 * Complete the all-or-nothing steward rebase.
 * Snapshots legacy modeled remaining, sets authoritative owed, activates epoch.
 */
export function completeDebtPositionTransition(input: {
  debts: readonly DebtEntry[];
  declarations: readonly DebtPositionDeclaration[];
  epochAt: string;
}):
  | {
      ok: true;
      debts: DebtEntry[];
      debtSemanticsVersion: typeof DEBT_SEMANTICS_POSITION;
      debtPositionEpochAt: string;
    }
  | { ok: false; reason: string } {
  if (input.debts.length === 0) {
    return {
      ok: true,
      debts: [],
      debtSemanticsVersion: DEBT_SEMANTICS_POSITION,
      debtPositionEpochAt: input.epochAt,
    };
  }

  if (input.declarations.length !== input.debts.length) {
    return {
      ok: false,
      reason: "Declare current owed for every recorded debt before continuing.",
    };
  }

  const byId = new Map(
    input.declarations.map((row) => [row.debtId, row.currentOwed] as const)
  );
  if (byId.size !== input.declarations.length) {
    return { ok: false, reason: "Each debt may be declared only once." };
  }

  for (const debt of input.debts) {
    if (!byId.has(debt.id)) {
      return {
        ok: false,
        reason: "Declare current owed for every recorded debt before continuing.",
      };
    }
  }

  const next: DebtEntry[] = [];
  for (const debt of input.debts) {
    const owed = byId.get(debt.id);
    if (owed === undefined || !Number.isFinite(owed) || owed < 0) {
      return {
        ok: false,
        reason: `Enter a valid current amount owed for ${debt.creditor}.`,
      };
    }
    next.push({
      ...debt,
      legacyModeledRemaining: roundMoney(debt.remainingDebt),
      remainingDebt: roundMoney(owed),
    });
  }

  return {
    ok: true,
    debts: next,
    debtSemanticsVersion: DEBT_SEMANTICS_POSITION,
    debtPositionEpochAt: input.epochAt,
  };
}

/** Remove purpose rows for one allocation event (income delete). */
export function withoutAttributionsForAllocation(
  attributions: readonly DebtPurposeAttribution[],
  allocationEventId: string
): DebtPurposeAttribution[] {
  return attributions.filter(
    (row) => row.allocationEventId !== allocationEventId
  );
}

export function withoutAttributionsForIncome(
  attributions: readonly DebtPurposeAttribution[],
  allocationEventIds: readonly string[]
): DebtPurposeAttribution[] {
  const drop = new Set(allocationEventIds);
  return attributions.filter((row) => !drop.has(row.allocationEventId));
}

export function sumAttributedPurpose(
  attributions: readonly DebtPurposeAttribution[],
  debtId?: string
): number {
  return roundMoney(
    attributions
      .filter((row) => (debtId ? row.debtId === debtId : true))
      .reduce((sum, row) => sum + row.amount, 0)
  );
}
