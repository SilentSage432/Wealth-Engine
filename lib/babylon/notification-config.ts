/**
 * Validation for notification preference and push-subscription input.
 * Operational only. Does not read the vault, the clock's zone, or Attention.
 */

export const IANA_TIMEZONE_MAX_LENGTH = 100;
export const PUSH_ENDPOINT_MAX_LENGTH = 2048;
export const PUSH_KEY_MAX_LENGTH = 256;

const OFFSET_ONLY =
  /^(?:(?:UTC|GMT)[+-]\d{1,2}(?::?\d{2})?|[+-]\d{2}:?\d{2})$/i;
const PUSH_KEY = /^[A-Za-z0-9+/_=-]+$/;

/**
 * True when the runtime accepts this string as an IANA timezone.
 * Empty strings and numeric offsets are rejected. A missing zone is not
 * replaced with the server's zone.
 */
export function isIanaTimeZone(value: string): boolean {
  if (typeof value !== "string") return false;
  const zone = value.trim();
  if (!zone || zone.length > IANA_TIMEZONE_MAX_LENGTH) return false;
  if (OFFSET_ONLY.test(zone)) return false;
  try {
    Intl.DateTimeFormat("en-US", { timeZone: zone }).format();
    return true;
  } catch {
    return false;
  }
}

export function parseIanaTimeZone(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const zone = value.trim();
  return isIanaTimeZone(zone) ? zone : null;
}

export function parsePushEndpoint(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const endpoint = value.trim();
  if (!endpoint || endpoint.length > PUSH_ENDPOINT_MAX_LENGTH) return null;
  if (!endpoint.startsWith("https://")) return null;

  let url: URL;
  try {
    url = new URL(endpoint);
  } catch {
    return null;
  }
  if (url.protocol !== "https:") return null;
  if (!url.hostname) return null;
  if (url.username || url.password || url.hash) return null;
  return endpoint;
}

export function parsePushKey(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const key = value.trim();
  if (!key || key.length > PUSH_KEY_MAX_LENGTH) return null;
  if (!PUSH_KEY.test(key)) return null;
  return key;
}

export type PreferenceInput = {
  enabled: boolean;
  ianaTimezone: string;
};

export function parsePreferenceInput(body: unknown): PreferenceInput | null {
  if (!body || typeof body !== "object" || Array.isArray(body)) return null;
  const record = body as Record<string, unknown>;
  if (typeof record.enabled !== "boolean") return null;
  const ianaTimezone = parseIanaTimeZone(record.ianaTimezone);
  if (!ianaTimezone) return null;
  return { enabled: record.enabled, ianaTimezone };
}

export type SubscriptionInput = {
  endpoint: string;
  p256dh: string;
  auth: string;
};

export function parseSubscriptionInput(body: unknown): SubscriptionInput | null {
  if (!body || typeof body !== "object" || Array.isArray(body)) return null;
  const record = body as Record<string, unknown>;
  const endpoint = parsePushEndpoint(record.endpoint);
  const p256dh = parsePushKey(record.p256dh);
  const auth = parsePushKey(record.auth);
  if (!endpoint || !p256dh || !auth) return null;
  return { endpoint, p256dh, auth };
}

export function parseRemovalInput(body: unknown): { endpoint: string } | null {
  if (!body || typeof body !== "object" || Array.isArray(body)) return null;
  const endpoint = parsePushEndpoint(
    (body as Record<string, unknown>).endpoint
  );
  return endpoint ? { endpoint } : null;
}
