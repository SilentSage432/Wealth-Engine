/**
 * Vault security — WebAuthn + local PIN gate.
 * Infrastructure/preference only; does not own ledger math.
 *
 * All storage / WebAuthn / crypto paths are fail-soft: never throw into React
 * render or leave the SecurityGate stuck mid-setup.
 */

export const PIN_HASH_KEY = "babylon_vault_pin_hash";
export const WEBAUTHN_CRED_KEY = "babylon_webauthn_cred_id";
export const SESSION_UNLOCK_KEY = "babylon_vault_unlocked";

/** Idle duration before SecurityGate re-locks an unlocked session. */
export const VAULT_IDLE_LOCK_MS = 3 * 60 * 1000;

/**
 * Hard cap for `navigator.credentials.get()` so domain mismatch / hung
 * platform prompts cannot leave the gate on "Opening the vault...".
 */
export const WEBAUTHN_UNLOCK_TIMEOUT_MS = 1500;

export type VaultPinResult =
  | { ok: true }
  | { ok: false; message: string };

export type WebAuthnUnlockResult =
  | "success"
  | "timeout"
  | "unavailable"
  | "failed";

function canUseBrowserStorage(): boolean {
  return typeof window !== "undefined";
}

function safeLocalGet(key: string): string | null {
  if (!canUseBrowserStorage()) return null;
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function safeLocalSet(key: string, value: string): boolean {
  if (!canUseBrowserStorage()) return false;
  try {
    window.localStorage.setItem(key, value);
    return true;
  } catch {
    return false;
  }
}

function safeLocalRemove(key: string): void {
  if (!canUseBrowserStorage()) return;
  try {
    window.localStorage.removeItem(key);
  } catch {
    // Storage blocked (private mode, quota, etc.)
  }
}

function safeSessionGet(key: string): string | null {
  if (!canUseBrowserStorage()) return null;
  try {
    return window.sessionStorage.getItem(key);
  } catch {
    return null;
  }
}

function safeSessionSet(key: string, value: string): void {
  if (!canUseBrowserStorage()) return;
  try {
    window.sessionStorage.setItem(key, value);
  } catch {
    // ignore
  }
}

function safeSessionRemove(key: string): void {
  if (!canUseBrowserStorage()) return;
  try {
    window.sessionStorage.removeItem(key);
  } catch {
    // ignore
  }
}

function toBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  bytes.forEach((b) => {
    binary += String.fromCharCode(b);
  });
  return btoa(binary);
}

function fromBase64(value: string): ArrayBuffer | null {
  try {
    if (typeof value !== "string" || value.length === 0) return null;
    const binary = atob(value);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) {
      bytes[i] = binary.charCodeAt(i);
    }
    return bytes.buffer;
  } catch {
    return null;
  }
}

/** Normalize to digits-only PIN string; never throws. */
export function normalizePinInput(value: unknown): string {
  if (typeof value !== "string") return "";
  return value.replace(/\D/g, "").slice(0, 4);
}

export function pinsMatch(pin: unknown, confirmPin: unknown): boolean {
  const a = normalizePinInput(pin);
  const b = normalizePinInput(confirmPin);
  return a.length === 4 && b.length === 4 && a === b;
}

export async function hashPin(pin: string): Promise<string> {
  if (typeof window === "undefined") {
    throw new Error("PIN hashing is only available in the browser.");
  }
  if (!window.crypto?.subtle) {
    throw new Error(
      "Secure PIN hashing unavailable. Open Wealth Engine over HTTPS."
    );
  }
  const data = new TextEncoder().encode(`babylon-vault:${pin}`);
  const digest = await window.crypto.subtle.digest("SHA-256", data);
  return toBase64(digest);
}

export function isVaultConfigured(): boolean {
  return Boolean(safeLocalGet(PIN_HASH_KEY));
}

export function isSessionUnlocked(): boolean {
  return safeSessionGet(SESSION_UNLOCK_KEY) === "1";
}

export function markSessionUnlocked(): void {
  safeSessionSet(SESSION_UNLOCK_KEY, "1");
}

export function lockSession(): void {
  safeSessionRemove(SESSION_UNLOCK_KEY);
}

/**
 * Persist a master PIN hash. Fail-soft — returns a result instead of throwing
 * for storage/crypto failures (callers may still try/catch).
 */
