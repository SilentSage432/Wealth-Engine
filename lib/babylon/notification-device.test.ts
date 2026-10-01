import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { CLOUD_VAULT_SCHEMA_VERSION } from "@/lib/babylon/cloud-vault";
import {
  GENERIC_NOTIFICATION_BODY,
  GENERIC_NOTIFICATION_PATH,
  GENERIC_NOTIFICATION_TAG,
  GENERIC_NOTIFICATION_TITLE,
  classifyDeviceNotification,
  deviceNotificationLabel,
  deviceNotificationSummaryMayClose,
  disableNotificationsOnDevice,
  enableNotificationsOnDevice,
  encodeSubscriptionKey,
  preferenceTimezoneRefresh,
  readBrowserIanaTimeZone,
  vapidPublicKeyToBytes,
  type DeviceOptInHost,
  type HeldSubscription,
} from "@/lib/babylon/notification-device";

function uncompressedKey(): { bytes: Uint8Array; encoded: string } {
  const bytes = new Uint8Array(65);
  bytes[0] = 0x04;
  for (let index = 1; index < bytes.length; index += 1) bytes[index] = index;
  return { bytes, encoded: Buffer.from(bytes).toString("base64url") };
}

function held(createdUnsubscribe = vi.fn(async () => undefined)): HeldSubscription {
  return {
    endpoint: "https://push.example/device",
    p256dh: "abc",
    auth: "def",
    unsubscribe: createdUnsubscribe,
  };
}

function host(overrides: Partial<DeviceOptInHost> = {}): DeviceOptInHost {
  const key = uncompressedKey();
  return {
    supported: true,
    vapidKey: () => key.bytes,
    requestPermission: async () => "granted",
    existingSubscription: async () => null,
    subscribe: async () => held(),
    browserTimeZone: () => "America/Denver",
    savePreference: async () => "ok",
    registerSubscription: async () => "ok",
    ...overrides,
  };
}

describe("VAPID public key conversion", () => {
  it("converts a base64url uncompressed P-256 key", () => {
    const key = uncompressedKey();
    expect(Array.from(vapidPublicKeyToBytes(key.encoded) ?? [])).toEqual(
      Array.from(key.bytes)
    );
  });

  it("fails closed on malformed input", () => {
    expect(vapidPublicKeyToBytes("")).toBeNull();
    expect(vapidPublicKeyToBytes("not a key")).toBeNull();
    expect(vapidPublicKeyToBytes("@@@@")).toBeNull();
    expect(vapidPublicKeyToBytes(Buffer.from([1, 2, 3]).toString("base64url"))).toBeNull();
    const wrongPrefix = uncompressedKey();
    wrongPrefix.bytes[0] = 0x02;
    expect(
      vapidPublicKeyToBytes(Buffer.from(wrongPrefix.bytes).toString("base64url"))
    ).toBeNull();
  });
});

describe("timezone boundary", () => {
  it("accepts an IANA name and rejects offsets", () => {
    expect(readBrowserIanaTimeZone("America/Denver")).toBe("America/Denver");
    expect(readBrowserIanaTimeZone("UTC-06:00")).toBeNull();
    expect(readBrowserIanaTimeZone("GMT+1")).toBeNull();
    expect(readBrowserIanaTimeZone(null)).toBeNull();
  });

  it("refreshes a stored IANA name without changing the enabled flag", () => {
    expect(
      preferenceTimezoneRefresh(
        { enabled: true, ianaTimezone: "America/Chicago" },
        "America/Denver"
      )
    ).toEqual({ enabled: true, ianaTimezone: "America/Denver" });
    expect(
      preferenceTimezoneRefresh(
        { enabled: false, ianaTimezone: "America/Chicago" },
        "UTC-6"
      )
    ).toBeNull();
    expect(
      preferenceTimezoneRefresh(
        { enabled: true, ianaTimezone: "America/Denver" },
        "America/Denver"
      )
    ).toBeNull();
    expect(preferenceTimezoneRefresh(null, "America/Denver")).toBeNull();
  });
});

