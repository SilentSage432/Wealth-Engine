/**
 * Owner-scoped notification rows. Uses the caller's JWT client so RLS applies.
 * Does not read the financial vault and does not send Web Push.
 */

import "server-only";

import { NextResponse } from "next/server";
import {
  isIanaTimeZone,
  type SubscriptionInput,
} from "@/lib/babylon/notification-config";
import type { NotificationStore } from "@/lib/babylon/notification-records";
import {
  createUserSupabaseClient,
  requireAuthenticatedUser,
  type BabylonServerSupabase,
} from "@/lib/supabase/server";

function logStoreFailure(action: string, code: string | undefined): void {
  console.error(`[notifications] ${action} failed`, code ?? "unknown");
}

function isUniqueViolation(code: string | undefined): boolean {
  return code === "23505";
}

export function createSupabaseNotificationStore(
  client: BabylonServerSupabase
): NotificationStore {
  return {
    async readPreference(userId) {
      const { data, error } = await client
        .from("notification_preferences")
        .select("enabled, iana_timezone")
        .eq("user_id", userId)
        .maybeSingle();
      if (error) {
        logStoreFailure("read preference", error.code);
        return { ok: false };
      }
      if (!data) return { ok: true, preference: null };
      if (typeof data.enabled !== "boolean") return { ok: false };
      const ianaTimezone = data.iana_timezone.trim();
      if (!isIanaTimeZone(ianaTimezone)) return { ok: false };
      return {
        ok: true,
        preference: {
          enabled: data.enabled,
          ianaTimezone,
        },
      };
    },

    async writePreference(userId, preference) {
      const existing = await client
        .from("notification_preferences")
        .select("user_id")
        .eq("user_id", userId)
        .maybeSingle();
      if (existing.error) {
        logStoreFailure("read preference before write", existing.error.code);
        return { ok: false };
      }

      if (existing.data) {
        const updated = await client
          .from("notification_preferences")
          .update({
            enabled: preference.enabled,
            iana_timezone: preference.ianaTimezone,
          })
          .eq("user_id", userId);
        if (updated.error) {
          logStoreFailure("update preference", updated.error.code);
          return { ok: false };
        }
        return { ok: true };
      }

      const inserted = await client.from("notification_preferences").insert({
        user_id: userId,
        enabled: preference.enabled,
        iana_timezone: preference.ianaTimezone,
      });
      if (!inserted.error) return { ok: true };
      if (!isUniqueViolation(inserted.error.code)) {
        logStoreFailure("insert preference", inserted.error.code);
        return { ok: false };
      }

      const raced = await client
        .from("notification_preferences")
        .update({
          enabled: preference.enabled,
          iana_timezone: preference.ianaTimezone,
        })
        .eq("user_id", userId);
      if (raced.error) {
        logStoreFailure("update preference after insert race", raced.error.code);
        return { ok: false };
      }
      return { ok: true };
    },

    async findOwnEndpoint(userId, endpoint) {
      const { data, error } = await client
        .from("push_subscriptions")
        .select("endpoint")
        .eq("user_id", userId)
        .eq("endpoint", endpoint)
        .maybeSingle();
      if (error) {
        logStoreFailure("read subscription", error.code);
        return { ok: false };
      }
      return { ok: true, found: Boolean(data) };
    },

    async updateOwnSubscriptionKeys(userId, subscription) {
      const { error } = await client
        .from("push_subscriptions")
        .update(keyUpdate(subscription))
        .eq("user_id", userId)
        .eq("endpoint", subscription.endpoint);
      if (error) {
        logStoreFailure("update subscription", error.code);
        return { ok: false };
      }
      return { ok: true };
    },

    async insertSubscription(userId, subscription) {
      const { error } = await client.from("push_subscriptions").insert({
        user_id: userId,
        endpoint: subscription.endpoint,
        p256dh: subscription.p256dh,
        auth: subscription.auth,
      });
      if (!error) return { ok: true };
      if (isUniqueViolation(error.code)) return { ok: false, conflict: true };
      logStoreFailure("insert subscription", error.code);
      return { ok: false, conflict: false };
    },

    async deleteOwnSubscription(userId, endpoint) {
      const { error } = await client
        .from("push_subscriptions")
        .delete()
        .eq("user_id", userId)
        .eq("endpoint", endpoint);
      if (error) {
        logStoreFailure("delete subscription", error.code);
        return { ok: false };
      }
      return { ok: true };
    },
  };
}

function keyUpdate(subscription: SubscriptionInput): {
  p256dh: string;
  auth: string;
} {
  return { p256dh: subscription.p256dh, auth: subscription.auth };
}

/**
 * Session owner for notification routes. Missing auth fails closed.
 * The service-role client is intentionally not used here.
 */
export async function bindNotificationSession(
  request: Request
): Promise<{ userId: string; store: NotificationStore } | NextResponse> {
  const auth = await requireAuthenticatedUser(request);
  if (auth instanceof NextResponse) return auth;

  const client = createUserSupabaseClient(auth.accessToken);
  if (!client) {
    return NextResponse.json(
      { error: "Account sign-in is not configured." },
      { status: 503 }
    );
  }

  return {
    userId: auth.user.id,
    store: createSupabaseNotificationStore(client),
  };
}
