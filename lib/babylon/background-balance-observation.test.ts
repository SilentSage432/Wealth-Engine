import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  observeBackgroundBalances,
  readPlaidItemOwners,
} from "@/lib/babylon/background-balance-observation";
import {
  applyBalanceObservations,
  type BalanceObservationRecord,
  type PlaidBalanceDraft,
} from "@/lib/babylon/balance-observation";

vi.mock("server-only", () => ({}));

const getSupabaseServiceClient = vi.fn();
vi.mock("@/lib/supabase/server", () => ({
  getSupabaseServiceClient: () => getSupabaseServiceClient(),
}));

const recordPlaidBalanceObservations = vi.fn();
vi.mock("@/lib/babylon/plaid-balance-record", () => ({
  recordPlaidBalanceObservations: (...args: unknown[]) =>
    recordPlaidBalanceObservations(...args),
}));

import { GET } from "@/app/api/plaid/observe-balances/route";

const SECRET = "cron-secret-value";
const CANONICAL = "https://nklmgzxxdhuvqayhcigp.supabase.co";
const OWNER_A = "11111111-1111-4111-8111-111111111111";
const OWNER_B = "22222222-2222-4222-8222-222222222222";
const ITEM_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const ITEM_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

function request(url: string, authorization?: string) {
  return new Request(url, {
    headers: authorization ? { Authorization: authorization } : {},
  });
}

function itemList(rows: { id: string; user_id: string }[] | null, error: { code: string } | null = null) {
  return {
    from(table: string) {
      if (table !== "plaid_items") throw new Error(`unexpected table ${table}`);
      return {
        select(columns: string) {
          if (columns !== "id, user_id") throw new Error(`unexpected columns ${columns}`);
          return Promise.resolve({ data: rows, error });
        },
      };
    },
  };
}

