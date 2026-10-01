import { describe, expect, it } from "vitest";
import {
  attributeDebtPurpose,
  buildDebtPurposeAttributions,
  completeDebtPositionTransition,
  DEBT_SEMANTICS_LEGACY,
  DEBT_SEMANTICS_POSITION,
  isDebtPositionEpoch,
  needsDebtPositionTransition,
  resolveDebtSemanticsVersion,
  sumAttributedPurpose,
  withoutAttributionsForAllocation,
} from "@/lib/babylon/debt-semantics";
import {
  allocateIncome,
  applyDebtAllocation,
  reverseDebtAllocation,
  roundMoney,
  totalRemainingDebt,
} from "@/lib/babylon/engine";
import {
  buildLedgerBackup,
  LEDGER_BACKUP_VERSION,
  normalizePersistedState,
  validateLedgerBackup,
} from "@/lib/babylon/persistence";
import { EMPTY_STATE } from "@/lib/babylon/constants";
import type { DebtEntry, PersistedState } from "@/types/babylon";

function debt(
  partial: Partial<DebtEntry> &
    Pick<DebtEntry, "id" | "creditor" | "remainingDebt">
): DebtEntry {
  return {
    totalDebt: partial.totalDebt ?? partial.remainingDebt,
    monthlyAllocation: partial.monthlyAllocation ?? 50,
    createdAt: partial.createdAt ?? "2026-01-01",
    interestRate: partial.interestRate ?? 0,
    ...partial,
  };
}

describe("debt semantics resolution", () => {
  it("A: missing marker with debts stays legacy (not silently authoritative)", () => {
    expect(resolveDebtSemanticsVersion(undefined, 2)).toBe(DEBT_SEMANTICS_LEGACY);
    expect(isDebtPositionEpoch(DEBT_SEMANTICS_LEGACY)).toBe(false);
  });

  it("empty vault soft-migrates to position era", () => {
    expect(resolveDebtSemanticsVersion(undefined, 0)).toBe(DEBT_SEMANTICS_POSITION);
    expect(normalizePersistedState({}).debtSemanticsVersion).toBe(
      DEBT_SEMANTICS_POSITION
    );
  });

  it("B/C: transition requires every debt; incomplete does not activate", () => {
    const debts = [
      debt({ id: "a", creditor: "Visa", remainingDebt: 600 }),
      debt({ id: "b", creditor: "Store", remainingDebt: 400 }),
    ];
    expect(
      needsDebtPositionTransition({
        debtSemanticsVersion: DEBT_SEMANTICS_LEGACY,
        debts,
      })
    ).toBe(true);

    const incomplete = completeDebtPositionTransition({
      debts,
      declarations: [{ debtId: "a", currentOwed: 725 }],
      epochAt: "2026-09-29T12:00:00.000Z",
    });
    expect(incomplete.ok).toBe(false);

    const cancelledSemantics = DEBT_SEMANTICS_LEGACY;
    expect(isDebtPositionEpoch(cancelledSemantics)).toBe(false);
  });

  it("D: preserves legacy modeled remaining as context", () => {
    const debts = [debt({ id: "a", creditor: "Visa", remainingDebt: 600 })];
    const outcome = completeDebtPositionTransition({
      debts,
      declarations: [{ debtId: "a", currentOwed: 725 }],
      epochAt: "2026-09-29T12:00:00.000Z",
    });
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.debts[0].legacyModeledRemaining).toBe(600);
    expect(outcome.debts[0].remainingDebt).toBe(725);
    expect(outcome.debtSemanticsVersion).toBe(DEBT_SEMANTICS_POSITION);
  });
});

describe("post-epoch purpose attribution without position mutation", () => {
  const visa = debt({
    id: "visa",
    creditor: "Visa",
    remainingDebt: 725,
    totalDebt: 1000,
  });
  const store = debt({
    id: "store",
    creditor: "Store",
    remainingDebt: 200,
    totalDebt: 500,
  });

  it("E/H/J: attribution uses authoritative owed and does not mutate debts", () => {
    const before = totalRemainingDebt([visa, store]);
    const rows = attributeDebtPurpose([visa, store], 160);
    // Snowball: store (200) first, then visa
    expect(rows).toEqual([
      { debtId: "store", amount: 160 },
    ]);
    expect(visa.remainingDebt).toBe(725);
    expect(store.remainingDebt).toBe(200);
    expect(totalRemainingDebt([visa, store])).toBe(before);
  });

  it("T: over-allocation keeps aggregate purpose room capped per creditor", () => {
    // Authoritative owed total room = 925. Canonical debt share 800.
    const split = allocateIncome(4000, true);
    expect(split.debtShare).toBe(800);

    const attributions = attributeDebtPurpose([visa, store], split.debtShare);
    const attributed = roundMoney(
      attributions.reduce((sum, row) => sum + row.amount, 0)
    );
    // Full room attributed: store 200 + visa 725 = 925 > 800? Wait 800 < 925
    // so full 800 is attributed; excess case needs share > room.
    expect(attributed).toBe(800);
    expect(attributions.find((r) => r.debtId === "store")?.amount).toBe(200);
    expect(attributions.find((r) => r.debtId === "visa")?.amount).toBe(600);

    // True over-allocation: $1000 purpose vs $925 room
    const over = attributeDebtPurpose([visa, store], 1000);
    const overSum = roundMoney(over.reduce((s, r) => s + r.amount, 0));
    expect(overSum).toBe(925);
    expect(overSum).toBeLessThan(1000);
    // Aggregate AllocationEvent.debt would still record 1000; attribution does not.
  });

  it("K/L: purpose reaching modeled zero does not clear authoritative owed", () => {
    // Modeled would go to zero, but position epoch does not call applyDebtAllocation.
    const debts = [debt({ id: "visa", creditor: "Visa", remainingDebt: 100 })];
    const purpose = attributeDebtPurpose(debts, 200);
    expect(sumAttributedPurpose(
      purpose.map((row) => ({
        id: "x",
        allocationEventId: "e",
        debtId: row.debtId,
        amount: row.amount,
        date: "2026-09-01",
        monthKey: "2026-09",
      })),
      "visa"
    )).toBe(100);
    expect(debts[0].remainingDebt).toBe(100);
    expect(debts.some((d) => d.remainingDebt > 0)).toBe(true);
  });

  it("legacy apply still mutates for pre-epoch paths", () => {
    const debts = [debt({ id: "visa", creditor: "Visa", remainingDebt: 725 })];
    const next = applyDebtAllocation(debts, 200);
    expect(next[0].remainingDebt).toBe(525);
    const reversed = reverseDebtAllocation(next, 200);
    expect(reversed[0].remainingDebt).toBe(725);
  });

  it("tie-break is deterministic by id", () => {
    const a = debt({ id: "a", creditor: "A", remainingDebt: 100 });
    const b = debt({ id: "b", creditor: "B", remainingDebt: 100 });
    expect(attributeDebtPurpose([b, a], 50)).toEqual([
      { debtId: "a", amount: 50 },
    ]);
  });

  it("build + remove attributions by allocation event", () => {
    const rows = buildDebtPurposeAttributions({
      debts: [visa],
      amount: 50,
      allocationEventId: "alloc-1",
      date: "2026-09-01",
      monthKey: "2026-09",
      createId: () => "attr-1",
    });
    expect(rows).toHaveLength(1);
    expect(
      withoutAttributionsForAllocation(
        [...rows, { ...rows[0], id: "other", allocationEventId: "alloc-2" }],
        "alloc-1"
      )
    ).toHaveLength(1);
  });
});

