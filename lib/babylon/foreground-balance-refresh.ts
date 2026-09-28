import type { BackgroundBalanceSummary } from "@/lib/babylon/background-balance-observation";

/**
 * Minimum gap between paid /accounts/balance/get calls.
 * Page memory and the stored balance_get observed_at both honor it,
 * including after a reload or a second tab.
 */
export const FOREGROUND_BALANCE_REFRESH_WINDOW_MS = 60_000;

/**
 * How long a committed balance_get reading remains fresh evidence.
 * Five minutes is the initial window for an actively used Wealth Engine.
 * It is five times the 60-second duplicate guard: long enough that focus,
 * visibility, and reload do not each become a paid institution extraction,
 * and short enough that a session left open does not keep treating an older
 * institution reading as current. A timer may wake the evaluator when this
 * window ends. The timer does not call Plaid.
 */
export const REAL_TIME_BALANCE_FRESHNESS_MS = 5 * FOREGROUND_BALANCE_REFRESH_WINDOW_MS;

export type RealtimeBalanceAge = "fresh" | "aged";

/** Age of one balance_get commit. A missing or unreadable time is not fresh. */
export function realtimeBalanceAge(
  observedAt: string,
  nowMs: number
): RealtimeBalanceAge | null {
  const at = Date.parse(observedAt);
  if (!Number.isFinite(at)) return null;
  return nowMs - at < REAL_TIME_BALANCE_FRESHNESS_MS ? "fresh" : "aged";
}

/** Newest current balance_get commit the client already has. */
export function newestRealtimeObservedAt(
  observations: readonly { source: string; observedAt: string }[] | null | undefined
): string | null {
  let newest: string | null = null;
  let newestMs = Number.NEGATIVE_INFINITY;
  for (const row of observations ?? []) {
    if (row.source !== "balance_get") continue;
    const at = Date.parse(row.observedAt);
    if (!Number.isFinite(at) || at < newestMs) continue;
    newestMs = at;
    newest = row.observedAt;
  }
  return newest;
}

/**
 * Delay until a fresh balance_get becomes aged.
 * An already aged reading returns null so a timer cannot tight-loop.
 */
export function realtimeFreshnessWakeDelayMs(input: {
  now: number;
  realTimeObservedAt: string | null;
}): number | null {
  if (!input.realTimeObservedAt) return null;
  const at = Date.parse(input.realTimeObservedAt);
  if (!Number.isFinite(at)) return null;
  const delay = at + REAL_TIME_BALANCE_FRESHNESS_MS - input.now;
  if (delay <= 0) return null;
  return delay;
}

/**
 * Whether this Item still needs one institution request.
 * Empty targets do not. A current balance_get inside the duplicate guard does not.
 * One aged or missing target is enough, because the Item is one request.
 */
export function realtimeBalanceRequestNeeded(input: {
  accountIds: readonly string[];
  observations: readonly { plaidAccountId: string; source: string; observedAt: string }[];
  nowMs: number;
}): boolean {
  if (input.accountIds.length === 0) return false;
  return input.accountIds.some((id) => {
    const row = input.observations.find(
      (observation) => observation.plaidAccountId === id && observation.source === "balance_get"
    );
    if (!row) return true;
    const at = Date.parse(row.observedAt);
    if (!Number.isFinite(at)) return true;
    return input.nowMs - at >= FOREGROUND_BALANCE_REFRESH_WINDOW_MS;
  });
}

/**
 * A recording applied only when every attempted Item committed.
 * Zero Items, a partial failure, and not-applied are not a fresh window.
 */
export function foregroundBalanceRefreshApplied(
  summary: BackgroundBalanceSummary | null
): boolean {
  if (!summary) return false;
  return (
    summary.attempted > 0 &&
    summary.notApplied === 0 &&
    summary.applied === summary.attempted
  );
}

export function readBalanceObservationSummary(
  value: unknown
): BackgroundBalanceSummary | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const summary = {
    items: record.items,
    attempted: record.attempted,
    applied: record.applied,
    notApplied: record.notApplied,
  };
  for (const count of Object.values(summary)) {
    if (typeof count !== "number" || !Number.isInteger(count) || count < 0) return null;
  }
  return summary as BackgroundBalanceSummary;
}

type RefreshDecision = { action: "skip" } | { action: "request"; ticket: number };

let generation = 0;
let inFlightTicket: number | null = null;
let lastAppliedAt: number | null = null;
let unseenItemPending = false;

export function resetForegroundBalanceRefreshSession(): void {
  generation += 1;
  inFlightTicket = null;
  lastAppliedAt = null;
  unseenItemPending = false;
}

/**
 * A newly connected Item was not in the balance ask already running or
 * recently applied. Visibility still waits for the window. This Item does not.
 */
export function markUnseenBalanceItem(): void {
  unseenItemPending = true;
}

export function hasUnseenBalanceItem(): boolean {
  return unseenItemPending;
}

/**
 * Ask once when a signed-in document is visible and the institution reading
 * is no longer fresh. Hidden, signed-out, in-flight, fresh balance_get, and
 * the 60-second duplicate window skip. An unseen Item bypasses those windows.
 * Signing out forgets the page window. This does not poll.
 */
export function planForegroundBalanceRefresh(input: {
  authenticated: boolean;
  visible: boolean;
  now: number;
  ignoreRecentSuccess?: boolean;
  /** Newest stored balance_get commit already known to this page. */
  realTimeObservedAt?: string | null;
}): RefreshDecision {
  if (!input.authenticated) {
    generation += 1;
    inFlightTicket = null;
    lastAppliedAt = null;
    unseenItemPending = false;
    return { action: "skip" };
  }
  if (!input.visible) return { action: "skip" };
  if (inFlightTicket !== null) return { action: "skip" };
  const bypassWindow = input.ignoreRecentSuccess === true || unseenItemPending;
  if (!bypassWindow && input.realTimeObservedAt) {
    if (realtimeBalanceAge(input.realTimeObservedAt, input.now) === "fresh") {
      return { action: "skip" };
    }
  }
  if (
    !bypassWindow &&
    lastAppliedAt !== null &&
    input.now - lastAppliedAt < FOREGROUND_BALANCE_REFRESH_WINDOW_MS
  ) {
    return { action: "skip" };
  }
  unseenItemPending = false;
  generation += 1;
  inFlightTicket = generation;
  return { action: "request", ticket: generation };
}

/** Clears the in-flight mark. Only an applied result starts the window. */
export function noteForegroundBalanceRefreshResult(input: {
  ticket: number;
  applied: boolean;
  now: number;
}): void {
  if (input.ticket !== inFlightTicket) return;
  inFlightTicket = null;
  if (input.applied) lastAppliedAt = input.now;
}
