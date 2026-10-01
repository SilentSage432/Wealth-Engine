import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  applyDueAttentionDecision,
  composeFinancialAttention,
  deriveDueAttention,
  deriveMonthCloseAttention,
  financialAttentionEpistemic,
  lastCivilDayOfMonth,
} from "@/lib/babylon/attention";
import { CLOUD_VAULT_SCHEMA_VERSION } from "@/lib/babylon/cloud-vault";
import { markExpensePaid } from "@/lib/babylon/engine";
import { LEDGER_BACKUP_VERSION } from "@/lib/babylon/persistence";
import { comingUpObligations } from "@/lib/babylon/recurring-obligations";
import type { ExpenseEntry } from "@/types/babylon";

function expense(
  partial: Partial<ExpenseEntry> & Pick<ExpenseEntry, "id" | "dueDate">
): ExpenseEntry {
  return {
    name: "Rent",
    category: "need",
    amount: 1200,
    date: partial.dueDate,
    budgetCategoryId: "rent",
    isSettled: false,
    ...partial,
  };
}

function source(path: string): string {
  return readFileSync(resolve(process.cwd(), path), "utf8");
}

describe("deriveDueAttention", () => {
  const today = "2026-09-25";

  it("includes an unpaid obligation due today", () => {
    const rows = [expense({ id: "rent", dueDate: today })];
    expect(deriveDueAttention(rows, today).map((row) => row.id)).toEqual(["rent"]);
  });

  it("includes an unpaid obligation due before today", () => {
    const rows = [expense({ id: "phone", name: "Phone", dueDate: "2026-09-01" })];
    expect(deriveDueAttention(rows, today).map((row) => row.id)).toEqual(["phone"]);
  });

  it("excludes an unpaid obligation due after today", () => {
    const rows = [expense({ id: "later", dueDate: "2026-09-26" })];
    expect(deriveDueAttention(rows, today)).toEqual([]);
  });

  it("excludes a settled row even when its due date has arrived", () => {
    const rows = [expense({ id: "paid", dueDate: today, isSettled: true })];
    expect(deriveDueAttention(rows, today)).toEqual([]);
  });

  it("treats a generated recurring occurrence like a manual expense", () => {
    const rows = [
      expense({ id: "manual", name: "Groceries", dueDate: "2026-09-20" }),
      expense({
        id: "generated",
        name: "Phone",
        dueDate: "2026-09-24",
        recurringObligationId: "rule-phone",
        recurrenceMonth: "2026-09",
      }),
      expense({ id: "future", name: "Internet", dueDate: "2026-10-02" }),
    ];
    expect(deriveDueAttention(rows, today)).toEqual([
      {
        id: "manual",
        name: "Groceries",
        amount: 1200,
        dueDate: "2026-09-20",
      },
      {
        id: "generated",
        name: "Phone",
        amount: 1200,
        dueDate: "2026-09-24",
        recurringObligationId: "rule-phone",
      },
    ]);
  });

  it("does not mutate the expense list", () => {
    const rows = [expense({ id: "rent", dueDate: today })];
    deriveDueAttention(rows, today);
    expect(rows[0]?.isSettled).toBe(false);
  });

  it("leaves Coming Up membership unchanged", () => {
    const rows = [
      expense({ id: "due", name: "Rent", dueDate: "2026-09-01" }),
      expense({ id: "later", name: "Internet", dueDate: "2026-10-04" }),
    ];
    expect(comingUpObligations(rows).map((row) => row.id)).toEqual(["due", "later"]);
    expect(deriveDueAttention(rows, today).map((row) => row.id)).toEqual(["due"]);
  });

  it("compares civil dates, including a leap-year February day", () => {
    const leapDue = expense({ id: "leap", dueDate: "2024-02-29" });
    expect(deriveDueAttention([leapDue], "2024-02-28")).toEqual([]);
    expect(deriveDueAttention([leapDue], "2024-02-29").map((row) => row.id)).toEqual([
      "leap",
    ]);
    expect(deriveDueAttention([expense({ id: "bad", dueDate: "2026-02-31" })], "2026-03-01")).toEqual(
      []
    );
  });
});

