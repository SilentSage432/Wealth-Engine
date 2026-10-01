/**
 * Phone caller for the bounded Paid command.
 * It does not mutate the local vault, append activity, or call the desktop toggle.
 */

import { parsePaidCommandBody } from "@/lib/babylon/paid-command";
import type { ExpenseEntry } from "@/types/babylon";

export const MOBILE_PAID_PATH = "/api/vault/mark-occurrence-paid";

export const MOBILE_PAID_OFFLINE_MESSAGE = "Paid needs a connection.";
export const MOBILE_PAID_SIGNED_OUT_MESSAGE = "Sign in to mark this paid.";
export const MOBILE_PAID_UNCONFIRMED_MESSAGE = "Paid could not be confirmed.";

export type MobilePaidSubmission =
  | { status: "paid" | "already_paid"; refresh: true; paymentDate: string }
  | { status: "blocked"; message: string; refresh: false }
  | { status: "failed"; message: string; refresh: boolean };

type PaidResponse = {
  status?: string;
  error?: string;
  paymentDate?: string;
};

export function paidCommandBodyFromExpense(expense: ExpenseEntry): {
  occurrenceId: string;
  preimage: {
    name: string;
    amount: number;
    category: ExpenseEntry["category"];
    dueDate: string;
    budgetCategoryId: string | null;
    recurringObligationId: string | null;
    recurrenceMonth: string | null;
    isSettled: false;
  };
} | null {
  if (expense.isSettled !== false) return null;
  if (!expense.id || !expense.name) return null;
  const body = {
    occurrenceId: expense.id,
    preimage: {
      name: expense.name,
      amount: expense.amount,
      category: expense.category,
      dueDate: expense.dueDate,
      budgetCategoryId: expense.budgetCategoryId ?? null,
      recurringObligationId: expense.recurringObligationId ?? null,
      recurrenceMonth: expense.recurrenceMonth ?? null,
      isSettled: false as const,
    },
  };
  return parsePaidCommandBody(body) ? body : null;
}

/**
 * Online authenticated Paid. A missing session or an offline device does not
 * fetch and does not ask the caller to queue a local payment.
 */
export async function submitMobilePaid(
  expense: ExpenseEntry,
  env: {
    online: boolean;
    accessToken: string | null;
    fetchImpl?: typeof fetch;
  }
): Promise<MobilePaidSubmission> {
  if (!env.online) {
    return { status: "blocked", message: MOBILE_PAID_OFFLINE_MESSAGE, refresh: false };
  }
  if (!env.accessToken) {
    return { status: "blocked", message: MOBILE_PAID_SIGNED_OUT_MESSAGE, refresh: false };
  }
  const body = paidCommandBodyFromExpense(expense);
  if (!body) {
    return {
      status: "blocked",
      message: "This bill changed before it could be marked paid.",
      refresh: false,
    };
  }

  const fetchImpl = env.fetchImpl ?? fetch;
  let response: Response;
  try {
    response = await fetchImpl(MOBILE_PAID_PATH, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${env.accessToken}`,
      },
      body: JSON.stringify(body),
    });
  } catch {
    return { status: "failed", message: MOBILE_PAID_UNCONFIRMED_MESSAGE, refresh: true };
  }

  let payload: PaidResponse | null = null;
  try {
    payload = (await response.json()) as PaidResponse;
  } catch {
    payload = null;
  }

  if (
    response.ok &&
    (payload?.status === "paid" || payload?.status === "already_paid") &&
    typeof payload.paymentDate === "string"
  ) {
    return { status: payload.status, refresh: true, paymentDate: payload.paymentDate };
  }

  if (response.status === 401) {
    return { status: "failed", message: MOBILE_PAID_SIGNED_OUT_MESSAGE, refresh: false };
  }

  const message =
    typeof payload?.error === "string" && payload.error.trim()
      ? payload.error
      : MOBILE_PAID_UNCONFIRMED_MESSAGE;
  return {
    status: "failed",
    message,
    refresh: response.status === 409 || response.status >= 500,
  };
}