describe("background balance observation", () => {
  const previous: Record<string, string | undefined> = {};
  const errorLog = vi.spyOn(console, "error").mockImplementation(() => {});

  afterEach(() => {
    getSupabaseServiceClient.mockReset();
    recordPlaidBalanceObservations.mockReset();
    errorLog.mockClear();
    for (const key of Object.keys(previous)) {
      if (previous[key] === undefined) delete process.env[key];
      else process.env[key] = previous[key];
    }
  });

  function rememberEnv() {
    for (const key of ["CRON_SECRET", "NEXT_PUBLIC_SUPABASE_URL"]) {
      if (!(key in previous)) previous[key] = process.env[key];
    }
  }

  function authorizeEnv() {
    rememberEnv();
    process.env.CRON_SECRET = SECRET;
    process.env.NEXT_PUBLIC_SUPABASE_URL = CANONICAL;
  }

  it("rejects a missing, short, or mismatched cron bearer", async () => {
    authorizeEnv();
    const missing = await GET(request("https://wealth-engine.example/api/plaid/observe-balances"));
    expect(missing.status).toBe(401);
    expect(missing.headers.get("cache-control")).toBe("no-store");
    expect(await missing.json()).toEqual({ error: "Unauthorized." });

    process.env.CRON_SECRET = "short";
    const shortSecret = await GET(
      request("https://wealth-engine.example/api/plaid/observe-balances", "Bearer short")
    );
    expect(shortSecret.status).toBe(401);

    process.env.CRON_SECRET = "cron secret value!!";
    const spaced = await GET(
      request(
        "https://wealth-engine.example/api/plaid/observe-balances",
        "Bearer cron secret value!!"
      )
    );
    expect(spaced.status).toBe(401);

    process.env.CRON_SECRET = SECRET;
    const mismatched = await GET(
      request(
        "https://wealth-engine.example/api/plaid/observe-balances",
        "Bearer wrong-secret-value"
      )
    );
    expect(mismatched.status).toBe(401);
    expect(getSupabaseServiceClient).not.toHaveBeenCalled();
    expect(recordPlaidBalanceObservations).not.toHaveBeenCalled();
  });

  it("observes each server-listed Item and ignores caller identity", async () => {
    authorizeEnv();
    getSupabaseServiceClient.mockReturnValue(
      itemList([
        { id: ITEM_A, user_id: OWNER_A },
        { id: ITEM_B, user_id: OWNER_B },
      ])
    );
    recordPlaidBalanceObservations.mockResolvedValue("applied");

    const response = await GET(
      request(
        `https://wealth-engine.example/api/plaid/observe-balances?user_id=${OWNER_A}&item=${ITEM_B}`,
        `Bearer ${SECRET}`
      )
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    const body = await response.json();
    expect(body).toEqual({
      items: 2,
      attempted: 2,
      applied: 2,
      notApplied: 0,
      repairs: [],
      itemOutcomes: [],
    });
    const text = JSON.stringify(body);
    expect(text).not.toContain(OWNER_A);
    expect(text).not.toContain(OWNER_B);
    expect(text).not.toContain(ITEM_A);
    expect(text).not.toContain(ITEM_B);
    expect(text).not.toMatch(/\d{3,}/);

    expect(recordPlaidBalanceObservations).toHaveBeenCalledTimes(2);
    expect(recordPlaidBalanceObservations.mock.calls[0]?.[0]).toMatchObject({
      userId: OWNER_A,
      itemRowId: ITEM_A,
    });
    expect(recordPlaidBalanceObservations.mock.calls[1]?.[0]).toMatchObject({
      userId: OWNER_B,
      itemRowId: ITEM_B,
    });
    const joined = JSON.stringify(recordPlaidBalanceObservations.mock.calls);
    expect(joined).not.toContain("caller-chosen");
  });

  it("continues after one Item throws and logs no identity", async () => {
    authorizeEnv();
    getSupabaseServiceClient.mockReturnValue(
      itemList([
        { id: ITEM_A, user_id: OWNER_A },
        { id: ITEM_B, user_id: OWNER_B },
      ])
    );
    recordPlaidBalanceObservations
      .mockRejectedValueOnce(new Error(`token ${ITEM_A} cents 44025`))
      .mockResolvedValueOnce("applied");

    const response = await GET(
      request("https://wealth-engine.example/api/plaid/observe-balances", `Bearer ${SECRET}`)
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      items: 2,
      attempted: 2,
      applied: 1,
      notApplied: 1,
      repairs: [],
      itemOutcomes: [],
    });
    expect(recordPlaidBalanceObservations).toHaveBeenCalledTimes(2);
    const logged = errorLog.mock.calls.map((call) => call.map(String).join(" ")).join("\n");
    expect(logged).toContain("[plaid] background balance observation failed.");
    expect(logged).not.toContain(ITEM_A);
    expect(logged).not.toContain(OWNER_A);
    expect(logged).not.toContain("44025");
    expect(logged).not.toContain("token");
  });

  it("does not record when the canonical project or the item list is unavailable", async () => {
    rememberEnv();
    process.env.CRON_SECRET = SECRET;
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://bsddcwkhkmxdcuimzzgr.supabase.co";
    const foreign = await GET(
      request("https://wealth-engine.example/api/plaid/observe-balances", `Bearer ${SECRET}`)
    );
    expect(foreign.status).toBe(503);
    expect(getSupabaseServiceClient).not.toHaveBeenCalled();

    process.env.NEXT_PUBLIC_SUPABASE_URL = CANONICAL;
    getSupabaseServiceClient.mockReturnValue(null);
    const missingClient = await GET(
      request("https://wealth-engine.example/api/plaid/observe-balances", `Bearer ${SECRET}`)
    );
    expect(missingClient.status).toBe(503);
    expect(recordPlaidBalanceObservations).not.toHaveBeenCalled();

    getSupabaseServiceClient.mockReturnValue(itemList(null, { code: "57014" }));
    const listFailed = await GET(
      request("https://wealth-engine.example/api/plaid/observe-balances", `Bearer ${SECRET}`)
    );
    expect(listFailed.status).toBe(503);
    expect(await listFailed.json()).toEqual({ error: "Balance observation is unavailable." });
    expect(recordPlaidBalanceObservations).not.toHaveBeenCalled();
    const logged = errorLog.mock.calls.map((call) => call.map(String).join(" ")).join("\n");
    expect(logged).not.toContain("57014");
  });
});

