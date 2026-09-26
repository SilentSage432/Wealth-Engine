/**
 * Observational Plaid /transactions/sync.
 *
 * Plaid amounts stay as Plaid reports them: positive is money out, negative
 * is money in. Nothing here creates income, settles an expense, or writes
 * wealth_engine_vaults.
 *
 * The in-memory store is the reference for cursor, lock, and idempotency
 * rules. 20260926_plaid_transaction_sync.sql stores observations.
 * 20260927_plaid_accounts.sql replaces the page function so account
 * descriptors from the same payload are stored with that page.
 */

import { isUuid } from "@/lib/babylon/cloud-mappers";
import { PLAID_USER_ERRORS } from "@/lib/babylon/plaid-errors";

export const PLAID_SYNC_PAGE_SIZE = 100;
export const PLAID_SYNC_MAX_PAGES = 50;
/** A crashed sync can be replaced after this long. Each stored page refreshes it. */
export const PLAID_SYNC_LOCK_STALE_MS = 5 * 60 * 1000;

export type PlaidObservationDraft = {
  plaidTransactionId: string;
  pendingTransactionId: string | null;
  accountId: string;
  /** Plaid sign. Positive is money out. Negative is money in. */
  amount: number;
  name: string;
  category: string | null;
  date: string;
  pending: boolean;
};

/** Observational account descriptor. Not a Wealth Engine FinancialAccount. */
export type PlaidAccountDraft = {
  plaidAccountId: string;
  name: string | null;
  mask: string | null;
  accountType: string | null;
  subtype: string | null;
};

export type PlaidAccountRecord = PlaidAccountDraft & {
  userId: string;
  plaidItemId: string;
};

export type PlaidSyncPage = {
  added: PlaidObservationDraft[];
  modified: PlaidObservationDraft[];
  removedIds: string[];
  accounts: PlaidAccountDraft[];
  nextCursor: string;
  hasMore: boolean;
};

export type PlaidItemSyncRecord = {
  id: string;
  userId: string;
  plaidItemId: string;
  accessToken: string;
  cursor: string | null;
  lockId: string | null;
  lockedAtMs: number | null;
};

export type PlaidObservationRecord = PlaidObservationDraft & {
  userId: string;
  removedAt: string | null;
  isProcessed: boolean;
};

export type PlaidSyncClaimResult =
  | {
      status: "claimed";
      cursor: string | null;
      accessToken: string;
      plaidItemId: string;
    }
  | { status: "busy" }
  | { status: "not_found" }
  | { status: "error" };

export type PlaidSyncApplyStatus =
  | "applied"
  | "not_found"
  | "lost_lock"
  | "cursor_conflict"
  | "rejected"
  | "error";

export type PlaidObservationSyncStore = {
  claim(input: {
    userId: string;
    itemRowId: string;
    lockId: string;
    nowMs: number;
    staleBeforeMs: number;
  }): Promise<PlaidSyncClaimResult>;
  applyPage(input: {
    userId: string;
    itemRowId: string;
    lockId: string;
    expectedCursor: string | null;
    nextCursor: string;
    drafts: readonly PlaidObservationDraft[];
    removedIds: readonly string[];
    accounts: readonly PlaidAccountDraft[];
    nowMs: number;
    removedAt: string;
  }): Promise<{ status: PlaidSyncApplyStatus }>;
  release(input: {
    userId: string;
    itemRowId: string;
    lockId: string;
  }): Promise<void>;
};

export type PlaidSyncFetchResult =
  | { ok: true; page: PlaidSyncPage }
  | { ok: false };

export type PlaidSyncPublicResult =
  | {
      status: "synced" | "incomplete";
      added: number;
      modified: number;
      removed: number;
      pages: number;
    }
  | { status: "busy" }
  | { status: "not_found" }
  | { status: "failed" };

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

function isIsoDate(value: string): boolean {
  const match = ISO_DATE.exec(value);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(year, month - 1, day);
  return (
    date.getFullYear() === year &&
    date.getMonth() === month - 1 &&
    date.getDate() === day
  );
}

function cloneItem(item: PlaidItemSyncRecord): PlaidItemSyncRecord {
  return { ...item };
}

function cloneObservation(row: PlaidObservationRecord): PlaidObservationRecord {
  return { ...row };
}

export function plaidTransactionsSyncBody(
  accessToken: string,
  cursor: string | null
): Record<string, unknown> {
  const body: Record<string, unknown> = {
    access_token: accessToken,
    count: PLAID_SYNC_PAGE_SIZE,
  };
  if (cursor) body.cursor = cursor;
  return body;
}

