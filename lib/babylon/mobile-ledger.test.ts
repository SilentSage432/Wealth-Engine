import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { PHONE_BUDGET_SECTION_ORDER } from "@/lib/babylon/mobile-budget";
import { PHONE_HOME_SECTION_ORDER } from "@/lib/babylon/mobile-home";
import {
  PHONE_LEDGER_SECTIONS,
  phoneDebtClearedPct,
  phoneExpenseTiming,
  phoneLedgerDateLabel,
  selectPhoneLedgerSection,
} from "@/lib/babylon/mobile-ledger";

describe("phone Ledger composition", () => {
  it("keeps Income, Expenses, and Debts as the local sections", () => {
    expect(PHONE_LEDGER_SECTIONS.map((item) => item.id)).toEqual([
      "income",
      "expenses",
      "debts",
    ]);
    expect(PHONE_LEDGER_SECTIONS.map((item) => item.label)).toEqual([
      "Income",
      "Expenses",
      "Debts",
    ]);
  });

  it("uses the existing paid, upcoming, and monthly words", () => {
    const today = "2026-09-26";
    expect(
      phoneExpenseTiming(
        { isSettled: true, dueDate: "2026-09-01" },
        today
      )
    ).toBe("Paid");
    expect(
      phoneExpenseTiming(
        { isSettled: false, dueDate: "2026-09-25" },
        today
      )
    ).toBe("Overdue");
    expect(
      phoneExpenseTiming(
        { isSettled: false, dueDate: "2026-09-26" },
        today
      )
    ).toBe("Due soon");
    expect(
      phoneExpenseTiming(
        { isSettled: false, dueDate: "2026-10-04" },
        today
      )
    ).toBe("Upcoming");
    expect(
      phoneExpenseTiming(
        {
          isSettled: false,
          dueDate: "2026-10-04",
          recurringObligationId: "rule-1",
        },
        today
      )
    ).toBe("Monthly · Upcoming");
  });

  it("formats a stored date without inventing a new one", () => {
    expect(phoneLedgerDateLabel("2026-09-28")).toBe("Sep 28");
    expect(phoneLedgerDateLabel("not-a-date")).toBe("not-a-date");
  });

  it("reads debt progress the way the desktop row already does", () => {
    expect(phoneDebtClearedPct(1000, 600)).toBe(40);
    expect(phoneDebtClearedPct(0, 0)).toBe(100);
    expect(phoneDebtClearedPct(100, 150)).toBe(0);
  });

  it("moves the local selector without leaving the ledger", () => {
    expect(selectPhoneLedgerSection("income", "ArrowRight")).toBe("expenses");
    expect(selectPhoneLedgerSection("income", "ArrowLeft")).toBe("debts");
    expect(selectPhoneLedgerSection("debts", "ArrowRight")).toBe("income");
    expect(selectPhoneLedgerSection("expenses", "Home")).toBe("income");
    expect(selectPhoneLedgerSection("income", "End")).toBe("debts");
    expect(selectPhoneLedgerSection("income", "Enter")).toBeNull();
  });

  it("leaves the accepted Home and Budget order in place", () => {
    expect(PHONE_HOME_SECTION_ORDER).toEqual([
      "attention",
      "financial-position",
      "available-after-planned-needs",
      "upcoming-needs",
      "recent-activity",
    ]);
    expect(PHONE_BUDGET_SECTION_ORDER).toEqual([
      "living-budget",
      "allocation-purpose",
      "category-plan",
      "debt-payoff",
      "deeper-analysis",
    ]);
  });
});

describe("phone Ledger source boundaries", () => {
  const ledgerSource = readFileSync(
    "components/babylon/mobile-ledger.tsx",
    "utf8"
  );
  const desktopSource = readFileSync(
    "components/babylon/ledger-matrices.tsx",
    "utf8"
  );
  const editorsSource = readFileSync(
    "components/babylon/ledger-record-editors.tsx",
    "utf8"
  );
  const homeSource = readFileSync(
    "components/babylon/mobile-home.tsx",
    "utf8"
  );
  const budgetSource = readFileSync(
    "components/babylon/mobile-budget.tsx",
    "utf8"
  );
  const headerSource = readFileSync(
    "components/babylon/mobile-header.tsx",
    "utf8"
  );
  const dashboard = readFileSync(
    "components/babylon/wealth-engine-dashboard.tsx",
    "utf8"
  );
  const ledgerBlock = dashboard
    .split('mobileDestination === "ledger"')[1]
    .split('mobileDestination === "more"')[0];
  const homeBlock = dashboard
    .split('mobileDestination === "home"')[1]
    .split('mobileDestination === "budget"')[0];
  const budgetBlock = dashboard
    .split('mobileDestination === "budget"')[1]
    .split('mobileDestination === "ledger"')[0];
  const desktopBlock = dashboard.split("{desktopLayout && (")[2];

  it("stacks records and keeps the wide tables on the desktop ledger", () => {
    expect(ledgerSource).toContain('aria-label="Ledger records"');
    expect(ledgerSource).toContain("aria-selected");
    expect(ledgerSource).toContain("formatDiscreetCurrency");
    expect(ledgerSource).toContain("onDeleteIncome");
    expect(ledgerSource).toContain("onDeleteExpense");
    expect(ledgerSource).toContain("onDeleteDebt");
    expect(ledgerSource).toContain("onToggleExpenseSettled");
    expect(ledgerSource).toContain("Edit rule");
    expect(ledgerSource).toContain("recurringObligationId");
    expect(ledgerSource).toContain("wealthShare");
    expect(ledgerSource).not.toContain("overflow-x-auto");
    expect(ledgerSource).not.toContain("min-w-[36rem]");
    expect(ledgerSource).not.toContain("min-w-[44rem]");
    expect(ledgerSource).not.toContain("min-w-[42rem]");
    expect(ledgerSource).not.toContain("<Table");
    expect(ledgerSource).not.toContain("onOpenTribute");
    expect(ledgerSource).not.toContain(".sort(");
    expect(ledgerSource).not.toContain("DebtFreedomEngine");
    expect(desktopSource).toContain("min-w-[36rem]");
    expect(desktopSource).toContain("min-w-[44rem]");
    expect(desktopSource).toContain("min-w-[42rem]");
    expect(desktopSource).toContain("overflow-x-auto");
    expect(desktopSource).toContain("Income Streams");
    expect(desktopSource).toContain("Expenses Archive");
    expect(desktopSource).toContain("Debt Ledger");
    expect(desktopSource).toContain("formatCurrency");
    expect(desktopSource).not.toContain("formatDiscreetCurrency");
    expect(editorsSource).toContain("Edit this month");
    expect(editorsSource).toContain("Monthly bill");
  });

  it("mounts phone records on Ledger and leaves Home, Budget, and desktop tables in place", () => {
    expect(ledgerBlock).toContain("<MobileLedger");
    expect(ledgerBlock).toContain("discreet={discreet}");
    expect(ledgerBlock).not.toContain("LedgerMatrices");
    expect(ledgerBlock).not.toContain("min-w-[44rem]");
    expect(homeBlock).toContain("<MobileHome");
    expect(budgetBlock).toContain("<MobileBudget");
    expect(homeSource).not.toContain("MobileLedger");
    expect(budgetSource).not.toContain("MobileLedger");
    expect(headerSource).toContain("Add");
    expect(desktopBlock).toContain("budgetBlueprint");
    expect(desktopBlock).toContain("{ledgers}");
  });
});