export async function setVaultPin(pin: unknown): Promise<VaultPinResult> {
  try {
    const normalized = normalizePinInput(pin);
    if (normalized.length !== 4) {
      return { ok: false, message: "PIN must be exactly 4 digits." };
    }
    const hash = await hashPin(normalized);
    if (!safeLocalSet(PIN_HASH_KEY, hash)) {
      return {
        ok: false,
        message:
          "Could not save PIN. Check private browsing / storage permissions.",
      };
    }
    return { ok: true };
  } catch (err) {
    return {
      ok: false,
      message:
        err instanceof Error ? err.message : "Could not set PIN. Try again.",
    };
  }
}

export async function verifyVaultPin(pin: unknown): Promise<boolean> {
  try {
    const normalized = normalizePinInput(pin);
    if (normalized.length !== 4) return false;
    const stored = safeLocalGet(PIN_HASH_KEY);
    if (!stored) return false;
    const hash = await hashPin(normalized);
    return hash === stored;
  } catch {
    return false;
  }
}

/**
 * Defensive WebAuthn feature detect — never throws on mobile / restricted browsers.
 */
export function isWebAuthnAvailable(): boolean {
  try {
    if (typeof window === "undefined") return false;
    if (!("PublicKeyCredential" in window) || !window.PublicKeyCredential) {
      return false;
    }
    if (!("credentials" in navigator) || !navigator.credentials) return false;
    return (
      typeof navigator.credentials.get === "function" &&
      typeof navigator.credentials.create === "function"
    );
  } catch {
    return false;
  }
}

export function hasWebAuthnCredential(): boolean {
  return Boolean(safeLocalGet(WEBAUTHN_CRED_KEY));
}

export function clearWebAuthnCredential(): void {
  safeLocalRemove(WEBAUTHN_CRED_KEY);
}

export async function registerWebAuthnCredential(): Promise<boolean> {
  try {
    if (!isWebAuthnAvailable()) return false;
    if (
      typeof window === "undefined" ||
      !("credentials" in navigator) ||
      !window.PublicKeyCredential
    ) {
      return false;
    }

    const challenge = crypto.getRandomValues(new Uint8Array(32));
    const userId = crypto.getRandomValues(new Uint8Array(16));
    const credential = (await navigator.credentials.create({
      publicKey: {
        challenge,
        rp: { name: "Wealth Engine", id: window.location.hostname },
        user: {
          id: userId,
          name: "steward",
          displayName: "Steward",
        },
        pubKeyCredParams: [
          { type: "public-key", alg: -7 },
          { type: "public-key", alg: -257 },
        ],
        authenticatorSelection: {
          authenticatorAttachment: "platform",
          userVerification: "required",
        },
        timeout: 60_000,
      },
    })) as PublicKeyCredential | null;

    if (!credential?.rawId) return false;
    return safeLocalSet(WEBAUTHN_CRED_KEY, toBase64(credential.rawId));
  } catch {
    return false;
  }
}

/**
 * Attempt platform authenticator unlock with a hard timeout.
 * Never throws — callers switch to PIN on any non-success result.
 */
export async function unlockWithWebAuthn(
  timeoutMs: number = WEBAUTHN_UNLOCK_TIMEOUT_MS
): Promise<WebAuthnUnlockResult> {
  try {
    if (!isWebAuthnAvailable()) return "unavailable";
    if (
      typeof window === "undefined" ||
      !("credentials" in navigator) ||
      !window.PublicKeyCredential
    ) {
      return "unavailable";
    }

    const storedId = safeLocalGet(WEBAUTHN_CRED_KEY);
    if (!storedId) return "unavailable";

    const credentialId = fromBase64(storedId);
    if (!credentialId) {
      clearWebAuthnCredential();
      return "failed";
    }

    const challenge = crypto.getRandomValues(new Uint8Array(32));
    let timedOut = false;

    const getPromise = navigator.credentials
      .get({
        publicKey: {
          challenge,
          timeout: Math.max(timeoutMs, 5_000),
          userVerification: "required",
          allowCredentials: [
            {
              type: "public-key",
              id: credentialId,
            },
          ],
        },
      })
      .then((credential) => ({ ok: true as const, credential }))
      .catch(() => ({ ok: false as const, credential: null }));

    const timeoutPromise = new Promise<{ ok: false; credential: null }>(
      (resolve) => {
        window.setTimeout(() => {
          timedOut = true;
          resolve({ ok: false, credential: null });
        }, timeoutMs);
      }
    );

    const result = await Promise.race([getPromise, timeoutPromise]);
    if (result.ok && result.credential) return "success";
    if (timedOut) return "timeout";
    return "failed";
  } catch {
    // InvalidStateError, NotAllowedError, SecurityError, AbortError, etc.
    return "failed";
  }
}
