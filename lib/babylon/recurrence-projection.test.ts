import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  dueDateForMonth,
  materializeRecurringObligations,
  projectRecurringOccurrences,
  recurringOccurrenceId,
  type CivilMonthRange,
} from "@/lib/babylon/recurring-obligations";
import type { ExpenseEntry, RecurringObligation } from "@/types/babylon";

function rule(partial: Partial<RecurringObligation> = {}): RecurringObligation {
  return {
    id: "phone-rule",
    name: "Phone",
    amount: 85,
    category: "need",
    budgetCategoryId: "utilities",
    dueDay: 18,
    startMonth: "2026-01",
    isActive: true,
    createdAt: "2026-01-02",
    skippedMonths: [],
    ...partial,
  };
}

function stored(
  partial: Partial<ExpenseEntry> & { recurrenceMonth: string }
): ExpenseEntry {
  const month = partial.recurrenceMonth;
  return {
    id: partial.id ?? `legacy-${month}`,
    name: partial.name ?? "Phone",
    category: partial.category ?? "need",
    amount: partial.amount ?? 85,
    date: partial.date ?? `${month}-18`,
    dueDate: partial.dueDate ?? `${month}-18`,
    budgetCategoryId: partial.budgetCategoryId ?? "utilities",
    isSettled: partial.isSettled ?? false,
    recurringObligationId: partial.recurringObligationId ?? "phone-rule",
    recurrenceMonth: month,
  };
}

function monthsOf(
  result: ReturnType<typeof projectRecurringOccurrences>
): string[] {
  if (result.status !== "projected") return [];
  return result.occurrences.map((row) => row.expense.recurrenceMonth ?? "");
}

