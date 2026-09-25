import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { CLOUD_VAULT_DATA_KEYS } from "@/lib/babylon/cloud-vault";
import {
  persistExchangedPlaidItem,
  planPlaidItemPersist,
  type PlaidItemWriteGateway,
} from "@/lib/babylon/plaid-item-persist";
import {
  PLAID_OBSERVATION_COLUMNS,
  toPlaidObservationPublic,
} from "@/lib/babylon/plaid-schema";
import { LEDGER_BACKUP_VERSION } from "@/lib/babylon/persistence";
import {
  applySyncPage,
  createMemoryPlaidObservationStore,
  currentPlaidObservations,
  parsePlaidTransactionsSyncResponse,
  plaidSyncHttpResult,
  plaidTransactionsSyncBody,
  syncPlaidItemObservations,
  type PlaidItemSyncRecord,
  type PlaidObservationDraft,
  type PlaidObservationSyncStore,
  type PlaidSyncPage,
} from "@/lib/babylon/plaid-transaction-sync";

const USER_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const USER_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const ITEM = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const ACCESS_TOKEN = "access-sandbox-test-token";

function item(overrides: Partial<PlaidItemSyncRecord> = {}): PlaidItemSyncRecord {
  return {
    id: ITEM,
    userId: USER_A,
    plaidItemId: "item-plaid-1",
    accessToken: ACCESS_TOKEN,
    cursor: null,
    lockId: null,
    lockedAtMs: null,
    ...overrides,
  };
}

function draft(
  overrides: Partial<PlaidObservationDraft> = {}
): PlaidObservationDraft {
  return {
    plaidTransactionId: "txn-posted-1",
    pendingTransactionId: "txn-pending-1",
    accountId: "account-checking",
    amount: -250.15,
    name: "Payroll",
    category: "Transfer / Payroll",
    date: "2026-09-15",
    pending: false,
    ...overrides,
  };
}

function syncPage(overrides: Partial<PlaidSyncPage> = {}): PlaidSyncPage {
  return {
    added: [],
    modified: [],
    removedIds: [],
    nextCursor: "cursor-1",
    hasMore: false,
    ...overrides,
  };
}

function scripted(pages: Record<string, PlaidSyncPage | "fail">) {
  const cursors: Array<string | null> = [];
  return {
    cursors,
    fetchPage: async ({ cursor }: { accessToken: string; cursor: string | null }) => {
      cursors.push(cursor);
      const found = pages[cursor ?? ""] ?? "fail";
      if (found === "fail") return { ok: false as const };
      return { ok: true as const, page: found };
    },
  };
}