describe("device capability", () => {
  const ready = {
    notificationSupported: true,
    serviceWorkerSupported: true,
    pushSupported: true,
    vapidReady: true,
    permission: "default" as const,
    localSubscription: false,
    endpointRegistered: false,
  };

  it("classifies support, configuration, permission, and this device", () => {
    expect(classifyDeviceNotification({ ...ready, pushSupported: false })).toBe(
      "unsupported"
    );
    expect(classifyDeviceNotification({ ...ready, vapidReady: false })).toBe(
      "configuration-unavailable"
    );
    expect(classifyDeviceNotification({ ...ready, permission: "denied" })).toBe(
      "permission-denied"
    );
    expect(classifyDeviceNotification(ready)).toBe("not-enabled");
    expect(
      classifyDeviceNotification({
        ...ready,
        permission: "granted",
        localSubscription: true,
        endpointRegistered: false,
      })
    ).toBe("not-enabled");
    expect(
      classifyDeviceNotification({
        ...ready,
        permission: "granted",
        localSubscription: true,
        endpointRegistered: true,
      })
    ).toBe("enabled-on-device");
    expect(deviceNotificationLabel("enabled-on-device")).toBe(
      "Notifications enabled on this device."
    );
    expect(deviceNotificationLabel("enabled-on-device")).not.toContain("will notify");
  });
});

describe("opt-in payloads and failure cleanup", () => {
  it("registers endpoint keys without a browser-chosen user id", async () => {
    let preference: unknown;
    let registration: unknown;
    const target = host({
      savePreference: async (body) => {
        preference = body;
        return "ok";
      },
      registerSubscription: async (body) => {
        registration = body;
        return "ok";
      },
    });
    await expect(enableNotificationsOnDevice(target)).resolves.toEqual({ ok: true });
    expect(preference).toEqual({
      enabled: true,
      ianaTimezone: "America/Denver",
    });
    expect(registration).toEqual({
      endpoint: "https://push.example/device",
      p256dh: "abc",
      auth: "def",
    });
    expect(registration).not.toHaveProperty("user_id");
    expect(registration).not.toHaveProperty("userId");
  });

  it("reuses an existing subscription and does not remove it when saving fails", async () => {
    const unsubscribe = vi.fn(async () => undefined);
    const subscribe = vi.fn(async () => held());
    const result = await enableNotificationsOnDevice(
      host({
        existingSubscription: async () => held(unsubscribe),
        subscribe,
        registerSubscription: async () => "failed",
      })
    );
    expect(result).toEqual({ ok: false, reason: "subscription" });
    expect(subscribe).not.toHaveBeenCalled();
    expect(unsubscribe).not.toHaveBeenCalled();
  });

  it("removes a subscription this attempt created when registration fails", async () => {
    const unsubscribe = vi.fn(async () => undefined);
    const result = await enableNotificationsOnDevice(
      host({
        subscribe: async () => held(unsubscribe),
        registerSubscription: async () => "failed",
      })
    );
    expect(result).toEqual({ ok: false, reason: "subscription" });
    expect(unsubscribe).toHaveBeenCalledOnce();
  });

  it("does not subscribe when permission is not granted", async () => {
    const subscribe = vi.fn(async () => held());
    const result = await enableNotificationsOnDevice(
      host({
        requestPermission: async () => "denied",
        subscribe,
      })
    );
    expect(result).toEqual({ ok: false, reason: "permission" });
    expect(subscribe).not.toHaveBeenCalled();
  });

  it("turns off this device without clearing the global preference", async () => {
    const unsubscribe = vi.fn(async () => undefined);
    const removeSubscription = vi.fn(async () => "ok" as const);
    await expect(
      disableNotificationsOnDevice({
        existingSubscription: async () => held(unsubscribe),
        removeSubscription,
      })
    ).resolves.toEqual({ ok: true });
    expect(removeSubscription).toHaveBeenCalledWith("https://push.example/device");
    expect(unsubscribe).toHaveBeenCalledOnce();

    const source = readFileSync("lib/babylon/notification-device.ts", "utf8");
    const disable = source.slice(
      source.indexOf("export async function disableNotificationsOnDevice"),
      source.indexOf("export function subscriptionFromBrowser")
    );
    expect(disable).not.toContain("enabled");
    expect(disable).not.toContain("preferences");
  });

  it("leaves the browser subscription when server removal fails", async () => {
    const unsubscribe = vi.fn(async () => undefined);
    const result = await disableNotificationsOnDevice({
      existingSubscription: async () => held(unsubscribe),
      removeSubscription: async () => "failed",
    });
    expect(result).toEqual({ ok: false, reason: "subscription" });
    expect(unsubscribe).not.toHaveBeenCalled();
  });
});

