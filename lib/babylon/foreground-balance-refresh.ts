import type { BackgroundBalanceSummary } from "@/lib/babylon/background-balance-observation";

/**
 * How long a successful foreground balance recording keeps this page from
 * asking again. Sixty seconds matches the balance-evidence query staleTime:
 * inside that window the screen already treats a successful read as fresh.
 * The mark lives in this page only. It is not stored.
 */
export const FOREGROUND_BALANCE_REFRESH_WINDOW_MS = 60_000;

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
 * Ask once when a signed-in document is visible and this page has no recent
 * applied recording. Hidden, signed-out, in-flight, and inside the window skip.
 * An unseen Item bypasses only the window. Signing out forgets the window.
 * This does not poll.
 */
export function planForegroundBalanceRefresh(input: {
  authenticated: boolean;
  visible: boolean;
  now: number;
  ignoreRecentSuccess?: boolean;
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
