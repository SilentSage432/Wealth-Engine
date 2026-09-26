import { readFileSync, readdirSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { NextResponse } from "next/server";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  IANA_TIMEZONE_MAX_LENGTH,
  PUSH_ENDPOINT_MAX_LENGTH,
  PUSH_KEY_MAX_LENGTH,
  isIanaTimeZone,
  parsePreferenceInput,
  parsePushEndpoint,
  parsePushKey,
  parseSubscriptionInput,
} from "@/lib/babylon/notification-config";
import {
  endpointQuery,
  getNotificationConfiguration,
  registerPushSubscription,
  removePushSubscription,
  saveNotificationPreference,
  type NotificationStore,
} from "@/lib/babylon/notification-records";
import { CLOUD_VAULT_DATA_KEYS, CLOUD_VAULT_SCHEMA_VERSION } from "@/lib/babylon/cloud-vault";
import { requireAuthenticatedUser } from "@/lib/supabase/server";

const ENDPOINT = "https://push.example.test/subscription/device-1";
const P256DH = "BElG".padEnd(80, "A");
const AUTH_SECRET = "secretAuthKey_12";

function throwingStore(): NotificationStore {
  const fail = async () => {
    throw new Error("unexpected store call");
  };
  return {
    readPreference: fail,
    writePreference: fail,
    findOwnEndpoint: fail,
    updateOwnSubscriptionKeys: fail,
    insertSubscription: fail,
    deleteOwnSubscription: fail,
  };
}

describe("IANA timezone validation", () => {
  it("accepts America/Denver and UTC", () => {
    expect(isIanaTimeZone("America/Denver")).toBe(true);
    expect(isIanaTimeZone("UTC")).toBe(true);
  });

  it("rejects empty, invalid, and offset-only values", () => {
    expect(isIanaTimeZone("")).toBe(false);
    expect(isIanaTimeZone("   ")).toBe(false);
    expect(isIanaTimeZone("Not/AZone")).toBe(false);
    expect(isIanaTimeZone("-06:00")).toBe(false);
    expect(isIanaTimeZone("UTC-6")).toBe(false);
    expect(isIanaTimeZone("GMT-7")).toBe(false);
    expect(isIanaTimeZone("A".repeat(IANA_TIMEZONE_MAX_LENGTH + 1))).toBe(false);
  });

  it("does not fall back to the runtime zone", () => {
    const source = readFileSync("lib/babylon/notification-config.ts", "utf8");
    expect(source).not.toContain("resolvedOptions");
    expect(isIanaTimeZone("")).toBe(false);
  });
});

describe("push subscription input", () => {
  it("accepts an https endpoint and non-empty keys", () => {
    expect(parsePushEndpoint(ENDPOINT)).toBe(ENDPOINT);
    expect(parsePushKey(P256DH)).toBe(P256DH);
    expect(parsePushKey(AUTH_SECRET)).toBe(AUTH_SECRET);
  });

  it("rejects malformed endpoints and keys", () => {
    expect(parsePushEndpoint("")).toBeNull();
    expect(parsePushEndpoint("http://push.example.test/device")).toBeNull();
    expect(parsePushEndpoint("https://user:pass@push.example.test/device")).toBeNull();
    expect(parsePushEndpoint(`${"https://push.example.test/"}${"a".repeat(PUSH_ENDPOINT_MAX_LENGTH)}`)).toBeNull();
    expect(parsePushKey("")).toBeNull();
    expect(parsePushKey("   ")).toBeNull();
    expect(parsePushKey("has space")).toBeNull();
    expect(parsePushKey("B".repeat(PUSH_KEY_MAX_LENGTH + 1))).toBeNull();
    expect(
      parseSubscriptionInput({
        endpoint: "http://insecure.example/push",
        p256dh: P256DH,
        auth: AUTH_SECRET,
      })
    ).toBeNull();
  });
});

