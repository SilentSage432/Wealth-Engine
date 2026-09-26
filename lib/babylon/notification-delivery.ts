import { deriveDueAttention, deriveMonthCloseAttention } from "@/lib/babylon/attention";
import { isIanaTimeZone } from "@/lib/babylon/notification-config";
import { vapidPublicKeyToBytes } from "@/lib/babylon/notification-device";
import { materializeRecurringObligations } from "@/lib/babylon/recurring-obligations";
import type { PersistedState } from "@/types/babylon";

/** Empty body. The service worker owns the fixed generic copy. */
export const GENERIC_PUSH_PAYLOAD = null;

const PRIVATE_KEY = /^[A-Za-z0-9_-]{32,200}$/;

export interface SenderConfig {
  publicKey: string;
  privateKey: string;
  subject: string;
}

export function parseVapidSubject(value: string | undefined): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (!trimmed || /\s/.test(trimmed)) return null;
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return null;
  }
  if (url.protocol !== "https:") return null;
  if (url.username || url.password || !url.hostname) return null;
  if (url.hostname === "localhost" || url.hostname === "127.0.0.1") return null;
  return url.origin;
}

export function readSenderConfig(
  env: {
    publicKey?: string;
    privateKey?: string;
    subject?: string;
  } = {
    publicKey: process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY,
    privateKey: process.env.VAPID_PRIVATE_KEY,
    subject: process.env.VAPID_SUBJECT,
  }
): SenderConfig | null {
  const publicKey = env.publicKey?.trim() ?? "";
  const privateKey = env.privateKey?.trim() ?? "";
  const subject = parseVapidSubject(env.subject);
  if (!vapidPublicKeyToBytes(publicKey)) return null;
  if (!PRIVATE_KEY.test(privateKey)) return null;
  if (privateKey === publicKey) return null;
  if (!subject) return null;
  return { publicKey, privateKey, subject };
}

export const CANONICAL_SUPABASE_HOST = "nklmgzxxdhuvqayhcigp.supabase.co";

/** Rows older than this many steward civil days are deleted by the daily evaluator. */
export const DELIVERY_RETENTION_DAYS = 14;

const ATTENTION_KEY_PATTERN =
  /^(due:[A-Za-z0-9_-]{1,80}|due:[A-Za-z0-9_-]{1,80}:[0-9]{4}-[0-9]{2}|month-close:[0-9]{4}-[0-9]{2})$/;

export function isCanonicalSupabaseUrl(value: string | undefined): boolean {
  if (!value) return false;
  try {
    const url = new URL(value.trim());
    return (
      url.protocol === "https:" &&
      url.hostname === CANONICAL_SUPABASE_HOST &&
      (url.pathname === "/" || url.pathname === "")
    );
  } catch {
    return false;
  }
}

export function civilDateInTimeZone(now: Date, timeZone: string): string | null {
  if (!isIanaTimeZone(timeZone)) return null;
  let formatted: string;
  try {
    formatted = new Intl.DateTimeFormat("en-CA", {
      timeZone: timeZone.trim(),
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(now);
  } catch {
    return null;
  }
  return /^\d{4}-\d{2}-\d{2}$/.test(formatted) ? formatted : null;
}

export function addCivilDays(isoDate: string, days: number): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(isoDate) || !Number.isInteger(days)) return null;
  const year = Number(isoDate.slice(0, 4));
  const month = Number(isoDate.slice(5, 7));
  const day = Number(isoDate.slice(8, 10));
  const utc = new Date(Date.UTC(year, month - 1, day));
  if (
    utc.getUTCFullYear() !== year ||
    utc.getUTCMonth() !== month - 1 ||
    utc.getUTCDate() !== day
  ) {
    return null;
  }
  utc.setUTCDate(utc.getUTCDate() + days);
  return utc.toISOString().slice(0, 10);
}

export function deliveryRetentionCutoff(civilDate: string): string | null {
  return addCivilDays(civilDate, -DELIVERY_RETENTION_DAYS);
}

export function dueAttentionKey(input: {
  expenseId: string;
  recurringObligationId?: string;
  recurrenceMonth?: string;
}): string | null {
  if (input.recurringObligationId && input.recurrenceMonth) {
    const key = `due:${input.recurringObligationId}:${input.recurrenceMonth}`;
    return ATTENTION_KEY_PATTERN.test(key) ? key : null;
  }
  const key = `due:${input.expenseId}`;
  return ATTENTION_KEY_PATTERN.test(key) ? key : null;
}