describe("import / backup fail-closed", () => {
  it("U/V: pre-v7 backup with debts imports as legacy, not position", () => {
    const state: PersistedState = {
      ...EMPTY_STATE,
      debts: [debt({ id: "visa", creditor: "Visa", remainingDebt: 600 })],
      debtSemanticsVersion: DEBT_SEMANTICS_LEGACY,
      debtPositionEpochAt: null,
      debtPurposeAttributions: [],
      accounts: [],
      openingWealthBuilding: 0,
      openingEmergencyFund: 0,
      recurringObligations: [],
      monthlyPlans: [],
    };
    const v6 = {
      ...buildLedgerBackup(state),
      version: 6 as const,
    };
    delete (v6 as { debtSemanticsVersion?: number }).debtSemanticsVersion;
    delete (v6 as { debtPositionEpochAt?: string | null }).debtPositionEpochAt;
    delete (v6 as { debtPurposeAttributions?: unknown }).debtPurposeAttributions;

    const restored = validateLedgerBackup(v6);
    expect(restored).not.toBeNull();
    expect(restored?.debtSemanticsVersion).toBe(DEBT_SEMANTICS_LEGACY);
    expect(restored?.debtPurposeAttributions).toEqual([]);
  });

  it("v7 round-trips epoch fields", () => {
    const state: PersistedState = {
      ...EMPTY_STATE,
      debts: [
        debt({
          id: "visa",
          creditor: "Visa",
          remainingDebt: 725,
          legacyModeledRemaining: 600,
        }),
      ],
      debtSemanticsVersion: DEBT_SEMANTICS_POSITION,
      debtPositionEpochAt: "2026-09-29T12:00:00.000Z",
      debtPurposeAttributions: [
        {
          id: "attr-1",
          allocationEventId: "alloc-1",
          debtId: "visa",
          amount: 40,
          date: "2026-09-30",
          monthKey: "2026-09",
        },
      ],
    };
    const backup = buildLedgerBackup(state);
    expect(backup.version).toBe(LEDGER_BACKUP_VERSION);
    expect(LEDGER_BACKUP_VERSION).toBe(11);
    const restored = validateLedgerBackup(backup);
    expect(restored?.debtSemanticsVersion).toBe(DEBT_SEMANTICS_POSITION);
    expect(restored?.debtPositionEpochAt).toBe("2026-09-29T12:00:00.000Z");
    expect(restored?.debtPurposeAttributions).toHaveLength(1);
    expect(restored?.debts[0].legacyModeledRemaining).toBe(600);
  });

  it("v7 position vault born without epoch stamp still imports", () => {
    const backup = buildLedgerBackup({
      ...EMPTY_STATE,
      debts: [debt({ id: "visa", creditor: "Visa", remainingDebt: 100 })],
      debtSemanticsVersion: DEBT_SEMANTICS_POSITION,
      debtPositionEpochAt: null,
    });
    const restored = validateLedgerBackup(backup);
    expect(restored?.debtSemanticsVersion).toBe(DEBT_SEMANTICS_POSITION);
    expect(restored?.debts[0].remainingDebt).toBe(100);
  });
});

describe("canonical 10/20/70 unchanged", () => {
  it("W: allocateIncome still penny-exact", () => {
    const withDebt = allocateIncome(100, true);
    expect(withDebt.wealthShare).toBe(10);
    expect(withDebt.debtShare).toBe(20);
    expect(withDebt.expenditureShare).toBe(70);
    expect(withDebt.debtRedirected).toBe(false);

    const free = allocateIncome(100, false);
    expect(free.wealthShare).toBe(30);
    expect(free.debtShare).toBe(0);
    expect(free.expenditureShare).toBe(70);
    expect(free.debtRedirected).toBe(true);
  });
});
