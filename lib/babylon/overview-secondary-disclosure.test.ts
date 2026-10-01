// @vitest-environment jsdom

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createElement } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { AffordabilityAnchor } from "@/components/babylon/affordability-anchor";
import { AnalyticsHub } from "@/components/babylon/analytics-hub";
import { ConnectedBanksCard } from "@/components/babylon/connected-banks-card";
import { QuickStats } from "@/components/babylon/quick-stats";
import { WisdomBox } from "@/components/babylon/wisdom-box";
import { RecentActivityStrip } from "@/components/dashboard/RecentActivityStrip";
import { TributeEnginesPanel } from "@/components/dashboard/TributeEnginesPanel";
import { BABYLON_WISDOM } from "@/lib/babylon/constants";
import { DISCREET_MASK } from "@/lib/babylon/discreet";
import type { ActivityEvent, TributeEngineSnapshot } from "@/types/babylon";

afterEach(() => {
  cleanup();
});

const INCOME_DESCRIPTION =
  "This month's income by type, and how each type changed from last month.";
const RECENT_DESCRIPTION =
  "Last five changes — income, expenses, and categories";
const RECENT_EMPTY =
  "Nothing here yet. Use Add to record income or an expense.";

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

function toggle(name: RegExp) {
  return screen.getByRole("button", { name });
}

const incomeSnapshot: TributeEngineSnapshot = {
  monthKey: "2026-09",
  monthTotal: 100,
  primaryAmount: 80,
  secondaryAmount: 20,
  primaryPct: 80,
  secondaryPct: 20,
  byKind: [
    { kind: "primary", amount: 80, pctOfMonth: 80, momPct: null },
  ],
};

const paycheck: ActivityEvent = {
  id: "evt-1",
  kind: "income",
  title: "Paycheck",
  subtitle: "Main",
  amount: 12,
  createdAt: "2026-09-30T18:00:00.000Z",
};