export function monthCloseAttentionKey(monthKey: string): string | null {
  const key = `month-close:${monthKey}`;
  return ATTENTION_KEY_PATTERN.test(key) ? key : null;
}

/**
 * In-memory recurring materialization for evaluation only.
 * The returned state is a copy. The input vault is not written.
 */
export function attentionKeysForState(
  state: PersistedState,
  civilDate: string
): string[] {
  const materialized = materializeRecurringObligations(
    state.recurringObligations,
    state.expenses,
    civilDate,
    (() => {
      let n = 0;
      return () => `memory-${n++}`;
    })()
  ).expenses;
  const keys: string[] = [];
  for (const item of deriveDueAttention(materialized, civilDate)) {
    const expense = materialized.find((entry) => entry.id === item.id);
    const key = dueAttentionKey({
      expenseId: item.id,
      recurringObligationId: expense?.recurringObligationId,
      recurrenceMonth: expense?.recurrenceMonth,
    });
    if (key) keys.push(key);
  }
  const monthClose = deriveMonthCloseAttention({
    today: civilDate,
    currentMonthKey: civilDate.slice(0, 7),
    lastClosedMonthKey: state.lastClosedMonthKey,
  });
  if (monthClose) {
    const key = monthCloseAttentionKey(monthClose.monthKey);
    if (key) keys.push(key);
  }
  return keys;
}

export interface DeliveryEndpointAttempt {
  id: string;
}

export interface DeliverySendResult {
  ok: boolean;
  permanent: boolean;
}

export interface AttentionDeliveryDecision {
  civilDate: string | null;
  eligibleKeys: string[];
  coveredKeys: string[];
  sent: boolean;
  failureCode: "transient" | "no-endpoint" | null;
  removeEndpointIds: string[];
}

/**
 * One generic notification covers every still-eligible Attention subject.
 * Success requires at least one endpoint. Permanent endpoint failures are removed.
 * Transient failure of every endpoint leaves the subjects retryable.
 */
export async function decideAttentionDelivery(input: {
  now: Date;
  timeZone: string;
  state: PersistedState;
  succeededToday: ReadonlySet<string>;
  endpoints: readonly DeliveryEndpointAttempt[];
  send: (endpointId: string) => Promise<DeliverySendResult>;
}): Promise<AttentionDeliveryDecision> {
  const civilDate = civilDateInTimeZone(input.now, input.timeZone);
  if (!civilDate) {
    return {
      civilDate: null,
      eligibleKeys: [],
      coveredKeys: [],
      sent: false,
      failureCode: null,
      removeEndpointIds: [],
    };
  }
  const eligibleKeys = attentionKeysForState(input.state, civilDate).filter(
    (key) => !input.succeededToday.has(key)
  );
  if (eligibleKeys.length === 0) {
    return {
      civilDate,
      eligibleKeys: [],
      coveredKeys: [],
      sent: false,
      failureCode: null,
      removeEndpointIds: [],
    };
  }
  if (input.endpoints.length === 0) {
    return {
      civilDate,
      eligibleKeys,
      coveredKeys: [],
      sent: false,
      failureCode: "no-endpoint",
      removeEndpointIds: [],
    };
  }
  let anySuccess = false;
  let anyTransient = false;
  const removeEndpointIds: string[] = [];
  for (const endpoint of input.endpoints) {
    const result = await input.send(endpoint.id);
    if (result.ok) anySuccess = true;
    else if (result.permanent) removeEndpointIds.push(endpoint.id);
    else anyTransient = true;
  }
  return {
    civilDate,
    eligibleKeys,
    coveredKeys: anySuccess ? eligibleKeys : [],
    sent: anySuccess,
    failureCode: anySuccess ? null : anyTransient ? "transient" : "no-endpoint",
    removeEndpointIds,
  };
}

export function authorizeCronRequest(
  authorization: string | null,
  secret: string | undefined
): boolean {
  if (!secret || secret.length < 16 || /\s/.test(secret)) return false;
  const expected = `Bearer ${secret}`;
  if (!authorization || authorization.length !== expected.length) return false;
  let mismatch = 0;
  for (let i = 0; i < expected.length; i += 1) {
    mismatch |= authorization.charCodeAt(i) ^ expected.charCodeAt(i);
  }
  return mismatch === 0;
}
