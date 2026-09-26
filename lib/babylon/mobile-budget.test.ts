import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { PHONE_HOME_SECTION_ORDER } from "@/lib/babylon/mobile-home";
import {
  PHONE_BUDGET_DEEPER_ACTIONS,
  PHONE_BUDGET_SECTION_ORDER,
  phoneBudgetDebtShareNote,
} from "@/lib/babylon/mobile-budget";

describe("phone Budget composition", () => {
  it("orders Budget as living budget, purpose, categories, debt, then deeper analysis", () => {
    expect(PHONE_BUDGET_SECTION_ORDER).toEqual([
      "living-budget",
      "allocation-purpose",
      "category-plan",
      "debt-payoff",
      "deeper-analysis",
    ]);
  });

  it("keeps deeper analysis closed until a steward opens one panel", () => {
    expect(PHONE_BUDGET_DEEPER_ACTIONS).toEqual([
      "income",
      "charts",
      "affordability",
    ]);
  });

  it("states the debt-free redirect without changing the 20% share", () => {
    expect(phoneBudgetDebtShareNote(true)).toBe("Applied to active debt.");
    expect(phoneBudgetDebtShareNote(false)).toBe(
      "No active debt. This share goes to Wealth Building."
    );
  });

  it("leaves the accepted Home order in place", () => {
    expect(PHONE_HOME_SECTION_ORDER).toEqual([
      "attention",
      "financial-position",
      "available-after-planned-needs",
      "upcoming-needs",
      "recent-activity",
    ]);
  });
});

describe("phone Budget source boundaries", () => {
  const budgetSource = readFileSync(
    "components/babylon/mobile-budget.tsx",
    "utf8"
  );
  const homeSource = readFileSync(
    "components/babylon/mobile-home.tsx",
    "utf8"
  );
  const dashboard = readFileSync(
    "components/babylon/wealth-engine-dashboard.tsx",
    "utf8"
  );
  const desktopBlock = dashboard.split("{desktopLayout && (")[2];

  it("uses a vertical purpose list and withholds charts until asked", () => {
    expect(budgetSource).not.toContain("overflow-x-auto");
    expect(budgetSource).not.toContain("GoldenTriad");
    expect(budgetSource).not.toContain("SpendingPowerFocus");
    expect(budgetSource.indexOf('aria-label="Living Budget"')).toBeLessThan(
      budgetSource.indexOf('aria-label="10/20/70"')
    );
    expect(budgetSource.indexOf('aria-label="10/20/70"')).toBeLessThan(
      budgetSource.indexOf("<BudgetBlueprint")
    );
    expect(budgetSource.indexOf("<BudgetBlueprint")).toBeLessThan(
      budgetSource.indexOf("<DebtFreedomEngine")
    );
    expect(budgetSource.indexOf("<DebtFreedomEngine")).toBeLessThan(
      budgetSource.indexOf('aria-label="Deeper analysis"')
    );
    expect(budgetSource).toContain('showVelocityChart={showDebtChart}');
    expect(budgetSource).toContain("useState(false)");
    expect(budgetSource).toContain('deeper === "charts"');
    expect(budgetSource).toContain('deeper === "affordability"');
    expect(budgetSource).toContain('deeper === "income"');
    expect(homeSource).not.toContain("MobileBudget");
  });

  it("keeps the desktop overview composition", () => {
    expect(desktopBlock).toContain("focusCards");
    expect(desktopBlock).toContain("triad");
    expect(desktopBlock).toContain("budgetBlueprint");
    expect(desktopBlock).toContain("debtFreedom");
    expect(desktopBlock).toContain("AnalyticsHub");
    expect(desktopBlock).toContain("AffordabilityAnchor");
    expect(desktopBlock).toContain("TributeEnginesPanel");
  });
});
