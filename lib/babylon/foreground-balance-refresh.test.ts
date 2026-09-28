import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { NextResponse } from "next/server";
import {
  FOREGROUND_BALANCE_REFRESH_WINDOW_MS,
  foregroundBalanceRefreshApplied,
  hasUnseenBalanceItem,
  markUnseenBalanceItem,
  noteForegroundBalanceRefreshResult,
  planForegroundBalanceRefresh,
  resetForegroundBalanceRefreshSession,
} from "@/lib/babylon/foreground-balance-refresh";

vi.mock("server-only", () => ({}));

const requireAuthenticatedUser = vi.fn();
const getSupabaseServiceClient = vi.fn();
vi.mock("@/lib/supabase/server", () => ({
  requireAuthenticatedUser: (...args: unknown[]) => requireAuthenticatedUser(...args),
  getSupabaseServiceClient: () => getSupabaseServiceClient(),
}));

const recordPlaidRealtimeBalanceObservations = vi.fn();
vi.mock("@/lib/babylon/plaid-balance-record", () => ({
  recordPlaidRealtimeBalanceObservations: (...args: unknown[]) =>
    recordPlaidRealtimeBalanceObservations(...args),
}));

import { POST } from "@/app/api/plaid/observe-balances/route";

const CANONICAL = "https://nklmgzxxdhuvqayhcigp.supabase.co";
const OWNER = "11111111-1111-4111-8111-111111111111";
const OTHER = "22222222-2222-4222-8222-222222222222";
const ITEM_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const ITEM_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const NOW = 1_700_000_000_000;

function source(path: string): string {
  return readFileSync(resolve(process.cwd(), path), "utf8");
}

