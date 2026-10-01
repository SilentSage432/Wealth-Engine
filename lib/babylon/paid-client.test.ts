import { describe, expect, it, vi } from "vitest";
import {
  MOBILE_PAID_OFFLINE_MESSAGE,
  MOBILE_PAID_PATH,
  MOBILE_PAID_SIGNED_OUT_MESSAGE,
  submitMobilePaid,
} from "@/lib/babylon/paid-client";
import type { ExpenseEntry } from "@/types/babylon";

function expense(partial: Partial<ExpenseEntry> = {}): ExpenseEntry {
  return {
    id: "groceries",
    name: "Groceries",
    category: "need",
    amount: 40,
    date: "2026-01-03",
    dueDate: "2026-01-03",
    isSettled: false,
    ...partial,
  };
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status });
}

describe("submitMobilePaid", () => {
  it("does not fetch or queue a payment while offline or signed out", async () => {
    const fetchImpl = vi.fn();
    const offline = await submitMobilePaid(expense(), {
      online: false,
      accessToken: "token",
      fetchImpl,
    });
    const signedOut = await submitMobilePaid(expense(), {
      online: true,
      accessToken: null,
      fetchImpl,
    });
    expect(offline).toEqual({
      status: "blocked",
      message: MOBILE_PAID_OFFLINE_MESSAGE,
      refresh: false,
    });
    expect(signedOut).toEqual({
      status: "blocked",
      message: MOBILE_PAID_SIGNED_OUT_MESSAGE,
      refresh: false,
    });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("posts only the occurrence preimage and refreshes after a canonical result", async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse(200, {
        status: "paid",
        expenseId: "groceries",
        paymentDate: "2026-10-01",
        revision: 5,
      })
    );
    const result = await submitMobilePaid(expense(), {
      online: true,
      accessToken: "token",
      fetchImpl,
    });
    expect(result).toEqual({ status: "paid", refresh: true, paymentDate: "2026-10-01" });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [path, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(path).toBe(MOBILE_PAID_PATH);
    expect(init.method).toBe("POST");
    expect(new Headers(init.headers).get("Authorization")).toBe("Bearer token");
    const payload = JSON.parse(String(init.body)) as Record<string, unknown>;
    expect(Object.keys(payload).sort()).toEqual(["occurrenceId", "preimage"]);
    expect(payload).not.toHaveProperty("vault_data");
    expect(payload).not.toHaveProperty("financialTimeZone");
    expect(payload).not.toHaveProperty("paymentDate");
  });

  it("leaves a failed acknowledgement for a canonical refresh and does not refresh a signed-out response", async () => {
    const mismatch = vi.fn(async () =>
      jsonResponse(409, {
        status: "rejected",
        reason: "preimage_mismatch",
        error: "This bill changed before it could be marked paid.",
      })
    );
    const rejected = await submitMobilePaid(expense(), {
      online: true,
      accessToken: "token",
      fetchImpl: mismatch,
    });
    expect(rejected).toMatchObject({ status: "failed", refresh: true });

    const expired = await submitMobilePaid(expense(), {
      online: true,
      accessToken: "token",
      fetchImpl: vi.fn(async () => jsonResponse(401, { error: "Sign in required to connect a bank." })),
    });
    expect(expired).toEqual({
      status: "failed",
      message: MOBILE_PAID_SIGNED_OUT_MESSAGE,
      refresh: false,
    });
  });

  it("asks for a refresh when the network result is unknown", async () => {
    const result = await submitMobilePaid(expense(), {
      online: true,
      accessToken: "token",
      fetchImpl: vi.fn(async () => {
        throw new Error("socket");
      }),
    });
    expect(result).toMatchObject({ status: "failed", refresh: true });
  });
});
