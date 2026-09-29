import { describe, expect, it } from "vitest";
import {
  currentEmergencyFundPosition,
  currentWealthBuildingPosition,
  isFirstPurposeDesignation,
  residualAfterFirstDesignation,
  withAccountPurpose,
} from "@/lib/babylon/account-purpose";
import { deriveAvailableAfterPlannedNeeds } from "@/lib/babylon/available-after-planned-needs";
import type { EffectiveAccountPosition } from "@/lib/babylon/balance-observation";
import { sumAccountBalances } from "@/lib/babylon/financial-position";
import { composeAlreadySetAside } from "@/lib/babylon/financial-position-composition";
import {
  buildLedgerBackup,
  LEDGER_BACKUP_VERSION,
  normalizePersistedState,
  validateLedgerBackup,
} from "@/lib/babylon/persistence";
import { CLOUD_VAULT_SCHEMA_VERSION } from "@/lib/babylon/cloud-vault";
import { INTELLIGENCE_CONTRACT_VERSION } from "@/lib/babylon/intelligence-contract";
import { totalProtectedMoney } from "@/lib/babylon/protected-money";
import { EMPTY_STATE } from "@/lib/babylon/constants";
import type { FinancialAccount } from "@/types/babylon";
import { readFileSync } from "node:fs";

function account(
  partial: Partial<FinancialAccount> & Pick<FinancialAccount, "id" | "balance">
): FinancialAccount {
  return {
    name: partial.name ?? "Account",
    kind: partial.kind ?? "checking",
    asOf: partial.asOf ?? "2026-09-29",
    ...partial,
  };
}

function declared(
  accountId: string,
  balance: number
): EffectiveAccountPosition {
  return {
    accountId,
    balance,
    source: "declared",
    asOf: "2026-09-29",
  };
}

function observed(
  accountId: string,
  balance: number
): EffectiveAccountPosition {
  return {
    accountId,
    balance,
    source: "observed",
    currentCents: Math.round(balance * 100),
    observedAt: "2026-09-29T12:00:00.000Z",
    observationId: `obs-${accountId}`,
    observationSource: "accounts_get",
  };
}

describe("account purpose position", () => {
  it("composes wealth and emergency positions from effective balances", () => {
    const accounts = [
      account({ id: "c", balance: 1500 }),
      account({
        id: "wb",
        kind: "savings",
        balance: 2000,
        purpose: "wealth_building",
      }),
      account({
        id: "ef",
        kind: "savings",
        balance: 1000,
        purpose: "emergency_fund",
      }),
    ];
    const positions = [
      declared("c", 1500),
      observed("wb", 2000),
      declared("ef", 1000),
    ];
    expect(currentWealthBuildingPosition(accounts, positions)).toBe(2000);
    expect(currentEmergencyFundPosition(accounts, positions)).toBe(1000);
  });

  it("sums multiple accounts for the same purpose", () => {
    const accounts = [
      account({ id: "a", balance: 800, purpose: "wealth_building" }),
      account({
        id: "b",
        kind: "savings",
        balance: 1200,
        purpose: "wealth_building",
      }),
    ];
    const positions = [declared("a", 800), declared("b", 1200)];
    expect(currentWealthBuildingPosition(accounts, positions)).toBe(2000);
  });

  it("allows checking and cash to carry purpose", () => {
    const accounts = [
      account({ id: "chk", kind: "checking", balance: 400, purpose: "wealth_building" }),
      account({ id: "cash", kind: "cash", balance: 300, purpose: "emergency_fund" }),
    ];
    const positions = [declared("chk", 400), declared("cash", 300)];
    expect(currentWealthBuildingPosition(accounts, positions)).toBe(400);
    expect(currentEmergencyFundPosition(accounts, positions)).toBe(300);
  });

  it("does not infer purpose from kind", () => {
    const savings = account({ id: "s", kind: "savings", balance: 900 });
    expect(savings.purpose).toBeUndefined();
    expect(
      currentWealthBuildingPosition([savings], [declared("s", 900)])
    ).toBe(0);
  });

  it("keeps Money Available unchanged when purpose is set", () => {
    const before = [
      account({ id: "c", balance: 1500 }),
      account({ id: "a", kind: "savings", balance: 2000 }),
      account({ id: "b", kind: "savings", balance: 1000 }),
    ];
    const after = [
      before[0]!,
      withAccountPurpose(before[1]!, "wealth_building"),
      withAccountPurpose(before[2]!, "emergency_fund"),
    ];
    expect(sumAccountBalances(before)).toBe(4500);
    expect(sumAccountBalances(after)).toBe(4500);
  });

  it("uses observed effective balance for purpose position", () => {
    const accounts = [
      account({
        id: "wb",
        kind: "savings",
        balance: 1800,
        purpose: "wealth_building",
      }),
    ];
    expect(
      currentWealthBuildingPosition(accounts, [observed("wb", 1842.17)])
    ).toBe(1842.17);
  });

  it("uses declared fallback when that is the effective position", () => {
    const accounts = [
      account({
        id: "wb",
        kind: "savings",
        balance: 2000,
        purpose: "wealth_building",
      }),
    ];
    expect(
      currentWealthBuildingPosition(accounts, [declared("wb", 2000)])
    ).toBe(2000);
  });
});