describe("phone notification disclosure policy", () => {
  it("closes only a quiet enabled or not-enabled device", () => {
    for (const state of [
      "unsupported",
      "configuration-unavailable",
      "permission-denied",
      "not-enabled",
      "enabled-on-device",
    ] as const) {
      expect(
        deviceNotificationSummaryMayClose({ state, note: null, busy: false })
      ).toBe(state === "not-enabled" || state === "enabled-on-device");
    }
  });

  it("stays open while busy or while a note is showing", () => {
    expect(
      deviceNotificationSummaryMayClose({
        state: "not-enabled",
        note: null,
        busy: true,
      })
    ).toBe(false);
    expect(
      deviceNotificationSummaryMayClose({
        state: "enabled-on-device",
        note: "Permission was not granted.",
        busy: false,
      })
    ).toBe(false);
  });
});

describe("subscription key encoding", () => {
  it("encodes key bytes without adding a user id", () => {
    const bytes = Uint8Array.from([1, 2, 3, 4]).buffer;
    expect(encodeSubscriptionKey(bytes)).toBe(
      Buffer.from(new Uint8Array(bytes)).toString("base64url")
    );
    expect(encodeSubscriptionKey(null)).toBeNull();
    expect(encodeSubscriptionKey(new ArrayBuffer(0))).toBeNull();
  });
});

describe("WE-NOTIFY-003 boundaries", () => {
  const device = readFileSync("lib/babylon/notification-device.ts", "utf8");
  const control = readFileSync(
    "components/babylon/device-notifications.tsx",
    "utf8"
  );
  const worker = readFileSync("public/sw.js", "utf8");
  const more = readFileSync("components/babylon/mobile-more.tsx", "utf8");

  it("keeps the service worker on fixed copy, /, and the existing cache", () => {
    expect(worker).toContain('addEventListener("push"');
    expect(worker).toContain('addEventListener("notificationclick"');
    expect(worker).toContain(`showNotification("${GENERIC_NOTIFICATION_TITLE}"`);
    expect(worker).toContain(`body: "${GENERIC_NOTIFICATION_BODY}"`);
    expect(worker).toContain(`tag: "${GENERIC_NOTIFICATION_TAG}"`);
    expect(worker).toContain(`new URL("${GENERIC_NOTIFICATION_PATH}", self.location.origin)`);
    expect(worker).toContain('const CACHE_NAME = "babylon-engine-v2"');
    expect(worker).toContain('cache: "no-store"');
    expect(worker).toContain('url.pathname.startsWith("/api/")');
    expect(worker).not.toContain("event.data");
    expect(worker).not.toContain("vault_data");
    expect(worker).not.toContain("deriveDueAttention");
    expect(worker).not.toContain("deriveMonthCloseAttention");
  });

  it("does not send, schedule, or evaluate Attention", () => {
    const joined = [device, control, worker, more].join("\n");
    expect(joined).not.toContain("web-push");
    expect(joined).not.toContain("VAPID_PRIVATE_KEY");
    expect(joined).not.toContain("VAPID_SUBJECT");
    expect(joined).not.toContain("CRON_SECRET");
    expect(joined).not.toContain("notification_deliveries");
    expect(joined).not.toContain("deriveDueAttention");
    expect(joined).not.toContain("deriveMonthCloseAttention");
    expect(joined).not.toContain("cron");
    expect(device).not.toContain("user_id");
    expect(control).not.toContain("user_id");
    expect(control).toContain('"/api/notifications/subscriptions"');
    expect(control).toContain('"/api/notifications/preferences"');
    expect(control).toContain('"/api/notifications/test"');
    expect(control).toContain("Send test notification");
    expect(control).not.toContain("serviceWorker.register");
    expect(readFileSync(".env.example", "utf8")).toContain(
      "NEXT_PUBLIC_VAPID_PUBLIC_KEY"
    );
    expect(CLOUD_VAULT_SCHEMA_VERSION).toBe(6);
    const attention = readFileSync("lib/babylon/attention.ts", "utf8");
    expect(attention).toContain("export function deriveDueAttention");
    expect(attention).not.toContain("PushManager");
  });
});
