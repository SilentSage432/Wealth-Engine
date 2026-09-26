/**
 * Authenticated notification configuration.
 * The caller supplies the session user id. Request bodies cannot choose it.
 * This module does not send pushes or read the financial vault.
 */

import {
  parsePreferenceInput,
  parsePushEndpoint,
  parseRemovalInput,
  parseSubscriptionInput,
  type PreferenceInput,
  type SubscriptionInput,
} from "@/lib/babylon/notification-config";

export type NotificationPreference = PreferenceInput;

export type NotificationStore = {
  readPreference(
    userId: string
  ): Promise<
    { ok: true; preference: NotificationPreference | null } | { ok: false }
  >;
  writePreference(
    userId: string,
    preference: NotificationPreference
  ): Promise<{ ok: true } | { ok: false }>;
  findOwnEndpoint(
    userId: string,
    endpoint: string
  ): Promise<{ ok: true; found: boolean } | { ok: false }>;
  updateOwnSubscriptionKeys(
    userId: string,
    subscription: SubscriptionInput
  ): Promise<{ ok: true } | { ok: false }>;
  insertSubscription(
    userId: string,
    subscription: SubscriptionInput
  ): Promise<{ ok: true } | { ok: false; conflict: boolean }>;
  deleteOwnSubscription(
    userId: string,
    endpoint: string
  ): Promise<{ ok: true } | { ok: false }>;
};

export type NotificationResponse = {
  status: number;
  body: Record<string, unknown>;
};

function unavailable(): NotificationResponse {
  return {
    status: 503,
    body: { error: "Notification settings are unavailable." },
  };
}

/** Null when the query omitted an endpoint. "invalid" when the value is unusable. */
export function endpointQuery(value: string | null): string | null | "invalid" {
  if (value === null) return null;
  return parsePushEndpoint(value) ?? "invalid";
}

export async function getNotificationConfiguration(input: {
  userId: string;
  endpoint: string | null;
  store: NotificationStore;
}): Promise<NotificationResponse> {
  const preference = await input.store.readPreference(input.userId);
  if (!preference.ok) return unavailable();

  let endpointRegistered: boolean | null = null;
  if (input.endpoint) {
    const found = await input.store.findOwnEndpoint(
      input.userId,
      input.endpoint
    );
    if (!found.ok) return unavailable();
    endpointRegistered = found.found;
  }

  return {
    status: 200,
    body: {
      enabled: preference.preference?.enabled ?? null,
      ianaTimezone: preference.preference?.ianaTimezone ?? null,
      endpointRegistered,
    },
  };
}

export async function saveNotificationPreference(input: {
  userId: string;
  body: unknown;
  store: NotificationStore;
}): Promise<NotificationResponse> {
  const preference = parsePreferenceInput(input.body);
  if (!preference) {
    return {
      status: 400,
      body: { error: "enabled and a valid IANA timezone are required." },
    };
  }

  const written = await input.store.writePreference(input.userId, preference);
  if (!written.ok) return unavailable();

  return {
    status: 200,
    body: {
      enabled: preference.enabled,
      ianaTimezone: preference.ianaTimezone,
    },
  };
}

export async function registerPushSubscription(input: {
  userId: string;
  body: unknown;
  store: NotificationStore;
}): Promise<NotificationResponse> {
  const subscription = parseSubscriptionInput(input.body);
  if (!subscription) {
    return {
      status: 400,
      body: { error: "A valid push subscription is required." },
    };
  }

  const existing = await input.store.findOwnEndpoint(
    input.userId,
    subscription.endpoint
  );
  if (!existing.ok) return unavailable();

  if (existing.found) {
    const updated = await input.store.updateOwnSubscriptionKeys(
      input.userId,
      subscription
    );
    if (!updated.ok) return unavailable();
    return { status: 200, body: { registered: true } };
  }

  const inserted = await input.store.insertSubscription(
    input.userId,
    subscription
  );
  if (inserted.ok) return { status: 200, body: { registered: true } };
  if (!inserted.conflict) return unavailable();

  const raced = await input.store.findOwnEndpoint(
    input.userId,
    subscription.endpoint
  );
  if (!raced.ok) return unavailable();
  if (!raced.found) {
    return {
      status: 409,
      body: { error: "That endpoint is already registered." },
    };
  }

  const updated = await input.store.updateOwnSubscriptionKeys(
    input.userId,
    subscription
  );
  if (!updated.ok) return unavailable();
  return { status: 200, body: { registered: true } };
}

export async function removePushSubscription(input: {
  userId: string;
  body: unknown;
  store: NotificationStore;
}): Promise<NotificationResponse> {
  const removal = parseRemovalInput(input.body);
  if (!removal) {
    return {
      status: 400,
      body: { error: "A valid push endpoint is required." },
    };
  }

  const removed = await input.store.deleteOwnSubscription(
    input.userId,
    removal.endpoint
  );
  if (!removed.ok) return unavailable();
  return { status: 200, body: { removed: true } };
}
