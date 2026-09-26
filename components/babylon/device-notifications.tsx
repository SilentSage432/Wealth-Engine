"use client";

import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  classifyDeviceNotification,
  deviceNotificationLabel,
  disableNotificationsOnDevice,
  enableNotificationsOnDevice,
  preferenceTimezoneRefresh,
  readBrowserIanaTimeZone,
  readVapidPublicKey,
  subscriptionFromBrowser,
  type DeviceNotificationState,
  type DeviceWriteResult,
  type HeldSubscription,
} from "@/lib/babylon/notification-device";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";

type StoredPreference = {
  enabled: boolean;
  ianaTimezone: string;
} | null;

function browserSupport() {
  if (typeof window === "undefined" || typeof Notification === "undefined") {
    return {
      notificationSupported: false,
      serviceWorkerSupported: false,
      pushSupported: false,
      permission: "unknown" as const,
    };
  }
  const registrationReady =
    "serviceWorker" in navigator && "PushManager" in window;
  return {
    notificationSupported: true,
    serviceWorkerSupported: "serviceWorker" in navigator,
    pushSupported: registrationReady,
    permission: Notification.permission,
  };
}

async function authedWrite(
  path: string,
  method: "PUT" | "POST" | "DELETE",
  body: unknown
): Promise<DeviceWriteResult> {
  const supabase = getSupabaseBrowserClient();
  if (!supabase) return "signed-out";
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) return "signed-out";
  try {
    const response = await fetch(path, {
      method,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(body),
    });
    return response.ok ? "ok" : "failed";
  } catch {
    return "failed";
  }
}

async function currentRegistration(): Promise<ServiceWorkerRegistration | null> {
  if (!("serviceWorker" in navigator)) return null;
  return (await navigator.serviceWorker.getRegistration()) ?? null;
}

async function heldFromRegistration(): Promise<HeldSubscription | null> {
  const registration = await currentRegistration();
  const subscription = await registration?.pushManager.getSubscription();
  if (!subscription) return null;
  return subscriptionFromBrowser({
    endpoint: subscription.endpoint,
    p256dh: subscription.getKey("p256dh"),
    auth: subscription.getKey("auth"),
    unsubscribe: async () => {
      await subscription.unsubscribe();
    },
  });
}

function failureMessage(reason: string): string {
  switch (reason) {
    case "signed-out":
      return "Sign in before changing notifications on this device.";
    case "permission":
      return "Permission was not granted.";
    case "registration":
      return "This browser is not ready to receive notifications.";
    case "timezone":
      return "This browser did not provide a valid timezone.";
    default:
      return "This device was not saved. Try again.";
  }
}

export function DeviceNotifications() {
  const vapidKey = readVapidPublicKey(process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY);
  const [support, setSupport] = useState(browserSupport);
  const [localSubscription, setLocalSubscription] = useState(false);
  const [endpointRegistered, setEndpointRegistered] = useState(false);
  const [stored, setStored] = useState<StoredPreference>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const nextSupport = browserSupport();
    setSupport(nextSupport);
    const held = await heldFromRegistration();
    setLocalSubscription(Boolean(held));

    const supabase = getSupabaseBrowserClient();
    if (!supabase) {
      setEndpointRegistered(false);
      setStored(null);
      return;
    }
    const { data } = await supabase.auth.getSession();
    const token = data.session?.access_token;
    if (!token) {
      setEndpointRegistered(false);
      setStored(null);
      return;
    }

    const query = held
      ? `?endpoint=${encodeURIComponent(held.endpoint)}`
      : "";
    try {
      const response = await fetch(`/api/notifications${query}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!response.ok) return;
      const body = (await response.json()) as {
        enabled?: unknown;
        ianaTimezone?: unknown;
        endpointRegistered?: unknown;
      };
      setEndpointRegistered(body.endpointRegistered === true);
      if (typeof body.enabled === "boolean" && typeof body.ianaTimezone === "string") {
        setStored({ enabled: body.enabled, ianaTimezone: body.ianaTimezone });
      } else {
        setStored(null);
      }
    } catch {
      setEndpointRegistered(false);
    }
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void refresh();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [refresh]);

  useEffect(() => {
    const body = preferenceTimezoneRefresh(stored, readBrowserIanaTimeZone());
    if (!body) return;
    let cancelled = false;
    void authedWrite("/api/notifications/preferences", "PUT", body).then(
      (result) => {
        if (!cancelled && result === "ok") {
          setStored({ enabled: body.enabled, ianaTimezone: body.ianaTimezone });
        }
      }
    );
    return () => {
      cancelled = true;
    };
  }, [stored]);

  const state: DeviceNotificationState = classifyDeviceNotification({
    ...support,
    vapidReady: Boolean(vapidKey),
    localSubscription,
    endpointRegistered,
  });

  async function onEnable() {
    setBusy(true);
    setNote(null);
    const result = await enableNotificationsOnDevice({
      supported: support.notificationSupported && support.pushSupported,
      vapidKey: () => vapidKey,
      requestPermission: () => Notification.requestPermission(),
      existingSubscription: heldFromRegistration,
      subscribe: async (applicationServerKey) => {
        const registration = await currentRegistration();
        if (!registration) return null;
        const key = new ArrayBuffer(applicationServerKey.byteLength);
        new Uint8Array(key).set(applicationServerKey);
        const subscription = await registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: key,
        });
        return subscriptionFromBrowser({
          endpoint: subscription.endpoint,
          p256dh: subscription.getKey("p256dh"),
          auth: subscription.getKey("auth"),
          unsubscribe: async () => {
            await subscription.unsubscribe();
          },
        });
      },
      browserTimeZone: () => readBrowserIanaTimeZone(),
      savePreference: (body) =>
        authedWrite("/api/notifications/preferences", "PUT", body),
      registerSubscription: (body) =>
        authedWrite("/api/notifications/subscriptions", "POST", body),
    });
    if (!result.ok) setNote(failureMessage(result.reason));
    await refresh();
    setBusy(false);
  }

  async function onDisable() {
    setBusy(true);
    setNote(null);
    const result = await disableNotificationsOnDevice({
      existingSubscription: heldFromRegistration,
      removeSubscription: (endpoint) =>
        authedWrite("/api/notifications/subscriptions", "DELETE", { endpoint }),
    });
    if (!result.ok) setNote(failureMessage(result.reason));
    await refresh();
    setBusy(false);
  }

  return (
    <div className="space-y-2 rounded-lg border border-slate-800 px-3 py-3">
      <p className="text-sm text-slate-200">{deviceNotificationLabel(state)}</p>
      {state === "enabled-on-device" ? (
        <p className="text-xs leading-relaxed text-slate-400">
          Wealth Engine is not sending notifications yet.
        </p>
      ) : null}
      {note ? (
        <p className="text-xs leading-relaxed text-slate-400">{note}</p>
      ) : null}
      {state === "not-enabled" ? (
        <Button
          type="button"
          variant="outline"
          className="w-full"
          onClick={() => void onEnable()}
          disabled={busy}
        >
          Enable on this device
        </Button>
      ) : null}
      {state === "enabled-on-device" ? (
        <Button
          type="button"
          variant="outline"
          className="w-full"
          onClick={() => void onDisable()}
          disabled={busy}
        >
          Turn off this device
        </Button>
      ) : null}
    </div>
  );
}
