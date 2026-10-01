/**
 * This browser's notification opt-in.
 * Displays nothing and sends nothing. The session user id stays on the server.
 */

import { isIanaTimeZone, parsePushEndpoint, parsePushKey } from "@/lib/babylon/notification-config";

export const GENERIC_NOTIFICATION_TITLE = "Wealth Engine";
export const GENERIC_NOTIFICATION_BODY = "Wealth Engine needs your attention.";
export const GENERIC_NOTIFICATION_PATH = "/";
export const GENERIC_NOTIFICATION_TAG = "wealth-engine-attention";

const VAPID_PUBLIC_KEY_BYTES = 65;

export type DeviceNotificationState =
  | "unsupported"
  | "configuration-unavailable"
  | "permission-denied"
  | "not-enabled"
  | "enabled-on-device";

/**
 * Phone More presentation. Quiet notification controls may start closed.
 * This does not change permission, registration, or delivery.
 */
export function deviceNotificationSummaryMayClose(input: {
  state: DeviceNotificationState;
  note: string | null;
  busy: boolean;
}): boolean {
  if (input.busy || input.note) return false;
  return input.state === "not-enabled" || input.state === "enabled-on-device";
}

export function deviceNotificationLabel(state: DeviceNotificationState): string {
  switch (state) {
    case "unsupported":
      return "This browser cannot receive notifications.";
    case "configuration-unavailable":
      return "Notification setup is not available.";
    case "permission-denied":
      return "Notifications are blocked in this browser.";
    case "enabled-on-device":
      return "Notifications enabled on this device.";
    case "not-enabled":
      return "Not enabled on this device.";
  }
}

export function classifyDeviceNotification(input: {
  notificationSupported: boolean;
  serviceWorkerSupported: boolean;
  pushSupported: boolean;
  vapidReady: boolean;
  permission: NotificationPermission | "unknown";
  localSubscription: boolean;
  endpointRegistered: boolean;
}): DeviceNotificationState {
  if (
    !input.notificationSupported ||
    !input.serviceWorkerSupported ||
    !input.pushSupported
  ) {
    return "unsupported";
  }
  if (!input.vapidReady) return "configuration-unavailable";
  if (input.permission === "denied") return "permission-denied";
  if (
    input.permission === "granted" &&
    input.localSubscription &&
    input.endpointRegistered
  ) {
    return "enabled-on-device";
  }
  return "not-enabled";
}

/** Uncompressed P-256 public key, base64url, 65 bytes, leading 0x04. */
export function vapidPublicKeyToBytes(value: string): Uint8Array | null {
  const trimmed = value.trim();
  if (!/^[A-Za-z0-9_-]+$/.test(trimmed)) return null;
  const padded = trimmed.replace(/-/g, "+").replace(/_/g, "/");
  const padLength = (4 - (padded.length % 4)) % 4;
  let binary: string;
  try {
    binary = atob(`${padded}${"=".repeat(padLength)}`);
  } catch {
    return null;
  }
  if (binary.length !== VAPID_PUBLIC_KEY_BYTES) return null;
  const bytes = new Uint8Array(VAPID_PUBLIC_KEY_BYTES);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  if (bytes[0] !== 0x04) return null;
  return bytes;
}

export function readVapidPublicKey(
  value: string | undefined
): Uint8Array | null {
  if (!value?.trim()) return null;
  return vapidPublicKeyToBytes(value);
}

export function readBrowserIanaTimeZone(
  resolved?: string | null
): string | null {
  let zone = resolved;
  if (zone === undefined) {
    try {
      zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    } catch {
      return null;
    }
  }
  if (!zone || !isIanaTimeZone(zone)) return null;
  return zone;
}

/**
 * A stored preference keeps its enabled flag. Only a different valid IANA
 * name is written. No numeric offset is stored.
 */
export function preferenceTimezoneRefresh(
  stored: { enabled: boolean; ianaTimezone: string } | null,
  browserZone: string | null
): { enabled: boolean; ianaTimezone: string } | null {
  if (!stored) return null;
  const zone = readBrowserIanaTimeZone(browserZone);
  if (!zone || zone === stored.ianaTimezone) return null;
  return { enabled: stored.enabled, ianaTimezone: zone };
}

export function encodeSubscriptionKey(
  buffer: ArrayBuffer | null
): string | null {
  if (!buffer || buffer.byteLength === 0) return null;
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  const encoded = btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
  return parsePushKey(encoded);
}

