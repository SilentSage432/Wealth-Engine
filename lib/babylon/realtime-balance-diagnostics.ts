import "server-only";

/**
 * Stage markers for foreground real-time balance diagnosis.
 * Counts and reason codes only. No tokens, balances, names, or payloads.
 */
export type RealtimeBalanceStage =
  | "post-entered"
  | "authenticated"
  | "items-discovered"
  | "targets-derived"
  | "balance-skipped"
  | "balance-request-start"
  | "balance-request-failed"
  | "balance-parsed"
  | "rpc-result"
  | "post-complete";

type StageField = string | number | boolean;

export function logRealtimeBalanceStage(
  stage: RealtimeBalanceStage,
  fields?: Readonly<Record<string, StageField | null | undefined>>
): void {
  const safe: Record<string, StageField> = { stage };
  if (fields) {
    for (const [key, value] of Object.entries(fields)) {
      if (value === null || value === undefined) continue;
      safe[key] = value;
    }
  }
  console.info("[plaid] realtime observe", safe);
}
