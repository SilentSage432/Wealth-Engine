// @vitest-environment jsdom

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createElement } from "react";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { SpendingPowerFocus } from "@/components/babylon/spending-power-focus";

afterEach(() => {
  cleanup();
});

describe("desktop Overview spending power", () => {
  const focusSource = readFileSync(
    resolve("components/babylon/spending-power-focus.tsx"),
    "utf8"
  );
  const triadSource = readFileSync(
    resolve("components/babylon/golden-triad.tsx"),
    "utf8"
  );
  const dashboard = readFileSync(
    resolve("components/babylon/wealth-engine-dashboard.tsx"),
    "utf8"
  );
  const focusCards = dashboard.slice(
    dashboard.indexOf("const focusCards = ("),
    dashboard.indexOf("const debtFreedom")
  );
  const triad = dashboard.slice(
    dashboard.indexOf("const triad = ("),
    dashboard.indexOf("const debtRebaseBanner")
  );
  const budgetBlock = dashboard
    .split('mobileDestination === "budget"')[1]
    .split('mobileDestination === "ledger"')[0];

  it("keeps labor hours and drops the Living Budget dollar hero", () => {
    render(
      createElement(SpendingPowerFocus, {
        expenditureRemaining: 420,
        hourlyLaborRate: 20,
      })
    );

    expect(screen.getByLabelText("Spending power").textContent).toContain(
      "Representing"
    );
    expect(screen.getByText("21")).toBeTruthy();
    expect(screen.getByText(/Main income · \$20\.00\/hr/)).toBeTruthy();
    expect(screen.queryByText(/Living Budget remaining/)).toBeNull();
    expect(screen.queryByText("$420.00")).toBeNull();
    expect(screen.queryByText(/this month/)).toBeNull();
  });

  it("keeps the hours tile when the wage rate is missing", () => {
    render(
      createElement(SpendingPowerFocus, {
        expenditureRemaining: 420,
        hourlyLaborRate: 0,
      })
    );

    expect(screen.getByText("—")).toBeTruthy();
    expect(
      screen.getByText("Add recurring main income to estimate hours")
    ).toBeTruthy();
    expect(screen.queryByText(/Living Budget remaining/)).toBeNull();
  });

  it("leaves the 70% dollar reading on the Golden Triad and off phone Budget", () => {
    expect(focusSource).toContain("laborHoursForAmount");
    expect(focusSource).not.toContain("Living Budget remaining · 70%");
    expect(focusSource).not.toContain("expenditurePool");
    expect(triadSource).toContain("Living Budget · 70%");
    expect(focusCards).toContain(
      "expenditureRemaining={engine.expenditureRemaining}"
    );
    expect(focusCards).toContain("hourlyLaborRate={engine.hourlyLaborRate}");
    expect(focusCards).not.toContain("expenditurePool");
    expect(focusCards).not.toContain("expenditureRemainingPct");
    expect(triad).toContain("expenditureRemaining={engine.expenditureRemaining}");
    expect(triad).toContain("expenditurePool={engine.expenditurePool}");
    expect(triad).toContain("totalSpent={engine.totalSpent}");
    expect(budgetBlock).not.toContain("SpendingPowerFocus");
    expect(budgetBlock).not.toContain("focusCards");
  });
});