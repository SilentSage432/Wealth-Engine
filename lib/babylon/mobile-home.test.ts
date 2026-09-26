import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { MOBILE_DESTINATIONS } from "@/lib/babylon/constants";
import {
  PHONE_HOME_ACTIVITY_LIMIT,
  PHONE_HOME_NAV_TARGETS,
  PHONE_HOME_SECTION_ORDER,
  PHONE_HOME_UPCOMING_LIMIT,
  PHONE_MOVED_CAPABILITIES,
  phoneHomeActivityPreview,
  phoneHomeShowsDueAttention,
  phoneHomeUpcomingPreview,
} from "@/lib/babylon/mobile-home";
import type { ExpenseEntry } from "@/types/babylon";

function expense(
  partial: Partial<ExpenseEntry> & Pick<ExpenseEntry, "id" | "dueDate">
): ExpenseEntry {
  return {
    name: partial.id,
    category: "need",
    amount: 10,
    date: partial.dueDate,
    isSettled: false,
    ...partial,
  };
}

describe("phone Home composition", () => {
  it("orders Home as attention, position, available, upcoming, then recent", () => {
    expect(PHONE_HOME_SECTION_ORDER).toEqual([
      "attention",
      "financial-position",
      "available-after-planned-needs",
      "upcoming-needs",
      "recent-activity",
    ]);
  });

  it("shows due attention only when a due obligation exists", () => {
    expect(phoneHomeShowsDueAttention(0)).toBe(false);
    expect(phoneHomeShowsDueAttention(2)).toBe(true);
  });

  it("previews the next three unpaid bills after due rows, in coming-up order", () => {
    const expenses = [
      expense({ id: "later", name: "Later", dueDate: "2026-10-20" }),
      expense({ id: "due", name: "Rent", dueDate: "2026-09-01" }),
      expense({ id: "soon-b", name: "Beta", dueDate: "2026-10-02" }),
      expense({ id: "soon-a", name: "Alpha", dueDate: "2026-10-02" }),
      expense({ id: "mid", name: "Mid", dueDate: "2026-10-08" }),
      expense({ id: "paid", name: "Paid", dueDate: "2026-09-15", isSettled: true }),
      expense({ id: "far", name: "Far", dueDate: "2026-11-01" }),
    ];
    const preview = phoneHomeUpcomingPreview(expenses, new Set(["due"]));
    expect(preview.map((item) => item.id)).toEqual([
      "soon-a",
      "soon-b",
      "mid",
    ]);
    expect(preview).toHaveLength(PHONE_HOME_UPCOMING_LIMIT);
  });

  it("keeps recent activity to a short slice of the existing feed", () => {
    const preview = phoneHomeActivityPreview(["a", "b", "c", "d", "e"]);
    expect(preview).toEqual(["a", "b", "c"]);
    expect(PHONE_HOME_ACTIVITY_LIMIT).toBe(3);
  });

  it("keeps moved capabilities on Budget, Ledger, or More", () => {
    const destinations = new Set<string>(MOBILE_DESTINATIONS);
    for (const destination of Object.values(PHONE_MOVED_CAPABILITIES)) {
      expect(destinations.has(destination)).toBe(true);
      expect(destination).not.toBe("home");
    }
    expect(PHONE_MOVED_CAPABILITIES["debt-freedom"]).toBe("budget");
    expect(PHONE_MOVED_CAPABILITIES["golden-triad"]).toBe("budget");
    expect(PHONE_MOVED_CAPABILITIES.analytics).toBe("budget");
    expect(PHONE_MOVED_CAPABILITIES["budget-blueprint"]).toBe("budget");
    expect(PHONE_MOVED_CAPABILITIES["affordability-anchor"]).toBe("budget");
    expect(PHONE_MOVED_CAPABILITIES["connected-banks"]).toBe("more");
    expect(PHONE_MOVED_CAPABILITIES["financial-guidance"]).toBe("more");
    expect(PHONE_MOVED_CAPABILITIES["account-management"]).toBe("more");
    expect(PHONE_MOVED_CAPABILITIES.ledger).toBe("ledger");
  });

  it("navigates only through the existing phone destinations", () => {
    expect(PHONE_HOME_NAV_TARGETS).toEqual(["ledger", "more"]);
    for (const target of PHONE_HOME_NAV_TARGETS) {
      expect(MOBILE_DESTINATIONS).toContain(target);
    }
  });
});

