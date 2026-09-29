import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { deriveAvailableAfterPlannedNeeds } from "@/lib/babylon/available-after-planned-needs";
import { sumAccountBalances } from "@/lib/babylon/financial-position";
import {
  ALREADY_SET_ASIDE_LABEL,
  FINANCIAL_POSITION_TRUTH_ORDER,
  MONEY_AVAILABLE_SCOPE,
  RECORDED_DEBT_LABEL,
  alreadySetAsideExplain,
  composeAlreadySetAside,
  composePositionWithRecordedDebt,
  recordedDebtExplain,
} from "@/lib/babylon/financial-position-composition";
import { totalProtectedMoney } from "@/lib/babylon/protected-money";
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

  it("leaves Money Available as the account sum when evidence is absent", () => {
    const accounts = [
      account({ id: "c", balance: 1500 }),
      account({ id: "s", kind: "savings", balance: 2000 }),
      account({ id: "cash", kind: "cash", balance: 100 }),
    ];
    expect(sumAccountBalances(accounts)).toBe(3600);
  });

  it("keeps the AAPN formula unchanged", () => {
    const planned = deriveAvailableAfterPlannedNeeds({
      moneyAvailable: 3600,
      protectedMoney: 500,
      upcomingNeeds: 1000,
    });
    expect(planned.availableAfterPlannedNeeds).toBe(2100);
    expect(planned.plannedNeedsShortfall).toBe(0);
    expect(planned.rawDifference).toBe(2100);
  });

  it("presents recorded debt without changing Money Available or AAPN", () => {
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
    expect(copy).toContain("Separate from Money Available");
    expect(copy.toLowerCase()).toContain("not a live creditor");
    expect(copy).not.toContain("modeled allocation progress");
  });

  it("orders the desktop truth hierarchy without netting debt into liquidity", () => {
    expect(FINANCIAL_POSITION_TRUTH_ORDER).toEqual([
      "money-available",
      "already-set-aside",
      "available-after-planned-needs",
      "accounts",
      "recorded-debt",
    ]);
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

  it("desktop exposes the intended truth hierarchy labels", () => {
    expect(desktop).toContain("ALREADY_SET_ASIDE_LABEL");
    expect(desktop).toContain("RECORDED_DEBT_LABEL");
    expect(desktop).toContain("MONEY_AVAILABLE_SCOPE");
    expect(desktop).toContain("remainingDebt");
    expect(desktop).not.toMatch(/>\s*Protected Money\s*</);
    expect(desktop.indexOf("ALREADY_SET_ASIDE_LABEL")).toBeLessThan(
      desktop.indexOf("AVAILABLE_AFTER_PLANNED_NEEDS_LABEL")
    );
    expect(desktop.indexOf("AVAILABLE_AFTER_PLANNED_NEEDS_LABEL")).toBeLessThan(
      desktop.lastIndexOf("RECORDED_DEBT_LABEL")
    );
  });

  it("mobile stays compact and truthful", () => {
    expect(home).toContain("ALREADY_SET_ASIDE_LABEL");
    expect(home).toContain("RECORDED_DEBT_LABEL");
    expect(home).toContain("MONEY_AVAILABLE_SCOPE");
    expect(home).toContain("Debt is not");
    expect(home).not.toContain("GoldenTriad");
    expect(home).not.toContain("DebtFreedomEngine");
    expect(home).not.toMatch(/>\s*Protected Money\s*</);
  });

  it("wires remainingDebt into Overview and phone Home without changing AAPN props", () => {
    expect(dashboard).toContain("remainingDebt={engine.remainingDebt}");
    expect(dashboard).toContain(
      "availableAfterPlannedNeeds={engine.availableAfterPlannedNeeds}"
    );
    expect(dashboard).toContain("moneyAvailable={engine.moneyAvailable}");
  });

  it("keeps liquid scope copy free of net-worth claims", () => {
    expect(MONEY_AVAILABLE_SCOPE.toLowerCase()).toContain("not net worth");
    expect(ALREADY_SET_ASIDE_LABEL).toBe("Already Set Aside");
    expect(RECORDED_DEBT_LABEL).toBe("Recorded Debt");
  });
});