describe("foreground balance refresh planner", () => {
  afterEach(() => {
    resetForegroundBalanceRefreshSession();
  });

  function plan(input: {
    authenticated?: boolean;
    visible?: boolean;
    now?: number;
    ignoreRecentSuccess?: boolean;
  }) {
    return planForegroundBalanceRefresh({
      authenticated: input.authenticated ?? true,
      visible: input.visible ?? true,
      now: input.now ?? NOW,
      ignoreRecentSuccess: input.ignoreRecentSuccess,
    });
  }

  it("requests when a signed-in document is visible and nothing was applied", () => {
    expect(plan({})).toEqual({ action: "request", ticket: expect.any(Number) });
  });

  it("records the window only after an applied result", () => {
    const decision = plan({});
    expect(decision.action).toBe("request");
    if (decision.action !== "request") return;
    noteForegroundBalanceRefreshResult({
      ticket: decision.ticket,
      applied: true,
      now: NOW + 10,
    });
    expect(plan({ now: NOW + 10 })).toEqual({ action: "skip" });
  });

  it("does not request again inside the recent-success window", () => {
    const decision = plan({});
    if (decision.action !== "request") throw new Error("expected request");
    noteForegroundBalanceRefreshResult({
      ticket: decision.ticket,
      applied: true,
      now: NOW,
    });
    expect(
      plan({ now: NOW + FOREGROUND_BALANCE_REFRESH_WINDOW_MS - 1 })
    ).toEqual({ action: "skip" });
  });

  it("lets an unseen Item ask inside the recent-success window", () => {
    const decision = plan({});
    if (decision.action !== "request") throw new Error("expected request");
    noteForegroundBalanceRefreshResult({
      ticket: decision.ticket,
      applied: true,
      now: NOW,
    });
    markUnseenBalanceItem();
    expect(hasUnseenBalanceItem()).toBe(true);
    expect(plan({ now: NOW + 1, visible: false })).toEqual({ action: "skip" });
    expect(hasUnseenBalanceItem()).toBe(true);
    const again = plan({ now: NOW + 1 });
    expect(again.action).toBe("request");
    expect(hasUnseenBalanceItem()).toBe(false);
  });

  it("keeps an in-flight ask from overlapping an unseen Item", () => {
    const decision = plan({});
    expect(decision.action).toBe("request");
    markUnseenBalanceItem();
    expect(plan({ now: NOW + 1, ignoreRecentSuccess: true })).toEqual({ action: "skip" });
    expect(hasUnseenBalanceItem()).toBe(true);
    if (decision.action !== "request") return;
    noteForegroundBalanceRefreshResult({
      ticket: decision.ticket,
      applied: true,
      now: NOW + 1,
    });
    expect(plan({ now: NOW + 1 }).action).toBe("request");
  });

  it("requests again after the recent-success window", () => {
    const decision = plan({});
    if (decision.action !== "request") throw new Error("expected request");
    noteForegroundBalanceRefreshResult({
      ticket: decision.ticket,
      applied: true,
      now: NOW,
    });
    expect(plan({ now: NOW + FOREGROUND_BALANCE_REFRESH_WINDOW_MS }).action).toBe(
      "request"
    );
  });

  it("does not record success when the request fails", () => {
    const decision = plan({});
    if (decision.action !== "request") throw new Error("expected request");
    noteForegroundBalanceRefreshResult({
      ticket: decision.ticket,
      applied: false,
      now: NOW,
    });
    expect(plan({ now: NOW + 1 }).action).toBe("request");
  });

  it("does not treat a not-applied summary as success", () => {
    expect(
      foregroundBalanceRefreshApplied({
        items: 1,
        attempted: 1,
        applied: 0,
        notApplied: 1,
      })
    ).toBe(false);
    expect(
      foregroundBalanceRefreshApplied({
        items: 2,
        attempted: 2,
        applied: 1,
        notApplied: 1,
      })
    ).toBe(false);
  });

  it("treats every attempted Item applied as success", () => {
    expect(
      foregroundBalanceRefreshApplied({
        items: 2,
        attempted: 2,
        applied: 2,
        notApplied: 0,
      })
    ).toBe(true);
  });

  it("keeps one request while another is in flight", () => {
    expect(plan({}).action).toBe("request");
    expect(plan({}).action).toBe("skip");
    expect(plan({}).action).toBe("skip");
  });

  it("does not ask again when the effect runs a second time before completion", () => {
    const first = plan({});
    const second = plan({});
    expect(first.action).toBe("request");
    expect(second).toEqual({ action: "skip" });
  });

  it("does not request while the document is hidden", () => {
    expect(plan({ visible: false })).toEqual({ action: "skip" });
  });

  it("does not request while signed out and forgets a prior success", () => {
    const decision = plan({});
    if (decision.action !== "request") throw new Error("expected request");
    noteForegroundBalanceRefreshResult({
      ticket: decision.ticket,
      applied: true,
      now: NOW,
    });
    expect(plan({ authenticated: false, now: NOW + 1 })).toEqual({ action: "skip" });
    expect(plan({ now: NOW + 2 }).action).toBe("request");
  });

  it("ignores a completion that lands after sign-out", () => {
    const decision = plan({});
    if (decision.action !== "request") throw new Error("expected request");
    plan({ authenticated: false });
    noteForegroundBalanceRefreshResult({
      ticket: decision.ticket,
      applied: true,
      now: NOW,
    });
    expect(plan({ now: NOW + 1 }).action).toBe("request");
  });
});