describe("phone Home source boundaries", () => {
  const dashboard = readFileSync(
    "components/babylon/wealth-engine-dashboard.tsx",
    "utf8"
  );
  const homeSource = readFileSync(
    "components/babylon/mobile-home.tsx",
    "utf8"
  );
  const moreSource = readFileSync(
    "components/babylon/mobile-more.tsx",
    "utf8"
  );
  const headerSource = readFileSync(
    "components/babylon/mobile-header.tsx",
    "utf8"
  );

  const homeBlock = dashboard
    .split('mobileDestination === "home"')[1]
    .split('mobileDestination === "budget"')[0];
  const budgetBlock = dashboard
    .split('mobileDestination === "budget"')[1]
    .split('mobileDestination === "ledger"')[0];
  const ledgerBlock = dashboard
    .split('mobileDestination === "ledger"')[1]
    .split('mobileDestination === "more"')[0];
  const moreBlock = dashboard
    .split('mobileDestination === "more"')[1]
    .split("{desktopLayout && (")[0];
  const desktopBlock = dashboard.split("{desktopLayout && (")[2];

  it("keeps a single phone destination state", () => {
    expect(dashboard.match(/useState<MobileDestination>/g)).toHaveLength(1);
  });

  it("mounts the short Home body and leaves heavy sections off that branch", () => {
    expect(homeBlock).toContain("<MobileHome");
    for (const name of [
      "GoldenTriad",
      "DebtFreedomEngine",
      "debtFreedom",
      "AnalyticsHub",
      "BudgetBlueprint",
      "ConnectedBanksCard",
      "banksCard",
      "WisdomBox",
      "SpendingPowerFocus",
      "focusCards",
      "FinancialPosition",
      "financialPosition",
      "UpcomingNeeds",
      "AffordabilityAnchor",
      "triad",
    ]) {
      expect(homeBlock).not.toContain(name);
    }
    expect(homeSource).not.toContain("GoldenTriad");
    expect(homeSource).not.toContain("AnalyticsHub");
    expect(homeSource).not.toContain("DebtFreedomEngine");
    expect(homeSource).not.toContain("Review close");
    expect(homeSource).toContain("applyDueAttentionDecision");
    expect(homeSource).toContain("Still upcoming");
  });

  it("keeps Ledger and More capabilities mounted on those destinations", () => {
    expect(budgetBlock).toContain("<MobileBudget");
    expect(budgetBlock).not.toContain("AnalyticsHub");
    expect(budgetBlock).not.toContain("GoldenTriad");
    expect(budgetBlock).not.toContain("DebtFreedomEngine");
    expect(ledgerBlock).toContain("<MobileLedger");
    expect(ledgerBlock).not.toContain("LedgerMatrices");
    expect(moreBlock).toContain("financialPosition");
    expect(moreBlock).toContain("<MobileMore");
    expect(moreSource).toContain("WisdomBox");
    expect(moreSource).toContain("ConnectedBanksCard");
    expect(moreSource).toContain("Close Month");
  });

  it("leaves month-close attention on the phone header and keeps the desktop overview", () => {
    expect(headerSource).toContain("Review close");
    expect(desktopBlock).toContain("financialPosition");
    expect(desktopBlock).toContain("upcomingNeedsCard");
    expect(desktopBlock).toContain("focusCards");
    expect(desktopBlock).toContain("triad");
    expect(desktopBlock).toContain("banksCard");
    expect(desktopBlock).toContain("debtFreedom");
    expect(desktopBlock).toContain("AffordabilityAnchor");
    expect(desktopBlock).toContain("budgetBlueprint");
    expect(desktopBlock).toContain("AnalyticsHub");
    expect(desktopBlock).toContain("RecentActivityStrip");
    expect(desktopBlock).toContain("WisdomBox");
  });
});
