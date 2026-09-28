import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

vi.mock("server-only", () => ({}));

import { logRealtimeBalanceStage } from "@/lib/babylon/realtime-balance-diagnostics";

describe("realtime balance diagnostics", () => {
  it("logs only stage markers and safe fields", () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    logRealtimeBalanceStage("targets-derived", {
      descriptors: 1,
      associated: 1,
      eligible: 1,
      omitted: null,
    });
    expect(info).toHaveBeenCalledWith("[plaid] realtime observe", {
      stage: "targets-derived",
      descriptors: 1,
      associated: 1,
      eligible: 1,
    });
    const payload = JSON.stringify(info.mock.calls[0]);
    expect(payload).not.toContain("access_token");
    expect(payload).not.toContain("secret");
    expect(payload).not.toContain("Bearer");
    expect(payload).not.toContain("currentCents");
    expect(payload).not.toContain("Z5m4");
    info.mockRestore();
  });

  it("wires stage logging through the POST route and realtime recorder", () => {
    const route = readFileSync(
      resolve(process.cwd(), "app/api/plaid/observe-balances/route.ts"),
      "utf8"
    );
    const recorder = readFileSync(
      resolve(process.cwd(), "lib/babylon/plaid-balance-record.ts"),
      "utf8"
    );
    expect(route).toContain('logRealtimeBalanceStage("post-entered")');
    expect(route).toContain('logRealtimeBalanceStage("items-discovered"');
    expect(route).toContain('logRealtimeBalanceStage("post-complete"');
    expect(recorder).toContain('logRealtimeBalanceStage("targets-derived"');
    expect(recorder).toContain('reason: "no-eligible-targets"');
    expect(recorder).toContain('logRealtimeBalanceStage("balance-request-start"');
    expect(recorder).toContain('logRealtimeBalanceStage("balance-request-failed"');
    expect(recorder).toContain('logRealtimeBalanceStage("rpc-result"');
  });
});
