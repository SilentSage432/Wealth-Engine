import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { EMPTY_STATE } from "@/lib/babylon/constants";
import {
  CLOUD_VAULT_SCHEMA_VERSION,
  financialVaultFingerprint,
  parseCloudVaultData,
  serializeCloudVaultData,
} from "@/lib/babylon/cloud-vault";
import type { EffectiveAccountPosition } from "@/lib/babylon/balance-observation";
import {
  appendOwnedEmergencyFundDestination,
  currentFinancialDestination,
  deriveEmergencyFundDestinationRelationship,
  ownedEmergencyFundPosition,
  parseFinancialDestinations,
} from "@/lib/babylon/financial-destination";
import { paidDocumentChangeIsBounded } from "@/lib/babylon/paid-command";
import {
  buildLedgerBackup,
  LEDGER_BACKUP_VERSION,
  normalizePersistedState,
  validateLedgerBackup,
} from "@/lib/babylon/persistence";
import { transitionOccurrencePaid } from "@/lib/babylon/paid-transition";
import { compareVaultStructure } from "@/lib/babylon/vault-structural-diff";
import type {
  ExpenseEntry,
  FinancialAccount,
  FinancialDestinationDeclaration,
  PersistedState,
} from "@/types/babylon";

const INSTANT = "2026-10-01T18:00:00.000Z";
const LATER = "2026-11-01T18:00:00.000Z";

function account(
  partial: Partial<FinancialAccount> & Pick<FinancialAccount, "id" | "purpose">
): FinancialAccount {
  return {
    name: partial.id,
    kind: "savings",
    balance: 0,
    asOf: "2026-10-01",
    ...partial,
  };
}

function position(
  accountId: string,
  balance: number
): EffectiveAccountPosition {
  return { accountId, balance, source: "declared", asOf: "2026-10-01" };
}

function declaration(
  partial: Partial<FinancialDestinationDeclaration> &
    Pick<FinancialDestinationDeclaration, "id" | "supersedesId">
): FinancialDestinationDeclaration {
  return {
    dimension: "owned_emergency_fund",
    relation: "at_least",
    amount: 8500,
    declaredAt: INSTANT,
    ...partial,
  };
}

describe("owned Emergency Fund position", () => {
  it("adds account-backed Emergency Fund position to the residual opening", () => {
    const accounts = [
      account({ id: "ef", purpose: "emergency_fund", balance: 1000 }),
    ];
    expect(
      ownedEmergencyFundPosition({
        accounts,
        positions: [position("ef", 2400)],
        openingEmergencyFund: 600,
      })
    ).toBe(3000);
  });

  it("sums every Emergency Fund account and ignores restriction", () => {
    const accounts = [
      account({
        id: "a",
        purpose: "emergency_fund",
        balance: 5000,
        restrictedAmount: 2000,
      }),
      account({ id: "b", purpose: "emergency_fund", balance: 1000 }),
      account({ id: "wb", purpose: "wealth_building", balance: 9000 }),
      account({ id: "cash", purpose: undefined, balance: 400 }),
    ];
    expect(
      ownedEmergencyFundPosition({
        accounts,
        positions: [
          position("a", 5000),
          position("b", 1000),
          position("wb", 9000),
          position("cash", 400),
        ],
        openingEmergencyFund: 250,
      })
    ).toBe(6250);
  });

  it("rounds with the existing money rule", () => {
    const accounts = [
      account({ id: "ef", purpose: "emergency_fund", balance: 0.1 }),
    ];
    expect(
      ownedEmergencyFundPosition({
        accounts,
        positions: [position("ef", 0.1)],
        openingEmergencyFund: 0.2,
      })
    ).toBe(0.3);
  });

  it("does not read tracked Emergency Fund, Wealth Building, or protected totals", () => {
    const source = readFileSync(
      "lib/babylon/financial-destination.ts",
      "utf8"
    );
    const position = source.slice(
      source.indexOf("export function ownedEmergencyFundPosition"),
      source.indexOf("function parseDeclaration")
    );
    expect(position).not.toContain("totalProtectedMoney");
    expect(position).not.toContain("totalEmergencyFund");
    expect(position).not.toContain("emergencyShield");
    expect(position).not.toContain("deriveDeployableProtected");
    expect(position).not.toContain("goldRetained");
    expect(source).not.toContain("allocateIncome");
    expect(source).not.toContain("financial-quiet");
    expect(source).not.toContain("composeFinancialAttention");
  });
});

