import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { LEDGER_BACKUP_VERSION } from "@/lib/babylon/persistence";
import { PLAID_ACCOUNT_PUBLIC_COLUMNS } from "@/lib/babylon/plaid-schema";
import {
  applyAccountIdentity,
  createMemoryPlaidObservationStore,
  parsePlaidTransactionsSyncResponse,
  syncPlaidItemObservations,
  type PlaidItemSyncRecord,
  type PlaidSyncPage,
} from "@/lib/babylon/plaid-transaction-sync";

const USER_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const USER_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const ITEM = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";

function item(): PlaidItemSyncRecord {
  return {
    id: ITEM,
    userId: USER_A,
    plaidItemId: "item-plaid-1",
    accessToken: "access-sandbox-test-token",
    cursor: null,
    lockId: null,
    lockedAtMs: null,
  };
}

function page(overrides: Partial<PlaidSyncPage> = {}): PlaidSyncPage {
  return {
    added: [],
    modified: [],
    removedIds: [],
    accounts: [],
    nextCursor: "cursor-1",
    hasMore: false,
    ...overrides,
  };
}

function payload(accounts: unknown) {
  return {
    added: [
      {
        transaction_id: "txn-posted-1",
        pending_transaction_id: "txn-pending-1",
        account_id: "acc-checking",
        amount: -250.15,
        name: "Payroll",
        date: "2026-09-15",
        pending: false,
      },
    ],
    modified: [],
    removed: [],
    accounts,
    next_cursor: "cursor-1",
    has_more: false,
  };
}

