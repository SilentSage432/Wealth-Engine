/**
 * Authenticated Paid command.
 *
 * The caller supplies an occurrence id and the obligation facts they
 * acknowledged. This module reads the caller's vault, runs the pure
 * transition, and compare-and-swaps the revision it just read.
 * It does not accept a replacement document, a user id, a timezone,
 * or a payment date.
 *
 * Activity is not written. That is an accepted limit of this tranche.
 */

import { FINANCIAL_CALENDAR_UNKNOWN } from "@/lib/babylon/civil-time";
import {
  CLOUD_VAULT_DATA_KEYS,
  CLOUD_VAULT_SCHEMA_VERSION,
  financialVaultFingerprint,
  parseCloudVaultData,
  updateCloudVault,
  type CloudVaultGateway,
} from "@/lib/babylon/cloud-vault";
import { isRealLocalIsoDate } from "@/lib/babylon/recurring-obligations";
import {
  transitionOccurrencePaid,
  type PaidPreimage,
  type PaidRejectionReason,
} from "@/lib/babylon/paid-transition";
import type { ExpenseEntry, ExpenseKind, PersistedState } from "@/types/babylon";

/** Initial attempt plus two re-reads after a revision conflict. */
export const PAID_COMMAND_MAX_ATTEMPTS = 3;

const BODY_KEYS = ["occurrenceId", "preimage"] as const;
const PREIMAGE_KEYS = [
  "name",
  "amount",
  "category",
  "dueDate",
  "budgetCategoryId",
  "recurringObligationId",
  "recurrenceMonth",
  "isSettled",
] as const;

const CATEGORIES = new Set<ExpenseKind>(["need", "desire"]);

export type PaidCommandRequest = {
  occurrenceId: string;
  preimage: PaidPreimage;
};

export type PaidCommandResult =
  | {
      status: "paid" | "already_paid";
      expenseId: string;
      paymentDate: string;
      revision: number;
    }
  | { status: "rejected"; reason: PaidRejectionReason | "unsupported_schema" | "invalid_vault" | "unbounded_change" }
  | { status: "conflict" }
  | { status: "absent" }
  | { status: "forbidden" }
  | { status: "unauthenticated" }
  | { status: "unavailable" };

function exactRecord(
  value: unknown,
  keys: readonly string[]
): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const present = Object.keys(record);
  if (present.length !== keys.length) return null;
  for (const key of keys) {
    if (!Object.prototype.hasOwnProperty.call(record, key)) return null;
  }
  return record;
}

function monthKey(value: unknown): string | null {
  if (typeof value !== "string" || !/^\d{4}-\d{2}$/.test(value)) return null;
  const month = Number(value.slice(5, 7));
  if (month < 1 || month > 12) return null;
  return value;
}

function optionalId(value: unknown): string | null | undefined {
  if (value === null) return null;
  if (typeof value !== "string" || value.length === 0) return undefined;
  return value;
}

/**
 * The only body this command accepts.
 * Any other key, including vault_data, user id, timezone, and payment date,
 * rejects the request.
 */
