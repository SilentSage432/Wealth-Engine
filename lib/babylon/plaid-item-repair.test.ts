import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { reconcilePlaidItemRepairs } from "@/lib/babylon/plaid-item-repair";

const ITEM_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const ITEM_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

function repair(itemId: string) {
  return { itemId, code: "ITEM_LOGIN_REQUIRED" as const };
}

describe("reconcilePlaidItemRepairs", () => {
  it("does not clear repair when repairs[] is empty and nothing applied", () => {
    expect(
      reconcilePlaidItemRepairs({
        previous: [repair(ITEM_A)],
        repairs: [],
        itemOutcomes: [{ itemId: ITEM_A, result: "not-applied" }],
      })
    ).toEqual([repair(ITEM_A)]);
  });

  it("retains repair on generic not-applied without a repair signal", () => {
    expect(
      reconcilePlaidItemRepairs({
        previous: [repair(ITEM_A)],
        repairs: [],
        itemOutcomes: [{ itemId: ITEM_A, result: "not-applied" }],
      })
    ).toEqual([repair(ITEM_A)]);
  });

  it("retains repair on skipped (no Balance write)", () => {
    expect(
      reconcilePlaidItemRepairs({
        previous: [repair(ITEM_A)],
        repairs: [],
        itemOutcomes: [{ itemId: ITEM_A, result: "skipped" }],
      })
    ).toEqual([repair(ITEM_A)]);
  });

  it("clears repair only when the same Item applied balance_get", () => {
    expect(
      reconcilePlaidItemRepairs({
        previous: [repair(ITEM_A)],
        repairs: [],
        itemOutcomes: [{ itemId: ITEM_A, result: "applied" }],
      })
    ).toEqual([]);
  });

  it("does not clear Item A when only Item B applied", () => {
    expect(
      reconcilePlaidItemRepairs({
        previous: [repair(ITEM_A), repair(ITEM_B)],
        repairs: [],
        itemOutcomes: [{ itemId: ITEM_B, result: "applied" }],
      })
    ).toEqual([repair(ITEM_A)]);
  });

  it("case 1: A applied and B generic failure clears only A", () => {
    expect(
      reconcilePlaidItemRepairs({
        previous: [repair(ITEM_A), repair(ITEM_B)],
        repairs: [],
        itemOutcomes: [
          { itemId: ITEM_A, result: "applied" },
          { itemId: ITEM_B, result: "not-applied" },
        ],
      })
    ).toEqual([repair(ITEM_B)]);
  });

  it("case 2: A ITEM_LOGIN_REQUIRED and B applied retains A and clears B", () => {
    expect(
      reconcilePlaidItemRepairs({
        previous: [repair(ITEM_A), repair(ITEM_B)],
        repairs: [repair(ITEM_A)],
        itemOutcomes: [
          { itemId: ITEM_A, result: "not-applied" },
          { itemId: ITEM_B, result: "applied" },
        ],
      })
    ).toEqual([repair(ITEM_A)]);
  });

  it("case 3: omitted Item retains prior repair", () => {
    expect(
      reconcilePlaidItemRepairs({
        previous: [repair(ITEM_A)],
        repairs: [],
        itemOutcomes: [{ itemId: ITEM_B, result: "applied" }],
      })
    ).toEqual([repair(ITEM_A)]);
  });

  it("case 4: empty repairs[] and no applied outcomes retains all", () => {
    expect(
      reconcilePlaidItemRepairs({
        previous: [repair(ITEM_A), repair(ITEM_B)],
        repairs: [],
        itemOutcomes: [],
      })
    ).toEqual([repair(ITEM_A), repair(ITEM_B)]);
  });

  it("upserts ITEM_LOGIN_REQUIRED when newly observed", () => {
    expect(
      reconcilePlaidItemRepairs({
        previous: [],
        repairs: [repair(ITEM_A)],
        itemOutcomes: [{ itemId: ITEM_A, result: "not-applied" }],
      })
    ).toEqual([repair(ITEM_A)]);
  });

  it("treats Link cancel as no observation merge (prior retained)", () => {
    expect(
      reconcilePlaidItemRepairs({
        previous: [repair(ITEM_A)],
        repairs: [],
        itemOutcomes: [],
      })
    ).toEqual([repair(ITEM_A)]);
  });

  it("treats Link success alone as no recovery (prior retained until applied)", () => {
    expect(
      reconcilePlaidItemRepairs({
        previous: [repair(ITEM_A)],
        repairs: [],
        itemOutcomes: [{ itemId: ITEM_A, result: "not-applied" }],
      })
    ).toEqual([repair(ITEM_A)]);
  });

  it("background GET empty outcomes cannot clear foreground repair state", () => {
    expect(
      reconcilePlaidItemRepairs({
        previous: [repair(ITEM_A)],
        repairs: [],
        itemOutcomes: [],
      })
    ).toEqual([repair(ITEM_A)]);
  });
});

describe("WE-PLAID-RECOVERY-001A repository boundary", () => {
  function source(relative: string) {
    return readFileSync(resolve(process.cwd(), relative), "utf8");
  }

  it("merges repairs per Item and never wholesale-replaces from repairs[]", () => {
    const hook = source("hooks/usePlaidConnections.ts");
    expect(hook).toContain("reconcilePlaidItemRepairs");
    expect(hook).not.toContain("setRepairs(summary.repairs)");
    expect(hook).toContain("itemOutcomes: summary.itemOutcomes");
  });

  it("POST emits itemOutcomes and GET keeps empty outcomes", () => {
    const route = source("app/api/plaid/observe-balances/route.ts");
    const background = source("lib/babylon/background-balance-observation.ts");
    expect(route).toContain("itemOutcomes");
    expect(route).toContain('recordPlaidRealtimeBalanceObservations');
    expect(background).toContain("itemOutcomes: []");
    expect(background).not.toContain("fetchPlaidRealtimeBalances");
  });

  it("applied means balance_get RPC commit; skipped is not recovery", () => {
    const recorder = source("lib/babylon/plaid-balance-record.ts");
    expect(recorder).toContain('return { result: "skipped" }');
    expect(recorder).toContain('reason: "no-eligible-targets"');
    expect(recorder).toContain('reason: "fresh-balance-get"');
    expect(recorder).toContain('source: "balance_get"');
    const appliedReturn = recorder.slice(
      recorder.indexOf("const committed = await commitBalanceObservations")
    );
    expect(appliedReturn).toContain(
      'return { result: committed === "applied" ? "applied" : "not-applied" }'
    );
  });

  it("connect and repair Link paths stay unchanged", () => {
    const hook = source("hooks/usePlaidConnections.ts");
    const connect = hook.slice(hook.indexOf("const launchLink"));
    const repair = hook.slice(hook.indexOf("const launchRepair"));
    expect(connect).toContain("createPlaidLinkTokenOrToast");
    expect(hook).toContain("startPlaidLinkExchange");
    expect(repair).toContain("createPlaidUpdateLinkTokenOrToast");
    expect(repair).not.toContain("startPlaidLinkExchange");
    expect(hook).toContain("requestForegroundBalanceRefresh");
    const onSuccess = hook.slice(
      hook.indexOf("const onSuccess"),
      hook.indexOf("const { open, ready }")
    );
    expect(onSuccess).toContain('mode === "repair"');
    expect(onSuccess).toContain("requestForegroundBalanceRefresh");
    expect(onSuccess.indexOf('mode === "repair"')).toBeLessThan(
      onSuccess.indexOf("startPlaidLinkExchange")
    );
  });
});
