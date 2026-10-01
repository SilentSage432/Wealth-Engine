// @vitest-environment jsdom

import { createElement, type ComponentProps } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MonthlyPlanPanel } from "@/components/babylon/monthly-plan-panel";
import { DISCREET_MASK } from "@/lib/babylon/discreet";
import {
  composeFundThisMonthView,
  formatCivilDateLabel,
} from "@/lib/babylon/paycheck-planner-ui";
import type { MonthlyPlanRevision, PaySchedule } from "@/types/babylon";

afterEach(() => {
  cleanup();
});

const biweekly: PaySchedule = {
  id: "sched-bi",
  cadence: "biweekly",
  anchorDate: "2026-10-02",
  createdAt: "2026-01-01",
  label: "Lowe's",
  expectedAmount: 4000,
};

function revision(): MonthlyPlanRevision {
  return {
    id: "plan-rev-1",
    periodKey: "2026-10",
    revision: 1,
    finalizedAt: "2026-10-01T12:00:00.000Z",
    supersedesId: null,
    planningBasis: 3000,
    wealthShare: 300,
    debtShare: 600,
    expenditureShare: 2100,
    debtRedirected: false,
    categories: [
      {
        id: "cat-groceries",
        categoryName: "Groceries",
        plannedAmount: 2100,
        isEssential: true,
      },
    ],
    debts: [],
    obligations: [],
    protectedContext: {
      openingWealthBuilding: 0,
      openingEmergencyFund: 0,
    },
  };
}

function renderPlan(
  partial: Partial<ComponentProps<typeof MonthlyPlanPanel>> = {}
) {
  return render(
    createElement(MonthlyPlanPanel, {
      suggestedPeriodKey: "2026-10",
      plans: [revision()],
      budgetTargets: [],
      debts: [],
      obligations: [],
      openingWealthBuilding: 0,
      openingEmergencyFund: 0,
      paySchedules: [biweekly],
      disclosure: true,
      onFinalize: () => ({ ok: true as const, revision: revision() }),
      onUpsertPaySchedule: () => ({ ok: true as const }),
      onRemovePaySchedule: () => undefined,
      ...partial,
    })
  );
}

function shows(text: string): boolean {
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  let node = walker.nextNode();
  while (node) {
    const parent = node.parentElement;
    if (
      parent &&
      parent.closest("[hidden]") === null &&
      node.textContent?.includes(text)
    ) {
      return true;
    }
    node = walker.nextNode();
  }
  return false;
}

function planToggle() {
  return screen.getByRole("button", { name: /Monthly Plan/ });
}