describe("projectRecurringOccurrences", () => {
  it("returns the same projection for the same rules, evidence, and range", () => {
    const rules = [rule({ intervalMonths: 3 })];
    const expenses = [stored({ recurrenceMonth: "2026-04", id: "kept-april", amount: 90 })];
    const range: CivilMonthRange = { fromMonth: "2026-01", throughMonth: "2026-07" };
    const left = projectRecurringOccurrences(rules, expenses, range);
    const right = projectRecurringOccurrences(rules, expenses, range);
    expect(left).toEqual(right);
    expect(left).toEqual({
      status: "projected",
      occurrences: [
        {
          origin: "derived",
          expense: expect.objectContaining({
            id: recurringOccurrenceId("phone-rule", "2026-01"),
            recurrenceMonth: "2026-01",
            isSettled: false,
          }),
        },
        { origin: "persisted", expense: expenses[0] },
        {
          origin: "derived",
          expense: expect.objectContaining({
            id: recurringOccurrenceId("phone-rule", "2026-07"),
            recurrenceMonth: "2026-07",
          }),
        },
      ],
    });
  });

  it("does not mutate rules, expenses, or the requested range", () => {
    const rules = Object.freeze([
      Object.freeze(rule({ skippedMonths: Object.freeze(["2026-03"]) as string[] })),
    ]);
    const row = Object.freeze(stored({ recurrenceMonth: "2026-02", isSettled: true }));
    const expenses = Object.freeze([row]);
    const range = Object.freeze({ fromMonth: "2026-01", throughMonth: "2026-04" });
    const before = {
      rules: structuredClone(rules),
      expenses: structuredClone(expenses),
      range: { ...range },
    };
    const result = projectRecurringOccurrences(rules, expenses, range);
    expect(rules).toEqual(before.rules);
    expect(expenses).toEqual(before.expenses);
    expect(range).toEqual(before.range);
    expect(result.status).toBe("projected");
    if (result.status !== "projected") return;
    expect(result.occurrences.find((item) => item.origin === "persisted")?.expense).toBe(row);
  });

  it("reconstructs every due month in an unwitnessed monthly gap", () => {
    const phone = rule();
    const result = projectRecurringOccurrences([phone], [], {
      fromMonth: "2026-01",
      throughMonth: "2026-05",
    });
    expect(result.status).toBe("projected");
    if (result.status !== "projected") return;
    expect(monthsOf(result)).toEqual([
      "2026-01",
      "2026-02",
      "2026-03",
      "2026-04",
      "2026-05",
    ]);
    expect(result.occurrences.every((row) => row.origin === "derived")).toBe(true);
    expect(result.occurrences.map((row) => row.expense.id)).toEqual([
      recurringOccurrenceId(phone.id, "2026-01"),
      recurringOccurrenceId(phone.id, "2026-02"),
      recurringOccurrenceId(phone.id, "2026-03"),
      recurringOccurrenceId(phone.id, "2026-04"),
      recurringOccurrenceId(phone.id, "2026-05"),
    ]);
    expect(result.occurrences.every((row) => row.expense.isSettled === false)).toBe(true);

    const witnessed = materializeRecurringObligations([phone], [], "2026-05-15");
    expect(witnessed.created.map((row) => row.recurrenceMonth).sort()).toEqual([
      "2026-05",
      "2026-06",
    ]);
  });

  it("reconstructs only months an interval rule marks due", () => {
    const result = projectRecurringOccurrences(
      [rule({ startMonth: "2026-01", intervalMonths: 3, dueDay: 31 })],
      [],
      { fromMonth: "2026-01", throughMonth: "2026-08" }
    );
    expect(monthsOf(result)).toEqual(["2026-01", "2026-04", "2026-07"]);
    if (result.status !== "projected") return;
    expect(result.occurrences[0]?.expense.dueDate).toBe(dueDateForMonth(31, "2026-01"));
    expect(
      projectRecurringOccurrences(
        [rule({ startMonth: "2026-01", intervalMonths: 3, dueDay: 31 })],
        [],
        { fromMonth: "2026-02", throughMonth: "2026-02" }
      )
    ).toEqual({ status: "projected", occurrences: [] });
    const february = projectRecurringOccurrences([rule({ dueDay: 31 })], [], {
      fromMonth: "2026-02",
      throughMonth: "2026-02",
    });
    if (february.status !== "projected") return;
    expect(february.occurrences[0]?.expense.dueDate).toBe("2026-02-28");
  });

  it("leaves a skipped month out and keeps the surrounding due months", () => {
    const result = projectRecurringOccurrences(
      [rule({ skippedMonths: ["2026-03"] })],
      [],
      { fromMonth: "2026-01", throughMonth: "2026-04" }
    );
    expect(monthsOf(result)).toEqual(["2026-01", "2026-02", "2026-04"]);
    if (result.status !== "projected") return;
    expect(result.occurrences.every((row) => row.origin === "derived")).toBe(true);
  });

  it("keeps a persisted unpaid row and derives only the missing months", () => {
    const unpaid = stored({
      recurrenceMonth: "2026-03",
      id: "unpaid-march",
      amount: 85,
      isSettled: false,
    });
    const result = projectRecurringOccurrences([rule()], [unpaid], {
      fromMonth: "2026-02",
      throughMonth: "2026-04",
    });
    expect(result.status).toBe("projected");
    if (result.status !== "projected") return;
    expect(result.occurrences.map((row) => row.origin)).toEqual([
      "derived",
      "persisted",
      "derived",
    ]);
    expect(result.occurrences[1]?.expense).toBe(unpaid);
    expect(result.occurrences[0]?.expense.id).toBe(recurringOccurrenceId("phone-rule", "2026-02"));
    expect(result.occurrences[2]?.expense.id).toBe(recurringOccurrenceId("phone-rule", "2026-04"));
  });

  it("keeps a persisted paid row unchanged", () => {
    const paid = stored({
      recurrenceMonth: "2026-03",
      id: recurringOccurrenceId("phone-rule", "2026-03") ?? "paid",
      isSettled: true,
      date: "2026-03-21",
      dueDate: "2026-03-18",
    });
    const result = projectRecurringOccurrences([rule()], [paid], {
      fromMonth: "2026-03",
      throughMonth: "2026-03",
    });
    expect(result).toEqual({
      status: "projected",
      occurrences: [{ origin: "persisted", expense: paid }],
    });
  });

  it("keeps a steward-edited amount, due date, and category", () => {
    const edited = stored({
      recurrenceMonth: "2026-03",
      id: "edited-march",
      name: "Phone adjusted",
      amount: 90,
      category: "desire",
      dueDate: "2026-03-20",
      date: "2026-03-20",
    });
    const result = projectRecurringOccurrences([rule()], [edited], {
      fromMonth: "2026-03",
      throughMonth: "2026-04",
    });
    expect(result.status).toBe("projected");
    if (result.status !== "projected") return;
    expect(result.occurrences[0]).toEqual({ origin: "persisted", expense: edited });
    expect(result.occurrences[1]?.origin).toBe("derived");
    expect(result.occurrences[1]?.expense).toMatchObject({
      amount: 85,
      category: "need",
      dueDate: "2026-04-18",
      isSettled: false,
      id: recurringOccurrenceId("phone-rule", "2026-04"),
    });
  });

  it("keeps a legacy random id instead of minting the canonical id", () => {
    const legacy = stored({
      recurrenceMonth: "2026-04",
      id: "806c3b62-00fd-49c0-850f-380ed6aea769",
      amount: 42.5,
      isSettled: true,
      dueDate: "2026-04-09",
    });
    const result = projectRecurringOccurrences([rule()], [legacy], {
      fromMonth: "2026-04",
      throughMonth: "2026-04",
    });
    expect(result.status).toBe("projected");
    if (result.status !== "projected") return;
    expect(result.occurrences).toEqual([{ origin: "persisted", expense: legacy }]);
    expect(result.occurrences[0]?.expense.id).not.toBe(
      recurringOccurrenceId("phone-rule", "2026-04")
    );
  });

  it("keeps a canonical id row as stored evidence", () => {
    const id = recurringOccurrenceId("phone-rule", "2026-04");
    const canonical = stored({ recurrenceMonth: "2026-04", id: id ?? "missing" });
    const result = projectRecurringOccurrences([rule()], [canonical], {
      fromMonth: "2026-04",
      throughMonth: "2026-04",
    });
    expect(result).toEqual({
      status: "projected",
      occurrences: [{ origin: "persisted", expense: canonical }],
    });
  });

  it("assigns recurringOccurrenceId only to a missing occurrence", () => {
    const result = projectRecurringOccurrences([rule()], [], {
      fromMonth: "2026-06",
      throughMonth: "2026-06",
    });
    expect(result).toEqual({
      status: "projected",
      occurrences: [
        {
          origin: "derived",
          expense: {
            id: recurringOccurrenceId("phone-rule", "2026-06"),
            name: "Phone",
            category: "need",
            amount: 85,
            date: "2026-06-18",
            dueDate: "2026-06-18",
            budgetCategoryId: "utilities",
            isSettled: false,
            recurringObligationId: "phone-rule",
            recurrenceMonth: "2026-06",
          },
        },
      ],
    });
  });

  it("refuses duplicate semantic occurrence evidence", () => {
    const rules = [rule()];
    const expenses = [
      stored({ recurrenceMonth: "2026-03", id: "one" }),
      stored({ recurrenceMonth: "2026-03", id: "two", amount: 10 }),
    ];
    const range = { fromMonth: "2026-06", throughMonth: "2026-06" };
    const before = structuredClone({ rules, expenses, range });
    expect(projectRecurringOccurrences(rules, expenses, range)).toEqual({
      status: "invalid",
      reason: "duplicate_semantic_occurrence",
    });
    expect({ rules, expenses, range }).toEqual(before);
  });

  it("refuses invalid range, rule, and occurrence evidence", () => {
    const phone = rule();
    expect(
      projectRecurringOccurrences([phone], [], {
        fromMonth: "2026-05",
        throughMonth: "2026-04",
      })
    ).toEqual({ status: "invalid", reason: "invalid_range" });
    expect(
      projectRecurringOccurrences([phone], [], {
        fromMonth: "2026-13",
        throughMonth: "2026-13",
      })
    ).toEqual({ status: "invalid", reason: "invalid_range" });
    expect(
      projectRecurringOccurrences([rule({ dueDay: 32 })], [], {
        fromMonth: "2026-01",
        throughMonth: "2026-01",
      })
    ).toEqual({ status: "invalid", reason: "invalid_rule" });
    expect(
      projectRecurringOccurrences([phone, phone], [], {
        fromMonth: "2026-01",
        throughMonth: "2026-01",
      })
    ).toEqual({ status: "invalid", reason: "invalid_rule" });
    expect(
      projectRecurringOccurrences(
        [phone],
        [stored({ recurrenceMonth: "2026-13", id: "bad-month" })],
        { fromMonth: "2026-01", throughMonth: "2026-01" }
      )
    ).toEqual({ status: "invalid", reason: "invalid_occurrence_evidence" });
    const half = stored({ recurrenceMonth: "2026-03" });
    delete half.recurrenceMonth;
    expect(
      projectRecurringOccurrences([phone], [half], {
        fromMonth: "2026-01",
        throughMonth: "2026-01",
      })
    ).toEqual({ status: "invalid", reason: "invalid_occurrence_evidence" });
  });

  it("produces nothing before the rule start month", () => {
    const result = projectRecurringOccurrences([rule({ startMonth: "2026-06" })], [], {
      fromMonth: "2026-01",
      throughMonth: "2026-05",
    });
    expect(result).toEqual({ status: "projected", occurrences: [] });
  });

  it("keeps persisted evidence for an inactive rule and does not invent months", () => {
    const existing = stored({ recurrenceMonth: "2026-02", id: "already-there" });
    const quiet = projectRecurringOccurrences([rule({ isActive: false })], [], {
      fromMonth: "2026-01",
      throughMonth: "2026-04",
    });
    const kept = projectRecurringOccurrences([rule({ isActive: false })], [existing], {
      fromMonth: "2026-01",
      throughMonth: "2026-04",
    });
    expect(quiet).toEqual({ status: "projected", occurrences: [] });
    expect(kept).toEqual({
      status: "projected",
      occurrences: [{ origin: "persisted", expense: existing }],
    });
  });

  it("limits the result to the requested range", () => {
    const historical = stored({ recurrenceMonth: "2026-01", id: "january" });
    const result = projectRecurringOccurrences([rule()], [historical], {
      fromMonth: "2026-04",
      throughMonth: "2026-04",
    });
    expect(monthsOf(result)).toEqual(["2026-04"]);
    if (result.status !== "projected") return;
    expect(result.occurrences[0]?.origin).toBe("derived");
    expect(result.occurrences.some((row) => row.expense === historical)).toBe(false);
  });

  it("does not read income, allocation, plans, or month close", () => {
    const beside = {
      incomes: [{ id: "pay", amount: 1000 }],
      allocations: [{ id: "split", wealth: 100 }],
      monthlyPlans: [{ id: "plan" }],
      lastClosedMonthKey: "2026-01",
    };
    const before = structuredClone(beside);
    const result = projectRecurringOccurrences([rule()], [], {
      fromMonth: "2026-03",
      throughMonth: "2026-03",
    });
    expect(beside).toEqual(before);
    expect(result.status).toBe("projected");
    const source = readFileSync("lib/babylon/recurring-obligations.ts", "utf8");
    const body = source.slice(
      source.indexOf("export function projectRecurringOccurrences"),
      source.indexOf("export function replaceRecurringObligation")
    );
    expect(body).not.toContain("incomes");
    expect(body).not.toContain("allocations");
    expect(body).not.toContain("monthlyPlans");
    expect(body).not.toContain("lastClosedMonthKey");
    expect(body).not.toContain("new Date");
    expect(body).not.toContain("Date.now");
    expect(body).not.toContain("todayIso");
  });

  it("leaves hydration, notification, and intelligence on materializeRecurringObligations", () => {
    const hook = readFileSync("hooks/useBabylonEngine.ts", "utf8");
    const delivery = readFileSync("lib/babylon/notification-delivery.ts", "utf8");
    const intelligence = readFileSync("lib/babylon/intelligence-contract.ts", "utf8");
    for (const source of [hook, delivery, intelligence]) {
      expect(source).toContain("materializeRecurringObligations(");
      expect(source).not.toContain("projectRecurringOccurrences");
    }
    expect(hook).toContain("setExpenses");
  });
});