describe("destination declarations", () => {
  it("makes the first declaration current and leaves supersedesId null", () => {
    const result = appendOwnedEmergencyFundDestination({
      declarations: [],
      id: "d1",
      amount: 8500,
      declaredAt: INSTANT,
      label: " Foundation ",
      rationale: " About three months ",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.declarations).toEqual([
      declaration({
        id: "d1",
        supersedesId: null,
        label: "Foundation",
        rationale: "About three months",
      }),
    ]);
    expect(currentFinancialDestination(result.declarations)?.id).toBe("d1");
  });

  it("appends a replacement and leaves the prior declaration unchanged", () => {
    const first = appendOwnedEmergencyFundDestination({
      declarations: [],
      id: "d1",
      amount: 8500,
      declaredAt: INSTANT,
    });
    if (!first.ok) throw new Error("first");
    const prior = first.declarations[0]!;
    const second = appendOwnedEmergencyFundDestination({
      declarations: first.declarations,
      id: "d2",
      amount: 10000,
      declaredAt: LATER,
    });
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    expect(second.declarations).toHaveLength(2);
    expect(second.declarations[0]).toBe(prior);
    expect(prior.amount).toBe(8500);
    expect(second.declarations[1]).toMatchObject({
      id: "d2",
      amount: 10000,
      supersedesId: "d1",
      declaredAt: LATER,
    });
    expect(currentFinancialDestination(second.declarations)?.id).toBe("d2");
  });

  it("accepts only owned_emergency_fund and at_least", () => {
    const valid = declaration({ id: "d1", supersedesId: null });
    expect(parseFinancialDestinations([valid])?.[0]?.id).toBe("d1");
    expect(
      parseFinancialDestinations([{ ...valid, dimension: "remaining_debt" }])
    ).toBeNull();
    expect(
      parseFinancialDestinations([{ ...valid, relation: "at_most" }])
    ).toBeNull();
    expect(
      parseFinancialDestinations([{ ...valid, relation: "exact" }])
    ).toBeNull();
    expect(
      parseFinancialDestinations([{ ...valid, targetDate: "2027-01-01" }])
    ).toBeNull();
    expect(parseFinancialDestinations([{ ...valid, amount: -1 }])).toBeNull();
    expect(parseFinancialDestinations("8500")).toBeNull();
  });

  it("keeps declaredAt as an absolute instant when the financial timezone changes", () => {
    const saved = appendOwnedEmergencyFundDestination({
      declarations: [],
      id: "d1",
      amount: 8500,
      declaredAt: INSTANT,
    });
    if (!saved.ok) throw new Error("append");
    const denver: PersistedState = {
      ...EMPTY_STATE,
      financialTimeZone: "America/Denver",
      financialDestinations: saved.declarations,
    };
    const auckland: PersistedState = {
      ...denver,
      financialTimeZone: "Pacific/Auckland",
    };
    expect(auckland.financialDestinations?.[0]?.declaredAt).toBe(INSTANT);
    expect(auckland.financialDestinations).toEqual(denver.financialDestinations);
    expect(serializeCloudVaultData(auckland).financialDestinations).toEqual(
      serializeCloudVaultData(denver).financialDestinations
    );
  });
});

describe("destination relationship", () => {
  const declarations = [
    declaration({ id: "d1", supersedesId: null, amount: 8500 }),
  ];

  function relate(position: number, trust?: { overflow?: boolean; conflict?: boolean }) {
    return deriveEmergencyFundDestinationRelationship({
      declarations,
      ownedEmergencyFundPosition: position,
      protectedOverflow: trust?.overflow ?? false,
      cloudConflict: trust?.conflict ?? false,
    });
  }

  it("states below, at the minimum, and above without a permanent completion", () => {
    const below = relate(2000);
    expect(below).toMatchObject({
      status: "known",
      relationship: "below",
      position: 2000,
      targetAmount: 8500,
      remaining: 6500,
      amountAbove: 0,
      declaredAt: INSTANT,
    });
    const exact = relate(8500);
    expect(exact).toMatchObject({
      status: "known",
      relationship: "at_or_above",
      remaining: 0,
      amountAbove: 0,
    });
    const above = relate(9000);
    expect(above).toMatchObject({
      status: "known",
      relationship: "at_or_above",
      remaining: 0,
      amountAbove: 500,
    });
    expect(relate(8499.99)).toMatchObject({
      status: "known",
      relationship: "below",
    });
  });

  it("returns to below when the position later falls under the minimum", () => {
    expect(relate(9000)).toMatchObject({ relationship: "at_or_above" });
    expect(relate(1000)).toMatchObject({
      relationship: "below",
      remaining: 7500,
      amountAbove: 0,
    });
  });

  it("keeps protected overflow unknown and distinct from no destination", () => {
    const unknown = relate(9000, { overflow: true });
    expect(unknown.status).toBe("unknown");
    if (unknown.status !== "unknown") return;
    expect(unknown.reasons).toEqual(["protected_overflow"]);
    expect(unknown).not.toHaveProperty("remaining");
    expect(unknown).not.toHaveProperty("position");
    expect(unknown.declaration?.amount).toBe(8500);

    const none = deriveEmergencyFundDestinationRelationship({
      declarations: [],
      ownedEmergencyFundPosition: 0,
      protectedOverflow: true,
      cloudConflict: true,
    });
    expect(none).toEqual({ status: "no_destination" });
  });

  it("stays unknown while the cloud copy disagrees", () => {
    const unknown = relate(100, { conflict: true, overflow: true });
    expect(unknown).toMatchObject({
      status: "unknown",
      reasons: ["protected_overflow", "cloud_conflict"],
    });
    expect(unknown).not.toHaveProperty("remaining");
  });

  it("does not turn a missing position into zero", () => {
    const unknown = deriveEmergencyFundDestinationRelationship({
      declarations,
      ownedEmergencyFundPosition: Number.NaN,
      protectedOverflow: false,
      cloudConflict: false,
    });
    expect(unknown.status).toBe("unknown");
    expect(unknown).not.toHaveProperty("position");
    expect(unknown).not.toHaveProperty("remaining");
  });
});

describe("destination persistence", () => {
  it("parses an old vault without the field and keeps its fingerprint", () => {
    expect(CLOUD_VAULT_SCHEMA_VERSION).toBe(6);
    const document = serializeCloudVaultData(EMPTY_STATE);
    expect(document).not.toHaveProperty("financialDestinations");
    const parsed = parseCloudVaultData(document);
    expect(parsed?.financialDestinations).toBeUndefined();
    expect(financialVaultFingerprint(EMPTY_STATE)).toBe(
      financialVaultFingerprint(parsed!)
    );
    expect(financialVaultFingerprint(EMPTY_STATE)).toBe(
      financialVaultFingerprint({ ...EMPTY_STATE, financialDestinations: [] })
    );
    const local = normalizePersistedState({ ...EMPTY_STATE });
    expect(local.financialDestinations).toBeUndefined();
  });

  it("round-trips a destination vault and changes the fingerprint", () => {
    const withDestination: PersistedState = {
      ...EMPTY_STATE,
      financialDestinations: [declaration({ id: "d1", supersedesId: null })],
    };
    const document = serializeCloudVaultData(withDestination);
    expect(document.financialDestinations).toHaveLength(1);
    const parsed = parseCloudVaultData(document);
    expect(parsed?.financialDestinations).toEqual(withDestination.financialDestinations);
    expect(financialVaultFingerprint(withDestination)).not.toBe(
      financialVaultFingerprint(EMPTY_STATE)
    );
    expect(financialVaultFingerprint(withDestination)).toBe(
      financialVaultFingerprint(parsed!)
    );
  });

  it("fails closed on a malformed destination field and an unknown key", () => {
    const document = serializeCloudVaultData(EMPTY_STATE);
    expect(
      parseCloudVaultData({
        ...document,
        financialDestinations: [{ id: "d1", amount: 8500 }],
      })
    ).toBeNull();
    expect(
      parseCloudVaultData({ ...document, financialDestinations: [] })
    ).toBeNull();
    expect(
      parseCloudVaultData({ ...document, notAVaultKey: true })
    ).toBeNull();
    expect(
      normalizePersistedState({
        ...EMPTY_STATE,
        financialDestinations: [{ id: "d1", dimension: "owned_emergency_fund" }],
      }).financialDestinations
    ).toBeUndefined();
  });

  it("shows a destination declaration as a planning-record difference", () => {
    const local: PersistedState = {
      ...EMPTY_STATE,
      financialDestinations: [declaration({ id: "d1", supersedesId: null })],
    };
    const diff = compareVaultStructure(local, EMPTY_STATE);
    expect(
      diff.collections.find((row) => row.key === "financialDestinations")
    ).toMatchObject({ localOnly: 1, cloudOnly: 0, sharedSame: 0 });
    expect(diff.summary.hasFinancialOrPlanningDifferences).toBe(true);
    expect(diff.summary.documentIdentity).toBe("different");
  });
});

describe("destination backup", () => {
  it("exports version 12 and round-trips destination history", () => {
    expect(LEDGER_BACKUP_VERSION).toBe(12);
    const state: PersistedState = {
      ...EMPTY_STATE,
      financialDestinations: [
        declaration({ id: "d1", supersedesId: null, amount: 8500 }),
        declaration({
          id: "d2",
          supersedesId: "d1",
          amount: 10000,
          declaredAt: LATER,
        }),
      ],
    };
    const backup = buildLedgerBackup(state);
    expect(backup.version).toBe(12);
    expect(backup.financialDestinations).toEqual(state.financialDestinations);
    expect(validateLedgerBackup(backup)?.financialDestinations).toEqual(
      state.financialDestinations
    );
  });

  it("still imports a version 11 backup and rejects destinations hidden in it", () => {
    const current = buildLedgerBackup(EMPTY_STATE);
    const version11 = validateLedgerBackup({
      ...current,
      version: 11,
    });
    expect(version11?.version).toBe(11);
    expect(version11?.financialDestinations).toBeUndefined();
    expect(
      validateLedgerBackup({
        ...current,
        version: 11,
        financialDestinations: [declaration({ id: "d1", supersedesId: null })],
      })
    ).toBeNull();
  });

  it("rejects a malformed version 12 destination list", () => {
    const current = buildLedgerBackup(EMPTY_STATE);
    expect(
      validateLedgerBackup({
        ...current,
        financialDestinations: [{ id: "broken" }],
      })
    ).toBeNull();
    expect(
      validateLedgerBackup({ ...current, financialDestinations: [] })
    ).toBeNull();
  });
});

describe("destination boundaries", () => {
  it("leaves Attention, Quiet, and Paid's bounded write unchanged", () => {
    const attention = readFileSync("lib/babylon/attention.ts", "utf8");
    const quiet = readFileSync("lib/babylon/financial-quiet.ts", "utf8");
    expect(attention).not.toContain("financialDestinations");
    expect(attention).not.toContain("ownedEmergencyFundPosition");
    expect(quiet).not.toContain("financialDestinations");
    expect(quiet).not.toContain("Destination");
    const paid = readFileSync("lib/babylon/paid-command.ts", "utf8");
    expect(paid).toContain('"financialDestinations"');

    const expense: ExpenseEntry = {
      id: "groceries",
      name: "Groceries",
      category: "need",
      amount: 40,
      date: "2026-01-03",
      dueDate: "2026-01-03",
      budgetCategoryId: "food",
      isSettled: false,
    };
    const state: PersistedState = {
      ...EMPTY_STATE,
      financialTimeZone: "America/Denver",
      expenses: [expense],
      financialDestinations: [declaration({ id: "d1", supersedesId: null })],
    };
    const result = transitionOccurrencePaid({
      state,
      occurrenceId: "groceries",
      preimage: {
        name: "Groceries",
        amount: 40,
        category: "need",
        dueDate: "2026-01-03",
        budgetCategoryId: "food",
        recurringObligationId: null,
        recurrenceMonth: null,
        isSettled: false,
      },
      commitInstant: new Date("2026-10-02T02:30:00.000Z"),
    });
    expect(result.status).toBe("paid");
    if (result.status !== "paid") return;
    expect(result.state.financialDestinations).toEqual(state.financialDestinations);
    expect(paidDocumentChangeIsBounded(state, result.state, "groceries")).toBe(true);
  });
});
