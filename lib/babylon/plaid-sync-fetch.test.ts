import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

vi.mock("@/lib/babylon/plaid-server", () => ({
  plaidFetch: vi.fn(),
}));

import { plaidFetch } from "@/lib/babylon/plaid-server";
import {
  fetchPlaidAccountIdentity,
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
