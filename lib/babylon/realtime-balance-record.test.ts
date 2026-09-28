import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const fetchPlaidRealtimeBalances = vi.fn();
const fetchPlaidAccountBalances = vi.fn();
vi.mock("@/lib/babylon/plaid-sync-fetch", () => ({
  fetchPlaidRealtimeBalances: (...args: unknown[]) => fetchPlaidRealtimeBalances(...args),
  fetchPlaidAccountBalances: (...args: unknown[]) => fetchPlaidAccountBalances(...args),
}));

import { recordPlaidRealtimeBalanceObservations } from "@/lib/babylon/plaid-balance-record";

const USER = "11111111-1111-4111-8111-111111111111";
const ITEM = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const TOKEN = "access-sandbox-secret-token";
const NOW = Date.parse("2026-09-28T18:00:00.000Z");

function serviceFor(input: {
  accounts?: unknown;
  associations?: unknown;
  observations?: unknown;
  token?: string | null;
  rpc?: ReturnType<typeof vi.fn>;
}) {
  const rpc =
    input.rpc ??
    vi.fn(async () => ({
      data: { status: "applied" },
      error: null,
    }));
  const calls: string[] = [];
  return {
    rpc,
    calls,
    client: {
      from(table: string) {
        calls.push(table);
        if (table === "plaid_accounts") {
          return {
            select() {
              return {
                eq() {
                  return {
                    eq: async () => ({ data: input.accounts ?? [], error: null }),
                  };
                },
              };
            },
          };
        }
        if (table === "plaid_account_associations") {
          return {
            select() {
              return {
                eq: async () => ({ data: input.associations ?? [], error: null }),
              };
            },
          };
        }
        if (table === "plaid_balance_observations") {
          return {
            select() {
              return {
                eq() {
                  return {
                    eq() {
                      return {
                        in: async () => ({ data: input.observations ?? [], error: null }),
                      };
                    },
                  };
                },
              };
            },
          };
        }
        if (table === "plaid_items") {
          return {
            select() {
              return {
                eq() {
                  return {
                    eq() {
                      return {
                        maybeSingle: async () => ({
                          data: input.token ? { access_token: input.token } : null,
                          error: null,
                        }),
                      };
                    },
                  };
                },
              };
            },
          };
        }
        throw new Error(`unexpected table ${table}`);
      },
      rpc,
    },
  };
}

function account(id: string, subtype = "checking") {
  return {
    plaid_account_id: id,
    account_type: "depository",
    subtype,
  };
}