describe("POST /api/plaid/observe-balances", () => {
  const previous: Record<string, string | undefined> = {};

  afterEach(() => {
    requireAuthenticatedUser.mockReset();
    getSupabaseServiceClient.mockReset();
    recordPlaidRealtimeBalanceObservations.mockReset();
    for (const key of Object.keys(previous)) {
      if (previous[key] === undefined) delete process.env[key];
      else process.env[key] = previous[key];
    }
  });

  function rememberEnv() {
    if (!("NEXT_PUBLIC_SUPABASE_URL" in previous)) {
      previous.NEXT_PUBLIC_SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
    }
  }

  function signedIn() {
    rememberEnv();
    process.env.NEXT_PUBLIC_SUPABASE_URL = CANONICAL;
    requireAuthenticatedUser.mockResolvedValue({
      user: { id: OWNER },
      accessToken: "session",
    });
  }

  function items(rows: { id: string; user_id: string }[] | null) {
    getSupabaseServiceClient.mockReturnValue({
      from(table: string) {
        if (table !== "plaid_items") throw new Error(`unexpected table ${table}`);
        return {
          select(columns: string) {
            if (columns !== "id, user_id") throw new Error(`unexpected columns ${columns}`);
            return {
              eq(column: string, value: string) {
                if (column !== "user_id" || value !== OWNER) {
                  throw new Error(`unexpected filter ${column}=${value}`);
                }
                return Promise.resolve({ data: rows, error: null });
              },
            };
          },
        };
      },
    });
  }

  function post(body = "") {
    return POST(
      new Request("https://wealth-engine.example/api/plaid/observe-balances", {
        method: "POST",
        body,
      })
    );
  }

  it("records every owned Item and does not sync transactions", async () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    signedIn();
    items([
      { id: ITEM_A, user_id: OWNER },
      { id: ITEM_B, user_id: OWNER },
    ]);
    recordPlaidRealtimeBalanceObservations.mockResolvedValue("applied");

    const response = await post();
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      items: 2,
      attempted: 2,
      applied: 2,
      notApplied: 0,
    });
    expect(recordPlaidRealtimeBalanceObservations).toHaveBeenCalledTimes(2);
    expect(recordPlaidRealtimeBalanceObservations.mock.calls[0]?.[0]).toMatchObject({
      userId: OWNER,
      itemRowId: ITEM_A,
    });
    expect(recordPlaidRealtimeBalanceObservations.mock.calls[1]?.[0]).toMatchObject({
      userId: OWNER,
      itemRowId: ITEM_B,
    });
    const stages = info.mock.calls
      .filter((call) => call[0] === "[plaid] realtime observe")
      .map((call) => (call[1] as { stage: string }).stage);
    expect(stages).toEqual([
      "post-entered",
      "authenticated",
      "items-discovered",
      "post-complete",
    ]);
    const complete = info.mock.calls.find(
      (call) =>
        call[0] === "[plaid] realtime observe" &&
        (call[1] as { stage?: string }).stage === "post-complete"
    )?.[1] as Record<string, unknown>;
    expect(complete).toMatchObject({
      status: 200,
      items: 2,
      attempted: 2,
      applied: 2,
      notApplied: 0,
    });
    expect(JSON.stringify(info.mock.calls)).not.toContain("access_token");
    info.mockRestore();
  });

  it("rejects a body that tries to choose an Item", async () => {
    signedIn();
    items([]);
    const response = await post(JSON.stringify({ id: ITEM_A }));
    expect(response.status).toBe(400);
    expect(recordPlaidRealtimeBalanceObservations).not.toHaveBeenCalled();
  });

  it("does not record when a row belongs to another owner", async () => {
    signedIn();
    items([
      { id: ITEM_A, user_id: OWNER },
      { id: ITEM_B, user_id: OTHER },
    ]);
    const response = await post();
    expect(response.status).toBe(503);
    expect(recordPlaidRealtimeBalanceObservations).not.toHaveBeenCalled();
  });

  it("returns the summary when the recorder does not apply", async () => {
    signedIn();
    items([{ id: ITEM_A, user_id: OWNER }]);
    recordPlaidRealtimeBalanceObservations.mockResolvedValue("not-applied");
    const response = await post();
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ applied: 0, notApplied: 1 });
  });

  it("does not run without a session", async () => {
    requireAuthenticatedUser.mockResolvedValue(
      NextResponse.json({ error: "Sign in required to connect a bank." }, { status: 401 })
    );
    const response = await post();
    expect(response.status).toBe(401);
    expect(recordPlaidRealtimeBalanceObservations).not.toHaveBeenCalled();
    expect(getSupabaseServiceClient).not.toHaveBeenCalled();
  });
});