describe("first-designation reconciliation", () => {
  it("keep-remainder: opening 2500 + account 2000 → residual 500", () => {
    expect(residualAfterFirstDesignation(2500, 2000, "keep_remainder")).toBe(
      500
    );
    expect(
      totalProtectedMoney(500, 0, 2000, 0)
    ).toBe(2500);
  });

  it("replace-existing: opening 500 + account 2000 → residual 0", () => {
    expect(residualAfterFirstDesignation(500, 2000, "replace_existing")).toBe(
      0
    );
    expect(totalProtectedMoney(0, 0, 2000, 0)).toBe(2000);
  });

  it("detects first designation vs subsequent", () => {
    const accounts = [
      account({ id: "a", balance: 1000, purpose: "wealth_building" }),
      account({ id: "b", balance: 500 }),
    ];
    expect(isFirstPurposeDesignation(accounts, "b", "wealth_building")).toBe(
      false
    );
    expect(isFirstPurposeDesignation(accounts, "b", "emergency_fund")).toBe(
      true
    );
  });
});

describe("Protected composition with purpose positions", () => {
  it("legacy openings only when no purpose accounts", () => {
    expect(
      composeAlreadySetAside({
        openingWealthBuilding: 500,
        openingEmergencyFund: 300,
      })
    ).toBe(800);
  });

  it("WB 2000 + EF 1000 with zero residuals → Protected 3000", () => {
    expect(
      composeAlreadySetAside({
        openingWealthBuilding: 0,
        openingEmergencyFund: 0,
        currentWealthBuildingPosition: 2000,
        currentEmergencyFundPosition: 1000,
      })
    ).toBe(3000);
  });

  it("WB 2000 + residual 500 + EF 1000 → Protected 3500", () => {
    expect(
      composeAlreadySetAside({
        openingWealthBuilding: 500,
        openingEmergencyFund: 0,
        currentWealthBuildingPosition: 2000,
        currentEmergencyFundPosition: 1000,
      })
    ).toBe(3500);
  });

  it("ignores tracked wealth and emergencyShield", () => {
    expect(
      composeAlreadySetAside({
        openingWealthBuilding: 0,
        openingEmergencyFund: 0,
        currentWealthBuildingPosition: 2000,
        trackedWealthBuilding: 2100,
        emergencyShield: 400,
      })
    ).toBe(2000);
  });

  it("AAPN example A = 700", () => {
    const protectedMoney = totalProtectedMoney(0, 0, 2000, 1000);
    const planned = deriveAvailableAfterPlannedNeeds({
      deployablePosition: 4500,
      deployableProtected: protectedMoney,
      upcomingNeeds: 800,
    });
    expect(protectedMoney).toBe(3000);
    expect(planned.availableAfterPlannedNeeds).toBe(700);
  });

  it("AAPN example B = 200", () => {
    const protectedMoney = totalProtectedMoney(500, 0, 2000, 1000);
    const planned = deriveAvailableAfterPlannedNeeds({
      deployablePosition: 4500,
      deployableProtected: protectedMoney,
      upcomingNeeds: 800,
    });
    expect(protectedMoney).toBe(3500);
    expect(planned.availableAfterPlannedNeeds).toBe(200);
  });
});

