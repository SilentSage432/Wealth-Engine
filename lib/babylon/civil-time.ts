/**
 * Pure civil-date resolution.
 *
 * Wealth Engine keeps separate temporal authorities:
 *
 * FINANCIAL CIVIL TIME
 * A shared calendar reading of an absolute instant in an explicitly supplied
 * IANA timezone. The steward financial timezone, when established, belongs
 * to the planning document. This module does not store that zone, look one
 * up, or decide which zone is authoritative.
 *
 * CALENDAR RULES
 * Stored civil coordinates such as a recurrence month, due day, skip, or
 * payday anchor. They have no live clock.
 *
 * EVENT / EVIDENCE TIME
 * Absolute instants, or dates authored by a provider. They are not
 * re-resolved when a financial timezone changes.
 *
 * STEWARD-ACTION DATE
 * A civil date recorded because the steward acted. It stays historical
 * evidence.
 *
 * DISPLAY / SCHEDULING TIME
 * Device clocks, relative labels, and infrastructure wakes. They do not
 * define financial truth.
 *
 * Absence of a valid zone or instant is unknown. It is not the device zone
 * and not the server zone.
 */

export const IANA_TIMEZONE_MAX_LENGTH = 100;

const OFFSET_ONLY =
  /^(?:(?:UTC|GMT)[+-]\d{1,2}(?::?\d{2})?|[+-]\d{2}:?\d{2})$/i;

/**
 * True when the runtime accepts this string as an IANA timezone.
 * Empty strings and numeric offsets are rejected. A missing zone is not
 * replaced with the device zone or the server zone.
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

/**
 * Trimmed IANA name, or null. Does not read the device, the server, or a
 * notification preference.
 */
export function canonicalIanaTimeZone(value: string): string | null {
  if (!isIanaTimeZone(value)) return null;
  return value.trim();
}

/**
 * Civil YYYY-MM-DD for one absolute instant in one explicit IANA timezone.
 * Null means the instant or the zone cannot support a civil date.
 * The same pair always resolves the same date. Stored historical dates are
 * not inputs. No clock is read.
 */
export function resolveCivilDate(instant: Date, ianaTimeZone: string): string | null {
  if (!(instant instanceof Date) || !Number.isFinite(instant.getTime())) return null;
  if (!isIanaTimeZone(ianaTimeZone)) return null;
  let formatted: string;
  try {
    formatted = new Intl.DateTimeFormat("en-CA", {
      timeZone: ianaTimeZone.trim(),
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(instant);
  } catch {
    return null;
  }
  return /^\d{4}-\d{2}-\d{2}$/.test(formatted) ? formatted : null;
}

/**
 * Same resolver notification delivery and the Intelligence Contract already
 * call. The name does not look up a notification preference.
 */
export function civilDateInTimeZone(now: Date, timeZone: string): string | null {
  return resolveCivilDate(now, timeZone);
}

/** Shown when a current-month reading has no steward financial timezone. */
export const FINANCIAL_CALENDAR_UNKNOWN =
  "Financial time zone is not established.";

/**
 * Current financial civil date. Null when the steward zone is absent or
 * unusable. Does not read the device zone, a notification preference, or
 * the server zone.
 */
export function financialCivilDate(
  instant: Date,
  financialTimeZone: string | null | undefined
): string | null {
  if (!financialTimeZone) return null;
  return resolveCivilDate(instant, financialTimeZone);
}

/**
 * Milliseconds until the civil date changes in the financial timezone.
 * Null when that zone cannot resolve a date. The search uses absolute
 * instants and resolveCivilDate, so a 23-hour or 25-hour civil day is
 * included. A 1s floor avoids a tight loop on the boundary. No device
 * midnight and no vault write.
 */
export function msUntilNextFinancialMidnight(
  now: Date,
  financialTimeZone: string | null | undefined
): number | null {
  if (!(now instanceof Date) || !Number.isFinite(now.getTime())) return null;
  const today = financialCivilDate(now, financialTimeZone);
  if (!today || !financialTimeZone) return null;
  const start = now.getTime();
  let hi = start + 36 * 60 * 60 * 1000;
  if (resolveCivilDate(new Date(hi), financialTimeZone) === today) return null;
  let lo = start;
  while (hi - lo > 1000) {
    const mid = lo + Math.floor((hi - lo) / 2);
    if (resolveCivilDate(new Date(mid), financialTimeZone) === today) lo = mid;
    else hi = mid;
  }
  return Math.max(1000, hi - start);
}