describe("authoritative item rows", () => {
  it("reads only id and user_id pairs", () => {
    expect(
      readPlaidItemOwners([
        { id: ITEM_A, user_id: OWNER_A },
        { id: ` ${ITEM_B} `, user_id: OWNER_B },
      ])
    ).toEqual([
      { id: ITEM_A, userId: OWNER_A },
      { id: ITEM_B, userId: OWNER_B },
    ]);
    expect(readPlaidItemOwners([{ id: ITEM_A }])).toBeNull();
    expect(readPlaidItemOwners(null)).toBeNull();
  });

  it("attempts every pair when one recorder throws", async () => {
    const seen: string[] = [];
    const summary = await observeBackgroundBalances({
      items: [
        { id: ITEM_A, userId: OWNER_A },
        { id: ITEM_B, userId: OWNER_B },
      ],
      record: async (item) => {
        seen.push(item.id);
        if (item.id === ITEM_A) throw new Error("access-token 8800");
        return "applied";
      },
    });
    expect(summary).toEqual({
      items: 2,
      attempted: 2,
      applied: 1,
      notApplied: 1,
      repairs: [],
      itemOutcomes: [],
    });
    expect(seen).toEqual([ITEM_A, ITEM_B]);
  });

  it("counts a not-applied Item without stopping the next", async () => {
    const summary = await observeBackgroundBalances({
      items: [
        { id: ITEM_A, userId: OWNER_A },
        { id: ITEM_B, userId: OWNER_B },
      ],
      record: async (item) => (item.id === ITEM_A ? "not-applied" : "applied"),
    });
    expect(summary).toEqual({
      items: 2,
      attempted: 2,
      applied: 1,
      notApplied: 1,
      repairs: [],
      itemOutcomes: [],
    });
  });
});

describe("existing balance storage semantics", () => {
  const userId = OWNER_A;
  const at = "2026-09-26T15:00:00.000Z";
  const later = "2026-09-27T15:00:00.000Z";

  function draft(currentCents: number | null): PlaidBalanceDraft {
    return {
      plaidAccountId: "plaid-checking",
      accountType: "depository",
      subtype: "checking",
      currentCents,
      availableCents: currentCents,
      isoCurrencyCode: "USD",
      unofficialCurrencyCode: null,
    };
  }

  function current(cents: number, observedAt: string): BalanceObservationRecord {
    return {
      userId,
      plaidAccountId: "plaid-checking",
      currentCents: cents,
      availableCents: cents,
      isoCurrencyCode: "USD",
      unofficialCurrencyCode: null,
      observedAt,
      source: "accounts_get",
      state: "current",
    };
  }

  it("refreshes observed_at when the reading is unchanged", () => {
    const stored = applyBalanceObservations([current(10_000, at)], {
      userId,
      observedAt: later,
      drafts: [draft(10_000)],
    });
    expect(stored.status).toBe("applied");
    expect(stored.observations).toEqual([current(10_000, later)]);
  });

  it("keeps one predecessor when the reading changes", () => {
    const stored = applyBalanceObservations([current(10_000, at)], {
      userId,
      observedAt: later,
      drafts: [draft(12_500)],
    });
    expect(stored.observations).toHaveLength(2);
    expect(stored.observations.filter((row) => row.state === "current")).toEqual([
      { ...current(12_500, later), availableCents: 12_500 },
    ]);
    expect(stored.observations.filter((row) => row.state === "superseded")).toHaveLength(1);
  });
});

