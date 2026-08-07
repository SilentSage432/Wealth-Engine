/**
 * Vault toast event bus — Infrastructure.
 * Presentation mounts `VaultToastHost`; callers emit without owning UI.
 */

export type VaultToastTone = "error" | "info" | "success";

export type VaultToastPayload = {
  message: string;
  tone?: VaultToastTone;
  /**
   * Auto-dismiss delay in ms.
   * Use `0` to keep the toast until the steward dismisses it.
   */
  durationMs?: number;
};

export type VaultToastDetail = Required<Pick<VaultToastPayload, "message">> & {
  tone: VaultToastTone;
  durationMs: number;
  id: number;
};

export const VAULT_TOAST_EVENT = "wealth-engine:vault-toast";

let toastSeq = 0;

/** Emit a fail-soft toast without coupling callers to React tree ownership. */
export function emitVaultToast(payload: VaultToastPayload): void {
  if (typeof window === "undefined") return;
  const detail: VaultToastDetail = {
    id: ++toastSeq,
    message: payload.message,
    tone: payload.tone ?? "info",
    durationMs: payload.durationMs ?? 4500,
  };
  window.dispatchEvent(new CustomEvent(VAULT_TOAST_EVENT, { detail }));
}