describe("WE-BALANCE-FRESHNESS-002 repository boundary", () => {
  it("asks on visibility through the cached recorder and leaves transaction sync in place", () => {
    const hook = source("hooks/usePlaidConnections.ts");
    const client = source("lib/babylon/plaid-client.ts");
    const route = source("app/api/plaid/observe-balances/route.ts");
    const syncRoute = source("app/api/plaid/sync-transactions/route.ts");
    const planner = source("lib/babylon/foreground-balance-refresh.ts");
    const home = source("components/babylon/mobile-home.tsx");

    const refreshCallback = hook.slice(hook.indexOf("const recordVisibleBalances"));
    expect(refreshCallback.indexOf("foregroundBalanceRefreshApplied")).toBeLessThan(
      refreshCallback.indexOf("BALANCE_OBSERVATION_QUERY_KEY")
    );
    expect(hook).toContain("planForegroundBalanceRefresh");
    expect(hook).toContain("requestForegroundBalanceRefresh");
    expect(hook).toContain("visibilitychange");
    expect(hook).toContain("BALANCE_OBSERVATION_QUERY_KEY");
    expect(hook).toContain("PLAID_DESCRIPTOR_QUERY_KEY");
    expect(hook).toContain("ACCOUNT_ASSOCIATION_QUERY_KEY");
    expect(hook).not.toContain("setInterval");
    expect(hook).toContain("startForegroundObservationSync");
    expect(client).toContain('"/api/plaid/observe-balances"');
    expect(client).toContain('method: "POST"');
    const refresh = client.slice(
      client.indexOf("export async function requestForegroundBalanceRefresh")
    );
    expect(refresh).not.toContain("sync-transactions");
    expect(planner).not.toContain("localStorage");
    expect(planner).not.toContain("setInterval");
    expect(route).not.toContain("/transactions/sync");
    expect(route).not.toContain("/transactions/refresh");
    const scheduled = route.slice(
      route.indexOf("export async function GET"),
      route.indexOf("export async function POST")
    );
    const foreground = route.slice(route.indexOf("export async function POST"));
    expect(scheduled).toContain("recordPlaidBalanceObservations(");
    expect(scheduled).not.toContain("recordPlaidRealtimeBalanceObservations");
    expect(foreground).toContain("recordPlaidRealtimeBalanceObservations(");
    expect(foreground).not.toContain("recordPlaidBalanceObservations(");
    expect(syncRoute).not.toContain("recordPlaidBalanceObservations");
    expect(syncRoute).toContain("bootstrapPlaidAccountIdentityIfAbsent");
    expect(syncRoute).toContain("syncPlaidItemObservations");
    expect(hook).toContain("itemIdsBeyondInitialReadyList");
    expect(hook).toContain("markUnseenBalanceItem");
    const syncEffect = hook.slice(hook.indexOf("startForegroundObservationSync({"));
    expect(syncEffect).not.toContain("requestForegroundBalanceRefresh");
    expect(syncEffect).not.toContain("recordPlaidBalanceObservations");
    expect(home).not.toContain("observedAt");
    expect(FOREGROUND_BALANCE_REFRESH_WINDOW_MS).toBe(60_000);
  });
});