describe("desktop Overview secondary disclosure", () => {
  it("keeps the income month total visible and the type rows closed", () => {
    render(
      createElement(TributeEnginesPanel, {
        disclosure: true,
        snapshot: incomeSnapshot,
      })
    );
    const control = toggle(/Income Breakdown/);
    expect(control.getAttribute("aria-expanded")).toBe("false");
    expect(control.getAttribute("aria-controls")).toBe(
      "overview-income-breakdown"
    );
    expect(shows("Income this month")).toBe(true);
    expect(shows("$100.00")).toBe(true);
    expect(shows("Main Income")).toBe(false);
    expect(shows("side, passive, and other")).toBe(false);
    expect(shows(INCOME_DESCRIPTION)).toBe(false);
    expect(document.getElementById("overview-income-breakdown")?.hidden).toBe(
      true
    );

    control.focus();
    fireEvent.click(control);
    expect(control.getAttribute("aria-expanded")).toBe("true");
    expect(document.activeElement).toBe(control);
    expect(shows("Main Income")).toBe(true);
    expect(shows("$80.00")).toBe(true);
    expect(shows("side, passive, and other")).toBe(true);
    expect(shows(INCOME_DESCRIPTION)).toBe(true);
    expect(shows("$100.00")).toBe(true);

    fireEvent.click(control);
    expect(control.getAttribute("aria-expanded")).toBe("false");
    expect(document.activeElement).toBe(control);
    expect(shows("Main Income")).toBe(false);
    expect(shows("$100.00")).toBe(true);
  });

  it("leaves the phone income breakdown open when disclosure is off", () => {
    render(createElement(TributeEnginesPanel, { snapshot: incomeSnapshot }));
    expect(screen.queryByRole("button", { name: /Show/ })).toBeNull();
    expect(shows("Main Income")).toBe(true);
    expect(shows(INCOME_DESCRIPTION)).toBe(true);
  });

  it("masks a discreet income total in the summary without changing the rows", () => {
    render(
      createElement(TributeEnginesPanel, {
        disclosure: true,
        discreet: true,
        snapshot: incomeSnapshot,
      })
    );
    expect(shows(DISCREET_MASK)).toBe(true);
    expect(shows("$100.00")).toBe(false);
    fireEvent.click(toggle(/Income Breakdown/));
    expect(shows("$80.00")).toBe(false);
    expect(shows("Main Income")).toBe(true);
  });

  it("keeps this month's expenditure readings visible and the charts closed", () => {
    render(
      createElement(AnalyticsHub, {
        disclosure: true,
        chartData: [],
        donutData: [],
        currentMonthNeed: 10,
        currentMonthDesire: 4,
        currentMonthRemaining: 6,
      })
    );
    const control = toggle(/Income and allocations/);
    expect(control.getAttribute("aria-expanded")).toBe("false");
    expect(shows("Needs")).toBe(true);
    expect(shows("Wants")).toBe(true);
    expect(shows("Remaining")).toBe(true);
    expect(shows("$10.00")).toBe(true);
    expect(shows("$4.00")).toBe(true);
    expect(shows("$6.00")).toBe(true);
    expect(
      shows("Income compared with Wealth Building, Debt Payoff, and the Living Budget")
    ).toBe(false);
    expect(shows("Charts appear after the first income is added.")).toBe(false);

    fireEvent.click(control);
    expect(
      shows("Income compared with Wealth Building, Debt Payoff, and the Living Budget")
    ).toBe(true);
    expect(shows("Charts appear after the first income is added.")).toBe(true);
    expect(
      shows("This breakdown appears after the first income is added.")
    ).toBe(true);
    expect(shows("$10.00")).toBe(true);
  });

  it("keeps the latest activity title visible and the event list closed", () => {
    render(
      createElement(RecentActivityStrip, {
        disclosure: true,
        events: [paycheck],
        now: new Date("2026-09-30T18:05:00.000Z"),
      })
    );
    const control = toggle(/Recent Activity/);
    expect(control.getAttribute("aria-expanded")).toBe("false");
    expect(shows("1 recent")).toBe(true);
    expect(shows("Paycheck")).toBe(true);
    expect(shows(RECENT_DESCRIPTION)).toBe(false);
    expect(shows("$12.00")).toBe(false);

    fireEvent.click(control);
    expect(shows(RECENT_DESCRIPTION)).toBe(true);
    expect(shows("$12.00")).toBe(true);
    expect(shows("Paycheck")).toBe(true);
  });

  it("keeps an empty activity summary visible", () => {
    render(
      createElement(RecentActivityStrip, { disclosure: true, events: [] })
    );
    expect(shows("Nothing here yet")).toBe(true);
    expect(shows(RECENT_EMPTY)).toBe(false);
    fireEvent.click(toggle(/Recent Activity/));
    expect(shows(RECENT_EMPTY)).toBe(true);
  });

  it("keeps lifetime readings visible and the stat cards closed", () => {
    render(
      createElement(QuickStats, {
        disclosure: true,
        totalIncome: 30,
        debtAllocated: 8,
      })
    );
    const control = toggle(/Lifetime Income/);
    expect(control.getAttribute("aria-expanded")).toBe("false");
    expect(shows("Lifetime Income")).toBe(true);
    expect(shows("Debt Payoff allocated")).toBe(true);
    expect(shows("$30.00")).toBe(true);
    expect(shows("$8.00")).toBe(true);
    expect(document.getElementById("overview-quick-stats")?.hidden).toBe(true);

    fireEvent.click(control);
    expect(screen.getAllByText("Lifetime Income")).toHaveLength(2);
    expect(screen.getAllByText("$30.00")).toHaveLength(2);
    expect(screen.getAllByText("Debt Payoff allocated")).toHaveLength(2);
    expect(screen.getAllByText("$8.00")).toHaveLength(2);
  });

  it("starts the Overview guidance quote closed and leaves the Guidance destination open", () => {
    const { rerender } = render(
      createElement(WisdomBox, {
        disclosure: true,
        expanded: false,
        wisdomIndex: 0,
        onSelectIndex: () => undefined,
      })
    );
    const control = toggle(/Financial Guidance/);
    expect(control.getAttribute("aria-expanded")).toBe("false");
    expect(shows("How this ledger works")).toBe(true);
    expect(shows(BABYLON_WISDOM[0])).toBe(true);
    expect(screen.queryByRole("tablist")).toBeNull();
    expect(document.querySelector("blockquote")?.closest("[hidden]")).not.toBeNull();
    fireEvent.click(control);
    expect(screen.getByRole("tablist", { name: "Financial guidance selector" })).toBeTruthy();
    expect(document.querySelector("blockquote")?.textContent).toContain(
      BABYLON_WISDOM[0]
    );
    expect(document.querySelector("blockquote")?.closest("[hidden]")).toBeNull();

    rerender(
      createElement(WisdomBox, {
        disclosure: false,
        expanded: true,
        wisdomIndex: 0,
        onSelectIndex: () => undefined,
      })
    );
    expect(screen.queryByRole("button", { name: /Show/ })).toBeNull();
    expect(
      screen.getByRole("tablist", { name: "Financial guidance selector" })
    ).toBeTruthy();
    expect(shows(BABYLON_WISDOM[1])).toBe(true);
  });

  it("keeps wants money visible, closes the purchase test, and preserves the typed amount", () => {
    render(
      createElement(AffordabilityAnchor, {
        disclosure: true,
        desiresPoolRemaining: 50,
        hourlyLaborRate: 25,
      })
    );
    const control = toggle(/Affordability Anchor/);
    expect(control.getAttribute("aria-expanded")).toBe("false");
    expect(shows("Left for wants:")).toBe(true);
    expect(shows("$50.00")).toBe(true);
    const input = document.getElementById(
      "affordability-amount"
    ) as HTMLInputElement;
    expect(input.closest("[hidden]")).not.toBeNull();
    expect(input.isConnected).toBe(true);
    fireEvent.change(input, { target: { value: "42.5" } });

    fireEvent.click(control);
    expect(input.value).toBe("42.5");
    expect(shows("Main income hours")).toBe(true);
    fireEvent.click(control);
    expect(control.getAttribute("aria-expanded")).toBe("false");
    expect(input.value).toBe("42.5");
    expect(input.isConnected).toBe(true);
    expect(shows("$50.00")).toBe(true);
  });

  it("collapses a healthy bank card without unmounting Connect Bank", () => {
    render(
      createElement(ConnectedBanksCard, {
        disclosureWhenHealthy: true,
        connectedCount: 2,
        isCloudSynced: true,
        onConnect: () => undefined,
      })
    );
    const control = toggle(/Connected Bank Accounts/);
    expect(control.getAttribute("aria-expanded")).toBe("false");
    expect(shows("2 banks connected")).toBe(true);
    const connect = screen.getByRole("button", {
      name: "Connect Bank",
      hidden: true,
    });
    expect(connect.closest("[hidden]")).not.toBeNull();
    expect(connect.isConnected).toBe(true);

    fireEvent.click(control);
    expect(screen.getByRole("button", { name: "Connect Bank" })).toBe(connect);
  });

  it("leaves repair, signed-out, loading, and empty bank states open", () => {
    const { rerender } = render(
      createElement(ConnectedBanksCard, {
        disclosureWhenHealthy: true,
        connectedCount: 1,
        isCloudSynced: true,
        repairs: [{ itemId: "item-1", institutionName: "First Bank" }],
        onRepair: () => undefined,
      })
    );
    expect(shows("Bank connection needs attention")).toBe(true);
    expect(shows("First Bank")).toBe(true);
    expect(screen.getByRole("button", { name: "Reconnect bank" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Show/ })).toBeNull();

    rerender(
      createElement(ConnectedBanksCard, {
        disclosureWhenHealthy: true,
        connectedCount: 0,
        isCloudSynced: false,
      })
    );
    expect(shows("Sign in to connect a bank.")).toBe(true);
    expect(screen.getByRole("button", { name: "Sign In" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Show/ })).toBeNull();

    rerender(
      createElement(ConnectedBanksCard, {
        disclosureWhenHealthy: true,
        connectedCount: 0,
        isCloudSynced: true,
        isLoading: true,
      })
    );
    expect(shows("Checking links…")).toBe(true);
    expect(screen.getByRole("button", { name: "Connect Bank" })).toBeTruthy();

    rerender(
      createElement(ConnectedBanksCard, {
        disclosureWhenHealthy: true,
        connectedCount: 0,
        isCloudSynced: true,
      })
    );
    expect(shows("No accounts linked yet")).toBe(true);
    expect(screen.getByRole("button", { name: "Connect Bank" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Show/ })).toBeNull();
  });
});

