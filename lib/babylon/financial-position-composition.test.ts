import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { deriveAvailableAfterPlannedNeeds } from "@/lib/babylon/available-after-planned-needs";
import { sumAccountBalances } from "@/lib/babylon/financial-position";
import {
  ALREADY_SET_ASIDE_LABEL,
  AVAILABLE_TO_USE_LABEL,
  FINANCIAL_POSITION_TRUTH_ORDER,
  LIQUID_POSITION_LABEL,
  LIQUID_POSITION_SCOPE,
  MONEY_AVAILABLE_LABEL,
  MONEY_AVAILABLE_SCOPE,
  RECORDED_DEBT_LABEL,
  RESTRICTED_POSITION_DOCUMENT_ORDER,
  UNAVAILABLE_LABEL,
  alreadySetAsideExplain,
  availableAfterPlannedNeedsExplain,
  availableToUseExplain,
  composeAlreadySetAside,
  composePositionWithRecordedDebt,
  deriveAvailableToUsePresentation,
  plannedNeedsShortfallExplain,
  recordedDebtExplain,
  unavailableExplain,
} from "@/lib/babylon/financial-position-composition";
import { INTELLIGENCE_CONTRACT_VERSION } from "@/lib/babylon/intelligence-contract";
import { LEDGER_BACKUP_VERSION } from "@/lib/babylon/persistence";
import { totalProtectedMoney } from "@/lib/babylon/protected-money";
import { formatCurrency } from "@/lib/utils";
import type { DebtEntry, FinancialAccount } from "@/types/babylon";

function account(
  partial: Partial<FinancialAccount> & Pick<FinancialAccount, "id" | "balance">
): FinancialAccount {
  return {
    name: partial.name ?? "Checking",
    kind: partial.kind ?? "checking",
    asOf: partial.asOf ?? "2026-09-29",
    ...partial,
  };
}

function debt(
  partial: Partial<DebtEntry> & Pick<DebtEntry, "id" | "remainingDebt">
): DebtEntry {
  return {
    creditor: partial.creditor ?? "Card",
    totalDebt: partial.totalDebt ?? partial.remainingDebt,
    monthlyAllocation: partial.monthlyAllocation ?? 25,
    createdAt: partial.createdAt ?? "2026-09-01",
    interestRate: partial.interestRate ?? 0,
    ...partial,
  };
}

describe("Financial Position composition", () => {
  it("keeps Already Set Aside as openings plus purpose positions", () => {
    expect(
      composeAlreadySetAside({
        openingWealthBuilding: 300,
        openingEmergencyFund: 200,
        trackedWealthBuilding: 900,
        emergencyShield: 400,
      })
    ).toBe(500);
    expect(totalProtectedMoney(300, 200)).toBe(500);
    expect(
      composeAlreadySetAside({
        openingWealthBuilding: 0,
        openingEmergencyFund: 0,
        currentWealthBuildingPosition: 2000,
        currentEmergencyFundPosition: 1000,
      })
    ).toBe(3000);
  });

  it("does not fold tracked Wealth or emergencyShield into Protected Money", () => {
    const openings = composeAlreadySetAside({
      openingWealthBuilding: 0,
      openingEmergencyFund: 0,
      trackedWealthBuilding: 1250,
      emergencyShield: 800,
    });
    expect(openings).toBe(0);
    expect(openings).not.toBe(1250);
    expect(openings).not.toBe(800);
  });

  it("leaves owned liquid as the account sum when evidence is absent", () => {
    const accounts = [
      account({ id: "c", balance: 1500 }),
      account({ id: "s", kind: "savings", balance: 2000 }),
      account({ id: "cash", kind: "cash", balance: 100 }),
    ];
    expect(sumAccountBalances(accounts)).toBe(3600);
  });

  it("keeps the AAPN formula unchanged", () => {
    const planned = deriveAvailableAfterPlannedNeeds({
      deployablePosition: 3600,
      deployableProtected: 500,
      upcomingNeeds: 1000,
    });
    expect(planned.availableAfterPlannedNeeds).toBe(2100);
    expect(planned.plannedNeedsShortfall).toBe(0);
    expect(planned.rawDifference).toBe(2100);
  });

  it("presents recorded debt without changing owned liquid or AAPN", () => {
    const debts = [debt({ id: "cc", remainingDebt: 800, creditor: "Credit Card" })];
    const composed = composePositionWithRecordedDebt({
      moneyAvailable: 3600,
      openingWealthBuilding: 300,
      openingEmergencyFund: 200,
      upcomingNeeds: 1000,
      debts,
    });
    expect(composed.moneyAvailable).toBe(3600);
    expect(composed.alreadySetAside).toBe(500);
    expect(composed.availableAfterPlannedNeeds).toBe(2100);
    expect(composed.recordedDebt).toBe(800);
    expect(composed.moneyAvailable - composed.recordedDebt).not.toBe(
      composed.availableAfterPlannedNeeds
    );
  });

  it("zero Already Set Aside copy does not imply zero tracked wealth", () => {
    const copy = alreadySetAsideExplain(0);
    expect(copy).toContain("No existing designation yet");
    expect(copy).toContain("separate");
    expect(copy.toLowerCase()).not.toContain("built $0");
    expect(copy.toLowerCase()).not.toContain("wealth building · 10%");
    expect(copy.toLowerCase()).not.toContain("no wealth");
    expect(copy.toLowerCase()).not.toContain("progress is zero");
  });

  it("zero recorded debt copy stays factual", () => {
    expect(recordedDebtExplain(0)).toBe("No remaining debt is recorded.");
  });

  it("positive recorded debt copy names current owed without claiming a live creditor statement", () => {
    const copy = recordedDebtExplain(800);
    expect(copy).toContain("Current amount owed");
    expect(copy).toContain("Separate from Liquid Position");
    expect(copy.toLowerCase()).toContain("not a live creditor");
    expect(copy).not.toContain("modeled allocation progress");
  });

  it("orders the desktop truth hierarchy without netting debt into liquidity", () => {
    expect(FINANCIAL_POSITION_TRUTH_ORDER).toEqual([
      "liquid-position",
      "already-set-aside",
      "available-after-planned-needs",
      "accounts",
      "recorded-debt",
    ]);
  });
});