describe("WE-ATTENTION-008 repository boundary", () => {
  const route = readFileSync("app/api/plaid/observe-balances/route.ts", "utf8");
  const recorder = readFileSync("lib/babylon/plaid-balance-record.ts", "utf8");
  const fetchSource = readFileSync("lib/babylon/plaid-sync-fetch.ts", "utf8");
  const evaluator = readFileSync("lib/babylon/notification-evaluator.ts", "utf8");
  const attention = readFileSync("lib/babylon/attention.ts", "utf8");
  const meaning = readFileSync("lib/babylon/confirmed-meaning.ts", "utf8");
  const syncRoute = readFileSync("app/api/plaid/sync-transactions/route.ts", "utf8");
  const vercel = readFileSync("vercel.json", "utf8");

  it("stays on the cached recorder and off financial authority", () => {
    expect(route).toContain("authorizeCronRequest");
    expect(route).toContain("isCanonicalSupabaseUrl");
    expect(route).toContain("getSupabaseServiceClient");
    expect(route).toContain('.select("id, user_id")');
    expect(route).toContain("recordPlaidBalanceObservations");
    expect(route).not.toContain("request.json");
    expect(route).not.toContain("searchParams");
    expect(route).not.toContain("access_token");
    expect(route).not.toContain("syncPlaidItemObservations");
    expect(route).not.toContain("bootstrapPlaidAccountIdentityIfAbsent");
    expect(route).not.toContain("/transactions/sync");
    expect(route).not.toContain("/transactions/refresh");
    expect(route).not.toContain("wealth_engine_vaults");
    expect(route).not.toContain("cas_update");
    expect(route).not.toContain("acceptObservedBalance");
    expect(route).not.toContain("associate");
    expect(route).not.toContain("confirm_plaid");
    expect(route).not.toContain("transactions_cursor");
    const foreground = route.slice(route.indexOf("export async function POST"));
    const scheduled = route.slice(
      route.indexOf("export async function GET"),
      route.indexOf("export async function POST")
    );
    expect(scheduled).toContain("authorizeCronRequest");
    expect(foreground).toContain("requireAuthenticatedUser");
    expect(foreground).toContain('.eq("user_id", auth.user.id)');
    expect(foreground).not.toContain("authorizeCronRequest");
    expect(foreground).not.toContain("syncPlaidItemObservations");
    expect(recorder).not.toContain('"/accounts/balance/get"');
    expect(recorder).not.toContain("/transactions/refresh");
    expect(recorder).toContain("fetchPlaidAccountBalances");
    expect(recorder).toContain("fetchPlaidRealtimeBalances");
    expect(recorder).not.toContain("transactions_cursor");
    expect(recorder).toContain('.eq("id", args.itemRowId)');
    expect(recorder).toContain('.eq("user_id", args.userId)');
    expect(fetchSource).toContain('"/accounts/get"');
    expect(fetchSource).toContain('"/accounts/balance/get"');
    const cachedFetch = fetchSource.slice(
      fetchSource.indexOf("export async function fetchPlaidAccountBalances"),
      fetchSource.indexOf("export async function fetchPlaidRealtimeBalances")
    );
    expect(cachedFetch).toContain('"/accounts/get"');
    expect(cachedFetch).not.toContain("/accounts/balance/get");
    expect(fetchSource).not.toContain("/transactions/refresh");
  });

  it("keeps notification, Attention, meaning, and the transaction cursor independent", () => {
    expect(evaluator).not.toContain("plaid_balance_observations");
    expect(evaluator).not.toContain("observe-balances");
    expect(evaluator).not.toContain("recordPlaidBalanceObservations");
    expect(attention).not.toContain("observe-balances");
    expect(attention).not.toContain("plaid_balance_observations");
    expect(attention).toContain("export function deriveDueAttention");
    expect(attention).toContain("export function deriveMonthCloseAttention");
    expect(meaning).not.toContain("observe-balances");
    expect(meaning).not.toContain("recordPlaidBalanceObservations");
    expect(syncRoute).toContain("syncPlaidItemObservations");
    expect(syncRoute).not.toContain("observe-balances");
    expect(syncRoute).not.toContain("recordPlaidBalanceObservations");
    expect(syncRoute).toContain("bootstrapPlaidAccountIdentityIfAbsent");
    expect(syncRoute).not.toContain("not-applied");
    expect(syncRoute.indexOf("plaidSyncHttpResult(outcome)")).toBeGreaterThan(
      syncRoute.indexOf("await bootstrapPlaidAccountIdentityIfAbsent")
    );
    const crons = JSON.parse(vercel) as {
      crons: { path: string; schedule: string }[];
    };
    expect(crons.crons).toEqual([
      { path: "/api/notifications/evaluate", schedule: "0 15 * * *" },
      { path: "/api/plaid/observe-balances", schedule: "0 15 * * *" },
    ]);
    expect(vercel).not.toContain("pg_cron");
  });
});