export function parsePaidCommandBody(body: unknown): PaidCommandRequest | null {
  const record = exactRecord(body, BODY_KEYS);
  if (!record) return null;
  if (typeof record.occurrenceId !== "string" || record.occurrenceId.length === 0) {
    return null;
  }
  const preimage = exactRecord(record.preimage, PREIMAGE_KEYS);
  if (!preimage) return null;
  if (typeof preimage.name !== "string" || preimage.name.length === 0) return null;
  if (typeof preimage.amount !== "number" || !Number.isFinite(preimage.amount) || preimage.amount < 0) {
    return null;
  }
  if (typeof preimage.category !== "string" || !CATEGORIES.has(preimage.category as ExpenseKind)) {
    return null;
  }
  if (typeof preimage.dueDate !== "string" || !isRealLocalIsoDate(preimage.dueDate)) return null;
  const budgetCategoryId = optionalId(preimage.budgetCategoryId);
  const recurringObligationId = optionalId(preimage.recurringObligationId);
  const recurrenceMonth =
    preimage.recurrenceMonth === null
      ? null
      : monthKey(preimage.recurrenceMonth) ?? undefined;
  if (
    budgetCategoryId === undefined ||
    recurringObligationId === undefined ||
    recurrenceMonth === undefined
  ) {
    return null;
  }
  if (preimage.isSettled !== false) return null;
  return {
    occurrenceId: record.occurrenceId,
    preimage: {
      name: preimage.name,
      amount: preimage.amount,
      category: preimage.category as ExpenseKind,
      dueDate: preimage.dueDate,
      budgetCategoryId,
      recurringObligationId,
      recurrenceMonth,
      isSettled: false,
    },
  };
}

function obligationFacts(expense: ExpenseEntry): Record<string, unknown> {
  const facts: Record<string, unknown> = {};
  for (const key of Object.keys(expense).sort()) {
    if (key === "isSettled" || key === "date") continue;
    const value = expense[key as keyof ExpenseEntry];
    if (value !== undefined) facts[key] = value;
  }
  return facts;
}

/**
 * True only when the next document's sole change is the target occurrence
 * becoming paid, or that one derived occurrence being inserted as paid.
 */
export function paidDocumentChangeIsBounded(
  before: PersistedState,
  after: PersistedState,
  expenseId: string
): boolean {
  const beforeTargets = before.expenses.filter((expense) => expense.id === expenseId);
  const afterTargets = after.expenses.filter((expense) => expense.id === expenseId);
  if (beforeTargets.length > 1 || afterTargets.length !== 1) return false;
  if (beforeTargets.length === 0 && after.expenses.length !== before.expenses.length + 1) {
    return false;
  }
  if (beforeTargets.length === 1 && after.expenses.length !== before.expenses.length) {
    return false;
  }

  const beforeRest = financialVaultFingerprint({
    ...before,
    expenses: before.expenses.filter((expense) => expense.id !== expenseId),
  });
  const afterRest = financialVaultFingerprint({
    ...after,
    expenses: after.expenses.filter((expense) => expense.id !== expenseId),
  });
  if (beforeRest !== afterRest) return false;

  const paid = afterTargets[0];
  if (!paid || paid.isSettled !== true || !isRealLocalIsoDate(paid.date)) return false;
  const prior = beforeTargets[0];
  if (!prior) return true;
  if (prior.isSettled !== false) return false;
  return JSON.stringify(obligationFacts(prior)) === JSON.stringify(obligationFacts(paid));
}

type ReadyVault = { status: "ready"; revision: number; state: PersistedState };

async function readOwnedVault(
  gateway: CloudVaultGateway,
  userId: string
): Promise<ReadyVault | Exclude<PaidCommandResult, { status: "paid" | "already_paid" | "conflict" }>> {
  const sessionUserId = await gateway.sessionUserId();
  if (!sessionUserId) return { status: "unauthenticated" };
  if (sessionUserId !== userId) return { status: "forbidden" };

  const read = await gateway.readVault(userId);
  if (!read.ok) return { status: "unavailable" };
  if (!read.row) return { status: "absent" };
  if (read.row.schemaVersion !== CLOUD_VAULT_SCHEMA_VERSION) {
    return { status: "rejected", reason: "unsupported_schema" };
  }
  const state = parseCloudVaultData(read.row.vaultData);
  if (!state) return { status: "rejected", reason: "invalid_vault" };
  if (!Number.isInteger(read.row.revision) || read.row.revision < 1) {
    return { status: "unavailable" };
  }
  return { status: "ready", revision: read.row.revision, state };
}

/**
 * Read, transition, and compare-and-swap.
 * A revision conflict re-reads and re-checks the preimage.
 * An already-paid row returns the stored date and does not write.
 */
