/**
 * Phone More composition. Group order, plus which cloud session may start closed.
 * Cloud, backup, reset, and guidance behavior stay in the shared maintenance panel.
 */

import type { VaultSyncView } from "@/lib/babylon/vault-sync";

export const PHONE_MORE_GROUPS = [
  "financial-setup",
  "connections",
  "guidance",
  "data-cloud",
  "danger-zone",
] as const;

export type PhoneMoreGroup = (typeof PHONE_MORE_GROUPS)[number];

/**
 * Presentation only. A signed-in clean session may start closed.
 * Every other sync kind, a busy check, reconciliation, and a conflict note stay open.
 */
export function phoneCloudSessionStartsClosed(input: {
  isCloudSynced: boolean;
  syncKind: VaultSyncView["kind"];
  cloudBusy: boolean;
  reconciliationActive: boolean;
  conflictRefreshNote: string | null;
}): boolean {
  return (
    input.isCloudSynced &&
    input.syncKind === "clean" &&
    !input.cloudBusy &&
    !input.reconciliationActive &&
    !input.conflictRefreshNote
  );
}