describe("WE-FINANCIAL-POSITION-LANGUAGE-001 presentation", () => {
  it("labels owned liquid as Liquid Position without renaming domain moneyAvailable", () => {
    expect(LIQUID_POSITION_LABEL).toBe("Liquid Position");
    expect(MONEY_AVAILABLE_LABEL).toBe("Liquid Position");
    expect(LIQUID_POSITION_SCOPE.toLowerCase()).toContain("checking, savings, and cash");
    expect(LIQUID_POSITION_SCOPE.toLowerCase()).toContain("unavailable or already set aside");
    expect(LIQUID_POSITION_SCOPE.toLowerCase()).toContain("not net worth");
    expect(LIQUID_POSITION_SCOPE.toLowerCase()).not.toContain("safe to spend");
    expect(MONEY_AVAILABLE_SCOPE).toBe(LIQUID_POSITION_SCOPE);
  });

  it("A: restricted case derives Available to use from DeployablePosition", () => {
    const owned = 2040.67;
    const unavailable = 2000;
    const deployable = 40.67;
    const presentation = deriveAvailableToUsePresentation({
      moneyAvailable: owned,
      restrictedEffectiveTotal: unavailable,
      deployablePosition: deployable,
    });
    expect(presentation.showUnavailable).toBe(true);
    expect(presentation.showAvailableToUse).toBe(true);
    expect(presentation.availableToUse).toBe(40.67);
    expect(presentation.heroKind).toBe("available-to-use");
    expect(presentation.unavailableAsSubtraction).toBe(true);
    expect(UNAVAILABLE_LABEL).toBe("Unavailable");
    expect(AVAILABLE_TO_USE_LABEL).toBe("Available to use");
    expect(unavailableExplain(unavailable)).toBe(
      "Still owned, but presently unavailable to use."
    );
  });

  it("B: zero restriction stays quiet", () => {
    const presentation = deriveAvailableToUsePresentation({
      moneyAvailable: 2040.67,
      restrictedEffectiveTotal: 0,
      deployablePosition: 2040.67,
    });
    expect(presentation.showUnavailable).toBe(false);
    expect(presentation.showAvailableToUse).toBe(false);
    expect(presentation.availableToUse).toBe(2040.67);
    expect(presentation.heroKind).toBe("liquid-position");
    expect(presentation.unavailableAsSubtraction).toBe(false);
  });

  it("C: shortfall currency renders $921.20 once via canonical formatter", () => {
    const planned = deriveAvailableAfterPlannedNeeds({
      deployablePosition: 40.67,
      deployableProtected: 0.81,
      upcomingNeeds: 961.06,
    });
    expect(planned.plannedNeedsShortfall).toBe(921.2);
    expect(formatCurrency(planned.plannedNeedsShortfall)).toBe("$921.20");
  });

  it("D: shortfall copy reflects Candidate A, not Protected + Needs − Owned", () => {
    const copy = plannedNeedsShortfallExplain();
    expect(copy).toContain("known Upcoming Needs");
    expect(copy).toContain("available after set-aside purposes");
    expect(copy.toLowerCase()).not.toContain("covering already-set-aside money and known");
    expect(availableAfterPlannedNeedsExplain().toLowerCase()).toContain(
      "may overlap"
    );
  });

  it("E: Already Set Aside still displays full ProtectedOwned", () => {
    expect(
      composeAlreadySetAside({
        openingWealthBuilding: 0.81,
        openingEmergencyFund: 0,
        currentWealthBuildingPosition: 0,
        currentEmergencyFundPosition: 0,
      })
    ).toBe(0.81);
    expect(ALREADY_SET_ASIDE_LABEL).toBe("Already Set Aside");
    expect(alreadySetAsideExplain(0.81)).toContain("Of Liquid Position");
  });

  it("F: domain arithmetic for production example stays Candidate A", () => {
    const planned = deriveAvailableAfterPlannedNeeds({
      deployablePosition: 40.67,
      deployableProtected: 0.81,
      upcomingNeeds: 961.06,
    });
    expect(planned.availableAfterPlannedNeeds).toBe(0);
    expect(planned.plannedNeedsShortfall).toBe(921.2);
  });

  it("G: Intelligence Contract remains v3", () => {
    expect(INTELLIGENCE_CONTRACT_VERSION).toBe("4");
  });

  it("H: backup remains v9", () => {
    expect(LEDGER_BACKUP_VERSION).toBe(11);
  });
});

