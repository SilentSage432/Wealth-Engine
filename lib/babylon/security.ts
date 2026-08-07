/**
 * Vault security — WebAuthn + local PIN gate.
 * Infrastructure/preference only; does not own ledger math.
 */

export const PIN_HASH_KEY = "babylon_vault_pin_hash";
export const WEBAUTHN_CRED_KEY = "babylon_webauthn_cred_id";
export const SESSION_UNLOCK_KEY = "babylon_vault_unlocked";

function toBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  bytes.forEach((b) => {
    binary += String.fromCharCode(b);
  });
  return btoa(binary);
}

function fromBase64(value: string): ArrayBuffer {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes.buffer;
}

export async function hashPin(pin: string): Promise<string> {
  const data = new TextEncoder().encode(`babylon-vault:${pin}`);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return toBase64(digest);
}

export function isVaultConfigured(): boolean {
  if (typeof window === "undefined") return false;
  return Boolean(window.localStorage.getItem(PIN_HASH_KEY));
}

export function isSessionUnlocked(): boolean {
  if (typeof window === "undefined") return false;
  return window.sessionStorage.getItem(SESSION_UNLOCK_KEY) === "1";
}

export function markSessionUnlocked(): void {
  if (typeof window === "undefined") return;
  window.sessionStorage.setItem(SESSION_UNLOCK_KEY, "1");
}

export function lockSession(): void {
  if (typeof window === "undefined") return;
  window.sessionStorage.removeItem(SESSION_UNLOCK_KEY);
}

export async function setVaultPin(pin: string): Promise<void> {
  if (!/^\d{4}$/.test(pin)) {
    throw new Error("PIN must be exactly 4 digits.");
  }
  const hash = await hashPin(pin);
  window.localStorage.setItem(PIN_HASH_KEY, hash);
}

export async function verifyVaultPin(pin: string): Promise<boolean> {
  const stored = window.localStorage.getItem(PIN_HASH_KEY);
  if (!stored) return false;
  const hash = await hashPin(pin);
  return hash === stored;
}

export function isWebAuthnAvailable(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof window.PublicKeyCredential !== "undefined" &&
    typeof navigator.credentials?.get === "function"
  );
}

export async function registerWebAuthnCredential(): Promise<boolean> {
  if (!isWebAuthnAvailable()) return false;
  try {
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

    if (!credential) return false;
    window.localStorage.setItem(WEBAUTHN_CRED_KEY, toBase64(credential.rawId));
    return true;
  } catch {
    return false;
  }
}

export async function unlockWithWebAuthn(): Promise<boolean> {
  if (!isWebAuthnAvailable()) return false;
  const storedId = window.localStorage.getItem(WEBAUTHN_CRED_KEY);
  if (!storedId) return false;

  try {
    const challenge = crypto.getRandomValues(new Uint8Array(32));
    const credential = await navigator.credentials.get({
      publicKey: {
        challenge,
        timeout: 60_000,
        userVerification: "required",
        allowCredentials: [
          {
            type: "public-key",
            id: fromBase64(storedId),
          },
        ],
      },
    });
    return Boolean(credential);
  } catch {
    return false;
  }
}
