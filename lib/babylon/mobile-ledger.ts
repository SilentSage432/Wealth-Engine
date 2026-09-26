/**
 * Phone Ledger composition. Presentation labels only.
 * Record order, settlement, and recurrence stay with the engine.
 */

import { isDueWithinWeek, isOverdue } from "@/lib/babylon/engine";
import type { ExpenseEntry } from "@/types/babylon";

export const PHONE_LEDGER_SECTIONS = [
  { id: "income", label: "Income" },
  { id: "expenses", label: "Expenses" },
  { id: "debts", label: "Debts" },
] as const;

export type PhoneLedgerSection = (typeof PHONE_LEDGER_SECTIONS)[number]["id"];

export function selectPhoneLedgerSection(
  current: PhoneLedgerSection,
  key: string
): PhoneLedgerSection | null {
  const index = PHONE_LEDGER_SECTIONS.findIndex((item) => item.id === current);
  if (key === "ArrowRight") {
    return PHONE_LEDGER_SECTIONS[(index + 1) % PHONE_LEDGER_SECTIONS.length].id;
  }
  if (key === "ArrowLeft") {
    return PHONE_LEDGER_SECTIONS[
      (index - 1 + PHONE_LEDGER_SECTIONS.length) % PHONE_LEDGER_SECTIONS.length
    ].id;
  }
  if (key === "Home") return PHONE_LEDGER_SECTIONS[0].id;
  if (key === "End") {
    return PHONE_LEDGER_SECTIONS[PHONE_LEDGER_SECTIONS.length - 1].id;
  }
  return null;
}

/** Same words the desktop expense row already shows. */
export function phoneExpenseTiming(
  row: Pick<ExpenseEntry, "isSettled" | "dueDate" | "recurringObligationId">,
  today?: string
): string {
  const dueSoon = !row.isSettled && isDueWithinWeek(row.dueDate, today);
  const overdue = !row.isSettled && isOverdue(row.dueDate, today);
  const timing = row.isSettled
    ? "Paid"
    : overdue
      ? "Overdue"
      : dueSoon
        ? "Due soon"
        : "Upcoming";
  return row.recurringObligationId ? `Monthly · ${timing}` : timing;
}

/** Local calendar label for a stored YYYY-MM-DD. Invalid text is left as stored. */
export function phoneLedgerDateLabel(isoDate: string): string {
  const [year, month, day] = isoDate.split("-").map(Number);
  if (!year || !month || !day) return isoDate;
  return new Date(year, month - 1, day).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });
}

/** Same progress reading the desktop debt row already shows. */
export function phoneDebtClearedPct(
  totalDebt: number,
  remainingDebt: number
): number {
  const cleared = Math.max(0, totalDebt - remainingDebt);
  if (totalDebt <= 0) return 100;
  return Math.round((cleared / totalDebt) * 100);
}