describe("Plaid observational transaction sync", () => {
  it("starts the first sync without a cursor", async () => {
    const store = createMemoryPlaidObservationStore({ items: [item()] });
    const plaid = scripted({
      "": syncPage({
        added: [draft()],
        nextCursor: "cursor-1",
      }),
    });

    const result = await syncPlaidItemObservations({
      userId: USER_A,
      itemRowId: ITEM,
      store,
      fetchPage: plaid.fetchPage,
    });

    expect(plaid.cursors).toEqual([null]);
    expect(plaidTransactionsSyncBody(ACCESS_TOKEN, null)).not.toHaveProperty(
      "cursor"
    );
    expect(result).toMatchObject({ status: "synced", pages: 1, added: 1 });
    expect(store.snapshot().items[0]?.cursor).toBe("cursor-1");
  });

  it("requests the next page while has_more is true", async () => {
    const store = createMemoryPlaidObservationStore({ items: [item()] });
    const plaid = scripted({
      "": syncPage({
        added: [draft({ plaidTransactionId: "txn-1", amount: -10 })],
        nextCursor: "cursor-1",
        hasMore: true,
      }),
      "cursor-1": syncPage({
        added: [draft({ plaidTransactionId: "txn-2", amount: 4 })],
        nextCursor: "cursor-2",
        hasMore: false,
      }),
    });

    const result = await syncPlaidItemObservations({
      userId: USER_A,
      itemRowId: ITEM,
      store,
      fetchPage: plaid.fetchPage,
    });

    expect(plaid.cursors).toEqual([null, "cursor-1"]);
    expect(plaidTransactionsSyncBody(ACCESS_TOKEN, "cursor-1").cursor).toBe(
      "cursor-1"
    );
    expect(result).toMatchObject({ status: "synced", pages: 2, added: 2 });
    expect(store.snapshot().observations.map((row) => row.plaidTransactionId)).toEqual(
      ["txn-1", "txn-2"]
    );
  });

  it("advances the cursor only after the observation write succeeds", async () => {
    const inner = createMemoryPlaidObservationStore({ items: [item()] });
    let attempts = 0;
    const store: PlaidObservationSyncStore = {
      claim: (input) => inner.claim(input),
      release: (input) => inner.release(input),
      applyPage: async (input) => {
        attempts += 1;
        if (attempts === 1) return { status: "rejected" };
        return inner.applyPage(input);
      },
    };
    const plaid = scripted({
      "": syncPage({ added: [draft()], nextCursor: "cursor-1" }),
    });

    const failed = await syncPlaidItemObservations({
      userId: USER_A,
      itemRowId: ITEM,
      store,
      fetchPage: plaid.fetchPage,
    });

    expect(failed.status).toBe("failed");
    expect(inner.snapshot().items[0]?.cursor).toBeNull();
    expect(inner.snapshot().observations).toEqual([]);

    const stored = await syncPlaidItemObservations({
      userId: USER_A,
      itemRowId: ITEM,
      store,
      fetchPage: plaid.fetchPage,
    });
    expect(stored.status).toBe("synced");
    expect(inner.snapshot().items[0]?.cursor).toBe("cursor-1");
    expect(inner.snapshot().observations).toHaveLength(1);
  });

  it("persists an added transaction once", async () => {
    const store = createMemoryPlaidObservationStore({ items: [item()] });
    const repeated = draft({ amount: -80 });
    const plaid = scripted({
      "": syncPage({
        added: [repeated, repeated],
        nextCursor: "cursor-1",
      }),
      "cursor-1": syncPage({
        added: [repeated],
        nextCursor: "cursor-2",
      }),
    });

    await syncPlaidItemObservations({
      userId: USER_A,
      itemRowId: ITEM,
      store,
      fetchPage: plaid.fetchPage,
    });
    await syncPlaidItemObservations({
      userId: USER_A,
      itemRowId: ITEM,
      store,
      fetchPage: plaid.fetchPage,
    });

    const rows = store.snapshot().observations;
    expect(rows).toHaveLength(1);
    expect(rows[0]?.amount).toBe(-80);
  });

  it("updates the existing observation when Plaid reports a modification", async () => {
    const store = createMemoryPlaidObservationStore({ items: [item()] });
    const plaid = scripted({
      "": syncPage({
        added: [draft({ amount: 42, pending: true, pendingTransactionId: null })],
        nextCursor: "cursor-1",
      }),
      "cursor-1": syncPage({
        modified: [
          draft({
            amount: 44.5,
            pending: false,
            pendingTransactionId: "txn-pending-1",
            name: "Rent",
          }),
        ],
        nextCursor: "cursor-2",
      }),
    });

    await syncPlaidItemObservations({
      userId: USER_A,
      itemRowId: ITEM,
      store,
      fetchPage: plaid.fetchPage,
    });
    await syncPlaidItemObservations({
      userId: USER_A,
      itemRowId: ITEM,
      store,
      fetchPage: plaid.fetchPage,
    });

    const rows = store.snapshot().observations;
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      amount: 44.5,
      pending: false,
      pendingTransactionId: "txn-pending-1",
      name: "Rent",
      isProcessed: false,
    });
  });

  it("marks a removed transaction id without deleting the observation history", async () => {
    const store = createMemoryPlaidObservationStore({ items: [item()] });
    const plaid = scripted({
      "": syncPage({
        added: [draft({ plaidTransactionId: "txn-pending-1", pending: true })],
        nextCursor: "cursor-1",
      }),
      "cursor-1": syncPage({
        removedIds: ["txn-pending-1"],
        nextCursor: "cursor-2",
      }),
    });

    await syncPlaidItemObservations({
      userId: USER_A,
      itemRowId: ITEM,
      store,
      fetchPage: plaid.fetchPage,
    });
    await syncPlaidItemObservations({
      userId: USER_A,
      itemRowId: ITEM,
      store,
      fetchPage: plaid.fetchPage,
    });

    const rows = store.snapshot().observations;
    expect(rows).toHaveLength(1);
    expect(rows[0]?.removedAt).toEqual(expect.any(String));
    expect(currentPlaidObservations(rows)).toEqual([]);
    expect(store.snapshot().items[0]?.cursor).toBe("cursor-2");
  });

  it("keeps the posted observation when the pending id is removed on the same page", async () => {
    const store = createMemoryPlaidObservationStore({
      items: [item()],
      observations: [
        {
          ...draft({
            plaidTransactionId: "txn-pending-1",
            pendingTransactionId: null,
            pending: true,
            amount: -250.15,
          }),
          userId: USER_A,
          removedAt: null,
          isProcessed: false,
        },
      ],
    });

    await syncPlaidItemObservations({
      userId: USER_A,
      itemRowId: ITEM,
      store,
      fetchPage: async () => ({
        ok: true,
        page: syncPage({
          added: [
            draft({
              plaidTransactionId: "txn-posted-1",
              pendingTransactionId: "txn-pending-1",
              pending: false,
              amount: -250.15,
            }),
          ],
          removedIds: ["txn-pending-1"],
          nextCursor: "cursor-1",
        }),
      }),
    });

    const current = currentPlaidObservations(store.snapshot().observations);
    expect(current).toHaveLength(1);
    expect(current[0]).toMatchObject({
      plaidTransactionId: "txn-posted-1",
      pendingTransactionId: "txn-pending-1",
      amount: -250.15,
    });
    expect(
      store.snapshot().observations.find((row) => row.plaidTransactionId === "txn-pending-1")
        ?.removedAt
    ).toEqual(expect.any(String));
  });

  it("preserves pending_transaction_id and Plaid amount signs", () => {
    const parsed = parsePlaidTransactionsSyncResponse({
      added: [
        {
          transaction_id: "txn-posted-1",
          pending_transaction_id: "txn-pending-1",
          account_id: "account-checking",
          amount: -250.15,
          name: "Payroll",
          category: ["Transfer", "Payroll"],
          date: "2026-09-15",
          pending: false,
        },
      ],
      modified: [
        {
          transaction_id: "txn-rent",
          account_id: "account-checking",
          amount: 40,
          name: "Rent",
          personal_finance_category: { primary: "RENT_AND_UTILITIES" },
          date: "2026-09-01",
          pending: false,
        },
      ],
      removed: [{ transaction_id: "txn-pending-1" }],
      next_cursor: "cursor-1",
      has_more: false,
    });

    expect(parsed?.added[0]).toMatchObject({
      pendingTransactionId: "txn-pending-1",
      amount: -250.15,
      category: "Transfer / Payroll",
    });
    expect(parsed?.modified[0]).toMatchObject({
      amount: 40,
      pendingTransactionId: null,
      category: "RENT_AND_UTILITIES",
    });
    expect(parsed?.removedIds).toEqual(["txn-pending-1"]);
  });

  it("is idempotent when the same page is applied again", async () => {
    const store = createMemoryPlaidObservationStore({ items: [item()] });
    const plaid = scripted({
      "": syncPage({ added: [draft()], nextCursor: "cursor-1" }),
      "cursor-1": syncPage({
        added: [draft()],
        removedIds: [],
        nextCursor: "cursor-2",
      }),
      "cursor-2": syncPage({ nextCursor: "cursor-3" }),
    });

    await syncPlaidItemObservations({
      userId: USER_A,
      itemRowId: ITEM,
      store,
      fetchPage: plaid.fetchPage,
    });
    await syncPlaidItemObservations({
      userId: USER_A,
      itemRowId: ITEM,
      store,
      fetchPage: plaid.fetchPage,
    });
    await syncPlaidItemObservations({
      userId: USER_A,
      itemRowId: ITEM,
      store,
      fetchPage: plaid.fetchPage,
    });

    expect(store.snapshot().observations).toHaveLength(1);
    expect(store.snapshot().observations[0]?.amount).toBe(-250.15);
    expect(store.snapshot().items[0]?.cursor).toBe("cursor-3");
  });

  it("does not advance the cursor when a later page fails", async () => {
    const store = createMemoryPlaidObservationStore({ items: [item()] });
    const plaid = scripted({
      "": syncPage({
        added: [draft()],
        nextCursor: "cursor-1",
        hasMore: true,
      }),
      "cursor-1": "fail",
    });

    const result = await syncPlaidItemObservations({
      userId: USER_A,
      itemRowId: ITEM,
      store,
      fetchPage: plaid.fetchPage,
    });

    expect(result.status).toBe("failed");
    expect(plaid.cursors).toEqual([null, "cursor-1"]);
    expect(store.snapshot().items[0]?.cursor).toBe("cursor-1");
    expect(store.snapshot().observations).toHaveLength(1);
    expect(store.snapshot().items[0]?.lockId).toBeNull();
  });

  it("refuses to sync an item owned by someone else", async () => {
    const store = createMemoryPlaidObservationStore({ items: [item()] });
    let fetches = 0;
    const result = await syncPlaidItemObservations({
      userId: USER_B,
      itemRowId: ITEM,
      store,
      fetchPage: async () => {
        fetches += 1;
        return { ok: false };
      },
    });

    expect(result.status).toBe("not_found");
    expect(fetches).toBe(0);
    expect(JSON.stringify(result)).not.toContain(ACCESS_TOKEN);
    expect(store.snapshot().items[0]?.cursor).toBeNull();
    expect(store.snapshot().items[0]?.userId).toBe(USER_A);
  });

  it("keeps the access token out of the client response", async () => {
    const store = createMemoryPlaidObservationStore({ items: [item()] });
    const result = await syncPlaidItemObservations({
      userId: USER_A,
      itemRowId: ITEM,
      store,
      fetchPage: async ({ accessToken, cursor }) => {
        expect(accessToken).toBe(ACCESS_TOKEN);
        expect(cursor).toBeNull();
        return {
          ok: true,
          page: syncPage({ added: [draft()], nextCursor: "cursor-1" }),
        };
      },
    });

    const http = plaidSyncHttpResult(result);
    expect(http.status).toBe(200);
    expect(Object.keys(http.body).sort()).toEqual([
      "added",
      "modified",
      "pages",
      "removed",
      "status",
    ]);
    expect(JSON.stringify(http)).not.toContain(ACCESS_TOKEN);
    expect(http.body).not.toHaveProperty("accessToken");
    expect(http.body).not.toHaveProperty("cursor");
  });

  it("does not put Plaid observations into the wealth engine vault", () => {
    expect([...CLOUD_VAULT_DATA_KEYS]).toEqual([
      "incomes",
      "expenses",
      "debts",
      "allocations",
      "budgetTargets",
      "accounts",
      "displayName",
      "activityLog",
      "emergencyShield",
      "periodArchives",
      "lastClosedMonthKey",
      "expenseSemanticsVersion",
      "openingWealthBuilding",
      "openingEmergencyFund",
      "recurringObligations",
    ]);
    expect(LEDGER_BACKUP_VERSION).toBe(5);
    expect(PLAID_OBSERVATION_COLUMNS).not.toContain("access_token");

    const files = [
      "lib/babylon/plaid-transaction-sync.ts",
      "lib/babylon/plaid-observation-store.ts",
      "lib/babylon/plaid-sync-fetch.ts",
      "lib/babylon/plaid-item-persist.ts",
      "app/api/plaid/sync-transactions/route.ts",
      "app/api/plaid/exchange-token/route.ts",
      "supabase/migrations/20260926_plaid_transaction_sync.sql",
    ];
    for (const file of files) {
      const source = readFileSync(resolve(process.cwd(), file), "utf8");
      expect(source).not.toContain('.from("wealth_engine_vaults")');
      expect(source).not.toContain("allocateIncome");
      expect(source).not.toContain("vault-sync");
      expect(source).not.toContain("cloud-vault");
    }

    const reader = readFileSync(
      resolve(process.cwd(), "lib/babylon/plaid-client.ts"),
      "utf8"
    );
    expect(reader).toContain('.from("plaid_transactions")');
    expect(reader).toContain('.is("removed_at", null)');
    expect(reader).not.toContain("wealth_engine_vaults");
  });

  it("does not let a second sync move the cursor backward", async () => {
    const store = createMemoryPlaidObservationStore({ items: [item()] });
    let releaseFirst: (() => void) | undefined;
    const gate = new Promise<void>((resolveGate) => {
      releaseFirst = resolveGate;
    });
    let entered = false;
    const fetchPage = async ({ cursor }: { cursor: string | null }) => {
      if (!entered) {
        entered = true;
        await gate;
      }
      return {
        ok: true as const,
        page: syncPage({
          added: [draft()],
          nextCursor: cursor === null ? "cursor-1" : "cursor-should-not-apply",
        }),
      };
    };

    const firstPromise = syncPlaidItemObservations({
      userId: USER_A,
      itemRowId: ITEM,
      store,
      fetchPage,
      createLockId: () => "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
    });
    await waitUntil(() => entered);
    const second = await syncPlaidItemObservations({
      userId: USER_A,
      itemRowId: ITEM,
      store,
      fetchPage,
    });
    releaseFirst?.();
    const first = await firstPromise;

    expect(second.status).toBe("busy");
    expect(first.status).toBe("synced");
    expect(store.snapshot().items[0]?.cursor).toBe("cursor-1");

    const held = store.snapshot();
    held.items[0] = {
      ...held.items[0],
      lockId: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
      lockedAtMs: 1,
    };
    const regressed = applySyncPage(held.items, held.observations, {
      userId: USER_A,
      itemRowId: ITEM,
      lockId: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
      expectedCursor: null,
      nextCursor: "cursor-old",
      drafts: [draft({ amount: 1 })],
      removedIds: [],
      nowMs: 10,
      removedAt: "2026-09-25T00:00:00.000Z",
    });
    expect(regressed.status).toBe("cursor_conflict");
    expect(regressed.items[0]?.cursor).toBe("cursor-1");
    expect(regressed.observations[0]?.amount).toBe(-250.15);
  });

  it("still saves a new link and refuses to reassign an existing item", async () => {
    expect(planPlaidItemPersist(null, USER_A)).toBe("insert");
    expect(planPlaidItemPersist(USER_A, USER_A)).toBe("update");
    expect(planPlaidItemPersist(USER_B, USER_A)).toBe("reject");

    const created = await persistExchangedPlaidItem(memoryGateway(null).gateway, {
      actorUserId: USER_A,
      plaidItemId: "item-plaid-1",
      accessToken: ACCESS_TOKEN,
      institutionName: "First Bank",
    });
    expect(created.status).toBe("saved");
    if (created.status === "saved") {
      expect(created.item).not.toHaveProperty("accessToken");
      expect(created.item.userId).toBe(USER_A);
    }

    const owned = memoryGateway({
      id: ITEM,
      userId: USER_A,
    });
    const updated = await persistExchangedPlaidItem(owned.gateway, {
      actorUserId: USER_A,
      plaidItemId: "item-plaid-1",
      accessToken: "access-sandbox-refreshed",
      institutionName: "First Bank",
    });
    expect(updated.status).toBe("saved");
    expect(owned.updates).toEqual([
      {
        rowId: ITEM,
        actorUserId: USER_A,
        accessToken: "access-sandbox-refreshed",
        institutionName: "First Bank",
      },
    ]);
    expect(owned.inserts).toBe(0);

    const foreign = memoryGateway({ id: ITEM, userId: USER_B });
    const rejected = await persistExchangedPlaidItem(foreign.gateway, {
      actorUserId: USER_A,
      plaidItemId: "item-plaid-1",
      accessToken: ACCESS_TOKEN,
      institutionName: "First Bank",
    });
    expect(rejected.status).toBe("owned_elsewhere");
    expect(foreign.updates).toEqual([]);
    expect(foreign.inserts).toBe(0);

    const link = readFileSync(
      resolve(process.cwd(), "app/api/plaid/link-token/route.ts"),
      "utf8"
    );
    const exchange = readFileSync(
      resolve(process.cwd(), "app/api/plaid/exchange-token/route.ts"),
      "utf8"
    );
    expect(link).toContain('products: ["transactions"]');
    expect(exchange).toContain("persistExchangedPlaidItem");
    expect(exchange).not.toContain(".upsert(");
    expect(exchange).toContain("PLAID_ITEM_PUBLIC_COLUMNS");
  });

  it("keeps the sync RPC executable only by the service role", () => {
    const migration = readFileSync(
      resolve(process.cwd(), "supabase/migrations/20260926_plaid_transaction_sync.sql"),
      "utf8"
    );
    const route = readFileSync(
      resolve(process.cwd(), "app/api/plaid/sync-transactions/route.ts"),
      "utf8"
    );
    const store = readFileSync(
      resolve(process.cwd(), "lib/babylon/plaid-observation-store.ts"),
      "utf8"
    );

    expect(migration).not.toContain("SECURITY DEFINER");
    expect(migration.match(/SECURITY INVOKER/g)).toHaveLength(3);
    expect(migration.match(/SET search_path = public/g)).toHaveLength(3);

    const signatures = [
      "public.claim_plaid_transaction_sync(uuid, uuid, uuid, timestamptz)",
      "public.apply_plaid_sync_page(uuid, uuid, uuid, text, text, jsonb, text[])",
      "public.release_plaid_transaction_sync(uuid, uuid, uuid)",
    ];
    for (const signature of signatures) {
      expect(migration).toContain(`REVOKE ALL ON FUNCTION ${signature}`);
      expect(migration).toContain(`GRANT EXECUTE ON FUNCTION ${signature}`);
    }
    expect(migration.match(/FROM PUBLIC, anon, authenticated;/g)).toHaveLength(3);
    expect(migration.match(/TO service_role;/g)).toHaveLength(3);
    expect(migration).not.toMatch(/GRANT EXECUTE[\s\S]*TO (PUBLIC|anon|authenticated)/);

    const claim = migration.slice(
      migration.indexOf("FUNCTION public.claim_plaid_transaction_sync"),
      migration.indexOf("FUNCTION public.apply_plaid_sync_page")
    );
    const apply = migration.slice(
      migration.indexOf("FUNCTION public.apply_plaid_sync_page"),
      migration.indexOf("FUNCTION public.release_plaid_transaction_sync")
    );
    const release = migration.slice(
      migration.indexOf("FUNCTION public.release_plaid_transaction_sync")
    );
    expect(claim.indexOf("auth.role()")).toBeGreaterThan(-1);
    expect(claim.indexOf("auth.role()")).toBeLessThan(claim.indexOf("claimed.access_token"));
    expect(claim).toContain("user_id = actor_user_id");
    expect(apply).not.toContain("access_token");
    expect(apply).toContain("found_item.user_id IS DISTINCT FROM actor_user_id");
    expect(apply).toContain("sync_lock_id IS DISTINCT FROM lock_token");
    expect(apply).toContain("transactions_cursor IS NOT DISTINCT FROM expected_cursor");
    expect(apply).toContain("user_id,\n          plaid_transaction_id");
    expect(release).not.toContain("access_token");
    expect(release).toContain("sync_lock_id = lock_token");
    expect(release).toContain("user_id = actor_user_id");

    expect(route).toContain("requireAuthenticatedUser");
    expect(route).toContain("userId: auth.user.id");
    expect(route).toContain("getSupabaseServiceClient");
    expect(route).toContain("plaidSyncHttpResult");
    expect(route).not.toContain("access_token");
    expect(route).not.toContain("accessToken");
    expect(store).toContain('rpc("claim_plaid_transaction_sync"');
    expect(store).toContain('rpc("apply_plaid_sync_page"');
    expect(store).toContain('rpc("release_plaid_transaction_sync"');
    expect(store).not.toContain("console.log");
  });

  it("leaves the WE-SYNC-004 vault cycle untouched", () => {
    const vaultSync = readFileSync(
      resolve(process.cwd(), "lib/babylon/vault-sync.ts"),
      "utf8"
    );
    const cloudVault = readFileSync(
      resolve(process.cwd(), "lib/babylon/cloud-vault.ts"),
      "utf8"
    );
    const migration = readFileSync(
      resolve(process.cwd(), "supabase/migrations/20260926_plaid_transaction_sync.sql"),
      "utf8"
    );
    expect(vaultSync).not.toContain("plaid");
    expect(cloudVault).not.toContain("plaid_transactions");
    expect(migration).toContain("transactions_cursor");
    expect(migration).toContain("pending_transaction_id");
    expect(migration).toContain("IS NOT DISTINCT FROM");
    expect(migration).toContain("sync_lock_id");
    expect(migration).not.toContain("wealth_engine_vaults (");
    expect(migration).not.toMatch(/ALTER TABLE public\.wealth_engine_vaults/);
    expect(migration).not.toMatch(/UPDATE public\.wealth_engine_vaults/);
    expect(
      toPlaidObservationPublic({
        id: "obs-1",
        user_id: USER_A,
        plaid_transaction_id: "txn-posted-1",
        pending_transaction_id: "txn-pending-1",
        account_id: "account-checking",
        amount: "-250.15",
        name: "Payroll",
        category: null,
        date: "2026-09-15",
        pending: false,
        removed_at: null,
      })?.amount
    ).toBe(-250.15);
    expect(
      toPlaidObservationPublic({
        id: "obs-1",
        user_id: USER_A,
        plaid_transaction_id: "txn-posted-1",
        pending_transaction_id: null,
        account_id: "account-checking",
        amount: 10,
        name: "Old",
        category: null,
        date: "2026-09-01",
        pending: false,
        removed_at: "2026-09-25T00:00:00.000Z",
      })
    ).toBeNull();
  });
});

