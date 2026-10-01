// @vitest-environment jsdom

import { readFileSync } from "node:fs";
import { createElement } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { BudgetBlueprint } from "@/components/dashboard/BudgetBlueprint";
import { MobileHeader } from "@/components/babylon/mobile-header";
import { MobileLedger } from "@/components/babylon/mobile-ledger";
import { MonthlyPlanPanel } from "@/components/babylon/monthly-plan-panel";
import { FinancialTimeZoneField } from "@/components/babylon/financial-time-zone-field";
import { applyDueAttentionDecision } from "@/lib/babylon/attention";
import type {
  BudgetCategoryVariance,
  ExpenseEntry,
  MonthlyPlanRevision,
} from "@/types/babylon";

afterEach(() => {
  cleanup();
});

function expense(
  partial: Partial<ExpenseEntry> & Pick<ExpenseEntry, "id" | "isSettled">
): ExpenseEntry {
  return {
    name: partial.name ?? partial.id,
    category: "need",
    amount: 40,
    date: "2026-10-01",
    dueDate: "2026-10-01",
    ...partial,
  };
}

function variance(): BudgetCategoryVariance {
  return {
    id: "rent",
    categoryName: "Rent",
    plannedAmount: 100,
    actualAmount: 40,
    remainingAmount: 60,
    variance: 60,
    usedPct: 40,
    isEssential: true,
    tone: "emerald",
  };
}

