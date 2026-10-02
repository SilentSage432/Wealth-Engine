import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { EMPTY_STATE } from "@/lib/babylon/constants";
import {
  financialVaultFingerprint,
  parseCloudVaultData,
  serializeCloudVaultData,
} from "@/lib/babylon/cloud-vault";
import { allocateIncome } from "@/lib/babylon/engine";
import {
  appendEmergencyFundDirection,
  currentFinancialDirection,
  illustrateWealthDirection,
  parseFinancialDirections,
  wealthDirectionState,
} from "@/lib/babylon/financial-direction";
import {
  buildLedgerBackup,
  LEDGER_BACKUP_VERSION,
  normalizePersistedState,
  validateLedgerBackup,
} from "@/lib/babylon/persistence";
import { compareVaultStructure } from "@/lib/babylon/vault-structural-diff";
import type {
  AllocationEvent,
  FinancialDirectionDeclaration,
  IncomeEntry,
  PersistedState,
} from "@/types/babylon";

const INSTANT = "2026-10-01T18:00:00.000Z";
const LATER = "2026-10-02T18:00:00.000Z";

function declaration(
  partial: Partial<FinancialDirectionDeclaration> & Pick<FinancialDirectionDeclaration, "id" | "supersedesId">
): FinancialDirectionDeclaration {
  return {
    purpose: "emergency_fund",
    basisPoints: 5000,
    declaredAt: INSTANT,
    ...partial,
  };
}

function cents(value: number): number {
  return Math.round(value * 100);
}

describe("wealth direction declarations", () => {
  it("accepts only emergency_fund and integer basis points from 1 through 10000", () => {
    const valid = declaration({ id: "w1", supersedesId: null, basisPoints: 1 });
    expect(parseFinancialDirections([valid])?.[0]).toEqual(valid);
    expect(parseFinancialDirections([{ ...valid, basisPoints: 10000 }])?.[0]?.basisPoints).toBe(10000);
    expect(parseFinancialDirections([{ ...valid, purpose: "wealth_building" }])).toBeNull();
    expect(parseFinancialDirections([{ ...valid, basisPoints: 0 }])).toBeNull();
    expect(parseFinancialDirections([{ ...valid, basisPoints: 10001 }])).toBeNull();
    expect(parseFinancialDirections([{ ...valid, basisPoints: 50.5 }])).toBeNull();
    expect(parseFinancialDirections([{ ...valid, basisPoints: 1.5 }])).toBeNull();
    expect(parseFinancialDirections([{ ...valid, destinationId: "d1" }])).toBeNull();
    expect(parseFinancialDirections([{ ...valid, accountId: "a1" }])).toBeNull();
    expect(parseFinancialDirections([{ ...valid, amount: 200 }])).toBeNull();
    expect(parseFinancialDirections([{ ...valid, targetDate: "2027-01-01" }])).toBeNull();
    expect(parseFinancialDirections([{ ...valid, completed: false }])).toBeNull();
    expect(parseFinancialDirections("5000")).toBeNull();
    expect(parseFinancialDirections([])).toEqual([]);
  });

  it("appends a replacement and leaves the prior declaration unchanged", () => {
    const first = appendEmergencyFundDirection({
      declarations: [],
      id: "w1",
      basisPoints: 10000,
      declaredAt: INSTANT,
    });
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    expect(first.declarations).toHaveLength(1);
    expect(first.declarations[0]?.supersedesId).toBeNull();
    const prior = first.declarations[0]!;
    const second = appendEmergencyFundDirection({
      declarations: first.declarations,
      id: "w2",
      basisPoints: 4000,
      declaredAt: LATER,
    });
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    expect(second.declarations).toHaveLength(2);
    expect(second.declarations[0]).toBe(prior);
    expect(prior.basisPoints).toBe(10000);
    expect(second.declarations[1]).toMatchObject({
      id: "w2",
      supersedesId: "w1",
      basisPoints: 4000,
    });
    expect(currentFinancialDirection(second.declarations)?.id).toBe("w2");
    expect(wealthDirectionState(undefined)).toEqual({ status: "no_direction" });
    expect(wealthDirectionState([])).toEqual({ status: "no_direction" });
    expect(wealthDirectionState(second.declarations)).toEqual({
      status: "valid_direction",
      declaration: second.declarations[1],
    });
    expect(wealthDirectionState([declaration({ id: "a", supersedesId: "missing" })])).toEqual({
      status: "invalid",
    });
    expect(
      parseFinancialDirections([
        declaration({ id: "a", supersedesId: null }),
        declaration({ id: "b", supersedesId: null }),
      ])
    ).toBeNull();
  });

  it("keeps declaredAt as an absolute instant when the financial timezone changes", () => {
    const saved = appendEmergencyFundDirection({
      declarations: [],
      id: "w1",
      basisPoints: 2500,
      declaredAt: INSTANT,
    });
    if (!saved.ok) throw new Error("append");
    const denver: PersistedState = {
      ...EMPTY_STATE,
      financialTimeZone: "America/Denver",
      financialDirections: saved.declarations,
    };
    const auckland: PersistedState = {
      ...denver,
      financialTimeZone: "Pacific/Auckland",
    };
    expect(auckland.financialDirections).toEqual(denver.financialDirections);
    expect(auckland.financialDirections?.[0]?.declaredAt).toBe(INSTANT);
    expect(normalizePersistedState(auckland).financialDirections?.[0]?.declaredAt).toBe(INSTANT);
  });
});