describe("desktop Monthly Plan disclosure", () => {
  it("starts a finalized plan closed with plan and payday timing", () => {
    renderPlan();
    const view = composeFundThisMonthView(revision(), [biweekly]);
    expect(view.status).toBe("path");
    if (view.status !== "path") return;
    const control = planToggle();
    expect(control.getAttribute("aria-expanded")).toBe("false");
    expect(control.getAttribute("aria-controls")).toBe("monthly-plan-detail");
    expect(shows("October 2026")).toBe(true);
    expect(shows("Revision")).toBe(true);
    expect(shows("Planned around")).toBe(true);
    expect(shows("$3,000.00")).toBe(true);
    expect(shows("Living")).toBe(true);
    expect(shows("$2,100.00")).toBe(true);
    expect(shows("First expected payday")).toBe(true);
    expect(shows(formatCivilDateLabel(view.dateGroups[0].date))).toBe(true);
    expect(shows(`${view.expectedPaydayCount} expected paydays`)).toBe(true);
    expect(shows("do not count as")).toBe(true);
    expect(shows("income until money is actually recorded")).toBe(true);
    expect(shows("$4,000.00")).toBe(false);
    expect(shows("not recorded income")).toBe(false);
    expect(shows("Groceries")).toBe(false);
    expect(document.getElementById("monthly-plan-detail")?.hidden).toBe(true);

    control.focus();
    fireEvent.click(control);
    expect(control.getAttribute("aria-expanded")).toBe("true");
    expect(document.activeElement).toBe(control);
    expect(shows("Groceries")).toBe(true);
    expect(
      screen.getByRole("list", { name: "Expected payday funding path" })
    ).toBeTruthy();
    expect(shows("not recorded income")).toBe(true);
    expect(shows("Received")).toBe(false);
  });

  it("keeps a missing plan visible without a disclosure", () => {
    renderPlan({ plans: [] });
    expect(shows("No map for")).toBe(true);
    expect(shows("October 2026")).toBe(true);
    expect(screen.getByRole("button", { name: "Map October 2026" })).toBeTruthy();
    expect(document.getElementById("monthly-plan-detail")).toBeNull();
  });

  it("keeps a missing pay schedule visible while the map stays closed", () => {
    renderPlan({ paySchedules: [] });
    expect(planToggle().getAttribute("aria-expanded")).toBe("false");
    expect(shows("Add an expected pay schedule to break this monthly plan into pay")).toBe(
      true
    );
    expect(shows("No expected pay schedule yet.")).toBe(true);
    expect(shows("Planning schedule only. Expected paydays are not income.")).toBe(
      true
    );
    expect(shows("Groceries")).toBe(false);
  });

  it("keeps an invalid pay schedule visible while the map stays closed", () => {
    renderPlan({
      paySchedules: [
        {
          id: "broken",
          cadence: "biweekly",
          anchorDate: "not-a-date",
          createdAt: "2026-01-01",
        },
      ],
    });
    expect(shows("No expected paydays in")).toBe(true);
    expect(shows("2026-10")).toBe(true);
    expect(shows("The monthly plan is unchanged.")).toBe(true);
    expect(shows("Groceries")).toBe(false);
  });

  it("keeps draft shortfall outside the disclosure", () => {
    renderPlan();
    fireEvent.click(planToggle());
    fireEvent.click(screen.getByRole("button", { name: "Revise map" }));
    expect(document.getElementById("monthly-plan-detail")).toBeNull();
    expect(shows("Working assumption — not income.")).toBe(true);
    fireEvent.change(screen.getByLabelText("Plan October 2026 around"), {
      target: { value: "1" },
    });
    expect(shows("Overcommitted by")).toBe(true);
    expect(shows("Living purposes")).toBe(true);
  });

  it("preserves the pay schedule editor across the disclosure", () => {
    const setItem = vi.spyOn(Storage.prototype, "setItem");
    renderPlan();
    fireEvent.click(screen.getByRole("button", { name: "Expected pay schedule" }));
    const phase = screen.getByLabelText("Phase date") as HTMLInputElement;
    fireEvent.change(phase, { target: { value: "2026-10-09" } });
    const control = planToggle();
    control.focus();
    fireEvent.click(control);
    expect(control.getAttribute("aria-expanded")).toBe("true");
    fireEvent.click(control);
    expect(control.getAttribute("aria-expanded")).toBe("false");
    expect(phase.isConnected).toBe(true);
    expect(phase.value).toBe("2026-10-09");
    expect(phase.closest("[hidden]")).toBeNull();
    expect(setItem).not.toHaveBeenCalled();
    setItem.mockRestore();
  });

  it("masks the closed summary in discreet mode", () => {
    renderPlan({ discreet: true });
    expect(shows(DISCREET_MASK)).toBe(true);
    expect(shows("$3,000.00")).toBe(false);
    expect(shows("$2,100.00")).toBe(false);
    expect(shows("$4,000.00")).toBe(false);
  });

  it("leaves phone planning open", () => {
    renderPlan({ disclosure: false });
    expect(document.getElementById("monthly-plan-detail")).toBeNull();
    expect(screen.queryByRole("button", { name: /Monthly Plan/ })).toBeNull();
    expect(shows("Groceries")).toBe(true);
    expect(shows("Fund this month")).toBe(true);
    expect(shows("not recorded income")).toBe(true);
  });
});