describe("composeFinancialAttention", () => {
  const today = "2026-09-25";
  const openMonth = {
    currentMonthKey: "2026-09",
    lastClosedMonthKey: "2026-08" as string | null,
  };

  it("returns the existing due item when today and the due date are civil", () => {
    const rows = [expense({ id: "rent", dueDate: today, name: "Rent", amount: 50 })];
    const composed = composeFinancialAttention({
      expenses: rows,
      today,
      ...openMonth,
    });
    const derived = deriveDueAttention(rows, today);
    expect(composed.due).toEqual({
      knowledge: "present",
      items: derived,
      unknowns: [],
    });
    expect(composed.items.map((entry) => entry.kind)).toEqual(["due_obligation"]);
    if (composed.items[0]?.kind === "due_obligation") {
      expect(composed.items[0].item).toEqual(derived[0]);
    }
    expect(composed.quiet).toBe(false);
    expect(financialAttentionEpistemic(composed)).toBe("present");
  });

  it("keeps due-item order identical to deriveDueAttention", () => {
    const rows = [
      expense({ id: "b", name: "Beta", dueDate: "2026-09-20" }),
      expense({ id: "a", name: "Alpha", dueDate: "2026-09-20" }),
      expense({ id: "c", name: "Alpha", dueDate: "2026-09-01" }),
    ];
    const composed = composeFinancialAttention({
      expenses: rows,
      today,
      ...openMonth,
    });
    expect(composed.due.items).toEqual(deriveDueAttention(rows, today));
    expect(composed.due.items.map((item) => item.id)).toEqual(["c", "a", "b"]);
  });

  it("calls the due predicate quiet only when every candidate date was civil and none are due", () => {
    const rows = [
      expense({ id: "later", dueDate: "2026-09-26" }),
      expense({ id: "paid", dueDate: today, isSettled: true }),
    ];
    const composed = composeFinancialAttention({
      expenses: rows,
      today,
      ...openMonth,
    });
    expect(deriveDueAttention(rows, today)).toEqual([]);
    expect(composed.due.knowledge).toBe("quiet");
    expect(composed.due.items).toEqual([]);
    expect(composed.quiet).toBe(true);
    expect(financialAttentionEpistemic(composed)).toBe("quiet");
    expect(composed.items).toEqual([]);
  });

  it("does not treat an empty derivation as quiet when today is not a civil date", () => {
    const rows = [expense({ id: "rent", dueDate: "2026-09-01" })];
    const composed = composeFinancialAttention({
      expenses: rows,
      today: "2026-02-31",
      ...openMonth,
    });
    expect(deriveDueAttention(rows, "2026-02-31")).toEqual([]);
    expect(composed.due.knowledge).toBe("unknown");
    expect(composed.due.items).toEqual([]);
    expect(composed.due.unknowns).toEqual([{ reason: "invalid_civil_today" }]);
    expect(composed.monthClose.knowledge).toBe("unknown");
    expect(composed.monthClose.currentMonthClosed).toBeNull();
    expect(composed.monthClose.unknowns).toEqual([{ reason: "invalid_civil_today" }]);
    expect(composed.quiet).toBe(false);
    expect(financialAttentionEpistemic(composed)).toBe("unknown");
    expect(composed.items).toEqual([]);
  });

  it("does not let an unsettled impossible due date disappear into quiet", () => {
    const rows = [expense({ id: "bad", dueDate: "2026-02-31" })];
    const composed = composeFinancialAttention({
      expenses: rows,
      today,
      ...openMonth,
    });
    expect(deriveDueAttention(rows, today)).toEqual([]);
    expect(composed.due.knowledge).toBe("unknown");
    expect(composed.due.unknowns).toEqual([
      { reason: "invalid_due_date", expenseId: "bad" },
    ]);
    expect(composed.quiet).toBe(false);
    expect(financialAttentionEpistemic(composed)).toBe("unknown");
  });

  it("keeps a valid due item when another unsettled due date is not civil", () => {
    const rows = [
      expense({ id: "rent", dueDate: today }),
      expense({ id: "bad", name: "Bad", dueDate: "2026-02-31" }),
    ];
    const composed = composeFinancialAttention({
      expenses: rows,
      today,
      ...openMonth,
    });
    expect(composed.due.knowledge).toBe("unknown");
    expect(composed.due.items).toEqual(deriveDueAttention(rows, today));
    expect(composed.due.items.map((item) => item.id)).toEqual(["rent"]);
    expect(composed.quiet).toBe(false);
    expect(financialAttentionEpistemic(composed)).toBe("unknown");
  });

  it("leaves settled and future civil rows on the existing derivation", () => {
    const rows = [
      expense({ id: "paid", dueDate: "2026-09-01", isSettled: true }),
      expense({ id: "later", dueDate: "2026-10-01" }),
      expense({
        id: "legacy",
        dueDate: "2026-02-31",
        isSettled: undefined as unknown as boolean,
      }),
    ];
    const composed = composeFinancialAttention({
      expenses: rows,
      today,
      ...openMonth,
    });
    expect(composed.due.items).toEqual(deriveDueAttention(rows, today));
    expect(composed.due.knowledge).toBe("quiet");
    expect(composed.due.unknowns).toEqual([]);
  });

  it("returns the existing month-close item on the last civil day of an open month", () => {
    const notice = deriveMonthCloseAttention({
      today: "2026-09-30",
      currentMonthKey: "2026-09",
      lastClosedMonthKey: "2026-08",
    });
    const composed = composeFinancialAttention({
      expenses: [],
      today: "2026-09-30",
      currentMonthKey: "2026-09",
      lastClosedMonthKey: "2026-08",
    });
    expect(composed.monthClose).toEqual({
      knowledge: "present",
      item: notice,
      currentMonthClosed: false,
      unknowns: [],
    });
    expect(composed.items.map((entry) => entry.kind)).toEqual(["month_close"]);
    expect(composed.quiet).toBe(false);
  });

  it("records month-close absence before the last day without calling the month closed", () => {
    const composed = composeFinancialAttention({
      expenses: [],
      today: "2026-09-29",
      currentMonthKey: "2026-09",
      lastClosedMonthKey: null,
    });
    expect(
      deriveMonthCloseAttention({
        today: "2026-09-29",
        currentMonthKey: "2026-09",
        lastClosedMonthKey: null,
      })
    ).toBeNull();
    expect(composed.monthClose).toEqual({
      knowledge: "absent",
      item: null,
      currentMonthClosed: false,
      unknowns: [],
    });
    expect(composed.quiet).toBe(true);
  });

  it("records month-close absence when the current month is already closed", () => {
    const composed = composeFinancialAttention({
      expenses: [],
      today: "2026-09-30",
      currentMonthKey: "2026-09",
      lastClosedMonthKey: "2026-09",
    });
    expect(composed.monthClose.knowledge).toBe("absent");
    expect(composed.monthClose.item).toBeNull();
    expect(composed.monthClose.currentMonthClosed).toBe(true);
    expect(composed.quiet).toBe(true);
  });

  it("does not turn a later calendar day into month-close attention or a closed month", () => {
    const composed = composeFinancialAttention({
      expenses: [],
      today: "2026-10-01",
      currentMonthKey: "2026-09",
      lastClosedMonthKey: null,
    });
    expect(composed.monthClose.knowledge).toBe("absent");
    expect(composed.monthClose.currentMonthClosed).toBe(false);
    expect(composed.items).toEqual([]);
    expect(composed.quiet).toBe(true);
  });

  it("does not call month-close absence known when the month key is not a month", () => {
    const composed = composeFinancialAttention({
      expenses: [],
      today,
      currentMonthKey: "2026-13",
      lastClosedMonthKey: null,
    });
    expect(composed.monthClose.knowledge).toBe("unknown");
    expect(composed.monthClose.currentMonthClosed).toBeNull();
    expect(composed.monthClose.unknowns).toEqual([
      { reason: "invalid_current_month_key" },
    ]);
    expect(composed.quiet).toBe(false);
  });

  it("does not mutate expenses", () => {
    const rows = [expense({ id: "rent", dueDate: today })];
    composeFinancialAttention({ expenses: rows, today, ...openMonth });
    expect(rows[0]?.isSettled).toBe(false);
  });
});