describe("foreground balance ownership", () => {
  afterEach(() => {
    resetForegroundBalanceRefreshSession();
  });

  it("uses one foreground balance owner on initial visible signed-in use", () => {
    const hook = source("hooks/usePlaidConnections.ts");
    const syncRoute = source("app/api/plaid/sync-transactions/route.ts");
    expect(hook.match(/requestForegroundBalanceRefresh\(/g)).toHaveLength(1);
    expect(hook).toContain("recordVisibleBalances(false)");
    expect(syncRoute).not.toContain("recordPlaidBalanceObservations");
    expect(syncRoute).toContain("syncPlaidItemObservations");
  });

  it("does not let a successful transaction sync record balances", () => {
    const hook = source("hooks/usePlaidConnections.ts");
    const syncRoute = source("app/api/plaid/sync-transactions/route.ts");
    const requestStart = hook.indexOf("request: (itemRowId)");
    const requestCallback = hook.slice(requestStart, hook.indexOf("const beyond", requestStart));
    expect(requestCallback).toContain("requestPlaidObservationSync");
    expect(requestCallback).not.toContain("recordVisibleBalances");
    expect(requestCallback).not.toContain("requestForegroundBalanceRefresh");
    expect(syncRoute).not.toContain("recordPlaidBalanceObservations");
    expect(syncRoute).toContain('outcome.status === "synced" || outcome.status === "incomplete"');
  });

  it("still asks for balances when transaction sync cannot succeed", () => {
    const hook = source("hooks/usePlaidConnections.ts");
    const visibility = hook.slice(
      hook.indexOf("recordVisibleBalances(false)"),
      hook.indexOf("startForegroundObservationSync({")
    );
    expect(visibility).toContain("visibilitychange");
    expect(visibility).not.toContain("outcome.status");
    expect(visibility).not.toContain("requestPlaidObservationSync");
    expect(planForegroundBalanceRefresh({
      authenticated: true,
      visible: true,
      now: NOW,
    }).action).toBe("request");
  });

  it("does not record balances for an incomplete transaction sync", () => {
    const syncRoute = source("app/api/plaid/sync-transactions/route.ts");
    const gate = syncRoute.slice(
      syncRoute.indexOf('outcome.status === "synced" || outcome.status === "incomplete"'),
      syncRoute.indexOf("plaidSyncHttpResult(outcome)")
    );
    expect(gate).toContain("bootstrapPlaidAccountIdentityIfAbsent");
    expect(gate).not.toContain("recordPlaidBalanceObservations");
  });

  it("does not ask again inside 60 seconds after a successful recording", () => {
    const decision = planForegroundBalanceRefresh({
      authenticated: true,
      visible: true,
      now: NOW,
    });
    if (decision.action !== "request") throw new Error("expected request");
    noteForegroundBalanceRefreshResult({
      ticket: decision.ticket,
      applied: true,
      now: NOW,
    });
    expect(
      planForegroundBalanceRefresh({
        authenticated: true,
        visible: true,
        now: NOW + FOREGROUND_BALANCE_REFRESH_WINDOW_MS - 1,
      })
    ).toEqual({ action: "skip" });
  });

  it("can ask again after 60 seconds", () => {
    const decision = planForegroundBalanceRefresh({
      authenticated: true,
      visible: true,
      now: NOW,
    });
    if (decision.action !== "request") throw new Error("expected request");
    noteForegroundBalanceRefreshResult({
      ticket: decision.ticket,
      applied: true,
      now: NOW,
    });
    expect(
      planForegroundBalanceRefresh({
        authenticated: true,
        visible: true,
        now: NOW + FOREGROUND_BALANCE_REFRESH_WINDOW_MS,
      }).action
    ).toBe("request");
  });

  it("leaves the daily observer independent of foreground sync", () => {
    const route = source("app/api/plaid/observe-balances/route.ts");
    const syncRoute = source("app/api/plaid/sync-transactions/route.ts");
    const vercel = source("vercel.json");
    const scheduled = route.slice(0, route.indexOf("export async function POST"));
    expect(scheduled).toContain("authorizeCronRequest");
    expect(scheduled).toContain("recordPlaidBalanceObservations");
    expect(scheduled).not.toContain("syncPlaidItemObservations");
    expect(syncRoute).not.toContain("recordPlaidBalanceObservations");
    const crons = JSON.parse(vercel) as { crons: { path: string; schedule: string }[] };
    expect(crons.crons).toContainEqual({
      path: "/api/plaid/observe-balances",
      schedule: "0 15 * * *",
    });
  });
});
