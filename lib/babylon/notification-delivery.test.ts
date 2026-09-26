import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { EMPTY_STATE } from "@/lib/babylon/constants";
import {
  GENERIC_NOTIFICATION_BODY,
  GENERIC_NOTIFICATION_TITLE,
} from "@/lib/babylon/notification-device";
import {
  addCivilDays,
  attentionKeysForState,
  authorizeCronRequest,
  civilDateInTimeZone,
  decideAttentionDelivery,
  DELIVERY_RETENTION_DAYS,
  deliveryRetentionCutoff,
  dueAttentionKey,
  GENERIC_PUSH_PAYLOAD,
  isCanonicalSupabaseUrl,
  monthCloseAttentionKey,
  parseVapidSubject,
  readSenderConfig,
} from "@/lib/babylon/notification-delivery";
import type { ExpenseEntry, PersistedState, RecurringObligation } from "@/types/babylon";

function publicKey(): string {
  const bytes = new Uint8Array(65);
  bytes[0] = 0x04;
  for (let index = 1; index < bytes.length; index += 1) bytes[index] = index;
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function expense(partial: Partial<ExpenseEntry> = {}): ExpenseEntry {
  return {
    id: "exp-rent",
    name: "Rent",
    category: "need",
    amount: 1200,
    date: "2026-01-14",
    dueDate: "2026-01-14",
    isSettled: false,
    ...partial,
  };
}

function rule(): RecurringObligation {
  return {
    id: "phone-rule",
    name: "Phone",
    amount: 85,
    category: "need",
    budgetCategoryId: "utilities",
    dueDay: 10,
    startMonth: "2026-01",
    isActive: true,
    createdAt: "2026-01-01",
    skippedMonths: [],
  };
}

function state(partial: Partial<PersistedState> = {}): PersistedState {
  return {
    ...EMPTY_STATE,
    expenses: [],
    recurringObligations: [],
    ...partial,
  };
}

describe("civil date", () => {
  it("uses the stored IANA zone instead of the UTC date", () => {
    const now = new Date("2026-01-15T06:30:00.000Z");
    expect(civilDateInTimeZone(now, "America/Boise")).toBe("2026-01-14");
    expect(civilDateInTimeZone(now, "America/New_York")).toBe("2026-01-15");
    expect(now.toISOString().slice(0, 10)).toBe("2026-01-15");
  });

  it("follows daylight-saving transitions through the IANA zone", () => {
    const beforeSpring = new Date("2026-03-08T06:30:00.000Z");
    expect(civilDateInTimeZone(beforeSpring, "America/Boise")).toBe("2026-03-07");
    const summer = new Date("2026-07-15T05:30:00.000Z");
    expect(civilDateInTimeZone(summer, "America/Boise")).toBe("2026-07-14");
    const beforeFall = new Date("2026-11-01T05:30:00.000Z");
    expect(civilDateInTimeZone(beforeFall, "America/Denver")).toBe("2026-10-31");
  });

  it("fails closed for an absent or invalid timezone", () => {
    const now = new Date("2026-01-15T06:30:00.000Z");
    expect(civilDateInTimeZone(now, "")).toBeNull();
    expect(civilDateInTimeZone(now, "UTC-7")).toBeNull();
    expect(civilDateInTimeZone(now, "America/NotARealZone")).toBeNull();
  });
});

describe("attention keys", () => {
  it("keeps one-off, recurring, and month-close identities free of financial text", () => {
    expect(dueAttentionKey({ expenseId: "exp-rent" })).toBe("due:exp-rent");
    expect(
      dueAttentionKey({
        expenseId: "memory-0",
        recurringObligationId: "phone-rule",
        recurrenceMonth: "2026-01",
      })
    ).toBe("due:phone-rule:2026-01");
    expect(monthCloseAttentionKey("2026-01")).toBe("month-close:2026-01");
    const keys = [
      dueAttentionKey({ expenseId: "exp-rent" }),
      dueAttentionKey({
        expenseId: "memory-0",
        recurringObligationId: "phone-rule",
        recurrenceMonth: "2026-01",
      }),
      monthCloseAttentionKey("2026-01"),
    ].join(" ");
    expect(keys).not.toContain("Rent");
    expect(keys).not.toContain("Phone");
    expect(keys).not.toContain("1200");
    expect(keys).not.toContain("85");
  });
});

describe("daily delivery", () => {
  const now = new Date("2026-01-15T18:00:00.000Z");

  it("does not send the same subject twice after success on that civil date", async () => {
    const vault = state({ expenses: [expense()] });
    const sends: string[] = [];
    const first = await decideAttentionDelivery({
      now,
      timeZone: "America/Boise",
      state: vault,
      succeededToday: new Set(),
      endpoints: [{ id: "device-a" }],
      send: async (id) => {
        sends.push(id);
        return { ok: true, permanent: false };
      },
    });
    expect(first.sent).toBe(true);
    expect(first.coveredKeys).toEqual(["due:exp-rent"]);
    const second = await decideAttentionDelivery({
      now,
      timeZone: "America/Boise",
      state: vault,
      succeededToday: new Set(first.coveredKeys),
      endpoints: [{ id: "device-a" }],
      send: async () => {
        throw new Error("should not send");
      },
    });
    expect(second.sent).toBe(false);
    expect(second.coveredKeys).toEqual([]);
    expect(sends).toEqual(["device-a"]);
  });

  it("allows the same unresolved subject on the next civil date", async () => {
    const next = await decideAttentionDelivery({
      now: new Date("2026-01-16T18:00:00.000Z"),
      timeZone: "America/Boise",
      state: state({ expenses: [expense()] }),
      succeededToday: new Set(),
      endpoints: [{ id: "device-a" }],
      send: async () => ({ ok: true, permanent: false }),
    });
    expect(next.civilDate).toBe("2026-01-16");
    expect(next.coveredKeys).toEqual(["due:exp-rent"]);
  });

  it("leaves a failed attempt retryable", async () => {
    const vault = state({ expenses: [expense()] });
    const failed = await decideAttentionDelivery({
      now,
      timeZone: "America/Boise",
      state: vault,
      succeededToday: new Set(),
      endpoints: [{ id: "device-a" }],
      send: async () => ({ ok: false, permanent: false }),
    });
    expect(failed.sent).toBe(false);
    expect(failed.failureCode).toBe("transient");
    expect(failed.coveredKeys).toEqual([]);
    const retry = await decideAttentionDelivery({
      now,
      timeZone: "America/Boise",
      state: vault,
      succeededToday: new Set(),
      endpoints: [{ id: "device-a" }],
      send: async () => ({ ok: true, permanent: false }),
    });
    expect(retry.sent).toBe(true);
  });

  it("covers several subjects with one send per endpoint", async () => {
    const calls: string[] = [];
    const decision = await decideAttentionDelivery({
      now: new Date("2026-01-31T18:00:00.000Z"),
      timeZone: "America/Boise",
      state: state({
        expenses: [
          expense(),
          expense({ id: "exp-power", name: "Power", amount: 40, dueDate: "2026-01-20" }),
        ],
        lastClosedMonthKey: null,
      }),
      succeededToday: new Set(),
      endpoints: [{ id: "device-a" }, { id: "device-b" }],
      send: async (id) => {
        calls.push(id);
        return { ok: id === "device-b", permanent: false };
      },
    });
    expect(calls).toEqual(["device-a", "device-b"]);
    expect(decision.sent).toBe(true);
    expect(decision.coveredKeys).toEqual([
      "due:exp-rent",
      "due:exp-power",
      "month-close:2026-01",
    ]);
  });

  it("removes only permanently invalid endpoints and keeps the preference untouched", async () => {
    const removed: string[] = [];
    const decision = await decideAttentionDelivery({
      now,
      timeZone: "America/Boise",
      state: state({ expenses: [expense()] }),
      succeededToday: new Set(),
      endpoints: [{ id: "gone" }, { id: "live" }],
      send: async (id) => {
        if (id === "gone") return { ok: false, permanent: true };
        return { ok: true, permanent: false };
      },
    });
    removed.push(...decision.removeEndpointIds);
    expect(removed).toEqual(["gone"]);
    expect(decision.sent).toBe(true);
    expect(decision.coveredKeys).toEqual(["due:exp-rent"]);
  });

  it("does not mark success when every endpoint fails or none remain", async () => {
    const transient = await decideAttentionDelivery({
      now,
      timeZone: "America/Boise",
      state: state({ expenses: [expense()] }),
      succeededToday: new Set(),
      endpoints: [{ id: "a" }, { id: "b" }],
      send: async () => ({ ok: false, permanent: false }),
    });
    expect(transient.sent).toBe(false);
    expect(transient.failureCode).toBe("transient");
    expect(transient.removeEndpointIds).toEqual([]);
    const empty = await decideAttentionDelivery({
      now,
      timeZone: "America/Boise",
      state: state({ expenses: [expense()] }),
      succeededToday: new Set(),
      endpoints: [],
      send: async () => {
        throw new Error("should not send");
      },
    });
    expect(empty.sent).toBe(false);
    expect(empty.failureCode).toBe("no-endpoint");
    const expired = await decideAttentionDelivery({
      now,
      timeZone: "America/Boise",
      state: state({ expenses: [expense()] }),
      succeededToday: new Set(),
      endpoints: [{ id: "gone" }],
      send: async () => ({ ok: false, permanent: true }),
    });
    expect(expired.sent).toBe(false);
    expect(expired.failureCode).toBe("no-endpoint");
    expect(expired.removeEndpointIds).toEqual(["gone"]);
  });
});

describe("recurring obligations and month close", () => {
  it("materializes the current occurrence in memory and keeps the vault unchanged", () => {
    const vault = state({ recurringObligations: [rule()], expenses: [] });
    const before = structuredClone(vault);
    const keys = attentionKeysForState(vault, "2026-01-20");
    expect(keys).toContain("due:phone-rule:2026-01");
    expect(keys.join(" ")).not.toContain("memory-");
    expect(keys.join(" ")).not.toContain("Phone");
    expect(vault).toEqual(before);
  });

  it("uses the existing month-close condition only", () => {
    const open = state({ lastClosedMonthKey: null });
    expect(attentionKeysForState(open, "2026-01-31")).toContain("month-close:2026-01");
    expect(attentionKeysForState(open, "2026-01-30")).not.toContain("month-close:2026-01");
    expect(
      attentionKeysForState(
        state({ lastClosedMonthKey: "2026-01" }),
        "2026-01-31"
      )
    ).not.toContain("month-close:2026-01");
  });
});

describe("privacy, retention, and authorization", () => {
  it("sends an empty payload and keeps the fixed service-worker copy", () => {
    expect(GENERIC_PUSH_PAYLOAD).toBeNull();
    const sender = readFileSync("lib/babylon/notification-sender.ts", "utf8");
    expect(sender).toContain("GENERIC_PUSH_PAYLOAD");
    expect(sender).not.toContain("amount");
    expect(sender).not.toContain("console.log");
    const worker = readFileSync("public/sw.js", "utf8");
    expect(worker).toContain(GENERIC_NOTIFICATION_TITLE);
    expect(worker).toContain(GENERIC_NOTIFICATION_BODY);
    expect(worker).not.toContain("event.data");
  });

  it("retains fourteen civil days and authorizes only an exact cron bearer", () => {
    expect(DELIVERY_RETENTION_DAYS).toBe(14);
    expect(deliveryRetentionCutoff("2026-01-20")).toBe("2026-01-06");
    expect(addCivilDays("2026-03-01", -1)).toBe("2026-02-28");
    const secret = "cron-secret-value";
    expect(authorizeCronRequest(null, secret)).toBe(false);
    expect(authorizeCronRequest("Bearer wrong-secret-value", secret)).toBe(false);
    expect(authorizeCronRequest("Bearer cron-secret-value", secret)).toBe(true);
    expect(authorizeCronRequest("Bearer cron-secret-value", "short")).toBe(false);
    expect(authorizeCronRequest("Bearer cron-secret-value", undefined)).toBe(false);
  });

  it("accepts only the canonical project and an https VAPID subject", () => {
    expect(
      isCanonicalSupabaseUrl("https://nklmgzxxdhuvqayhcigp.supabase.co")
    ).toBe(true);
    expect(
      isCanonicalSupabaseUrl("https://bsddcwkhkmxdcuimzzgr.supabase.co")
    ).toBe(false);
    expect(parseVapidSubject("https://wealth-engine-zeta.vercel.app")).toBe(
      "https://wealth-engine-zeta.vercel.app"
    );
    expect(parseVapidSubject("mailto:steward@example.com")).toBeNull();
    expect(
      readSenderConfig({
        publicKey: publicKey(),
        privateKey: "a".repeat(43),
        subject: "https://wealth-engine-zeta.vercel.app",
      })?.subject
    ).toBe("https://wealth-engine-zeta.vercel.app");
    expect(
      readSenderConfig({
        publicKey: publicKey(),
        privateKey: "a".repeat(43),
        subject: undefined,
      })
    ).toBeNull();
  });
});

describe("repository boundary", () => {
  const evaluator = readFileSync("lib/babylon/notification-evaluator.ts", "utf8");
  const evaluateRoute = readFileSync(
    "app/api/notifications/evaluate/route.ts",
    "utf8"
  );
  const testRoute = readFileSync("app/api/notifications/test/route.ts", "utf8");
  const delivery = readFileSync("lib/babylon/notification-delivery.ts", "utf8");
  const migration = readFileSync(
    "supabase/migrations/20260930_notification_deliveries.sql",
    "utf8"
  );

  it("reuses Attention and does not write financial or Plaid state", () => {
    expect(delivery).toContain("deriveDueAttention");
    expect(delivery).toContain("deriveMonthCloseAttention");
    expect(delivery).toContain("materializeRecurringObligations");
    expect(evaluator).toContain("parseCloudVaultData");
    expect(evaluator).toContain('.select("schema_version, vault_data")');
    expect(evaluator).not.toContain(".update(");
    expect(evaluator).not.toContain("plaid");
    expect(evaluator).not.toContain("revision");
    expect(evaluator).toContain("notification_deliveries");
    expect(delivery).not.toContain("deriveBudget");
    expect(readFileSync("lib/babylon/attention.ts", "utf8")).not.toContain(
      "notification_deliveries"
    );
  });

  it("keeps the scheduler, transport test, and migration inside their boundaries", () => {
    expect(evaluateRoute).toContain("authorizeCronRequest");
    expect(evaluateRoute).toContain("isCanonicalSupabaseUrl");
    expect(evaluateRoute).not.toContain("request.json");
    expect(testRoute).toContain("requireAuthenticatedUser");
    expect(testRoute).toContain("sendOwnedTransportTest");
    expect(testRoute).toContain("request.text");
    expect(testRoute).not.toContain("wealth_engine_vaults");
    expect(testRoute).not.toContain("notification_deliveries");
    expect(evaluator).toContain("sendOwnedTransportTest");
    const testFn = evaluator.slice(evaluator.indexOf("export async function sendOwnedTransportTest"));
    expect(testFn).not.toContain("notification_deliveries");
    expect(testFn).not.toContain("wealth_engine_vaults");
    expect(migration).toContain("WHERE status = 'succeeded'");
    expect(migration).not.toContain("p256dh");
    expect(migration).not.toContain("push_subscriptions");
    expect(migration).not.toContain("GRANT SELECT");
    const vercel = readFileSync("vercel.json", "utf8");
    expect(vercel).toContain('"/api/notifications/evaluate"');
    expect(vercel).toContain('"0 15 * * *"');
    expect(vercel).not.toContain("pg_cron");
    expect(readFileSync("package.json", "utf8")).toContain('"web-push"');
    expect(readFileSync("next.config.ts", "utf8")).toContain("web-push");
  });
});
