import { NextResponse } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const requireAuthenticatedUser = vi.fn();
const createUserSupabaseClient = vi.fn();

vi.mock("@/lib/supabase/server", () => ({
  requireAuthenticatedUser: (...args: unknown[]) => requireAuthenticatedUser(...args),
  createUserSupabaseClient: (...args: unknown[]) => createUserSupabaseClient(...args),
  getSupabaseServiceClient: () => {
    throw new Error("Paid must not use the service role");
  },
}));

import { serializeCloudVaultData } from "@/lib/babylon/cloud-vault";
import { EMPTY_STATE } from "@/lib/babylon/constants";
import { POST } from "@/app/api/vault/mark-occurrence-paid/route";
import type { ExpenseEntry, PersistedState } from "@/types/babylon";

const OWNER = "11111111-1111-4111-8111-111111111111";

function expense(): ExpenseEntry {
  return {
    id: "groceries",
    name: "Groceries",
    category: "need",
    amount: 40,
    date: "2026-01-03",
    dueDate: "2026-01-03",
    isSettled: false,
  };
}

function state(): PersistedState {
  return {
    ...EMPTY_STATE,
    financialTimeZone: "America/Denver",
    expenses: [expense()],
  };
}

function body(extra?: Record<string, unknown>) {
  return {
    occurrenceId: "groceries",
    preimage: {
      name: "Groceries",
      amount: 40,
      category: "need",
      dueDate: "2026-01-03",
      budgetCategoryId: null,
      recurringObligationId: null,
      recurrenceMonth: null,
      isSettled: false,
    },
    ...extra,
  };
}

function request(payload: unknown, query = ""): Request {
  return new Request(`https://wealth.example/api/vault/mark-occurrence-paid${query}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: "Bearer token" },
    body: JSON.stringify(payload),
  });
}

beforeEach(() => {
  requireAuthenticatedUser.mockReset();
  createUserSupabaseClient.mockReset();
});

describe("POST /api/vault/mark-occurrence-paid", () => {
  it("rejects an unauthenticated caller before reading a vault", async () => {
    requireAuthenticatedUser.mockResolvedValue(
      NextResponse.json({ error: "Sign in required." }, { status: 401 })
    );
    const response = await POST(request(body()));
    expect(response.status).toBe(401);
    expect(createUserSupabaseClient).not.toHaveBeenCalled();
  });

  it("rejects vault data, a user id, a timezone, and a payment date before opening the vault", async () => {
    requireAuthenticatedUser.mockResolvedValue({
      user: { id: OWNER },
      accessToken: "token",
    });
    for (const extra of [
      { vault_data: { expenses: [] } },
      { userId: "22222222-2222-4222-8222-222222222222" },
      { financialTimeZone: "America/Chicago" },
      { paymentDate: "2026-10-01" },
    ]) {
      const response = await POST(request(body(extra)));
      expect(response.status).toBe(400);
    }
    const queried = await POST(request(body(), "?userId=22222222-2222-4222-8222-222222222222"));
    expect(queried.status).toBe(400);
    expect(createUserSupabaseClient).not.toHaveBeenCalled();
  });

  it("pays through the authenticated user client and returns the bounded result", async () => {
    requireAuthenticatedUser.mockResolvedValue({
      user: { id: OWNER },
      accessToken: "token",
    });
    const reads: string[] = [];
    const rpc: Array<{ name: string; args: Record<string, unknown> }> = [];
    createUserSupabaseClient.mockReturnValue({
      from(table: string) {
        expect(table).toBe("wealth_engine_vaults");
        return {
          select() {
            return {
              eq(_column: string, userId: string) {
                reads.push(userId);
                return {
                  maybeSingle: async () => ({
                    data: {
                      schema_version: 6,
                      revision: 4,
                      updated_at: "2026-09-01T00:00:00.000Z",
                      vault_data: serializeCloudVaultData(state()),
                    },
                    error: null,
                  }),
                };
              },
            };
          },
        };
      },
      rpc: async (name: string, args: Record<string, unknown>) => {
        rpc.push({ name, args });
        return {
          data: {
            status: "updated",
            revision: 5,
            schema_version: 6,
            updated_at: "2026-10-01T12:00:00.000Z",
          },
          error: null,
        };
      },
    });

    const response = await POST(request(body()));
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      status: "paid",
      expenseId: "groceries",
      revision: 5,
    });
    expect(reads).toEqual([OWNER]);
    expect(rpc.map((call) => call.name)).toEqual(["cas_update_wealth_engine_vault"]);
    const written = rpc[0]?.args.next_vault_data as PersistedState;
    expect(written.expenses[0]).toMatchObject({ id: "groceries", isSettled: true });
    expect(written.activityLog).toEqual([]);
    expect(rpc[0]?.args).not.toHaveProperty("user_id");
  });
});