function plan(): MonthlyPlanRevision {
  return {
    id: "plan-1",
    periodKey: "2026-10",
    revision: 1,
    finalizedAt: "2026-10-01T12:00:00.000Z",
    supersedesId: null,
    planningBasis: 1000,
    wealthShare: 100,
    debtShare: 200,
    expenditureShare: 700,
    debtRedirected: false,
    categories: [
      {
        id: "rent",
        categoryName: "Rent",
        plannedAmount: 700,
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

function dashboardBlocks() {
  const dashboard = readFileSync(
    "components/babylon/wealth-engine-dashboard.tsx",
    "utf8"
  );
  return {
    dashboard,
    home: dashboard
      .split('mobileDestination === "home"')[1]
      .split('mobileDestination === "budget"')[0],
    budget: dashboard
      .split('mobileDestination === "budget"')[1]
      .split('mobileDestination === "ledger"')[0],
    ledger: dashboard
      .split('mobileDestination === "ledger"')[1]
      .split('mobileDestination === "more"')[0],
    more: dashboard
      .split('mobileDestination === "more"')[1]
      .split("{desktopLayout && (")[0],
    desktop: dashboard.split("{desktopLayout && (")[2],
  };
}

describe("phone projection surfaces", () => {
  it("keeps discreet mode and withholds record and close from the phone header", () => {
    const onToggle = vi.fn();
    render(
      createElement(MobileHeader, {
        username: "Ada",
        isDiscreetMode: false,
        openMonthMessage: "Oct 26 is still open and ends today.",
        onToggleDiscreetMode: onToggle,
        financialCalendarKnown: true,
      })
    );
    expect(screen.getByText(/still open and ends today/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Add (shortcut N)" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Review close" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Enable discreet mode" }));
    expect(onToggle).toHaveBeenCalledOnce();
  });

  it("shows Paid for an unpaid ledger row and withholds Reopen, edit, and delete", () => {
    const onMarkPaid = vi.fn();
    render(
      createElement(MobileLedger, {
        incomes: [],
        expenses: [
          expense({ id: "open", name: "Rent", isSettled: false }),
          expense({ id: "done", name: "Power", isSettled: true }),
        ],
        debts: [],
        needSpend: 40,
        desireSpend: 0,
        totalSpent: 40,
        budgetTargets: [],
        financialToday: "2026-10-01",
        onMarkPaid,
        recurringObligations: [],
        discreet: false,
      })
    );
    fireEvent.click(screen.getByRole("tab", { name: "Expenses" }));
    fireEvent.click(screen.getByRole("button", { name: "Mark Rent paid" }));
    expect(onMarkPaid).toHaveBeenCalledWith("open");
    expect(screen.queryByRole("button", { name: "Mark Power paid" })).toBeNull();
    expect(screen.queryByRole("button", { name: /upcoming/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /Edit/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /Delete/ })).toBeNull();
  });

  it("renders budget figures without cap authorship, and desktop keeps the editor", () => {
    const onUpdate = vi.fn(() => true);
    const shared = {
      variances: [variance()],
      budgetTargets: [],
      plannedTotal: 100,
      actualTotal: 40,
      expenditurePool: 700,
      onUpdateTargetFull: onUpdate,
      onDeleteTarget: vi.fn(),
      onAutoScaleCaps: vi.fn(() => true),
    };
    const { unmount } = render(
      createElement(BudgetBlueprint, { ...shared, layout: "phone", readOnly: true })
    );
    expect(screen.getByText("Rent")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Edit category Rent" })).toBeNull();
    expect(screen.queryByRole("button", { name: /Auto-scale/ })).toBeNull();
    unmount();
    render(createElement(BudgetBlueprint, { ...shared, layout: "full" }));
    expect(screen.getByRole("button", { name: "Edit category Rent" })).toBeTruthy();
    expect(
      screen.getByRole("button", { name: /Auto-scale budget allocations/ })
    ).toBeTruthy();
  });

  it("shows a stored plan on the phone and keeps revise and pay-schedule controls on the desktop", () => {
    const props = {
      suggestedPeriodKey: "2026-10",
      plans: [plan()],
      budgetTargets: [],
      debts: [],
      obligations: [],
      openingWealthBuilding: 0,
      openingEmergencyFund: 0,
      paySchedules: [],
      onFinalize: vi.fn(),
      onUpsertPaySchedule: vi.fn(() => ({ ok: true as const })),
      onRemovePaySchedule: vi.fn(),
    };
    const { unmount } = render(
      createElement(MonthlyPlanPanel, { ...props, readOnly: true })
    );
    expect(screen.getByText(/Revision 1/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Revise map" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Add expected pay schedule" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Expected pay schedule" })).toBeNull();
    expect(screen.getByText("No expected pay schedule is recorded.")).toBeTruthy();
    unmount();
    render(createElement(MonthlyPlanPanel, props));
    expect(screen.getByRole("button", { name: "Revise map" })).toBeTruthy();
  });

  it("displays the financial time zone without an establish control", () => {
    const { unmount } = render(
      createElement(FinancialTimeZoneField, {
        financialTimeZone: "America/Boise",
        readOnly: true,
      })
    );
    expect(screen.getByText("America/Boise")).toBeTruthy();
    expect(screen.queryByRole("textbox", { name: "Financial time zone" })).toBeNull();
    expect(
      screen.queryByRole("button", { name: "Change financial time zone" })
    ).toBeNull();
    unmount();
    render(
      createElement(FinancialTimeZoneField, {
        financialTimeZone: "America/Boise",
        onEstablish: vi.fn(() => true),
      })
    );
    expect(
      screen.getByRole("button", { name: "Change financial time zone" })
    ).toBeTruthy();
  });

  it("leaves Still upcoming as a non-writing decision", () => {
    const markPaid = vi.fn();
    applyDueAttentionDecision("still-upcoming", "exp-rent", markPaid);
    expect(markPaid).not.toHaveBeenCalled();
    applyDueAttentionDecision("paid", "exp-rent", markPaid);
    expect(markPaid).toHaveBeenCalledWith("exp-rent");
  });
});

describe("phone projection mutation audit", () => {
  const blocks = dashboardBlocks();
  const phone = `${blocks.home}\n${blocks.budget}\n${blocks.ledger}\n${blocks.more}`;
  const forbidden = [
    "openTribute",
    "setMonthlyCloseOpen",
    "debtRebaseBanner",
    "updateBudgetTargetFull",
    "deleteBudgetTarget",
    "autoScaleBudgetCaps",
    "deleteIncome",
    "deleteExpense",
    "deleteDebt",
    "updateExpenseOccurrence",
    "updateRecurringObligation",
    "addAccount",
    "updateAccount",
    "removeAccount",
    "setAccountPurpose",
    "updateProtectedDesignations",
    "establishFinancialTimeZone",
    "finalizeMonthlyPlan",
    "upsertPaySchedule",
    "addExpense",
    "addDebt",
    "addIncome",
    "closeMonth",
    "completeDebtPositionRebase",
  ];

  it("reaches Paid from Home and Ledger and no other financial authorship from the phone branches", () => {
    expect(blocks.home).toContain("onMarkPaid={engine.markOccurrencePaid}");
    expect(blocks.ledger).toContain("onMarkPaid={engine.markOccurrencePaid}");
    expect(blocks.home).not.toContain("toggleExpenseSettled");
    expect(blocks.ledger).not.toContain("toggleExpenseSettled");
    expect(blocks.budget).not.toContain("toggleExpenseSettled");
    expect(blocks.dashboard).toContain("onMarkPaid={engine.toggleExpenseSettled}");
    expect(blocks.desktop).toContain("{upcomingNeedsCard}");
    for (const name of forbidden) {
      expect(phone).not.toContain(name);
    }
    expect(blocks.dashboard).toContain("readOnly={!desktopLayout}");
    expect(blocks.dashboard).toContain("enabled:\n      desktopLayout &&");
  });

  it("keeps maintenance on More", () => {
    for (const name of [
      "onUsernameChange={engine.setUsername}",
      "onConnectBank={handleLinkBank}",
      "onExportBackup={engine.exportBackup}",
      "onImportBackup={engine.importBackup}",
      "onClearAllData={engine.clearAllData}",
      "onCheckCloud={engine.confirmCloudCheck}",
      "balanceObservation={balanceObservationView}",
    ]) {
      expect(blocks.more).toContain(name);
    }
  });

  it("keeps desktop authoring on the desktop branch", () => {
    expect(blocks.desktop).toContain("{debtRebaseBanner}");
    expect(blocks.desktop).toContain("budgetBlueprint");
    expect(blocks.desktop).toContain("{ledgers}");
    expect(blocks.desktop).toContain("{monthlyPlan}");
    expect(blocks.dashboard).toContain("onDeleteIncome={engine.deleteIncome}");
    expect(blocks.dashboard).toContain("onUpdateTargetFull={engine.updateBudgetTargetFull}");
    expect(blocks.dashboard).toContain("onFinalize={engine.finalizeMonthlyPlan}");
    expect(blocks.dashboard).toContain("onEstablishFinancialTimeZone={engine.establishFinancialTimeZone}");
    expect(blocks.dashboard).toContain(
      "onOpenMonthlyClose={() => engine.setMonthlyCloseOpen(true)}"
    );
    const commandBar = readFileSync("components/babylon/command-bar.tsx", "utf8");
    const matrices = readFileSync("components/babylon/ledger-matrices.tsx", "utf8");
    expect(commandBar).toContain("Add");
    expect(commandBar).toContain("Review close");
    expect(matrices).toContain("onDeleteIncome");
    expect(matrices).toContain("onToggleExpenseSettled");
  });

  it("does not let a passive phone surface write the vault", () => {
    for (const file of [
      "components/babylon/mobile-home.tsx",
      "components/babylon/mobile-budget.tsx",
      "components/babylon/mobile-ledger.tsx",
      "components/babylon/mobile-more.tsx",
      "components/babylon/mobile-header.tsx",
    ]) {
      const source = readFileSync(file, "utf8");
      expect(source).not.toContain("savePersistedState");
      expect(source).not.toContain("compareAndSwap");
    }
    const home = readFileSync("components/babylon/mobile-home.tsx", "utf8");
    expect(home).toContain('"still-upcoming"');
  });
});
