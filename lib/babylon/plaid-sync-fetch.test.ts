import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

vi.mock("@/lib/babylon/plaid-server", () => ({
  plaidFetch: vi.fn(),
}));

import { plaidFetch } from "@/lib/babylon/plaid-server";
import { fetchPlaidTransactionSyncPage } from "@/lib/babylon/plaid-sync-fetch";
import { parsePlaidTransactionsSyncResponse } from "@/lib/babylon/plaid-transaction-sync";

const ACCESS_TOKEN = "access-sandbox-probe-secret";
const CURSOR = "cursor-probe-secret";
const PROBE = "[WE-ATTENTION-ACCOUNT-PROBE]";

function body(accounts: unknown) {
  return {
    added: [
      {
        transaction_id: "txn-probe-secret",
        account_id: "acc-probe-secret",
        amount: -12.5,
        name: "Payroll Probe Secret",
        date: "2026-09-15",
        pending: false,
      },
    ],
    modified: [],
    removed: [],
    next_cursor: CURSOR,
    has_more: false,
    ...(accounts === undefined ? {} : { accounts }),
  };
}

function account(id: string) {
  return {
    account_id: id,
    name: "Everyday Checking Secret",
    mask: "1234",
    type: "depository",
    subtype: "checking",
    balances: { current: 80, available: 70 },
  };
}

describe("temporary account identity probe", () => {
  const log = vi.spyOn(console, "log").mockImplementation(() => {});

  afterEach(() => {
    log.mockClear();
    vi.mocked(plaidFetch).mockReset();
  });

  it("reports only aggregate account counts and leaves the parsed page unchanged", async () => {
    const payload = body([account("acc-probe-secret"), account("acc-second-secret")]);
    vi.mocked(plaidFetch).mockResolvedValue({ ok: true, data: payload });

    const fetched = await fetchPlaidTransactionSyncPage({
      accessToken: ACCESS_TOKEN,
      cursor: CURSOR,
    });

    expect(fetched).toEqual({
      ok: true,
      page: parsePlaidTransactionsSyncResponse(payload),
    });
    expect(log).toHaveBeenCalledTimes(1);
    expect(log.mock.calls[0]?.[0]).toBe(PROBE);
    expect(log.mock.calls[0]?.[1]).toEqual({
      accountsPresent: true,
      accountsCount: 2,
      parsedAccountsCount: 2,
      pageAccepted: true,
    });
    expect(Object.keys(log.mock.calls[0]?.[1] as object).sort()).toEqual([
      "accountsCount",
      "accountsPresent",
      "pageAccepted",
      "parsedAccountsCount",
    ]);
    const printed = JSON.stringify(log.mock.calls[0]);
    for (const secret of [
      ACCESS_TOKEN,
      CURSOR,
      "txn-probe-secret",
      "acc-probe-secret",
      "acc-second-secret",
      "Payroll Probe Secret",
      "Everyday Checking Secret",
      "1234",
      "depository",
      "checking",
      "-12.5",
      "2026-09-15",
      "balances",
    ]) {
      expect(printed).not.toContain(secret);
    }
  });

  it("reports zero when the sync body has no accounts array", async () => {
    const payload = body(undefined);
    vi.mocked(plaidFetch).mockResolvedValue({ ok: true, data: payload });

    const fetched = await fetchPlaidTransactionSyncPage({
      accessToken: ACCESS_TOKEN,
      cursor: null,
    });

    expect(fetched).toEqual({
      ok: true,
      page: parsePlaidTransactionsSyncResponse(payload),
    });
    expect(fetched.ok && fetched.page.accounts).toEqual([]);
    expect(log.mock.calls[0]?.[1]).toEqual({
      accountsPresent: false,
      accountsCount: 0,
      parsedAccountsCount: 0,
      pageAccepted: true,
    });
  });

  it("does not log before a rejected Plaid response and still rejects a non-array accounts field", async () => {
    vi.mocked(plaidFetch).mockResolvedValue({
      ok: false,
      response: {} as never,
    });
    await fetchPlaidTransactionSyncPage({
      accessToken: ACCESS_TOKEN,
      cursor: null,
    });
    expect(log).not.toHaveBeenCalled();

    const payload = body({ account_id: "acc-probe-secret" });
    vi.mocked(plaidFetch).mockResolvedValue({ ok: true, data: payload });
    const fetched = await fetchPlaidTransactionSyncPage({
      accessToken: ACCESS_TOKEN,
      cursor: null,
    });
    expect(fetched).toEqual({ ok: false });
    expect(parsePlaidTransactionsSyncResponse(payload)).toBeNull();
    expect(log.mock.calls[0]?.[1]).toEqual({
      accountsPresent: false,
      accountsCount: 0,
      parsedAccountsCount: 0,
      pageAccepted: false,
    });
  });
});
