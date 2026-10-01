/**
 * Directional unpaid → paid transition for one acknowledged occurrence.
 *
 * The payment fact is the persisted expense row: isSettled and the civil
 * payment date. This function does not append activity. That omission is an
 * accepted limit of this tranche, not a redesign of the activity feed.
 *
 * It does not read a device clock, a device zone, or a notification preference.
 * The caller supplies the commit instant. The civil date comes from
 * financialCivilDate and the vault's financialTimeZone.
 */

import { financialCivilDate } from "@/lib/babylon/civil-time";
import { occurrenceForStewardAction } from "@/lib/babylon/effective-expenses";
import { markExpensePaid } from "@/lib/babylon/engine";
import {
  isRealLocalIsoDate,
  parseRecurringOccurrenceId,
  projectRecurringOccurrences,
} from "@/lib/babylon/recurring-obligations";
import type { ExpenseEntry, ExpenseKind, PersistedState } from "@/types/babylon";

export type PaidPreimage = {
  name: string;
  amount: number;
  category: ExpenseKind;
  dueDate: string;
  /** Null is the acknowledged absence of a budget category. */
  budgetCategoryId: string | null;
  /** Null is the acknowledged absence of a recurring rule. */
  recurringObligationId: string | null;
  /** Null is the acknowledged absence of a recurrence month. */
  recurrenceMonth: string | null;
  isSettled: false;
};

export type PaidRejectionReason =
  | "unknown_occurrence"
  | "preimage_mismatch"
  | "derived_unavailable"
  | "legacy_collision"
  | "invalid_occurrence"
  | "financial_calendar_unknown";

export type PaidTransitionResult =
  | {
      status: "paid";
      state: PersistedState;
      expenseId: string;
      paymentDate: string;
    }
  | {
      status: "already_paid";
      expenseId: string;
      paymentDate: string;
    }
  | {
      status: "rejected";
      reason: PaidRejectionReason;
    };

function sameFacts(expense: ExpenseEntry, preimage: PaidPreimage): boolean {
  return (
    expense.name === preimage.name &&
    expense.amount === preimage.amount &&
    expense.category === preimage.category &&
    expense.dueDate === preimage.dueDate &&
    (expense.budgetCategoryId ?? null) === preimage.budgetCategoryId &&
    (expense.recurringObligationId ?? null) === preimage.recurringObligationId &&
    (expense.recurrenceMonth ?? null) === preimage.recurrenceMonth
  );
}

function explainMissing(
  state: PersistedState,
  occurrenceId: string
): PaidRejectionReason {
  const parsed = parseRecurringOccurrenceId(occurrenceId);
  if (!parsed) return "unknown_occurrence";
  const projection = projectRecurringOccurrences(
    state.recurringObligations,
    state.expenses,
    { fromMonth: parsed.recurrenceMonth, throughMonth: parsed.recurrenceMonth }
  );
  if (projection.status !== "projected") return "invalid_occurrence";
  const occupied = projection.occurrences.find(
    (occurrence) =>
      occurrence.expense.recurringObligationId === parsed.ruleId &&
      occurrence.expense.recurrenceMonth === parsed.recurrenceMonth
  );
  if (occupied && occupied.expense.id !== occurrenceId) return "legacy_collision";
  return "derived_unavailable";
}

/**
 * Establish Paid, or report that the stored payment already matches.
 * Does not mutate `state`. A rejection contains no next document.
 */
export function transitionOccurrencePaid(input: {
  state: PersistedState;
  occurrenceId: string;
  preimage: PaidPreimage;
  commitInstant: Date;
}): PaidTransitionResult {
  const prepared = occurrenceForStewardAction(
    input.state.recurringObligations,
    input.state.expenses,
    input.occurrenceId
  );
  if (!prepared) {
    return { status: "rejected", reason: explainMissing(input.state, input.occurrenceId) };
  }

  const target = prepared.expense;
  if (target.id !== input.occurrenceId || !sameFacts(target, input.preimage)) {
    return { status: "rejected", reason: "preimage_mismatch" };
  }

  if (target.isSettled) {
    return {
      status: "already_paid",
      expenseId: target.id,
      paymentDate: target.date,
    };
  }

  const paymentDate = financialCivilDate(
    input.commitInstant,
    input.state.financialTimeZone
  );
  if (!paymentDate || !isRealLocalIsoDate(paymentDate)) {
    return { status: "rejected", reason: "financial_calendar_unknown" };
  }

  const next: PersistedState = {
    ...input.state,
    expenses: prepared.expenses.map((expense) =>
      expense.id === input.occurrenceId
        ? markExpensePaid(expense, paymentDate)
        : { ...expense }
    ),
  };

  return {
    status: "paid",
    state: structuredClone(next),
    expenseId: input.occurrenceId,
    paymentDate,
  };
}