describe("wealth direction capacity illustration", () => {
  it("applies the share to the supplied wealth capacity, including the debt-free total", () => {
    const withDebt = allocateIncome(1000, true);
    const debtFree = allocateIncome(1000, false);
    expect(withDebt).toEqual({
      wealthShare: 100,
      debtShare: 200,
      expenditureShare: 700,
      debtRedirected: false,
    });
    expect(debtFree).toEqual({
      wealthShare: 300,
      debtShare: 0,
      expenditureShare: 700,
      debtRedirected: true,
    });
    expect(
      illustrateWealthDirection({ wealthShare: withDebt.wealthShare, basisPoints: 10000 })
    ).toEqual({
      ok: true,
      source: 100,
      basisPoints: 10000,
      directed: 100,
      undirected: 0,
    });
    expect(
      illustrateWealthDirection({ wealthShare: debtFree.wealthShare, basisPoints: 5000 })
    ).toEqual({
      ok: true,
      source: 300,
      basisPoints: 5000,
      directed: 150,
      undirected: 150,
    });
  });

  it("rounds a partial share half-up and keeps the remainder penny-exact", () => {
    const partial = illustrateWealthDirection({ wealthShare: 0.03, basisPoints: 5000 });
    expect(partial.ok).toBe(true);
    if (!partial.ok) return;
    expect(cents(partial.directed)).toBe(2);
    expect(cents(partial.undirected)).toBe(1);
    expect(cents(partial.directed) + cents(partial.undirected)).toBe(3);

    const awkward = illustrateWealthDirection({ wealthShare: 1, basisPoints: 3333 });
    expect(awkward.ok).toBe(true);
    if (!awkward.ok) return;
    expect(cents(awkward.directed) + cents(awkward.undirected)).toBe(100);
    expect(cents(awkward.directed)).toBe(33);

    const all = illustrateWealthDirection({ wealthShare: 1.15, basisPoints: 10000 });
    expect(all.ok).toBe(true);
    if (!all.ok) return;
    expect(all.directed).toBe(1.15);
    expect(all.undirected).toBe(0);
    expect(illustrateWealthDirection({ wealthShare: Number.NaN, basisPoints: 10000 }).ok).toBe(false);
  });

  it("does not stamp income or allocations and does not read them back as directed", () => {
    const income: IncomeEntry = {
      id: "income-1",
      source: "Pay",
      amount: 1000,
      date: "2026-10-01",
      interval: "one-time",
      kind: "primary",
      wealthShare: 100,
      debtShare: 200,
      expenditureShare: 700,
      debtRedirected: false,
    };
    const allocation: AllocationEvent = {
      id: "alloc-1",
      incomeId: "income-1",
      date: "2026-10-01",
      monthKey: "2026-10",
      gross: 1000,
      wealth: 100,
      debt: 200,
      expenditure: 700,
    };
    const beforeIncome = { ...income };
    const beforeAllocation = { ...allocation };
    const saved = appendEmergencyFundDirection({
      declarations: [],
      id: "w1",
      basisPoints: 10000,
      declaredAt: LATER,
    });
    expect(saved.ok).toBe(true);
    expect(income).toEqual(beforeIncome);
    expect(allocation).toEqual(beforeAllocation);
    expect(income).not.toHaveProperty("directionId");
    expect(allocation).not.toHaveProperty("directionId");

    const engine = readFileSync("hooks/useBabylonEngine.ts", "utf8");
    const addIncome = engine.slice(
      engine.indexOf("const addIncome"),
      engine.indexOf("const proposeIncomeSplit")
    );
    expect(addIncome).not.toContain("financialDirections");
    expect(addIncome).not.toContain("illustrateWealthDirection");
    const directionSource = readFileSync("lib/babylon/financial-direction.ts", "utf8");
    expect(directionSource).not.toContain("allocateIncome");
    expect(directionSource).not.toContain("on course");
    expect(directionSource).not.toContain("off course");
    expect(readFileSync("lib/babylon/monthly-plan.ts", "utf8")).not.toContain("financialDirections");
    expect(readFileSync("lib/babylon/paycheck-funding.ts", "utf8")).not.toContain("financialDirections");
    expect(readFileSync("lib/babylon/paycheck-temporal.ts", "utf8")).not.toContain("financialDirections");
    expect(readFileSync("lib/babylon/attention.ts", "utf8")).not.toContain("financialDirections");
    expect(readFileSync("lib/babylon/financial-quiet.ts", "utf8")).not.toContain("financialDirections");
    expect(readFileSync("lib/babylon/financial-destination.ts", "utf8")).not.toContain(
      "financialDirections"
    );
  });
});

