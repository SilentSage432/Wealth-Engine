// @vitest-environment jsdom

import { readFileSync } from "node:fs";
import { createElement } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MobileBudget } from "@/components/babylon/mobile-budget";
import {
  percentToBasisPoints,
  WealthDirectionPanel,
} from "@/components/babylon/wealth-direction";
import type { WealthDirectionState } from "@/lib/babylon/financial-direction";
import type { FinancialDirectionDeclaration } from "@/types/babylon";

afterEach(() => {
  cleanup();
});

function row(basisPoints: number): FinancialDirectionDeclaration {
  return {
    id: "w1",
    purpose: "emergency_fund",
    basisPoints,
    declaredAt: "2026-10-01T18:00:00.000Z",
    supersedesId: null,
  };
}

function budgetProps(
  wealthDirection: WealthDirectionState
) {
  return {
    expenditureRemaining: 700,
    expenditurePool: 700,
    totalSpent: 0,
    expenditureRemainingPct: 100,
    hasActiveDebt: true,
    wealthAllocated: 100,
    debtAllocated: 200,
    discreet: false,
    variances: [],
    budgetTargets: [],
    plannedTotal: 0,
    actualTotal: 0,
    debts: [],
    monthlyDebtBudget: 200,
    currentMonthKey: "2026-10",
    periodArchives: [],
    chartData: [],
    donutData: [],
    currentMonthNeed: 0,
    currentMonthDesire: 0,
    currentMonthRemaining: 700,
    tributeSnapshot: {
      monthKey: "2026-10",
      monthTotal: 0,
      primaryAmount: 0,
      secondaryAmount: 0,
      primaryPct: 0,
      secondaryPct: 0,
      byKind: [],
    },
    desiresPoolRemaining: 0,
    wealthDirection,
  };
}

describe("desktop wealth direction authorship", () => {
  it("starts empty, does not prefill 100%, and saves the share the steward types", () => {
    const onDeclare = vi.fn(() => null);
    render(
      createElement(WealthDirectionPanel, {
        direction: { status: "no_direction" },
        authoring: true,
        onDeclare,
      })
    );
    fireEvent.click(screen.getByRole("button", { name: "Declare Emergency Fund direction" }));
    const input = screen.getByLabelText("Share of new Wealth Building capacity") as HTMLInputElement;
    expect(input.value).toBe("");
    expect(screen.getByText(/You declare this share/)).toBeTruthy();
    expect(screen.getByText(/not proof money moved/)).toBeTruthy();
    fireEvent.change(input, { target: { value: "40" } });
    fireEvent.click(screen.getByRole("button", { name: "Save declaration" }));
    expect(onDeclare).toHaveBeenCalledWith({ basisPoints: 4000 });
    expect(percentToBasisPoints("100")).toBe(10000);
    expect(percentToBasisPoints("")).toBeNull();
  });

  it("shows the current share and appends a replacement without editing the prior row", () => {
    const prior = row(10000);
    const onDeclare = vi.fn(() => null);
    render(
      createElement(WealthDirectionPanel, {
        direction: { status: "valid_direction", declaration: prior },
        authoring: true,
        onDeclare,
        destinationAmount: 8500,
      })
    );
    expect(screen.getByText(/100% of new received Wealth Building capacity/)).toBeTruthy();
    expect(screen.getByText(/The rest remains Wealth Building/)).toBeTruthy();
    expect(screen.getByText(/minimum of/)).toBeTruthy();
    expect(prior.basisPoints).toBe(10000);
    fireEvent.click(screen.getByRole("button", { name: "Declare a new share" }));
    fireEvent.change(screen.getByLabelText("Share of new Wealth Building capacity"), {
      target: { value: "25" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save declaration" }));
    expect(onDeclare).toHaveBeenCalledWith({ basisPoints: 2500 });
    expect(prior.basisPoints).toBe(10000);
  });
});

describe("mobile wealth direction projection", () => {
  it("reads the standing share and does not offer authorship", () => {
    render(
      createElement(MobileBudget, {
        ...budgetProps({
          status: "valid_direction",
          declaration: row(4000),
        }),
      })
    );
    expect(screen.getByLabelText("Living Budget").textContent).toContain("$700.00");
    expect(screen.queryByText(/hours of main income/)).toBeNull();
    expect(screen.queryByText(/\/hr/)).toBeNull();
    expect(screen.getByText(/40% of/)).toBeTruthy();
    expect(screen.getByText(/The rest remains Wealth Building/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Declare/ })).toBeNull();
    expect(screen.queryByRole("button", { name: "Save declaration" })).toBeNull();

    const budget = readFileSync("components/babylon/mobile-budget.tsx", "utf8");
    const dashboard = readFileSync("components/babylon/wealth-engine-dashboard.tsx", "utf8");
    expect(budget).not.toContain("Declare Emergency Fund direction");
    expect(budget).not.toContain("Save declaration");
    const phoneBudget = dashboard.split('mobileDestination === "budget"')[1]?.split('mobileDestination === "ledger"')[0] ?? "";
    expect(phoneBudget).toContain("wealthDirection={engine.wealthDirection}");
    expect(phoneBudget).not.toContain("declareWealthDirection");
    expect(phoneBudget).not.toContain("WealthDirectionPanel");
    expect(dashboard).toContain("<WealthDirectionPanel");
  });
});