describe("applyDueAttentionDecision", () => {
  it("routes Paid through the supplied payment mutation", () => {
    const markPaid = vi.fn();
    const row = expense({ id: "rent", dueDate: "2026-09-25", date: "2026-09-01" });
    applyDueAttentionDecision("paid", row.id, markPaid);
    expect(markPaid).toHaveBeenCalledTimes(1);
    expect(markPaid).toHaveBeenCalledWith("rent");
    expect(markExpensePaid(row, "2026-09-25").isSettled).toBe(true);
  });

  it("writes nothing when the steward says still upcoming", () => {
    const markPaid = vi.fn();
    const row = expense({ id: "rent", dueDate: "2026-09-25" });
    applyDueAttentionDecision("still-upcoming", row.id, markPaid);
    expect(markPaid).not.toHaveBeenCalled();
    expect(row.isSettled).toBe(false);
  });
});

describe("deriveMonthCloseAttention", () => {
  it("is eligible on the last local day of an open month", () => {
    const notice = deriveMonthCloseAttention({
      today: "2026-09-30",
      currentMonthKey: "2026-09",
      lastClosedMonthKey: "2026-08",
    });
    expect(lastCivilDayOfMonth("2026-09")).toBe("2026-09-30");
    expect(notice).toEqual({
      monthKey: "2026-09",
      monthLabel: "Sep 26",
      message: "Sep 26 is still open and ends today.",
    });
  });

  it("is not eligible when the current month is already closed", () => {
    expect(
      deriveMonthCloseAttention({
        today: "2026-09-30",
        currentMonthKey: "2026-09",
        lastClosedMonthKey: "2026-09",
      })
    ).toBeNull();
  });

  it("is not eligible before the last local day", () => {
    expect(
      deriveMonthCloseAttention({
        today: "2026-09-29",
        currentMonthKey: "2026-09",
        lastClosedMonthKey: null,
      })
    ).toBeNull();
  });

  it("does not reopen a previous month after the local calendar rolls", () => {
    expect(
      deriveMonthCloseAttention({
        today: "2026-10-01",
        currentMonthKey: "2026-09",
        lastClosedMonthKey: null,
      })
    ).toBeNull();
    expect(
      deriveMonthCloseAttention({
        today: "2026-10-01",
        currentMonthKey: "2026-10",
        lastClosedMonthKey: null,
      })
    ).toBeNull();
  });

  it("uses the local last day of February, including leap day", () => {
    expect(lastCivilDayOfMonth("2026-02")).toBe("2026-02-28");
    expect(lastCivilDayOfMonth("2024-02")).toBe("2024-02-29");
    expect(
      deriveMonthCloseAttention({
        today: "2026-02-28",
        currentMonthKey: "2026-02",
        lastClosedMonthKey: null,
      })?.monthKey
    ).toBe("2026-02");
    expect(
      deriveMonthCloseAttention({
        today: "2024-02-28",
        currentMonthKey: "2024-02",
        lastClosedMonthKey: null,
      })
    ).toBeNull();
    expect(
      deriveMonthCloseAttention({
        today: "2024-02-29",
        currentMonthKey: "2024-02",
        lastClosedMonthKey: null,
      })?.message
    ).toBe("Feb 24 is still open and ends today.");
  });
});