describe("WE-FINANCIAL-POSITION-HIERARCHY-001 presentation", () => {
  it("A: restricted aggregate promotes Available to use as primary hero", () => {
    const presentation = deriveAvailableToUsePresentation({
      moneyAvailable: 2040.67,
      restrictedEffectiveTotal: 2000,
      deployablePosition: 40.67,
    });
    expect(presentation.heroKind).toBe("available-to-use");
    expect(presentation.availableToUse).toBe(40.67);
    expect(RESTRICTED_POSITION_DOCUMENT_ORDER).toEqual([
      "available-to-use",
      "liquid-position",
      "unavailable",
    ]);
  });

  it("B: supporting composition still exposes owned and unavailable amounts", () => {
    const presentation = deriveAvailableToUsePresentation({
      moneyAvailable: 2040.67,
      restrictedEffectiveTotal: 2000,
      deployablePosition: 40.67,
    });
    expect(presentation.showUnavailable).toBe(true);
    expect(presentation.unavailableAsSubtraction).toBe(true);
    expect(formatCurrency(2040.67)).toBe("$2,040.67");
    expect(formatCurrency(2000)).toBe("$2,000.00");
    expect(formatCurrency(presentation.availableToUse)).toBe("$40.67");
  });

  it("C: zero restriction keeps Liquid Position primary without duplicate Available to use", () => {
    const presentation = deriveAvailableToUsePresentation({
      moneyAvailable: 2040.67,
      restrictedEffectiveTotal: 0,
    });
    expect(presentation.heroKind).toBe("liquid-position");
    expect(presentation.showAvailableToUse).toBe(false);
  });

  it("D: Already Set Aside remains full ProtectedOwned", () => {
    expect(
      composeAlreadySetAside({
        openingWealthBuilding: 0.4,
        openingEmergencyFund: 0.41,
      })
    ).toBe(0.81);
  });

  it("E/F: AAPN and shortfall remain Candidate A with $921.20 once", () => {
    const planned = deriveAvailableAfterPlannedNeeds({
      deployablePosition: 40.67,
      deployableProtected: 0.81,
      upcomingNeeds: 961.06,
    });
    expect(planned.availableAfterPlannedNeeds).toBe(0);
    expect(planned.plannedNeedsShortfall).toBe(921.2);
    expect(formatCurrency(planned.plannedNeedsShortfall)).toBe("$921.20");
  });

  it("G: domain arithmetic and IC remain unchanged", () => {
    expect(INTELLIGENCE_CONTRACT_VERSION).toBe("4");
    expect(LEDGER_BACKUP_VERSION).toBe(11);
  });

  it("restricted hero copy stays concise and not safe-to-spend", () => {
    const copy = availableToUseExplain();
    expect(copy).toContain("presently available to use");
    expect(copy).toContain("before set-aside purposes");
    expect(copy.toLowerCase()).not.toContain("safe to spend");
    expect(copy.toLowerCase()).not.toContain("discretionary");
  });
});

