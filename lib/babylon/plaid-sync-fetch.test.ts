import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

vi.mock("@/lib/babylon/plaid-server", () => ({
  plaidFetch: vi.fn(),
}));

import { plaidFetch } from "@/lib/babylon/plaid-server";
import {
  fetchPlaidAccountIdentity,
  fetchPlaidRealtimeBalances,
  fetchPlaidTransactionSyncPage,
} from "@/lib/babylon/plaid-sync-fetch";
import {
  parsePlaidAccountsGetResponse,
  parsePlaidTransactionsSyncResponse,
} from "@/lib/babylon/plaid-transaction-sync";

const ACCESS_TOKEN = "access-sandbox-secret";

describe("Plaid account identity fetch", () => {
  const log = vi.spyOn(console, "log").mockImplementation(() => {});

  afterEach(() => {
    log.mockClear();
    vi.mocked(plaidFetch).mockReset();
  });

  it("does not log a transaction sync page", async () => {
    const payload = {
      added: [],
      modified: [],
      removed: [],
      accounts: [],
      next_cursor: "cursor-1",
      has_more: false,
    };
    vi.mocked(plaidFetch).mockResolvedValue({ ok: true, data: payload });

    const fetched = await fetchPlaidTransactionSyncPage({
      accessToken: ACCESS_TOKEN,
      cursor: "cursor-1",
    });

    expect(fetched).toEqual({
      ok: true,
      page: parsePlaidTransactionsSyncResponse(payload),
    });
    expect(log).not.toHaveBeenCalled();
    expect(JSON.stringify(log.mock.calls)).not.toContain("WE-ATTENTION-ACCOUNT-PROBE");
  });

  it("requests /accounts/get and returns only parsed identity", async () => {
    const payload = {
      request_id: "req-secret",
      item: { item_id: "item-secret" },
      accounts: [
        {
          account_id: "acc-checking",
          name: "Checking",
          mask: "1234",
          type: "depository",
          subtype: "checking",
          official_name: "Official Checking",
          holder_category: "personal",
          balances: { current: 80, available: 70 },
        },
      ],
    };
    vi.mocked(plaidFetch).mockResolvedValue({ ok: true, data: payload });

    const fetched = await fetchPlaidAccountIdentity({ accessToken: ACCESS_TOKEN });

    expect(vi.mocked(plaidFetch)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(plaidFetch).mock.calls[0]?.[0]).toBe("/accounts/get");
    expect(vi.mocked(plaidFetch).mock.calls[0]?.[1]).toEqual({
      access_token: ACCESS_TOKEN,
    });
    expect(fetched).toEqual({
      ok: true,
      accounts: parsePlaidAccountsGetResponse(payload),
    });
    const printed = JSON.stringify(fetched);
    for (const discarded of [
      "balances",
      "official_name",
      "holder_category",
      "request_id",
      "item-secret",
      "80",
    ]) {
      expect(printed).not.toContain(discarded);
    }
    expect(log).not.toHaveBeenCalled();
  });

  it("does not call Plaid again when the accounts payload cannot be parsed", async () => {
    vi.mocked(plaidFetch).mockResolvedValue({
      ok: true,
      data: { accounts: { account_id: "acc-checking" } },
    });

    const fetched = await fetchPlaidAccountIdentity({ accessToken: ACCESS_TOKEN });

    expect(fetched).toEqual({ ok: false });
    expect(vi.mocked(plaidFetch)).toHaveBeenCalledTimes(1);
  });
});

describe("Plaid real-time balance fetch", () => {
  afterEach(() => {
    vi.mocked(plaidFetch).mockReset();
  });

  it("asks /accounts/balance/get for the server-chosen account ids only", async () => {
    vi.mocked(plaidFetch).mockResolvedValue({
      ok: true,
      data: {
        accounts: [
          {
            account_id: "checking",
            type: "depository",
            subtype: "checking",
            balances: {
              current: 40.5,
              available: 10,
              iso_currency_code: "USD",
              unofficial_currency_code: null,
            },
          },
          {
            account_id: "not-requested",
            type: "depository",
            subtype: "savings",
            balances: {
              current: 99,
              available: 99,
              iso_currency_code: "USD",
              unofficial_currency_code: null,
            },
          },
        ],
      },
    });
    const fetched = await fetchPlaidRealtimeBalances({
      accessToken: ACCESS_TOKEN,
      accountIds: ["checking"],
    });
    expect(vi.mocked(plaidFetch)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(plaidFetch).mock.calls[0]?.[0]).toBe("/accounts/balance/get");
    expect(vi.mocked(plaidFetch).mock.calls[0]?.[1]).toEqual({
      access_token: ACCESS_TOKEN,
      options: { account_ids: ["checking"] },
    });
    expect(fetched).toEqual({
      ok: true,
      accounts: [
        {
          plaidAccountId: "checking",
          accountType: "depository",
          subtype: "checking",
          currentCents: 4_050,
          availableCents: 1_000,
          isoCurrencyCode: "USD",
          unofficialCurrencyCode: null,
        },
      ],
    });
  });

  it("does not call Plaid when no account id was derived", async () => {
    const fetched = await fetchPlaidRealtimeBalances({
      accessToken: ACCESS_TOKEN,
      accountIds: [],
    });
    expect(fetched).toEqual({ ok: false, reason: "empty_account_ids" });
    expect(vi.mocked(plaidFetch)).not.toHaveBeenCalled();
  });

  it("names a parse failure without calling again", async () => {
    vi.mocked(plaidFetch).mockResolvedValue({
      ok: true,
      data: { accounts: { account_id: "checking" } },
    });
    const fetched = await fetchPlaidRealtimeBalances({
      accessToken: ACCESS_TOKEN,
      accountIds: ["checking"],
    });
    expect(fetched).toEqual({ ok: false, reason: "parse" });
  });

  it("names an upstream Plaid failure", async () => {
    vi.mocked(plaidFetch).mockResolvedValue({
      ok: false,
      response: { status: 502 } as never,
    });
    const fetched = await fetchPlaidRealtimeBalances({
      accessToken: ACCESS_TOKEN,
      accountIds: ["checking"],
    });
    expect(fetched).toEqual({ ok: false, reason: "plaid_request" });
  });
});