describe("authenticated notification operations", () => {
  it("fails closed when no bearer token is present", async () => {
    const previous = {
      url: process.env.NEXT_PUBLIC_SUPABASE_URL,
      anon: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
      publishable: process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
    };
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.supabase.co";
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "anon-test";
    delete process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
    try {
      const response = await requireAuthenticatedUser(
        new Request("https://wealth.example/api/notifications")
      );
      expect(response).toBeInstanceOf(NextResponse);
      if (response instanceof NextResponse) {
        expect(response.status).toBe(401);
      }
    } finally {
      restoreEnv("NEXT_PUBLIC_SUPABASE_URL", previous.url);
      restoreEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", previous.anon);
      restoreEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", previous.publishable);
    }
  });

  it("reads and writes the preference for the session user", async () => {
    const seen: string[] = [];
    const store = throwingStore();
    store.readPreference = async (userId) => {
      seen.push(userId);
      return { ok: true, preference: null };
    };
    store.writePreference = async (userId, preference) => {
      seen.push(`${userId}:${preference.enabled}:${preference.ianaTimezone}`);
      return { ok: true };
    };

    const missing = await getNotificationConfiguration({
      userId: "session-user",
      endpoint: null,
      store,
    });
    expect(missing).toEqual({
      status: 200,
      body: { enabled: null, ianaTimezone: null, endpointRegistered: null },
    });

    const saved = await saveNotificationPreference({
      userId: "session-user",
      body: {
        user_id: "other-user",
        enabled: true,
        ianaTimezone: "America/Denver",
      },
      store,
    });
    expect(saved).toEqual({
      status: 200,
      body: { enabled: true, ianaTimezone: "America/Denver" },
    });
    expect(seen).toEqual([
      "session-user",
      "session-user:true:America/Denver",
    ]);
    expect(parsePreferenceInput({ enabled: "true", ianaTimezone: "UTC" })).toBeNull();

    const rejected = await saveNotificationPreference({
      userId: "session-user",
      body: { enabled: true, ianaTimezone: "" },
      store,
    });
    expect(rejected.status).toBe(400);
    expect(endpointQuery(null)).toBeNull();
    expect(endpointQuery("http://push.example.test/device")).toBe("invalid");
  });

  it("updates a repeated endpoint instead of inserting another row", async () => {
    const calls: string[] = [];
    const store = throwingStore();
    store.findOwnEndpoint = async (userId) => {
      calls.push(`find:${userId}`);
      return { ok: true, found: true };
    };
    store.updateOwnSubscriptionKeys = async (userId) => {
      calls.push(`update:${userId}`);
      return { ok: true };
    };
    store.insertSubscription = async () => {
      calls.push("insert");
      return { ok: true };
    };

    const result = await registerPushSubscription({
      userId: "session-user",
      body: {
        user_id: "other-user",
        endpoint: ENDPOINT,
        p256dh: P256DH,
        auth: AUTH_SECRET,
      },
      store,
    });
    expect(result.status).toBe(200);
    expect(result.body).toEqual({ registered: true });
    expect(calls).toEqual(["find:session-user", "update:session-user"]);
    expect(JSON.stringify(result.body)).not.toContain(P256DH);
    expect(JSON.stringify(result.body)).not.toContain(AUTH_SECRET);
  });

  it("refuses an endpoint owned by someone else without returning secrets", async () => {
    const store = throwingStore();
    store.findOwnEndpoint = async () => ({ ok: true, found: false });
    store.insertSubscription = async (userId) => {
      expect(userId).toBe("session-user");
      return { ok: false, conflict: true };
    };

    const result = await registerPushSubscription({
      userId: "session-user",
      body: { endpoint: ENDPOINT, p256dh: P256DH, auth: AUTH_SECRET },
      store,
    });
    expect(result.status).toBe(409);
    expect(result.body).toEqual({
      error: "That endpoint is already registered.",
    });
    expect(JSON.stringify(result.body)).not.toContain(ENDPOINT);
    expect(JSON.stringify(result.body)).not.toContain(P256DH);
    expect(JSON.stringify(result.body)).not.toContain(AUTH_SECRET);
  });

  it("removes only the session user's endpoint", async () => {
    const seen: string[] = [];
    const store = throwingStore();
    store.deleteOwnSubscription = async (userId, endpoint) => {
      seen.push(`${userId}:${endpoint}`);
      return { ok: true };
    };
    const result = await removePushSubscription({
      userId: "session-user",
      body: { user_id: "other-user", endpoint: ENDPOINT },
      store,
    });
    expect(result).toEqual({ status: 200, body: { removed: true } });
    expect(seen).toEqual([`session-user:${ENDPOINT}`]);
  });

  it("rejects a malformed subscription before touching the store", async () => {
    const store = throwingStore();
    const result = await registerPushSubscription({
      userId: "session-user",
      body: { endpoint: "not-a-url", p256dh: "", auth: AUTH_SECRET },
      store,
    });
    expect(result.status).toBe(400);
    expect(JSON.stringify(result.body)).not.toContain(AUTH_SECRET);
  });
});

