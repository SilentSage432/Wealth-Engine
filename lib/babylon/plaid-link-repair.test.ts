import { afterEach, describe, expect, it, vi } from "vitest";
import { NextResponse } from "next/server";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

vi.mock("server-only", () => ({}));

const requireAuthenticatedUser = vi.fn();
const getSupabaseServiceClient = vi.fn();
vi.mock("@/lib/supabase/server", () => ({
  requireAuthenticatedUser: (...args: unknown[]) => requireAuthenticatedUser(...args),
  getSupabaseServiceClient: () => getSupabaseServiceClient(),
}));

const plaidFetch = vi.fn();
vi.mock("@/lib/babylon/plaid-server", async () => {
  const actual = await vi.importActual<typeof import("@/lib/babylon/plaid-server")>(
    "@/lib/babylon/plaid-server"
  );
  return {
    ...actual,
    plaidFetch: (...args: unknown[]) => plaidFetch(...args),
  };
});

import { POST } from "@/app/api/plaid/link-token/route";

const CANONICAL = "https://nklmgzxxdhuvqayhcigp.supabase.co";
const OWNER = "11111111-1111-4111-8111-111111111111";
const OTHER = "22222222-2222-4222-8222-222222222222";
const ITEM = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const TOKEN = "access-sandbox-secret-token";

describe("POST /api/plaid/link-token connect vs repair", () => {
  const previous: Record<string, string | undefined> = {};

  afterEach(() => {
    requireAuthenticatedUser.mockReset();
    getSupabaseServiceClient.mockReset();
    plaidFetch.mockReset();
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

  function post(body?: unknown) {
    return POST(
      new Request("https://wealth-engine.example/api/plaid/link-token", {
        method: "POST",
        body: body === undefined ? undefined : JSON.stringify(body),
        headers: body === undefined ? undefined : { "Content-Type": "application/json" },
      })
    );
  }

  it("keeps initial connect on products without an access_token", async () => {
    signedIn();
    plaidFetch.mockResolvedValue({
      ok: true,
      data: { link_token: "link-connect", expiration: "2030-01-01" },
    });
    const response = await post();
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      link_token: "link-connect",
      expiration: "2030-01-01",
    });
    expect(plaidFetch).toHaveBeenCalledWith("/link/token/create", {
      user: { client_user_id: OWNER },
      client_name: "Wealth Engine",
      products: ["transactions"],
      country_codes: ["US"],
      language: "en",
    });
    expect(JSON.stringify(plaidFetch.mock.calls)).not.toContain("access_token");
  });

  it("creates update-mode Link with the owned Item access_token and no products", async () => {
    signedIn();
    getSupabaseServiceClient.mockReturnValue({
      from(table: string) {
        expect(table).toBe("plaid_items");
        return {
          select(columns: string) {
            expect(columns).toBe("access_token");
            return {
              eq(column: string, value: string) {
                if (column === "id") {
                  expect(value).toBe(ITEM);
                  return {
                    eq(innerColumn: string, innerValue: string) {
                      expect(innerColumn).toBe("user_id");
                      expect(innerValue).toBe(OWNER);
                      return {
                        maybeSingle: async () => ({
                          data: { access_token: TOKEN },
                          error: null,
                        }),
                      };
                    },
                  };
                }
                throw new Error(`unexpected eq ${column}`);
              },
            };
          },
        };
      },
    });
    plaidFetch.mockResolvedValue({
      ok: true,
      data: { link_token: "link-repair", expiration: "2030-01-01" },
    });
    const response = await post({ item: ITEM });
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toEqual({
      link_token: "link-repair",
      expiration: "2030-01-01",
    });
    expect(JSON.stringify(body)).not.toContain(TOKEN);
    expect(plaidFetch).toHaveBeenCalledWith("/link/token/create", {
      user: { client_user_id: OWNER },
      client_name: "Wealth Engine",
      country_codes: ["US"],
      language: "en",
      access_token: TOKEN,
    });
    const createBody = plaidFetch.mock.calls[0]?.[1] as Record<string, unknown>;
    expect(createBody).not.toHaveProperty("products");
  });

  it("fails closed for a foreign or missing Item", async () => {
    signedIn();
    getSupabaseServiceClient.mockReturnValue({
      from() {
        return {
          select() {
            return {
              eq() {
                return {
                  eq() {
                    return {
                      maybeSingle: async () => ({ data: null, error: null }),
                    };
                  },
                };
              },
            };
          },
        };
      },
    });
    const response = await post({ item: ITEM });
    expect(response.status).toBe(404);
    expect(plaidFetch).not.toHaveBeenCalled();
  });

  it("requires authentication for repair", async () => {
    requireAuthenticatedUser.mockResolvedValue(
      NextResponse.json({ error: "Unauthorized." }, { status: 401 })
    );
    const response = await post({ item: ITEM });
    expect(response.status).toBe(401);
    expect(plaidFetch).not.toHaveBeenCalled();
    expect(getSupabaseServiceClient).not.toHaveBeenCalled();
  });

  it("does not leak access_token when owner filter excludes another user", async () => {
    signedIn();
    getSupabaseServiceClient.mockReturnValue({
      from() {
        return {
          select() {
            return {
              eq(column: string, value: string) {
                if (column === "id" && value === ITEM) {
                  return {
                    eq(innerColumn: string, innerValue: string) {
                      expect(innerColumn).toBe("user_id");
                      expect(innerValue).toBe(OWNER);
                      expect(innerValue).not.toBe(OTHER);
                      return {
                        maybeSingle: async () => ({ data: null, error: null }),
                      };
                    },
                  };
                }
                throw new Error("unexpected");
              },
            };
          },
        };
      },
    });
    await post({ item: ITEM });
    expect(plaidFetch).not.toHaveBeenCalled();
  });
});