describe("recordPlaidRealtimeBalanceObservations", () => {
  const errorLog = vi.spyOn(console, "error").mockImplementation(() => {});
  const infoLog = vi.spyOn(console, "info").mockImplementation(() => {});

  afterEach(() => {
    fetchPlaidRealtimeBalances.mockReset();
    fetchPlaidAccountBalances.mockReset();
    errorLog.mockClear();
    infoLog.mockClear();
  });

  async function record(gateway: ReturnType<typeof serviceFor>) {
    return recordPlaidRealtimeBalanceObservations({
      service: gateway.client as never,
      userId: USER,
      itemRowId: ITEM,
      nowMs: NOW,
    });
  }

  function infoStages() {
    return infoLog.mock.calls
      .filter((call) => call[0] === "[plaid] realtime observe")
      .map((call) => call[1] as Record<string, unknown>);
  }

  function assertPrivateLogs() {
    const joined = [...errorLog.mock.calls, ...infoLog.mock.calls]
      .map((call) => call.map((part) => JSON.stringify(part)).join(" "))
      .join("\n");
    expect(joined).not.toContain(TOKEN);
    expect(joined).not.toContain("access_token");
    expect(joined).not.toContain("secret");
    expect(joined).not.toContain("9000");
    expect(joined).not.toContain("Bearer");
  }

  it("makes zero Balance requests when nothing is associated", async () => {
    const gateway = serviceFor({
      accounts: [account("checking"), account("savings", "savings")],
      associations: [],
      token: TOKEN,
    });
    await expect(record(gateway)).resolves.toBe("applied");
    expect(fetchPlaidRealtimeBalances).not.toHaveBeenCalled();
    expect(fetchPlaidAccountBalances).not.toHaveBeenCalled();
    expect(gateway.rpc).not.toHaveBeenCalled();
    expect(gateway.calls).not.toContain("plaid_items");
    expect(infoStages()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          stage: "targets-derived",
          descriptors: 2,
          associated: 0,
          eligible: 0,
        }),
        expect.objectContaining({
          stage: "balance-skipped",
          reason: "no-eligible-targets",
          result: "applied",
        }),
      ])
    );
    assertPrivateLogs();
  });

  it("requests one Balance call for every associated account on the Item", async () => {
    const gateway = serviceFor({
      accounts: [account("checking"), account("savings", "savings"), account("other")],
      associations: [
        { plaid_account_id: "checking" },
        { plaid_account_id: "savings" },
      ],
      observations: [],
      token: TOKEN,
    });
    fetchPlaidRealtimeBalances.mockResolvedValue({
      ok: true,
      accounts: [
        {
          plaidAccountId: "checking",
          accountType: "depository",
          subtype: "checking",
          currentCents: 9_000,
          availableCents: 1,
          isoCurrencyCode: "USD",
          unofficialCurrencyCode: null,
        },
      ],
    });
    await expect(record(gateway)).resolves.toBe("applied");
    expect(fetchPlaidRealtimeBalances).toHaveBeenCalledTimes(1);
    expect(fetchPlaidAccountBalances).not.toHaveBeenCalled();
    expect(fetchPlaidRealtimeBalances).toHaveBeenCalledWith({
      accessToken: TOKEN,
      accountIds: ["checking", "savings"],
    });
    expect(gateway.rpc.mock.calls[0]?.[1].observations[0].source).toBe("balance_get");
    expect(infoStages()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          stage: "targets-derived",
          eligible: 2,
        }),
        expect.objectContaining({
          stage: "balance-request-start",
          eligible: 2,
        }),
        expect.objectContaining({
          stage: "balance-parsed",
          accounts: 1,
        }),
        expect.objectContaining({
          stage: "rpc-result",
          result: "applied",
        }),
      ])
    );
    assertPrivateLogs();
  });

  it("does not call Plaid again inside the stored 60-second window", async () => {
    const gateway = serviceFor({
      accounts: [account("checking")],
      associations: [{ plaid_account_id: "checking" }],
      observations: [
        {
          plaid_account_id: "checking",
          source: "balance_get",
          observed_at: new Date(NOW - 30_000).toISOString(),
        },
      ],
      token: TOKEN,
    });
    await expect(record(gateway)).resolves.toBe("applied");
    expect(fetchPlaidRealtimeBalances).not.toHaveBeenCalled();
    expect(gateway.rpc).not.toHaveBeenCalled();
    expect(gateway.calls).not.toContain("plaid_items");
    expect(infoStages()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          stage: "balance-skipped",
          reason: "fresh-balance-get",
          result: "applied",
        }),
      ])
    );
    assertPrivateLogs();
  });

  it("leaves stored evidence in place when the real-time read fails", async () => {
    const gateway = serviceFor({
      accounts: [account("checking")],
      associations: [{ plaid_account_id: "checking" }],
      observations: [
        {
          plaid_account_id: "checking",
          source: "balance_get",
          observed_at: new Date(NOW - 120_000).toISOString(),
        },
      ],
      token: TOKEN,
    });
    fetchPlaidRealtimeBalances.mockResolvedValue({
      ok: false,
      reason: "plaid_request",
    });
    await expect(record(gateway)).resolves.toBe("not-applied");
    expect(fetchPlaidAccountBalances).not.toHaveBeenCalled();
    expect(gateway.rpc).not.toHaveBeenCalled();
    expect(infoStages()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          stage: "balance-request-failed",
          reason: "plaid_request",
        }),
      ])
    );
    const logged = errorLog.mock.calls.map((call) => String(call[0])).join("\n");
    expect(logged).toBe("[plaid] balance observation failed.");
    assertPrivateLogs();
  });
});