describe("notification migration contract", () => {
  const sql = readFileSync(
    "supabase/migrations/20260929_notification_foundation.sql",
    "utf8"
  );
  const vault = readFileSync(
    "supabase/migrations/20260925_wealth_engine_vault.sql",
    "utf8"
  );

  it("keeps one preference per user and one row per endpoint", () => {
    expect(sql).toContain(
      "user_id uuid PRIMARY KEY REFERENCES auth.users (id) ON DELETE CASCADE"
    );
    expect(sql).toContain(
      "CONSTRAINT push_subscriptions_endpoint_unique UNIQUE (endpoint)"
    );
    expect(sql).toContain("REFERENCES auth.users (id) ON DELETE CASCADE");
    expect(sql).toContain("enabled boolean NOT NULL");
  });

  it("enables owner RLS and does not grant anonymous access", () => {
    expect(sql.match(/ENABLE ROW LEVEL SECURITY/g)).toHaveLength(2);
    expect(sql.match(/auth\.uid\(\) = user_id/g)).toHaveLength(10);
    expect(sql).toContain("GRANT ALL ON TABLE public.notification_preferences TO service_role");
    expect(sql).toContain("GRANT ALL ON TABLE public.push_subscriptions TO service_role");
    expect(sql).not.toContain("TO anon");
    expect(sql).not.toContain("USING (true)");
  });

  it("stores no financial document and no delivery history", () => {
    expect(sql).not.toContain("notification_deliveries");
    expect(sql).not.toContain("vault_data");
    expect(sql).not.toContain("wealth_engine_vaults");
    expect(sql).not.toContain("plaid_");
    expect(vault).not.toContain("notification_preferences");
    expect(vault).not.toContain("push_subscriptions");
    for (const file of readdirSync("supabase/migrations")) {
      const text = readFileSync(resolve("supabase/migrations", file), "utf8");
      expect(text).not.toContain("CREATE TABLE public.notification_deliveries");
    }
  });

  it("hides subscription key columns from authenticated select", () => {
    expect(sql).toContain(
      "GRANT SELECT (id, user_id, endpoint, created_at, updated_at)"
    );
    expect(sql).not.toContain("GRANT SELECT (id, user_id, endpoint, p256dh, auth");
  });
});

describe("notification tranche boundaries", () => {
  const config = readFileSync("lib/babylon/notification-config.ts", "utf8");
  const records = readFileSync("lib/babylon/notification-records.ts", "utf8");
  const store = readFileSync("lib/babylon/notification-store.ts", "utf8");
  const routes = [
    "app/api/notifications/route.ts",
    "app/api/notifications/preferences/route.ts",
    "app/api/notifications/subscriptions/route.ts",
  ].map((file) => readFileSync(file, "utf8"));
  const server = readFileSync("lib/supabase/server.ts", "utf8");

  it("authenticates with the caller JWT and not the service role", () => {
    expect(store.indexOf("requireAuthenticatedUser")).toBeLessThan(
      store.indexOf("createSupabaseNotificationStore")
    );
    expect(store).toContain("createUserSupabaseClient");
    expect(store).not.toContain("getSupabaseServiceClient");
    expect(store).not.toContain("SUPABASE_SERVICE_ROLE_KEY");
    const userClient = server.slice(
      server.indexOf("export function createUserSupabaseClient"),
      server.indexOf("export function getSupabaseServiceClient")
    );
    expect(userClient).toContain("env.anonKey");
    expect(userClient).toContain("Authorization");
    expect(userClient).not.toContain("SERVICE_ROLE");
    for (const route of routes) {
      expect(route).toContain("bindNotificationSession");
      expect(route).toContain("session.userId");
      expect(route).not.toContain("getSupabaseServiceClient");
      expect(route).not.toContain("user_id");
    }
  });

  it("does not return subscription secrets from status reads", () => {
    expect(store).toContain('.select("enabled, iana_timezone")');
    expect(store).toContain('.select("user_id")');
    expect(store).toContain('.select("endpoint")');
    expect(store).not.toContain('.select("p256dh');
    expect(store).not.toContain('.select("auth');
    expect(store).not.toContain("error.message");
    expect(store).not.toContain("console.log");
  });

  it("does not send, schedule, subscribe, or touch financial authority", () => {
    const joined = [config, records, store, ...routes].join("\n");
    expect(joined).not.toContain("Notification.requestPermission");
    expect(joined).not.toContain("pushManager");
    expect(joined).not.toContain("web-push");
    expect(joined).not.toContain("VAPID");
    expect(joined).not.toContain("CRON_SECRET");
    expect(joined).not.toContain("deriveDueAttention");
    expect(joined).not.toContain("deriveMonthCloseAttention");
    expect(joined).not.toContain("wealth_engine_vaults");
    expect(joined).not.toContain("plaid");
    expect(joined).not.toContain("from \"@/lib/babylon/attention");

    expect(readFileSync("package.json", "utf8")).not.toContain("web-push");
    expect(readFileSync(".env.example", "utf8")).not.toContain("VAPID");
    expect(existsSync("vercel.json")).toBe(false);
    expect(existsSync("supabase/functions")).toBe(false);

    const worker = readFileSync("public/sw.js", "utf8");
    expect(worker).not.toContain("notificationclick");
    expect(worker).not.toContain("showNotification");
    expect(worker).not.toContain('addEventListener("push"');
    expect(worker).toContain('const CACHE_NAME = "babylon-engine-v2"');

    const attention = readFileSync("lib/babylon/attention.ts", "utf8");
    expect(attention).not.toContain("notification");
    expect(attention).toContain("export function deriveDueAttention");
    expect(attention).toContain("export function deriveMonthCloseAttention");
    expect(CLOUD_VAULT_SCHEMA_VERSION).toBe(5);
    expect(CLOUD_VAULT_DATA_KEYS).not.toContain("ianaTimezone");
    expect(CLOUD_VAULT_DATA_KEYS.join(",")).not.toContain("notification");
  });
});

function restoreEnv(name: string, value: string | undefined) {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}

afterEach(() => {
  vi.restoreAllMocks();
});