export function parsePlaidTransactionsSyncResponse(
  payload: unknown
): PlaidSyncPage | null {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return null;
  }
  const record = payload as Record<string, unknown>;
  if (typeof record.next_cursor !== "string" || !record.next_cursor.trim()) {
    return null;
  }
  if (typeof record.has_more !== "boolean") return null;
  if (!Array.isArray(record.added) || !Array.isArray(record.modified)) {
    return null;
  }
  if (!Array.isArray(record.removed)) return null;

  const added = readDrafts(record.added);
  const modified = readDrafts(record.modified);
  const removedIds = readRemovedIds(record.removed);
  if (!added || !modified || !removedIds) return null;
  if (record.accounts !== undefined && !Array.isArray(record.accounts)) {
    return null;
  }
  const accounts = Array.isArray(record.accounts)
    ? readAccounts(record.accounts)
    : [];

  return {
    added,
    modified,
    removedIds,
    accounts,
    nextCursor: record.next_cursor,
    hasMore: record.has_more,
  };
}

function readDrafts(value: unknown[]): PlaidObservationDraft[] | null {
  const drafts: PlaidObservationDraft[] = [];
  for (const entry of value) {
    const draft = readDraft(entry);
    if (!draft) return null;
    drafts.push(draft);
  }
  return drafts;
}

function readDraft(value: unknown): PlaidObservationDraft | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  if (typeof record.transaction_id !== "string" || !record.transaction_id.trim()) {
    return null;
  }
  if (typeof record.account_id !== "string" || !record.account_id.trim()) {
    return null;
  }
  if (typeof record.amount !== "number" || !Number.isFinite(record.amount)) {
    return null;
  }
  if (typeof record.date !== "string" || !isIsoDate(record.date)) return null;
  if (typeof record.pending !== "boolean") return null;
  const name =
    typeof record.name === "string" && record.name.trim()
      ? record.name.trim()
      : "(no name)";
  return {
    plaidTransactionId: record.transaction_id.trim(),
    pendingTransactionId: readOptionalId(record.pending_transaction_id),
    accountId: record.account_id.trim(),
    amount: record.amount,
    name,
    category: readCategory(record),
    date: record.date,
    pending: record.pending,
  };
}

function readOptionalId(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function readOptionalText(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function readAccounts(value: unknown[]): PlaidAccountDraft[] {
  const accounts: PlaidAccountDraft[] = [];
  for (const entry of value) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) continue;
    const record = entry as Record<string, unknown>;
    const plaidAccountId = readOptionalId(record.account_id);
    if (!plaidAccountId) continue;
    accounts.push({
      plaidAccountId,
      name: readOptionalText(record.name),
      mask: readOptionalText(record.mask),
      accountType: readOptionalText(record.type),
      subtype: readOptionalText(record.subtype),
    });
  }
  return accounts;
}

export function applyAccountIdentity(
  accounts: readonly PlaidAccountRecord[],
  input: {
    userId: string;
    itemRowId: string;
    accounts: readonly PlaidAccountDraft[];
  }
): { status: "applied" | "rejected"; accounts: PlaidAccountRecord[] } {
  const next = accounts.map((account) => ({ ...account }));
  for (const draft of input.accounts) {
    const existingIndex = next.findIndex(
      (account) => account.plaidAccountId === draft.plaidAccountId
    );
    if (existingIndex >= 0 && next[existingIndex].userId !== input.userId) {
      return { status: "rejected", accounts: accounts.map((account) => ({ ...account })) };
    }
    const row: PlaidAccountRecord = {
      ...draft,
      userId: input.userId,
      plaidItemId: input.itemRowId,
    };
    if (existingIndex < 0) {
      next.push(row);
      continue;
    }
    next[existingIndex] = row;
  }
  return { status: "applied", accounts: next };
}

function readCategory(record: Record<string, unknown>): string | null {
  if (Array.isArray(record.category)) {
    const parts = record.category.filter(
      (part): part is string => typeof part === "string" && part.trim().length > 0
    );
    if (parts.length > 0) return parts.map((part) => part.trim()).join(" / ");
  }
  const personal = record.personal_finance_category;
  if (!personal || typeof personal !== "object" || Array.isArray(personal)) {
    return null;
  }
  const primary = (personal as { primary?: unknown }).primary;
  if (typeof primary !== "string" || !primary.trim()) return null;
  return primary.trim();
}

function readRemovedIds(value: unknown[]): string[] | null {
  const ids: string[] = [];
  for (const entry of value) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) return null;
    const transactionId = (entry as { transaction_id?: unknown }).transaction_id;
    if (typeof transactionId !== "string" || !transactionId.trim()) return null;
    ids.push(transactionId.trim());
  }
  return ids;
}

export function currentPlaidObservations(
  rows: readonly PlaidObservationRecord[]
): PlaidObservationRecord[] {
  return rows.filter((row) => row.removedAt === null);
}

