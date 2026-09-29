import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  FORBIDDEN_EXECUTION_OVERCLAIMS,
  TRACKED_WEALTH_HINT,
  WEALTH_PURPOSE_OUTSIDE_LIVING,
  debtFreedomProjectionNote,
  modeledDebtProgressLabel,
  monthCloseActivitySubtitle,
  monthCloseConfirmCopy,
  monthCloseSweepDescription,
  paycheckDebtHint,
  paycheckWealthHint,
  phoneBudgetDebtShareNote,
} from "@/lib/babylon/allocation-execution-copy";
import {
  ALREADY_SET_ASIDE_LABEL,
  alreadySetAsideExplain,
  composeAlreadySetAside,
  recordedDebtExplain,
} from "@/lib/babylon/financial-position-composition";
import { allocateIncome, applyDebtAllocation } from "@/lib/babylon/engine";
import type { DebtEntry } from "@/types/babylon";

function debt(remainingDebt: number): DebtEntry {
  return {
    id: "d1",
    creditor: "Card",
    totalDebt: 1000,
    remainingDebt,
    monthlyAllocation: 50,
    createdAt: "2026-09-01",
    interestRate: 0,
  };
}

describe("WE-ALLOCATION-EXECUTION-002 semantic lock copy", () => {
  it("Month Close confirm does not claim open expenses are marked paid", () => {
    const copy = monthCloseConfirmCopy({
      monthLabel: "September 2026",
      dispositionLabel: "100% to Wealth Building",
      surplus: 40,
      money: (n) => `$${n}`,
    });
    expect(copy.toLowerCase()).not.toContain("open expenses as paid");
    expect(copy).toContain("Unpaid expenses stay unpaid");
    expect(copy).toContain("Account balances do not change");
    expect(copy).toContain("September 2026");
  });

  it("Month Close modal source rejects the false paid claim", () => {
    const source = readFileSync(
      "components/modals/MonthlyCloseModal.tsx",
      "utf8"
    );
    expect(source).not.toContain("open expenses as paid");
    expect(source).toContain("monthCloseConfirmCopy");
    expect(source).toContain("monthCloseSweepDescription");
  });

  it("debt allocation UI does not claim confirmed creditor payment", () => {
    expect(paycheckDebtHint(true)).toBe(
      "Allocated toward debt · smallest balance first"
    );
    expect(phoneBudgetDebtShareNote(true)).toBe(
      "Allocated toward active debt."
    );
    expect(modeledDebtProgressLabel(40)).toBe("40% modeled progress");
    for (const phrase of FORBIDDEN_EXECUTION_OVERCLAIMS) {
      expect(paycheckDebtHint(true)).not.toContain(phrase);
      expect(phoneBudgetDebtShareNote(true)).not.toContain(phrase);
      expect(modeledDebtProgressLabel(12)).not.toContain(phrase);
    }

    const triad = readFileSync("components/babylon/golden-triad.tsx", "utf8");
    const paycheck = readFileSync(
      "components/modals/PaycheckSplitterModal.tsx",
      "utf8"
    );
    const mobileBudget = readFileSync("lib/babylon/mobile-budget.ts", "utf8");
    expect(triad).not.toContain("% paid off");
    expect(paycheck).not.toContain("Applied to the smallest balance first");
    expect(mobileBudget).not.toContain("Applied to active debt");
  });

  it("tracked Wealth copy does not claim cash was physically set aside", () => {
    expect(TRACKED_WEALTH_HINT.toLowerCase()).toContain("tracked");
    expect(TRACKED_WEALTH_HINT.toLowerCase()).toContain("not proof");
    expect(paycheckWealthHint()).toBe("Allocated toward Wealth Building");
    expect(WEALTH_PURPOSE_OUTSIDE_LIVING).toBe(
      "Allocated outside the Living Budget"
    );

    const triad = readFileSync("components/babylon/golden-triad.tsx", "utf8");
    expect(triad).not.toContain("Set aside for wealth building");
    expect(triad).not.toContain("Protected from the Living Budget");
    expect(triad).toContain("TRACKED_WEALTH_HINT");
  });

  it("Already Set Aside stays distinct from tracked Wealth", () => {
    expect(ALREADY_SET_ASIDE_LABEL).toBe("Already Set Aside");
    expect(
      composeAlreadySetAside({
        openingWealthBuilding: 100,
        openingEmergencyFund: 50,
        trackedWealthBuilding: 900,
        emergencyShield: 400,
      })
    ).toBe(150);
    const explain = alreadySetAsideExplain(150);
    expect(explain).toContain("already designated");
    expect(explain).toContain("Progress tracked from income and month close is separate");
  });

  it("Monthly Plan still communicates intent and not a payment yet", () => {
    const panel = readFileSync(
      "components/babylon/monthly-plan-panel.tsx",
      "utf8"
    );
    expect(panel).toContain("If this plan is executed");
    expect(panel).toContain("not a payment yet");
    expect(panel).toContain("Planned position if this map is followed");
    expect(panel).toContain("not cash on");
  });

  it("Financial Position Recorded Debt remains sibling context wording", () => {
    const copy = recordedDebtExplain(800);
    expect(copy).toContain("Separate from Liquid Position");
    expect(copy).toContain("Current amount owed");
    expect(copy.toLowerCase()).toContain("not a live creditor");
  });

  it("surplus and activity copy stay allocation language", () => {
    expect(
      monthCloseSweepDescription("wealth_boost", 25, true, (n) => `$${n}`)
    ).toContain("tracked Wealth Building");
    expect(
      monthCloseSweepDescription("emergency_shield", 25, true, (n) => `$${n}`)
    ).toContain("not a bank transfer");
    expect(monthCloseActivitySubtitle("wealth_boost")).toContain("tracked");
    expect(monthCloseActivitySubtitle("split_50_50")).toContain(
      "debt purpose"
    );
  });

  it("Debt Freedom qualifies projection without removing it", () => {
    const note = debtFreedomProjectionNote();
    expect(note.toLowerCase()).toContain("projection");
    expect(note.toLowerCase()).toContain("not a live creditor");
    const source = readFileSync(
      "components/babylon/debt-freedom-engine.tsx",
      "utf8"
    );
    expect(source).toContain("debtFreedomProjectionNote");
  });

  it("does not change 10/20/70 math or debt waterfall behavior", () => {
    const split = allocateIncome(1000, true);
    expect(split).toEqual({
      wealthShare: 100,
      debtShare: 200,
      expenditureShare: 700,
      debtRedirected: false,
    });
    const next = applyDebtAllocation([debt(800)], 200);
    expect(next[0]?.remainingDebt).toBe(600);
  });
});