describe("Plaid account identity", () => {
  it("reads account descriptors from the sync payload and ignores balances", () => {
    const parsed = parsePlaidTransactionsSyncResponse(
      payload([
        {
          account_id: " acc-checking ",
          name: " Everyday Checking ",
          mask: " 1234 ",
          type: "depository",
          subtype: "checking",
          official_name: "Official Checking",
          balances: { current: 80, available: 70 },
        },
      ])
    );

    expect(parsed?.accounts).toEqual([
      {
        plaidAccountId: "acc-checking",
        name: "Everyday Checking",
        mask: "1234",
        accountType: "depository",
        subtype: "checking",
      },
    ]);
    expect(JSON.stringify(parsed?.accounts)).not.toContain("balances");
    expect(JSON.stringify(parsed?.accounts)).not.toContain("official_name");
  });

  it("keeps missing descriptors empty and nulls non-text fields", () => {
    const missing = parsePlaidTransactionsSyncResponse({
      ...payload(undefined),
      accounts: undefined,
    });
    expect(missing?.accounts).toEqual([]);
    expect(missing?.added[0]).toMatchObject({
      amount: -250.15,
      pendingTransactionId: "txn-pending-1",
    });

    const parsed = parsePlaidTransactionsSyncResponse(
      payload([
        { account_id: "   " },
        {
          account_id: "acc-card",
          name: null,
          mask: "",
          type: { value: "credit" },
          subtype: 4,
        },
      ])
    );
    expect(parsed?.accounts).toEqual([
      {
        plaidAccountId: "acc-card",
        name: null,
        mask: null,
        accountType: null,
        subtype: null,
      },
    ]);
    expect(parsePlaidTransactionsSyncResponse(payload({ account_id: "acc" }))).toBeNull();
  });

  it("upserts account identity with the observation page and repeats safely", async () => {
    const store = createMemoryPlaidObservationStore({ items: [item()] });
    const first = await syncPlaidItemObservations({
      userId: USER_A,
      itemRowId: ITEM,
      store,
      fetchPage: async () => ({
        ok: true,
        page: page({
          accounts: [
            {
              plaidAccountId: "acc-checking",
              name: "Checking",
              mask: "1234",
              accountType: "depository",
              subtype: "checking",
            },
          ],
          added: [
            {
              plaidTransactionId: "txn-posted-1",
              pendingTransactionId: "txn-pending-1",
              accountId: "acc-checking",
              amount: -250.15,
              name: "Payroll",
              category: null,
              date: "2026-09-15",
              pending: false,
            },
          ],
        }),
      }),
    });
    const second = await syncPlaidItemObservations({
      userId: USER_A,
      itemRowId: ITEM,
      store,
      fetchPage: async ({ cursor }) => {
        expect(cursor).toBe("cursor-1");
        return {
          ok: true,
          page: page({
            nextCursor: "cursor-2",
            accounts: [
              {
                plaidAccountId: "acc-checking",
                name: "Primary Checking",
                mask: "1234",
                accountType: "depository",
                subtype: "checking",
              },
            ],
          }),
        };
      },
    });

    expect(first.status).toBe("synced");
    expect(second.status).toBe("synced");
    expect(store.snapshot().accounts).toEqual([
      {
        userId: USER_A,
        plaidItemId: ITEM,
        plaidAccountId: "acc-checking",
        name: "Primary Checking",
        mask: "1234",
        accountType: "depository",
        subtype: "checking",
      },
    ]);
    expect(store.snapshot().observations).toHaveLength(1);
    expect(store.snapshot().observations[0]).toMatchObject({
      accountId: "acc-checking",
      amount: -250.15,
      pendingTransactionId: "txn-pending-1",
    });
    expect(store.snapshot().items[0]?.cursor).toBe("cursor-2");
  });

  it("rejects a page when another user already owns the Plaid account id", async () => {
    const store = createMemoryPlaidObservationStore({
      items: [item()],
      observations: [
        {
          userId: USER_A,
          plaidTransactionId: "txn-existing",
          pendingTransactionId: null,
          accountId: "acc-shared",
          amount: 12,
          name: "Existing",
          category: null,
          date: "2026-09-01",
          pending: false,
          removedAt: null,
          isProcessed: false,
        },
      ],
      accounts: [
        {
          userId: USER_B,
          plaidItemId: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
          plaidAccountId: "acc-shared",
          name: "Other checking",
          mask: "9999",
          accountType: "depository",
          subtype: "checking",
        },
      ],
    });

    const result = await syncPlaidItemObservations({
      userId: USER_A,
      itemRowId: ITEM,
      store,
      fetchPage: async () => ({
        ok: true,
        page: page({
          accounts: [
            {
              plaidAccountId: "acc-shared",
              name: "Taken",
              mask: "0000",
              accountType: "depository",
              subtype: "checking",
            },
          ],
          added: [
            {
              plaidTransactionId: "txn-new",
              pendingTransactionId: null,
              accountId: "acc-shared",
              amount: 5,
              name: "New",
              category: null,
              date: "2026-09-20",
              pending: false,
            },
          ],
        }),
      }),
    });

    expect(result.status).toBe("failed");
    expect(store.snapshot().items[0]?.cursor).toBeNull();
    expect(store.snapshot().observations.map((row) => row.plaidTransactionId)).toEqual([
      "txn-existing",
    ]);
    expect(store.snapshot().accounts).toEqual([
      {
        userId: USER_B,
        plaidItemId: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
        plaidAccountId: "acc-shared",
        name: "Other checking",
        mask: "9999",
        accountType: "depository",
        subtype: "checking",
      },
    ]);
    expect(
      applyAccountIdentity(
        [
          {
            userId: USER_B,
            plaidItemId: ITEM,
            plaidAccountId: "acc-shared",
            name: "Other",
            mask: null,
            accountType: null,
            subtype: null,
          },
        ],
        {
          userId: USER_A,
          itemRowId: ITEM,
          accounts: [
            {
              plaidAccountId: "acc-shared",
              name: "Mine",
              mask: null,
              accountType: null,
              subtype: null,
            },
          ],
        }
      ).status
    ).toBe("rejected");
  });

  it("stores descriptors without balances, tokens, or vault writes", () => {
    const migration = readFileSync(
      resolve(process.cwd(), "supabase/migrations/20260927_plaid_accounts.sql"),
      "utf8"
    );
    const client = readFileSync(
      resolve(process.cwd(), "lib/babylon/plaid-client.ts"),
      "utf8"
    );
    const hook = readFileSync(
      resolve(process.cwd(), "hooks/usePlaidConnections.ts"),
      "utf8"
    );
    const planner = readFileSync(
      resolve(process.cwd(), "lib/babylon/plaid-foreground-sync.ts"),
      "utf8"
    );
    const vaultSync = readFileSync(
      resolve(process.cwd(), "lib/babylon/vault-sync.ts"),
      "utf8"
    );

    expect(migration).toContain("UNIQUE (user_id, plaid_account_id)");
    expect(migration).toContain("SECURITY INVOKER");
    expect(migration).toContain("SET search_path = public");
    expect(migration).toContain("plaid_account_owner_conflict");
    expect(migration).toContain(
      "DROP FUNCTION IF EXISTS public.apply_plaid_sync_page(uuid, uuid, uuid, text, text, jsonb, text[])"
    );
    expect(migration).toContain(
      "REVOKE ALL ON FUNCTION public.apply_plaid_sync_page(uuid, uuid, uuid, text, text, jsonb, text[], jsonb)"
    );
    expect(migration).toContain("FROM PUBLIC, anon, authenticated");
    expect(migration).toContain("TO service_role");
    expect(migration).not.toContain("SECURITY DEFINER");
    const table = migration.slice(
      migration.indexOf("CREATE TABLE public.plaid_accounts"),
      migration.indexOf("CREATE INDEX")
    );
    expect(table).not.toContain("balance");
    expect(migration).not.toContain("access_token");
    expect(migration).not.toContain("wealth_engine_vaults");
    expect(migration).not.toContain("plaid_transactions.account_id");
    expect(migration).not.toMatch(/GRANT (INSERT|UPDATE|DELETE)/);

    expect(PLAID_ACCOUNT_PUBLIC_COLUMNS).not.toContain("access_token");
    expect(PLAID_ACCOUNT_PUBLIC_COLUMNS).not.toContain("transactions_cursor");
    expect(PLAID_ACCOUNT_PUBLIC_COLUMNS).not.toContain("sync_lock");
    expect(PLAID_ACCOUNT_PUBLIC_COLUMNS).not.toContain("balance");
    expect(client).toContain("listPlaidAccounts");
    expect(client).toContain("PLAID_ACCOUNT_PUBLIC_COLUMNS");
    expect(client).not.toContain("WE-ATTENTION-PROBE");
    expect(hook).not.toContain("WE-ATTENTION-PROBE");
    expect(planner).not.toContain("WE-ATTENTION-PROBE");
    expect(hook.match(/startForegroundObservationSync\(/g)).toHaveLength(1);
    expect(planner).toContain("input.request(itemRowId)");
    expect(vaultSync).not.toContain("plaid");
    expect(LEDGER_BACKUP_VERSION).toBe(5);
  });
});
