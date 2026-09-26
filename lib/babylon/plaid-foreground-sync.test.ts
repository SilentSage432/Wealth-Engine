import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EMPTY_STATE } from "@/lib/babylon/constants";
import { emitVaultToast } from "@/lib/babylon/vault-toast";
import {
  resetForegroundObservationSyncSession,
  startForegroundObservationSync,
} from "@/lib/babylon/plaid-foreground-sync";
import { requestPlaidObservationSync } from "@/lib/babylon/plaid-client";
import {
  buildLedgerBackup,
  LEDGER_BACKUP_VERSION,
} from "@/lib/babylon/persistence";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";

vi.mock("@/lib/supabase/client", () => ({
  getSupabaseBrowserClient: vi.fn(),
}));

vi.mock("@/lib/babylon/vault-toast", () => ({
  emitVaultToast: vi.fn(),
}));

const ITEM_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const ITEM_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const SESSION_BEARER = "session-bearer";

function source(path: string): string {
  return readFileSync(resolve(process.cwd(), path), "utf8");
}

function session(token: string | null) {
  vi.mocked(getSupabaseBrowserClient).mockReturnValue({
    auth: {
      getSession: async () => ({
        data: { session: token ? { access_token: token } : null },
      }),
    },
  } as never);
}

describe("foreground observation sync", () => {
  beforeEach(() => {
    resetForegroundObservationSyncSession();
    vi.mocked(emitVaultToast).mockClear();
    session(SESSION_BEARER);
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        json: async () => ({ status: "synced", added: 0, modified: 0, removed: 0, pages: 1 }),
      }))
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    resetForegroundObservationSyncSession();
  });

  it("does not sync while signed out", () => {
    const request = vi.fn();
    startForegroundObservationSync({
      authenticated: true,
      itemsReady: true,
      itemIds: [ITEM_A],
      request,
    });
    const due = startForegroundObservationSync({
      authenticated: false,
      itemsReady: true,
      itemIds: [ITEM_A, ITEM_B],
      request,
    });
    const afterSignIn = startForegroundObservationSync({
      authenticated: true,
      itemsReady: true,
      itemIds: [ITEM_A],
      request,
    });
    expect(due).toEqual([]);
    expect(afterSignIn).toEqual([ITEM_A]);
    expect(request).toHaveBeenCalledTimes(2);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("requests sync once for each signed-in Item through the session bearer", async () => {
    const request = vi.fn();
    const first = startForegroundObservationSync({
      authenticated: true,
      itemsReady: true,
      itemIds: [ITEM_A, ITEM_B],
      request,
    });
    const again = startForegroundObservationSync({
      authenticated: true,
      itemsReady: true,
      itemIds: [ITEM_B, ITEM_A],
      request,
    });

    expect(first).toEqual([ITEM_A, ITEM_B]);
    expect(again).toEqual([]);
    expect(request).toHaveBeenCalledTimes(2);
    expect(request).toHaveBeenNthCalledWith(1, ITEM_A);
    expect(request).toHaveBeenNthCalledWith(2, ITEM_B);

    await requestPlaidObservationSync(ITEM_A);
    expect(fetch).toHaveBeenCalledTimes(1);
    const [url, init] = vi.mocked(fetch).mock.calls[0] ?? [];
    expect(url).toBe("/api/plaid/sync-transactions");
    expect(init).toMatchObject({
      method: "POST",
      body: JSON.stringify({ id: ITEM_A }),
      headers: {
        Authorization: `Bearer ${SESSION_BEARER}`,
        "Content-Type": "application/json",
      },
    });
    const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
    expect(body).toEqual({ id: ITEM_A });
    expect(body).not.toHaveProperty("access_token");
    expect(emitVaultToast).not.toHaveBeenCalled();
  });

  it("does not repeat a cycle on re-render or a second effect pass", () => {
    const request = vi.fn();
    const input = {
      authenticated: true,
      itemsReady: true,
      itemIds: [ITEM_A],
      request,
    };
    startForegroundObservationSync(input);
    startForegroundObservationSync(input);
    expect(request).toHaveBeenCalledTimes(1);
  });

  it("syncs a newly connected Item and leaves the earlier Item alone", () => {
    const request = vi.fn();
    startForegroundObservationSync({
      authenticated: true,
      itemsReady: true,
      itemIds: [ITEM_A],
      request,
    });
    const added = startForegroundObservationSync({
      authenticated: true,
      itemsReady: true,
      itemIds: [ITEM_A, ITEM_B],
      request,
    });
    expect(added).toEqual([ITEM_B]);
    expect(request).toHaveBeenCalledTimes(2);
    expect(request).toHaveBeenLastCalledWith(ITEM_B);
  });

  it("waits until the Item list is ready and does not ask again during a refetch", () => {
    const request = vi.fn();
    startForegroundObservationSync({
      authenticated: true,
      itemsReady: false,
      itemIds: [ITEM_A],
      request,
    });
    expect(request).not.toHaveBeenCalled();

    startForegroundObservationSync({
      authenticated: true,
      itemsReady: true,
      itemIds: [ITEM_A, ITEM_B],
      request,
    });
    startForegroundObservationSync({
      authenticated: true,
      itemsReady: false,
      itemIds: [ITEM_A, ITEM_B],
      request,
    });
    startForegroundObservationSync({
      authenticated: true,
      itemsReady: true,
      itemIds: [ITEM_A, ITEM_B],
      request,
    });
    expect(request.mock.calls.map((call) => call[0])).toEqual([ITEM_A, ITEM_B]);
  });

  it("does not call the route without a session bearer", async () => {
    session(null);
    const ok = await requestPlaidObservationSync(ITEM_A);
    expect(ok).toBe(false);
    expect(fetch).not.toHaveBeenCalled();
    expect(emitVaultToast).not.toHaveBeenCalled();
  });

  it("keeps a failed observation sync outside Wealth Engine state", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: false,
        json: async () => ({ error: "Couldn't refresh bank transactions.", code: "sync_failed" }),
      }))
    );
    const vault = { revision: 4, vault_data: { income: [{ amount: 10 }] } };
    const before = structuredClone(vault);
    const ok = await requestPlaidObservationSync(ITEM_A);
    expect(ok).toBe(false);
    expect(vault).toEqual(before);
    expect(emitVaultToast).not.toHaveBeenCalled();
    expect(fetch).toHaveBeenCalledTimes(1);
    error.mockRestore();
  });

  it("keeps a successful observation sync outside Wealth Engine state", async () => {
    const vault = { revision: 4, vault_data: { expenses: [{ amount: 3 }] } };
    const before = structuredClone(vault);
    const backup = buildLedgerBackup(EMPTY_STATE);
    const ok = await requestPlaidObservationSync(ITEM_A);
    expect(ok).toBe(true);
    expect(vault).toEqual(before);
    expect(backup.version).toBe(5);
    expect(LEDGER_BACKUP_VERSION).toBe(5);
    expect(EMPTY_STATE).not.toHaveProperty("plaidTransactions");
  });

  it("keeps the browser caller on the authenticated route and off the vault", () => {
    const client = source("lib/babylon/plaid-client.ts");
    const planner = source("lib/babylon/plaid-foreground-sync.ts");
    const hook = source("hooks/usePlaidConnections.ts");
    const worker = source("public/sw.js");
    const vaultSync = source("lib/babylon/vault-sync.ts");
    const cloudVault = source("lib/babylon/cloud-vault.ts");
    const serverSync = source("lib/babylon/plaid-transaction-sync.ts");

    const syncFn = client.slice(
      client.indexOf("export async function requestPlaidObservationSync"),
      client.indexOf("export async function startPlaidLinkExchange")
    );
    expect(syncFn).toContain('body: JSON.stringify({ id })');
    expect(syncFn).toContain('"/api/plaid/sync-transactions"');
    expect(syncFn).toContain("plaidApiFetch");
    expect(syncFn).not.toContain("access_token");
    expect(syncFn).not.toContain("PLAID_SECRET");
    expect(client).toContain("authBearer()");
    expect(client).not.toContain("localStorage");
    expect(client).not.toContain("SUPABASE_SERVICE_ROLE_KEY");
    expect(planner).not.toContain("access_token");
    expect(planner).not.toContain("localStorage");
    expect(hook.match(/startForegroundObservationSync\(/g)).toHaveLength(1);
    expect(hook).toContain("requestPlaidObservationSync");
    expect(hook).not.toContain("setInterval");
    expect(hook).not.toContain("setTimeout");
    expect(hook).not.toContain("visibilitychange");
    expect(hook).not.toContain("serviceWorker");
    expect(hook).not.toContain("access_token");
    expect(hook).not.toContain("wealth_engine_vaults");
    expect(worker).not.toContain("sync-transactions");
    expect(vaultSync).not.toContain("plaid");
    expect(cloudVault).not.toContain("plaid_transactions");
    expect(cloudVault).not.toContain("requestPlaidObservationSync");
    expect(serverSync).toContain('status: "busy"');

    for (const file of [client, planner, hook]) {
      expect(file).not.toContain("vault-sync");
      expect(file).not.toContain("cloud-vault");
      expect(file).not.toContain("allocateIncome");
      expect(file).not.toContain("vault_data");
    }
  });
});