describe("repair mode ownership in the client and hook", () => {
  it("keeps connect and repair Link APIs distinct and never exchanges on repair", () => {
    const client = readFileSync(
      resolve(process.cwd(), "lib/babylon/plaid-client.ts"),
      "utf8"
    );
    const hook = readFileSync(
      resolve(process.cwd(), "hooks/usePlaidConnections.ts"),
      "utf8"
    );
    expect(client).toContain("export async function requestPlaidUpdateLinkToken");
    expect(client).toContain('body: JSON.stringify({ item: id })');
    expect(hook).toContain("launchRepair");
    expect(hook).toContain('linkModeRef.current = "repair"');
    const repairSuccess = hook.slice(
      hook.indexOf('if (mode === "repair")'),
      hook.indexOf("if (!publicToken)")
    );
    expect(repairSuccess).toContain("requestForegroundBalanceRefresh");
    expect(repairSuccess).not.toContain("startPlaidLinkExchange");
    expect(repairSuccess).not.toContain("exchangePlaidPublicToken");
    expect(hook).toContain("startPlaidLinkExchange");
    expect(hook).toContain('linkModeRef.current = "connect"');
    expect(hook).toContain("createPlaidLinkTokenOrToast");
    expect(hook.indexOf("launchRepair")).toBeGreaterThan(
      hook.indexOf("launchLink")
    );
  });

  it("surfaces Reconnect bank on desktop and mobile Connections", () => {
    const card = readFileSync(
      resolve(process.cwd(), "components/babylon/connected-banks-card.tsx"),
      "utf8"
    );
    const more = readFileSync(
      resolve(process.cwd(), "components/babylon/mobile-more.tsx"),
      "utf8"
    );
    const dashboard = readFileSync(
      resolve(process.cwd(), "components/babylon/wealth-engine-dashboard.tsx"),
      "utf8"
    );
    expect(card).toContain("Bank connection needs attention");
    expect(card).toContain("Reconnect bank");
    expect(card).toContain("onRepair");
    expect(more).toContain("onRepairBank");
    expect(more).toContain("repairs={repairs}");
    expect(dashboard).toContain("launchRepair");
    expect(dashboard).toContain("onRepair={handleRepairBank}");
  });
});
