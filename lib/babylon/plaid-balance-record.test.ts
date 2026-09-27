import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const fetchPlaidAccountBalances = vi.fn();
vi.mock("@/lib/babylon/plaid-sync-fetch", () => ({
  fetchPlaidAccountBalances: (...args: unknown[]) => fetchPlaidAccountBalances(...args),
}));

import { recordPlaidBalanceObservations } from "@/lib/babylon/plaid-balance-record";

const USER = "11111111-1111-4111-8111-111111111111";
const ITEM = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const TOKEN = "access-sandbox-secret-token";

function serviceFor(input: {
  token?: string;
  error?: boolean;
  rpc?: ReturnType<typeof vi.fn>;
}) {
  const eqs: [string, string][] = [];
  const rpc =
    input.rpc ??
    vi.fn(async () => ({
      data: { status: "applied" },
      error: null,
    }));
  const chain = {
    select(columns: string) {
      expect(columns).toBe("access_token");
      return chain;
    },
    eq(column: string, value: string) {
      eqs.push([column, value]);
      return chain;
    },
    async maybeSingle() {
      if (input.error) return { data: null, error: { code: "XX000" } };
      if (!input.token) return { data: null, error: null };
      return { data: { access_token: input.token }, error: null };
    },
  };
  return {
    eqs,
    rpc,
    client: {
      from(table: string) {
        expect(table).toBe("plaid_items");
        return chain;
      },
      rpc,
    },
  };
}

describe("recordPlaidBalanceObservations", () => {
  const errorLog = vi.spyOn(console, "error").mockImplementation(() => {});

  afterEach(() => {
    fetchPlaidAccountBalances.mockReset();
    errorLog.mockClear();
  });

  async function record(gateway: ReturnType<typeof serviceFor>) {
    return recordPlaidBalanceObservations({
      service: gateway.client as never,
      userId: USER,
      itemRowId: ITEM,
    });
  }

  it("returns not-applied when the cached read fails and does not call storage", async () => {
    const gateway = serviceFor({ token: TOKEN });
    fetchPlaidAccountBalances.mockResolvedValue({ ok: false });
    await expect(record(gateway)).resolves.toBe("not-applied");
    expect(gateway.eqs).toEqual([
      ["id", ITEM],
      ["user_id", USER],
    ]);
    expect(fetchPlaidAccountBalances).toHaveBeenCalledWith({ accessToken: TOKEN });
    expect(gateway.rpc).not.toHaveBeenCalled();
    const logged = errorLog.mock.calls.map((call) => call.map(String).join(" ")).join("\n");
    expect(logged).toBe("[plaid] balance observation failed.");
    expect(logged).not.toContain(TOKEN);
    expect(logged).not.toContain(USER);
    expect(logged).not.toContain(ITEM);
  });

  it("returns not-applied when the token lookup fails or the token is blank", async () => {
    fetchPlaidAccountBalances.mockResolvedValue({ ok: true, accounts: [] });
    const failed = serviceFor({ error: true });
    await expect(record(failed)).resolves.toBe("not-applied");
    const missing = serviceFor({});
    await expect(record(missing)).resolves.toBe("not-applied");
    const blank = serviceFor({ token: "   " });
    await expect(record(blank)).resolves.toBe("not-applied");
    expect(fetchPlaidAccountBalances).not.toHaveBeenCalled();
    expect(failed.rpc).not.toHaveBeenCalled();
    expect(missing.rpc).not.toHaveBeenCalled();
    expect(blank.rpc).not.toHaveBeenCalled();
  });

  it("returns not-applied when storage fails or does not accept the payload", async () => {
    fetchPlaidAccountBalances.mockResolvedValue({ ok: true, accounts: [] });
    const rpcError = serviceFor({
      token: TOKEN,
      rpc: vi.fn(async () => ({ data: null, error: { code: "XX000" } })),
    });
    await expect(record(rpcError)).resolves.toBe("not-applied");
    const rejected = serviceFor({
      token: TOKEN,
      rpc: vi.fn(async () => ({ data: { status: "forbidden" }, error: null })),
    });
    await expect(record(rejected)).resolves.toBe("not-applied");
    expect(errorLog.mock.calls.map((call) => String(call[0]))).not.toContain(TOKEN);
  });

  it("returns applied only when the observation RPC accepts the payload", async () => {
    const gateway = serviceFor({ token: TOKEN });
    fetchPlaidAccountBalances.mockResolvedValue({
      ok: true,
      accounts: [
        {
          plaidAccountId: "plaid-checking",
          accountType: "depository",
          subtype: "checking",
          currentCents: 10_000,
          availableCents: 9_000,
          isoCurrencyCode: "USD",
          unofficialCurrencyCode: null,
        },
      ],
    });
    await expect(record(gateway)).resolves.toBe("applied");
    expect(gateway.rpc).toHaveBeenCalledTimes(1);
    expect(gateway.rpc.mock.calls[0]?.[0]).toBe("apply_plaid_balance_observations");
    expect(gateway.rpc.mock.calls[0]?.[1]).toMatchObject({ actor_user_id: USER });
    expect(errorLog).not.toHaveBeenCalled();
  });
});