function memoryGateway(existing: { id: string; userId: string } | null): {
  gateway: PlaidItemWriteGateway;
  updates: Array<{
    rowId: string;
    actorUserId: string;
    accessToken: string;
    institutionName: string;
  }>;
  inserts: number;
} {
  let row = existing;
  const updates: Array<{
    rowId: string;
    actorUserId: string;
    accessToken: string;
    institutionName: string;
  }> = [];
  let inserts = 0;
  const gateway: PlaidItemWriteGateway = {
    async findByPlaidItemId() {
      return row;
    },
    async updateOwnedItem(rowId, actorUserId, accessToken, institutionName) {
      updates.push({ rowId, actorUserId, accessToken, institutionName });
      if (!row || row.id !== rowId || row.userId !== actorUserId) return null;
      return {
        id: row.id,
        userId: row.userId,
        itemId: "item-plaid-1",
        institutionName,
        createdAt: "2026-09-25T00:00:00.000Z",
      };
    },
    async insertItem(input) {
      inserts += 1;
      if (row) return { ok: false, conflict: true };
      row = { id: ITEM, userId: input.actorUserId };
      return {
        ok: true,
        item: {
          id: ITEM,
          userId: input.actorUserId,
          itemId: input.plaidItemId,
          institutionName: input.institutionName,
          createdAt: "2026-09-25T00:00:00.000Z",
        },
      };
    },
  };
  return {
    gateway,
    get updates() {
      return updates;
    },
    get inserts() {
      return inserts;
    },
  };
}

async function waitUntil(ready: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    if (ready()) return;
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  throw new Error("timed out waiting for the first sync to claim the item");
}