export function claimSyncLock(
  items: readonly PlaidItemSyncRecord[],
  input: {
    userId: string;
    itemRowId: string;
    lockId: string;
    nowMs: number;
    staleBeforeMs: number;
  }
): {
  status: "claimed" | "busy" | "not_found";
  items: PlaidItemSyncRecord[];
  cursor: string | null;
  accessToken: string;
  plaidItemId: string;
} {
  const index = items.findIndex((item) => item.id === input.itemRowId);
  if (index < 0 || items[index].userId !== input.userId) {
    return {
      status: "not_found",
      items: items.map(cloneItem),
      cursor: null,
      accessToken: "",
      plaidItemId: "",
    };
  }
  const item = items[index];
  const held =
    item.lockId !== null &&
    item.lockedAtMs !== null &&
    item.lockedAtMs >= input.staleBeforeMs;
  if (held) {
    return {
      status: "busy",
      items: items.map(cloneItem),
      cursor: null,
      accessToken: "",
      plaidItemId: "",
    };
  }
  const next = items.map(cloneItem);
  next[index] = {
    ...item,
    lockId: input.lockId,
    lockedAtMs: input.nowMs,
  };
  return {
    status: "claimed",
    items: next,
    cursor: item.cursor,
    accessToken: item.accessToken,
    plaidItemId: item.plaidItemId,
  };
}

export function applySyncPage(
  items: readonly PlaidItemSyncRecord[],
  observations: readonly PlaidObservationRecord[],
  input: {
    userId: string;
    itemRowId: string;
    lockId: string;
    expectedCursor: string | null;
    nextCursor: string;
    drafts: readonly PlaidObservationDraft[];
    removedIds: readonly string[];
    nowMs: number;
    removedAt: string;
  }
): {
  status: PlaidSyncApplyStatus;
  items: PlaidItemSyncRecord[];
  observations: PlaidObservationRecord[];
} {
  const unchanged = {
    items: items.map(cloneItem),
    observations: observations.map(cloneObservation),
  };
  const index = items.findIndex((item) => item.id === input.itemRowId);
  if (index < 0 || items[index].userId !== input.userId) {
    return { status: "not_found", ...unchanged };
  }
  const item = items[index];
  if (item.lockId !== input.lockId) {
    return { status: "lost_lock", ...unchanged };
  }
  if (item.cursor !== input.expectedCursor) {
    return { status: "cursor_conflict", ...unchanged };
  }
  if (!input.nextCursor.trim()) {
    return { status: "rejected", ...unchanged };
  }

  const nextObservations = observations.map(cloneObservation);
  for (const draft of input.drafts) {
    const existingIndex = nextObservations.findIndex(
      (row) => row.plaidTransactionId === draft.plaidTransactionId
    );
    if (existingIndex < 0) {
      nextObservations.push({
        ...draft,
        userId: input.userId,
        removedAt: null,
        isProcessed: false,
      });
      continue;
    }
    const existing = nextObservations[existingIndex];
    if (existing.userId !== input.userId) {
      return { status: "rejected", ...unchanged };
    }
    nextObservations[existingIndex] = {
      ...existing,
      ...draft,
      userId: existing.userId,
      isProcessed: existing.isProcessed,
      removedAt: null,
    };
  }

  for (const removedId of input.removedIds) {
    const existing = nextObservations.find(
      (row) => row.plaidTransactionId === removedId
    );
    if (existing && existing.userId !== input.userId) {
      return { status: "rejected", ...unchanged };
    }
  }

  for (const removedId of input.removedIds) {
    const existingIndex = nextObservations.findIndex(
      (row) => row.plaidTransactionId === removedId && row.userId === input.userId
    );
    if (existingIndex < 0) continue;
    const existing = nextObservations[existingIndex];
    if (existing.removedAt !== null) continue;
    nextObservations[existingIndex] = { ...existing, removedAt: input.removedAt };
  }

  const nextItems = items.map(cloneItem);
  nextItems[index] = {
    ...item,
    cursor: input.nextCursor,
    lockedAtMs: input.nowMs,
  };
  return {
    status: "applied",
    items: nextItems,
    observations: nextObservations,
  };
}

export function releaseSyncLock(
  items: readonly PlaidItemSyncRecord[],
  input: { userId: string; itemRowId: string; lockId: string }
): PlaidItemSyncRecord[] {
  return items.map((item) => {
    if (
      item.id !== input.itemRowId ||
      item.userId !== input.userId ||
      item.lockId !== input.lockId
    ) {
      return cloneItem(item);
    }
    return { ...item, lockId: null, lockedAtMs: null };
  });
}

