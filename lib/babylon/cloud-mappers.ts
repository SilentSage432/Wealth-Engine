/**
 * Shared identity check for Supabase user ids.
 * The older relational row mappers were removed with the ledger writes
 * in WE-SYNC-003. The relational tables themselves stay.
 */

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function isUuid(value: string | undefined | null): value is string {
  return typeof value === "string" && UUID_RE.test(value);
}