describe("attention wiring", () => {
  const attention = source("lib/babylon/attention.ts");
  const hook = source("hooks/useBabylonEngine.ts");
  const dashboard = source("components/babylon/wealth-engine-dashboard.tsx");
  const upcoming = source("components/babylon/upcoming-needs.tsx");
  const commandBar = source("components/babylon/command-bar.tsx");

  it("pays through toggleExpenseSettled and opens the existing close ritual", () => {
    expect(hook).toContain("markExpensePaid");
    expect(dashboard).toContain("onMarkPaid={engine.toggleExpenseSettled}");
    expect(dashboard).toContain("onOpenMonthlyClose={() => engine.setMonthlyCloseOpen(true)}");
    expect(upcoming).toContain('applyDueAttentionDecision("paid"');
    expect(upcoming).toContain('applyDueAttentionDecision("still-upcoming"');
    expect(commandBar).toContain("onOpenMonthlyClose");
    expect(commandBar).not.toContain("closeMonth");
    expect(upcoming).not.toContain("closeMonth");
    expect(attention).not.toContain("closeMonth");
  });

  it("adds no observation, notification, or schema path", () => {
    for (const file of [attention, hook, dashboard, upcoming, commandBar]) {
      expect(file).not.toContain("listPlaidObservations");
      expect(file).not.toContain("Notification");
      expect(file).not.toContain("showNotification");
      expect(file).not.toContain("serviceWorker");
    }
    expect(attention).not.toContain("getUTC");
    expect(attention).not.toContain("toISOString");
    expect(attention).not.toContain("Date.UTC");
    expect(attention).not.toContain("plaid");
    expect(LEDGER_BACKUP_VERSION).toBe(11);
    expect(CLOUD_VAULT_SCHEMA_VERSION).toBe(6);
  });
});
