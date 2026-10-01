import { describe, expect, it } from "vitest";
import {
  accountDeployableBalance,
  deriveDeployablePosition,
  deriveDeployableProtected,
  deriveRestrictedEffectiveTotal,
  hasRestrictionConflict,
  restrictedDeclared,
  restrictedEffective,
  withAccountRestrictedAmount,
} from "@/lib/babylon/account-restriction";
import { deriveAvailableAfterPlannedNeeds } from "@/lib/babylon/available-after-planned-needs";
import type { EffectiveAccountPosition } from "@/lib/babylon/balance-observation";
import { currentWealthBuildingPosition } from "@/lib/babylon/account-purpose";
import { totalProtectedMoney } from "@/lib/babylon/protected-money";
import {
  buildLedgerBackup,
  LEDGER_BACKUP_VERSION,
  normalizePersistedState,
  validateLedgerBackup,
} from "@/lib/babylon/persistence";
import { CLOUD_VAULT_SCHEMA_VERSION } from "@/lib/babylon/cloud-vault";
import { INTELLIGENCE_CONTRACT_VERSION } from "@/lib/babylon/intelligence-contract";
import { EMPTY_STATE } from "@/lib/babylon/constants";
import type { FinancialAccount } from "@/types/babylon";

function account(
  partial: Partial<FinancialAccount> & Pick<FinancialAccount, "id" | "balance">
): FinancialAccount {
  return {
    name: partial.name ?? "Account",
    kind: partial.kind ?? "savings",
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

describe("account restriction helpers", () => {
  it("treats absent and zero as undeployed restriction", () => {
    expect(restrictedDeclared(account({ id: "a", balance: 100 }))).toBe(0);
    expect(
      restrictedDeclared(account({ id: "a", balance: 100, restrictedAmount: 0 }))
    ).toBe(0);
  });

  it("bounds effective restriction and never yields negative deployable", () => {
    expect(restrictedEffective(1900, 2000)).toBe(1900);
    expect(accountDeployableBalance(1900, 2000)).toBe(0);
    expect(hasRestrictionConflict(1900, 2000)).toBe(true);
    expect(accountDeployableBalance(2600, 2000)).toBe(600);
  });

  it("full restriction yields zero deployable", () => {
    expect(accountDeployableBalance(2000, 2000)).toBe(0);
  });

  it("omits zero when setting restriction", () => {
    const withAmount = withAccountRestrictedAmount(
      account({ id: "a", balance: 100, purpose: "wealth_building" }),
      40
    );
    expect(withAmount.restrictedAmount).toBe(40);
    expect(withAmount.purpose).toBe("wealth_building");
    const cleared = withAccountRestrictedAmount(withAmount, 0);
    expect(cleared.restrictedAmount).toBeUndefined();
    expect(cleared.purpose).toBe("wealth_building");
  });
});

describe("secured-account acceptance", () => {
  it("non-purpose savings 2600 / R2000", () => {
    const accounts = [
      account({ id: "exp", balance: 2600, restrictedAmount: 2000 }),
    ];
    const positions = [declared("exp", 2600)];
    expect(deriveDeployablePosition(accounts, positions)).toBe(600);
    expect(deriveRestrictedEffectiveTotal(accounts, positions)).toBe(2000);
    expect(
      totalProtectedMoney(0, 0, currentWealthBuildingPosition(accounts, positions), 0)
    ).toBe(0);
    expect(deriveDeployableProtected(accounts, positions, 0, 0)).toBe(0);
  });

  it("EAP rise to 2700 with restriction unchanged raises deployable", () => {
    const accounts = [
      account({ id: "exp", balance: 2600, restrictedAmount: 2000 }),
    ];
    expect(
      deriveDeployablePosition(accounts, [declared("exp", 2700)])
    ).toBe(700);
  });
});

describe("purpose + restriction", () => {
  it("WB 5000 / R2000 keeps ProtectedOwned and shrinks DeployableProtected", () => {
    const accounts = [
      account({
        id: "wb",
        balance: 5000,
        restrictedAmount: 2000,
        purpose: "wealth_building",
      }),
    ];
    const positions = [declared("wb", 5000)];
    expect(deriveDeployablePosition(accounts, positions)).toBe(3000);
    expect(
      totalProtectedMoney(
        0,
        0,
        currentWealthBuildingPosition(accounts, positions),
        0
      )
    ).toBe(5000);
    expect(deriveDeployableProtected(accounts, positions, 0, 0)).toBe(3000);
  });

  it("EF + restriction mirrors WB purpose handling", () => {
    const accounts = [
      account({
        id: "ef",
        balance: 5000,
        restrictedAmount: 2000,
        purpose: "emergency_fund",
      }),
    ];
    const positions = [declared("ef", 5000)];
    expect(deriveDeployableProtected(accounts, positions, 0, 0)).toBe(3000);
  });
});

describe("multi-account composition", () => {
  const accounts = [
    account({ id: "chk", kind: "checking", balance: 1500 }),
    account({
      id: "exp",
      balance: 2600,
      restrictedAmount: 2000,
      name: "Expenses",
    }),
    account({
      id: "ef",
      balance: 1000,
      purpose: "emergency_fund",
    }),
    account({
      id: "wb",
      balance: 2000,
      purpose: "wealth_building",
    }),
  ];
  const positions = accounts.map((row) => declared(row.id, row.balance));

  it("matches accepted Owned / Deployable / Protected matrix", () => {
    expect(deriveDeployablePosition(accounts, positions)).toBe(5100);
    expect(deriveRestrictedEffectiveTotal(accounts, positions)).toBe(2000);
    const protectedOwned = totalProtectedMoney(
      0,
      0,
      currentWealthBuildingPosition(accounts, positions),
      1000
    );
    expect(protectedOwned).toBe(3000);
    expect(deriveDeployableProtected(accounts, positions, 0, 0)).toBe(3000);
    const free = deriveAvailableAfterPlannedNeeds({
      deployablePosition: 5100,
      deployableProtected: 3000,
      upcomingNeeds: 0,
    });
    expect(free.freeBeforeNeeds).toBe(2100);
  });

  it("AAPN / shortfall for Needs 500 / 1500 / 3000", () => {
    const dep = deriveDeployablePosition(accounts, positions);
    const depProt = deriveDeployableProtected(accounts, positions, 0, 0);
    expect(
      deriveAvailableAfterPlannedNeeds({
        deployablePosition: dep,
        deployableProtected: depProt,
        upcomingNeeds: 500,
      })
    ).toMatchObject({ availableAfterPlannedNeeds: 1600, plannedNeedsShortfall: 0 });
    expect(
      deriveAvailableAfterPlannedNeeds({
        deployablePosition: dep,
        deployableProtected: depProt,
        upcomingNeeds: 1500,
      })
    ).toMatchObject({ availableAfterPlannedNeeds: 600, plannedNeedsShortfall: 0 });
    expect(
      deriveAvailableAfterPlannedNeeds({
        deployablePosition: dep,
        deployableProtected: depProt,
        upcomingNeeds: 3000,
      })
    ).toMatchObject({ availableAfterPlannedNeeds: 0, plannedNeedsShortfall: 900 });
  });
});

describe("restricted + protected overlap", () => {
  it("does not double-subtract restricted purpose dollars", () => {
    const accounts = [
      account({ id: "chk", kind: "checking", balance: 1500 }),
      account({
        id: "wb",
        balance: 5000,
        restrictedAmount: 2000,
        purpose: "wealth_building",
      }),
      account({
        id: "ef",
        balance: 1000,
        purpose: "emergency_fund",
      }),
    ];
    const positions = accounts.map((row) => declared(row.id, row.balance));
    const deployable = deriveDeployablePosition(accounts, positions);
    const deployableProtected = deriveDeployableProtected(
      accounts,
      positions,
      0,
      0
    );
    expect(deployable).toBe(5500);
    expect(
      totalProtectedMoney(0, 0, 5000, 1000)
    ).toBe(6000);
    expect(deployableProtected).toBe(4000);
    expect(
      deriveAvailableAfterPlannedNeeds({
        deployablePosition: deployable,
        deployableProtected,
        upcomingNeeds: 0,
      }).availableAfterPlannedNeeds
    ).toBe(1500);
    expect(
      deriveAvailableAfterPlannedNeeds({
        deployablePosition: deployable,
        deployableProtected,
        upcomingNeeds: 2000,
      })
    ).toMatchObject({
      availableAfterPlannedNeeds: 0,
      plannedNeedsShortfall: 500,
    });
  });
});

describe("residual openings", () => {
  it("includes residual openings fully in DeployableProtected", () => {
    const accounts = [
      account({
        id: "wb",
        balance: 2000,
        restrictedAmount: 1000,
        purpose: "wealth_building",
      }),
      account({ id: "chk", kind: "checking", balance: 500 }),
    ];
    const positions = [
      declared("wb", 2000),
      declared("chk", 500),
    ];
    expect(deriveDeployableProtected(accounts, positions, 500, 0)).toBe(1500);
    expect(
      totalProtectedMoney(500, 0, currentWealthBuildingPosition(accounts, positions), 0)
    ).toBe(2500);
  });
});

describe("zero-restriction legacy identity", () => {
  it("absent restriction matches Owned − Protected − Needs AAPN", () => {
    const identity = [
      account({ id: "c", kind: "checking", balance: 1500 }),
      account({
        id: "wb",
        balance: 2000,
        purpose: "wealth_building",
      }),
      account({
        id: "ef",
        balance: 1000,
        purpose: "emergency_fund",
      }),
    ];
    const positions = identity.map((row) => declared(row.id, row.balance));
    const owned = 4500;
    const protectedOwned = totalProtectedMoney(0, 0, 2000, 1000);
    const deployable = deriveDeployablePosition(identity, positions);
    const deployableProtected = deriveDeployableProtected(
      identity,
      positions,
      0,
      0
    );
    expect(deployable).toBe(owned);
    expect(deployableProtected).toBe(protectedOwned);
    expect(
      deriveAvailableAfterPlannedNeeds({
        deployablePosition: deployable,
        deployableProtected,
        upcomingNeeds: 800,
      }).availableAfterPlannedNeeds
    ).toBe(700);
  });

  it("restrictedAmount omitted zero via withAccount is identical", () => {
    const base = account({ id: "a", balance: 1000 });
    const zeroed = withAccountRestrictedAmount(base, 0);
    expect(zeroed.restrictedAmount).toBeUndefined();
    expect(
      deriveDeployablePosition([zeroed], [declared("a", 1000)])
    ).toBe(1000);
  });
});

describe("observed EAP + steward restriction", () => {
  it("uses observed balance for deployable and keeps steward restriction", () => {
    const accounts = [
      account({ id: "s", balance: 2400, restrictedAmount: 2000 }),
    ];
    expect(
      deriveDeployablePosition(accounts, [observed("s", 2600)])
    ).toBe(600);
  });

  it("Plaid unlink fallback uses declared EAP with restriction intact", () => {
    const accounts = [
      account({ id: "s", balance: 2600, restrictedAmount: 2000 }),
    ];
    expect(accounts[0]?.restrictedAmount).toBe(2000);
    expect(
      deriveDeployablePosition(accounts, [declared("s", 2600)])
    ).toBe(600);
  });
});

describe("restriction removal", () => {
  it("removing restriction raises deployable without changing owned EAP", () => {
    const restricted = account({
      id: "s",
      balance: 2600,
      restrictedAmount: 2000,
    });
    const cleared = withAccountRestrictedAmount(restricted, undefined);
    const positions = [declared("s", 2600)];
    expect(deriveDeployablePosition([restricted], positions)).toBe(600);
    expect(deriveDeployablePosition([cleared], positions)).toBe(2600);
    expect(cleared.balance).toBe(2600);
  });
});

describe("persistence backup v10", () => {
  it("exports version 10 and keeps cloud schema 6 and IC v3", () => {
    expect(LEDGER_BACKUP_VERSION).toBe(11);
    expect(CLOUD_VAULT_SCHEMA_VERSION).toBe(6);
    expect(INTELLIGENCE_CONTRACT_VERSION).toBe("4");
    const backup = buildLedgerBackup({
      ...EMPTY_STATE,
      accounts: [
        account({
          id: "s",
          balance: 2600,
          restrictedAmount: 2000,
        }),
      ],
    });
    expect(backup.version).toBe(11);
    expect(backup.accounts?.[0]?.restrictedAmount).toBe(2000);
  });

  it("v9 round-trip keeps restriction; v8 strips it", () => {
    const state = {
      ...EMPTY_STATE,
      accounts: [
        account({
          id: "s",
          balance: 100,
          restrictedAmount: 40,
          purpose: "wealth_building",
        }),
      ],
    };
    const v9 = buildLedgerBackup(state);
    const roundTrip = validateLedgerBackup(v9);
    expect(roundTrip?.accounts?.[0]?.restrictedAmount).toBe(40);
    expect(roundTrip?.accounts?.[0]?.purpose).toBe("wealth_building");

    const asV8 = { ...v9, version: 8 as const };
    const stripped = validateLedgerBackup(asV8);
    expect(stripped?.accounts?.[0]?.restrictedAmount).toBeUndefined();
    expect(stripped?.accounts?.[0]?.purpose).toBe("wealth_building");
  });

  it("strict backup rejects negative restriction", () => {
    const backup = buildLedgerBackup({
      ...EMPTY_STATE,
      accounts: [account({ id: "s", balance: 100 })],
    });
    const corrupt = {
      ...backup,
      accounts: [
        {
          ...backup.accounts![0],
          restrictedAmount: -1,
        },
      ],
    };
    expect(validateLedgerBackup(corrupt)).toBeNull();
  });

  it("allows restriction greater than balance on import", () => {
    const backup = buildLedgerBackup({
      ...EMPTY_STATE,
      accounts: [
        account({ id: "s", balance: 1900, restrictedAmount: 2000 }),
      ],
    });
    const parsed = validateLedgerBackup(backup);
    expect(parsed?.accounts?.[0]?.restrictedAmount).toBe(2000);
    expect(
      hasRestrictionConflict(1900, 2000)
    ).toBe(true);
  });

  it("soft vault drops invalid restriction without wiping the account", () => {
    const soft = normalizePersistedState({
      ...EMPTY_STATE,
      accounts: [
        {
          id: "s",
          name: "Savings",
          kind: "savings",
          balance: 100,
          asOf: "2026-09-29",
          restrictedAmount: -5,
        },
      ],
    });
    expect(soft.accounts).toHaveLength(1);
    expect(soft.accounts[0]?.restrictedAmount).toBeUndefined();
  });

  it("deleting an account removes its restriction with the account", () => {
    const before = [
      account({ id: "keep", balance: 10 }),
      account({ id: "gone", balance: 50, restrictedAmount: 20 }),
    ];
    const after = before.filter((row) => row.id !== "gone");
    expect(after).toHaveLength(1);
    expect(after[0]?.restrictedAmount).toBeUndefined();
  });
});