describe("Financial Position composition surfaces", () => {
  const desktop = readFileSync(
    "components/babylon/financial-position.tsx",
    "utf8"
  );
  const home = readFileSync("components/babylon/mobile-home.tsx", "utf8");
  const dashboard = readFileSync(
    "components/babylon/wealth-engine-dashboard.tsx",
    "utf8"
  );

  it("desktop exposes adaptive hierarchy and fixed shortfall copy", () => {
    expect(desktop).toContain('data-position-hero="available-to-use"');
    expect(desktop).toContain('data-position-hero="liquid-position"');
    expect(desktop).toContain('data-position-support="owned-unavailable"');
    expect(desktop).toContain("availableToUseExplain");
    expect(desktop).toContain("LIQUID_POSITION_LABEL");
    expect(desktop).toContain("LIQUID_POSITION_SCOPE");
    expect(desktop).toContain("AVAILABLE_TO_USE_LABEL");
    expect(desktop).toContain("ALREADY_SET_ASIDE_LABEL");
    expect(desktop).toContain("RECORDED_DEBT_LABEL");
    expect(desktop).toContain("plannedNeedsShortfallExplain");
    expect(desktop).toContain("remainingDebt");
    expect(desktop).not.toMatch(/>\s*Protected Money\s*</);
    const shortfallMoneyCalls = desktop.match(
      /money\(availableAfterPlannedNeeds\.plannedNeedsShortfall\)/g
    );
    expect(shortfallMoneyCalls?.length).toBe(1);
    expect(desktop).not.toContain("−{money(protectedMoney)}");
    expect(desktop).not.toContain("−{money(upcomingNeeds)}");
    expect(desktop.indexOf("ALREADY_SET_ASIDE_LABEL")).toBeLessThan(
      desktop.indexOf("AVAILABLE_AFTER_PLANNED_NEEDS_LABEL")
    );
    expect(desktop.indexOf("AVAILABLE_AFTER_PLANNED_NEEDS_LABEL")).toBeLessThan(
      desktop.lastIndexOf("RECORDED_DEBT_LABEL")
    );
    // Restricted hero appears before supporting Liquid / Unavailable composition.
    expect(desktop.indexOf('data-position-hero="available-to-use"')).toBeLessThan(
      desktop.indexOf('data-position-support="owned-unavailable"')
    );
  });

  it("I: mobile promotes Available to use when restricted without new cards", () => {
    expect(home).toContain('data-position-hero="available-to-use"');
    expect(home).toContain('data-position-hero="liquid-position"');
    expect(home).toContain('data-position-support="owned-unavailable"');
    expect(home).toContain("availableToUseExplain");
    expect(home).toContain("LIQUID_POSITION_LABEL");
    expect(home).toContain("LIQUID_POSITION_SCOPE");
    expect(home).toContain("AVAILABLE_TO_USE_LABEL");
    expect(home).toContain("UNAVAILABLE_LABEL");
    expect(home).toContain("ALREADY_SET_ASIDE_LABEL");
    expect(home).toContain("RECORDED_DEBT_LABEL");
    expect(home).toContain("plannedNeedsShortfallExplain");
    expect(home).toContain("Debt is not");
    expect(home).not.toContain("GoldenTriad");
    expect(home).not.toContain("DebtFreedomEngine");
    expect(home).not.toMatch(/>\s*Protected Money\s*</);
    expect(home.indexOf('data-position-hero="available-to-use"')).toBeLessThan(
      home.indexOf('data-position-support="owned-unavailable"')
    );
  });

  it("wires remainingDebt into Overview and phone Home without changing AAPN props", () => {
    expect(dashboard).toContain("remainingDebt={engine.remainingDebt}");
    expect(dashboard).toContain(
      "availableAfterPlannedNeeds={engine.availableAfterPlannedNeeds}"
    );
    expect(dashboard).toContain("moneyAvailable={engine.moneyAvailable}");
    expect(dashboard).toContain("deployablePosition={engine.deployablePosition}");
  });

  it("keeps liquid scope copy free of net-worth claims", () => {
    expect(LIQUID_POSITION_SCOPE.toLowerCase()).toContain("not net worth");
    expect(ALREADY_SET_ASIDE_LABEL).toBe("Already Set Aside");
    expect(RECORDED_DEBT_LABEL).toBe("Recorded Debt");
  });
});