describe("purpose backup and cloud versions", () => {
  it("exports backup version 9 and keeps cloud schema 6", () => {
    expect(LEDGER_BACKUP_VERSION).toBe(9);
    expect(CLOUD_VAULT_SCHEMA_VERSION).toBe(6);
    const backup = buildLedgerBackup({
      ...EMPTY_STATE,
      accounts: [
        account({
          id: "wb",
          kind: "savings",
          balance: 100,
          purpose: "wealth_building",
        }),
      ],
    });
    expect(backup.version).toBe(9);
    expect(backup.accounts?.[0]?.purpose).toBe("wealth_building");
  });

  it("round-trips v8 purpose and rejects unknown purpose", () => {
    const backup = buildLedgerBackup({
      ...EMPTY_STATE,
      accounts: [
        account({
          id: "ef",
          kind: "cash",
          balance: 50,
          purpose: "emergency_fund",
        }),
      ],
      openingWealthBuilding: 0,
      openingEmergencyFund: 0,
    });
    const restored = validateLedgerBackup(backup);
    expect(restored?.accounts?.[0]?.purpose).toBe("emergency_fund");

    const bad = {
      ...backup,
      accounts: [
        {
          id: "x",
          name: "Bad",
          kind: "checking",
          balance: 1,
          asOf: "2026-09-29",
          purpose: "operating",
        },
      ],
    };
    expect(validateLedgerBackup(bad)).toBeNull();
  });

  it("legacy <=7 imports strip purpose", () => {
    const v7 = {
      version: 7 as const,
      exportedAt: "2026-09-29T00:00:00.000Z",
      incomes: [],
      expenses: [],
      debts: [],
      allocations: [],
      budgetTargets: [],
      displayName: "",
      accounts: [
        {
          id: "s",
          name: "Savings",
          kind: "savings",
          balance: 100,
          asOf: "2026-09-29",
          purpose: "wealth_building",
        },
      ],
      openingWealthBuilding: 0,
      openingEmergencyFund: 0,
      recurringObligations: [],
      monthlyPlans: [],
      debtSemanticsVersion: 2 as const,
      debtPositionEpochAt: null,
      debtPurposeAttributions: [],
    };
    const restored = validateLedgerBackup(v7);
    expect(restored?.accounts?.[0]?.purpose).toBeUndefined();
  });

  it("live vault soft-loads absent purpose", () => {
    const state = normalizePersistedState({
      ...EMPTY_STATE,
      accounts: [
        {
          id: "c",
          name: "Checking",
          kind: "checking",
          balance: 10,
          asOf: "2026-09-29",
        },
      ],
    });
    expect(state.accounts[0]?.purpose).toBeUndefined();
  });

  it("keeps Intelligence Contract at v3", () => {
    expect(INTELLIGENCE_CONTRACT_VERSION).toBe("3");
  });

  it("does not wire observational movement into Financial Position surfaces", () => {
    const dashboard = readFileSync(
      "components/babylon/wealth-engine-dashboard.tsx",
      "utf8"
    );
    expect(dashboard).not.toContain("deriveCorrelatedInternalMovements");
    expect(dashboard).not.toContain("MovementEvent");
  });
});