describe("desktop Overview composition", () => {
  const dashboard = readFileSync(
    resolve("components/babylon/wealth-engine-dashboard.tsx"),
    "utf8"
  );
  const overview = dashboard.slice(dashboard.indexOf("{showOverview && ("));
  const homeBlock = dashboard
    .split('mobileDestination === "home"')[1]
    .split('mobileDestination === "budget"')[0];
  const budgetBlock = dashboard
    .split('mobileDestination === "budget"')[1]
    .split('mobileDestination === "ledger"')[0];
  const moreBlock = dashboard
    .split('mobileDestination === "more"')[1]
    .split("{desktopLayout && (")[0];

  it("keeps primary truth ahead of the closed secondary stack", () => {
    const order = [
      "{debtRebaseBanner}",
      "{financialPosition}",
      "{upcomingNeedsCard}",
      "{focusCards}",
      "{triad}",
      "{banksCard}",
      "{debtFreedom}",
      "<AffordabilityAnchor",
      "<TributeEnginesPanel",
      "{monthlyPlan}",
      "{budgetBlueprint}",
      "<AnalyticsHub",
      "<RecentActivityStrip",
      "<QuickStats",
      "<WisdomBox",
    ];
    let cursor = -1;
    for (const name of order) {
      const at = overview.indexOf(name);
      expect(at).toBeGreaterThan(cursor);
      cursor = at;
    }
    expect(overview).toMatch(/<AffordabilityAnchor\s+disclosure/);
    expect(overview).toMatch(/<TributeEnginesPanel\s+disclosure/);
    expect(overview).toMatch(/<AnalyticsHub\s+disclosure/);
    expect(overview).toMatch(/<RecentActivityStrip\s+disclosure/);
    expect(overview).toMatch(/<QuickStats\s+disclosure/);
    expect(overview).toContain("disclosure={showOverview}");
    expect(dashboard.slice(
      dashboard.indexOf("const monthlyPlan = ("),
      dashboard.indexOf("const budgetBlueprint")
    )).toContain("disclosure={desktopLayout}");
    expect(dashboard.slice(
      dashboard.indexOf("const budgetBlueprint = ("),
      dashboard.indexOf("const ledgers")
    )).not.toContain("disclosure");
    expect(dashboard).toMatch(/<ConnectedBanksCard\s+disclosureWhenHealthy/);
    expect(homeBlock).not.toContain("disclosure");
    expect(budgetBlock).not.toContain("disclosure");
    expect(moreBlock).not.toContain("disclosure");
  });

  it("does not add disclosure to phone surfaces", () => {
    const budget = readFileSync(
      resolve("components/babylon/mobile-budget.tsx"),
      "utf8"
    );
    const more = readFileSync(
      resolve("components/babylon/mobile-more.tsx"),
      "utf8"
    );
    const home = readFileSync(
      resolve("components/babylon/mobile-home.tsx"),
      "utf8"
    );
    expect(budget).not.toContain("disclosure");
    expect(more).not.toContain("disclosureWhenHealthy");
    expect(more).not.toContain("disclosure=");
    expect(home).not.toContain("overview-disclosure");
  });
});