export async function executePaidCommand(input: {
  gateway: CloudVaultGateway;
  userId: string;
  occurrenceId: string;
  preimage: PaidPreimage;
  now?: () => Date;
}): Promise<PaidCommandResult> {
  const now = input.now ?? (() => new Date());
  let sawConflict = false;

  for (let attempt = 0; attempt < PAID_COMMAND_MAX_ATTEMPTS; attempt += 1) {
    const read = await readOwnedVault(input.gateway, input.userId);
    if (read.status !== "ready") return read;

    const transition = transitionOccurrencePaid({
      state: read.state,
      occurrenceId: input.occurrenceId,
      preimage: input.preimage,
      commitInstant: now(),
    });
    if (transition.status === "already_paid") {
      return {
        status: "already_paid",
        expenseId: transition.expenseId,
        paymentDate: transition.paymentDate,
        revision: read.revision,
      };
    }
    if (transition.status === "rejected") {
      return { status: "rejected", reason: transition.reason };
    }
    if (!paidDocumentChangeIsBounded(read.state, transition.state, input.occurrenceId)) {
      return { status: "rejected", reason: "unbounded_change" };
    }

    const write = await updateCloudVault(
      input.userId,
      read.revision,
      CLOUD_VAULT_SCHEMA_VERSION,
      transition.state,
      input.gateway
    );
    if (write.status === "updated") {
      return {
        status: "paid",
        expenseId: transition.expenseId,
        paymentDate: transition.paymentDate,
        revision: write.revision,
      };
    }
    if (write.status === "conflict") {
      sawConflict = true;
      continue;
    }
    if (write.status === "unsupported_schema") {
      return { status: "rejected", reason: "unsupported_schema" };
    }
    if (write.status === "absent") return { status: "absent" };
    if (write.status === "forbidden") return { status: "forbidden" };
    if (write.status === "unauthenticated") return { status: "unauthenticated" };
    if (write.status === "rejected") return { status: "rejected", reason: "invalid_vault" };
    return { status: "unavailable" };
  }

  return sawConflict ? { status: "conflict" } : { status: "unavailable" };
}

export function paidCommandHttp(result: PaidCommandResult): {
  status: number;
  body: Record<string, unknown>;
} {
  if (result.status === "paid" || result.status === "already_paid") {
    return {
      status: 200,
      body: {
        status: result.status,
        expenseId: result.expenseId,
        paymentDate: result.paymentDate,
        revision: result.revision,
      },
    };
  }
  if (result.status === "conflict") {
    return {
      status: 409,
      body: {
        status: "conflict",
        error: "Paid could not be confirmed. Check cloud and try again.",
      },
    };
  }
  if (result.status === "rejected") {
    const error =
      result.reason === "financial_calendar_unknown"
        ? FINANCIAL_CALENDAR_UNKNOWN
        : result.reason === "unsupported_schema" || result.reason === "invalid_vault"
          ? "Paid could not be saved."
          : "This bill changed before it could be marked paid.";
    return { status: 409, body: { status: "rejected", reason: result.reason, error } };
  }
  if (result.status === "absent") {
    return { status: 404, body: { status: "absent", error: "Paid could not be saved." } };
  }
  if (result.status === "forbidden") {
    return { status: 403, body: { status: "forbidden", error: "Paid could not be saved." } };
  }
  if (result.status === "unauthenticated") {
    return {
      status: 401,
      body: { status: "unauthenticated", error: "Sign in to mark this paid." },
    };
  }
  return {
    status: 503,
    body: { status: "unavailable", error: "Paid could not be confirmed." },
  };
}

/** Keys the bounded check treats as the document outside the target row. */
export const PAID_UNCHANGED_DOCUMENT_KEYS = [
  ...CLOUD_VAULT_DATA_KEYS.filter((key) => key !== "expenses"),
  "financialTimeZone",
  "financialDestinations",
] as const;