export type HeldSubscription = {
  endpoint: string;
  p256dh: string;
  auth: string;
  unsubscribe: () => Promise<void>;
};

export type DeviceWriteResult = "ok" | "signed-out" | "failed";

export type DeviceOptInHost = {
  supported: boolean;
  vapidKey: () => Uint8Array | null;
  requestPermission: () => Promise<NotificationPermission>;
  existingSubscription: () => Promise<HeldSubscription | null>;
  subscribe: (applicationServerKey: Uint8Array) => Promise<HeldSubscription | null>;
  browserTimeZone: () => string | null;
  savePreference: (body: {
    enabled: true;
    ianaTimezone: string;
  }) => Promise<DeviceWriteResult>;
  registerSubscription: (body: {
    endpoint: string;
    p256dh: string;
    auth: string;
  }) => Promise<DeviceWriteResult>;
};

export type DeviceOptInResult =
  | { ok: true }
  | {
      ok: false;
      reason:
        | "unsupported"
        | "configuration"
        | "permission"
        | "registration"
        | "timezone"
        | "preference"
        | "subscription"
        | "signed-out";
    };

async function dropIfCreated(
  created: boolean,
  held: HeldSubscription
): Promise<void> {
  if (!created) return;
  try {
    await held.unsubscribe();
  } catch {
    // The UI will not claim this device is enabled.
  }
}

/**
 * Permission is requested by the caller from a click.
 * A subscription created in this attempt is removed if saving it fails.
 * A subscription that already existed is left in place.
 */
export async function enableNotificationsOnDevice(
  host: DeviceOptInHost
): Promise<DeviceOptInResult> {
  if (!host.supported) return { ok: false, reason: "unsupported" };
  const applicationServerKey = host.vapidKey();
  if (!applicationServerKey) return { ok: false, reason: "configuration" };

  const permission = await host.requestPermission();
  if (permission !== "granted") return { ok: false, reason: "permission" };

  const existing = await host.existingSubscription();
  const created = !existing;
  const held = existing ?? (await host.subscribe(applicationServerKey));
  if (!held) return { ok: false, reason: "registration" };

  const ianaTimezone = readBrowserIanaTimeZone(host.browserTimeZone());
  if (!ianaTimezone) {
    await dropIfCreated(created, held);
    return { ok: false, reason: "timezone" };
  }

  const preference = await host.savePreference({ enabled: true, ianaTimezone });
  if (preference !== "ok") {
    await dropIfCreated(created, held);
    return {
      ok: false,
      reason: preference === "signed-out" ? "signed-out" : "preference",
    };
  }

  const registered = await host.registerSubscription({
    endpoint: held.endpoint,
    p256dh: held.p256dh,
    auth: held.auth,
  });
  if (registered !== "ok") {
    await dropIfCreated(created, held);
    return {
      ok: false,
      reason: registered === "signed-out" ? "signed-out" : "subscription",
    };
  }

  return { ok: true };
}

export type DeviceDisableHost = {
  existingSubscription: () => Promise<HeldSubscription | null>;
  removeSubscription: (endpoint: string) => Promise<DeviceWriteResult>;
};

/**
 * Removes this browser's endpoint only.
 * The steward-wide enabled flag is not cleared.
 */
export async function disableNotificationsOnDevice(
  host: DeviceDisableHost
): Promise<
  | { ok: true }
  | { ok: false; reason: "subscription" | "signed-out" | "unsubscribe" }
> {
  const held = await host.existingSubscription();
  if (!held) return { ok: true };

  const removed = await host.removeSubscription(held.endpoint);
  if (removed !== "ok") {
    return {
      ok: false,
      reason: removed === "signed-out" ? "signed-out" : "subscription",
    };
  }

  try {
    await held.unsubscribe();
  } catch {
    return { ok: false, reason: "unsubscribe" };
  }
  return { ok: true };
}

export function subscriptionFromBrowser(input: {
  endpoint: string;
  p256dh: ArrayBuffer | null;
  auth: ArrayBuffer | null;
  unsubscribe: () => Promise<void>;
}): HeldSubscription | null {
  const endpoint = parsePushEndpoint(input.endpoint);
  const p256dh = encodeSubscriptionKey(input.p256dh);
  const auth = encodeSubscriptionKey(input.auth);
  if (!endpoint || !p256dh || !auth) return null;
  return {
    endpoint,
    p256dh,
    auth,
    unsubscribe: input.unsubscribe,
  };
}