describe("wealth direction persistence", () => {
  it("omits an absent or empty direction list from the canonical fingerprint", () => {
    const bare = financialVaultFingerprint(EMPTY_STATE);
    expect(financialVaultFingerprint({ ...EMPTY_STATE, financialDirections: [] })).toBe(bare);
    expect(serializeCloudVaultData(EMPTY_STATE)).not.toHaveProperty("financialDirections");
    const saved = appendEmergencyFundDirection({
      declarations: [],
      id: "w1",
      basisPoints: 2500,
      declaredAt: INSTANT,
    });
    if (!saved.ok) throw new Error("append");
    const withDirection: PersistedState = {
      ...EMPTY_STATE,
      financialDirections: saved.declarations,
    };
    expect(financialVaultFingerprint(withDirection)).not.toBe(bare);
    const parsed = parseCloudVaultData(serializeCloudVaultData(withDirection));
    expect(parsed?.financialDirections).toEqual(saved.declarations);
    expect(financialVaultFingerprint(withDirection)).toBe(financialVaultFingerprint(parsed!));
  });

  it("fails closed on malformed direction data and still rejects unknown keys", () => {
    const document = serializeCloudVaultData(EMPTY_STATE);
    expect(
      parseCloudVaultData({
        ...document,
        financialDirections: [{ id: "w1", basisPoints: 10000 }],
      })
    ).toBeNull();
    expect(parseCloudVaultData({ ...document, financialDirections: [] })).toBeNull();
    expect(parseCloudVaultData({ ...document, notAVaultKey: true })).toBeNull();
    expect(
      normalizePersistedState({
        ...EMPTY_STATE,
        financialDirections: [{ id: "w1", purpose: "emergency_fund", basisPoints: 10000 }],
      }).financialDirections
    ).toBeUndefined();
    expect(
      normalizePersistedState({
        ...EMPTY_STATE,
        financialDirections: [
          declaration({ id: "w1", supersedesId: null }),
          { id: "w2", purpose: "emergency_fund", basisPoints: 10000, declaredAt: INSTANT, supersedesId: "missing" },
        ],
      }).financialDirections
    ).toBeUndefined();
  });

  it("shows a direction declaration as a planning-record difference", () => {
    const local: PersistedState = {
      ...EMPTY_STATE,
      financialDirections: [declaration({ id: "w1", supersedesId: null })],
    };
    const diff = compareVaultStructure(local, EMPTY_STATE);
    expect(diff.collections.find((row) => row.key === "financialDirections")).toMatchObject({
      localOnly: 1,
      cloudOnly: 0,
      sharedSame: 0,
    });
    expect(diff.summary.hasFinancialOrPlanningDifferences).toBe(true);
  });
});

describe("wealth direction backup", () => {
  it("exports version 13 and round-trips direction history", () => {
    expect(LEDGER_BACKUP_VERSION).toBe(13);
    const state: PersistedState = {
      ...EMPTY_STATE,
      financialDirections: [
        declaration({ id: "w1", supersedesId: null, basisPoints: 10000 }),
        declaration({
          id: "w2",
          supersedesId: "w1",
          basisPoints: 4000,
          declaredAt: LATER,
        }),
      ],
    };
    const backup = buildLedgerBackup(state);
    expect(backup.version).toBe(13);
    expect(backup.financialDirections).toEqual(state.financialDirections);
    expect(validateLedgerBackup(backup)?.financialDirections).toEqual(state.financialDirections);
    expect(validateLedgerBackup({ ...backup, financialDirections: [] })).toBeNull();
    expect(
      validateLedgerBackup({
        ...backup,
        financialDirections: [{ id: "w1", basisPoints: 10000 }],
      })
    ).toBeNull();
  });

  it("keeps older backups without direction and rejects direction hidden in them", () => {
    const current = buildLedgerBackup(EMPTY_STATE);
    const version12 = validateLedgerBackup({ ...current, version: 12 });
    expect(version12?.version).toBe(12);
    expect(version12?.financialDirections).toBeUndefined();
    expect(
      validateLedgerBackup({
        ...current,
        version: 12,
        financialDirections: [declaration({ id: "w1", supersedesId: null })],
      })
    ).toBeNull();
    expect(
      validateLedgerBackup({
        ...current,
        version: 11,
        financialDirections: [declaration({ id: "w1", supersedesId: null })],
      })
    ).toBeNull();
    const version11 = validateLedgerBackup({ ...current, version: 11 });
    expect(version11?.version).toBe(11);
    expect(version11?.financialDirections).toBeUndefined();
  });
});