export function createMemoryPlaidObservationStore(seed: {
  items: readonly PlaidItemSyncRecord[];
  observations?: readonly PlaidObservationRecord[];
  accounts?: readonly PlaidAccountRecord[];
}): PlaidObservationSyncStore & {
  snapshot(): {
    items: PlaidItemSyncRecord[];
    observations: PlaidObservationRecord[];
    accounts: PlaidAccountRecord[];
  };
} {
  let items = seed.items.map(cloneItem);
  let observations = (seed.observations ?? []).map(cloneObservation);
  let accounts = (seed.accounts ?? []).map((account) => ({ ...account }));
  return {
    snapshot: () => ({
      items: items.map(cloneItem),
      observations: observations.map(cloneObservation),
      accounts: accounts.map((account) => ({ ...account })),
    }),
    async claim(input) {
      const result = claimSyncLock(items, input);
      items = result.items;
      if (result.status !== "claimed") return { status: result.status };
      return {
        status: "claimed",
        cursor: result.cursor,
        accessToken: result.accessToken,
        plaidItemId: result.plaidItemId,
      };
    },
    async applyPage(input) {
      const result = applySyncPage(items, observations, input);
      if (result.status !== "applied") return { status: result.status };
      const identified = applyAccountIdentity(accounts, {
        userId: input.userId,
        itemRowId: input.itemRowId,
        accounts: input.accounts,
      });
      if (identified.status !== "applied") return { status: "rejected" };
      items = result.items;
      observations = result.observations;
      accounts = identified.accounts;
      return { status: "applied" };
    },
    async release(input) {
      items = releaseSyncLock(items, input);
    },
  };
}

export function plaidSyncHttpResult(outcome: PlaidSyncPublicResult): {
  status: number;
  body: Record<string, unknown>;
} {
  if (outcome.status === "synced" || outcome.status === "incomplete") {
    return {
      status: 200,
      body: {
        status: outcome.status,
        added: outcome.added,
        modified: outcome.modified,
        removed: outcome.removed,
        pages: outcome.pages,
      },
    };
  }
  if (outcome.status === "busy") {
    return {
      status: 409,
      body: { error: PLAID_USER_ERRORS.sync_busy, code: "sync_busy" },
    };
  }
  if (outcome.status === "not_found") {
    return {
      status: 404,
      body: { error: PLAID_USER_ERRORS.item_not_found, code: "item_not_found" },
    };
  }
  return {
    status: 502,
    body: { error: PLAID_USER_ERRORS.sync_failed, code: "sync_failed" },
  };
}

export async function syncPlaidItemObservations(input: {
  userId: string;
  itemRowId: string;
  store: PlaidObservationSyncStore;
  fetchPage: (args: {
    accessToken: string;
    cursor: string | null;
  }) => Promise<PlaidSyncFetchResult>;
  now?: () => number;
  createLockId?: () => string;
  maxPages?: number;
}): Promise<PlaidSyncPublicResult> {
  if (!isUuid(input.userId) || !isUuid(input.itemRowId)) {
    return { status: "not_found" };
  }

  const now = input.now ?? (() => Date.now());
  const lockId = (input.createLockId ?? (() => crypto.randomUUID()))();
  const claimedAt = now();
  const claim = await input.store.claim({
    userId: input.userId,
    itemRowId: input.itemRowId,
    lockId,
    nowMs: claimedAt,
    staleBeforeMs: claimedAt - PLAID_SYNC_LOCK_STALE_MS,
  });
  if (claim.status === "busy") return { status: "busy" };
  if (claim.status === "not_found") return { status: "not_found" };
  if (claim.status !== "claimed") return { status: "failed" };

  let cursor = claim.cursor;
  let added = 0;
  let modified = 0;
  let removed = 0;
  let pages = 0;
  const maxPages = input.maxPages ?? PLAID_SYNC_MAX_PAGES;

  try {
    while (pages < maxPages) {
      const fetched = await input.fetchPage({
        accessToken: claim.accessToken,
        cursor,
      });
      if (!fetched.ok) return { status: "failed" };

      const page = fetched.page;
      const stampedAt = now();
      const applied = await input.store.applyPage({
        userId: input.userId,
        itemRowId: input.itemRowId,
        lockId,
        expectedCursor: cursor,
        nextCursor: page.nextCursor,
        drafts: [...page.added, ...page.modified],
        removedIds: page.removedIds,
        accounts: page.accounts,
        nowMs: stampedAt,
        removedAt: new Date(stampedAt).toISOString(),
      });
      if (applied.status !== "applied") return { status: "failed" };

      added += page.added.length;
      modified += page.modified.length;
      removed += page.removedIds.length;
      pages += 1;
      cursor = page.nextCursor;
      if (!page.hasMore) {
        return { status: "synced", added, modified, removed, pages };
      }
    }
    return { status: "incomplete", added, modified, removed, pages };
  } catch {
    return { status: "failed" };
  } finally {
    try {
      await input.store.release({
        userId: input.userId,
        itemRowId: input.itemRowId,
        lockId,
      });
    } catch {
      // The lock expires on its own. The cursor stays at the last stored page.
    }
  }
}
