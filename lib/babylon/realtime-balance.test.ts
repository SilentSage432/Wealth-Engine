import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  applyBalanceObservations,
  associatedDepositoryAccountIds,
  toBalanceObservationPublic,
  type BalanceObservationRecord,
  type PlaidBalanceDraft,
} from "@/lib/babylon/balance-observation";
import {
  describeAccountEvidenceLine,
  describeMoneyAvailableEvidence,
  type BalanceObservationLoad,
} from "@/lib/babylon/balance-evidence-load";
import {
  FOREGROUND_BALANCE_REFRESH_WINDOW_MS,
  REAL_TIME_BALANCE_FRESHNESS_MS,
  newestRealtimeObservedAt,
  planForegroundBalanceRefresh,
  realtimeBalanceRequestNeeded,
  realtimeFreshnessWakeDelayMs,
  resetForegroundBalanceRefreshSession,
} from "@/lib/babylon/foreground-balance-refresh";
import { assembleIntelligenceContract } from "@/lib/babylon/intelligence-contract";
import { EMPTY_STATE } from "@/lib/babylon/constants";
import type { FinancialAccount } from "@/types/babylon";
import type { EffectiveAccountPosition } from "@/lib/babylon/balance-observation";

const USER = "user-a";
const AT = "2026-09-28T15:00:00.000Z";
const LATER = "2026-09-28T16:00:00.000Z";
const NOW = Date.parse("2026-09-28T18:00:00.000Z");

function draft(partial: Partial<PlaidBalanceDraft> = {}): PlaidBalanceDraft {
  return {
    plaidAccountId: "plaid-checking",
    accountType: "depository",
    subtype: "checking",
    currentCents: 8_000,
    availableCents: 7_500,
    isoCurrencyCode: "USD",
    unofficialCurrencyCode: null,
    ...partial,
  };
}

function row(
  partial: Partial<BalanceObservationRecord> = {}
): BalanceObservationRecord {
  return {
    userId: USER,
    plaidAccountId: "plaid-checking",
    currentCents: 13_533,
    availableCents: 13_000,
    isoCurrencyCode: "USD",
    unofficialCurrencyCode: null,
    observedAt: AT,
    source: "accounts_get",
    state: "current",
    ...partial,
  };
}

function checking(balance = 335.33): FinancialAccount {
  return {
    id: "acct-checking",
    name: "Checking",
    kind: "checking",
    balance,
    asOf: "2026-09-01",
  };
}

describe("real-time observation strength", () => {
  it("upgrades accounts_get in place when balance_get cents are unchanged", () => {
    const stored = applyBalanceObservations([row()], {
      userId: USER,
      observedAt: LATER,
      source: "balance_get",
      drafts: [draft({ currentCents: 13_533, availableCents: 13_000 })],
    });
    expect(stored.observations).toEqual([
      row({ source: "balance_get", observedAt: LATER }),
    ]);
  });

  it("supersedes a cached current when balance_get cents change", () => {
    const stored = applyBalanceObservations([row()], {
      userId: USER,
      observedAt: LATER,
      source: "balance_get",
      drafts: [draft({ currentCents: 9_000, availableCents: 8_000 })],
    });
    expect(stored.observations.filter((item) => item.state === "current")).toEqual([
      row({
        currentCents: 9_000,
        availableCents: 8_000,
        source: "balance_get",
        observedAt: LATER,
      }),
    ]);
    expect(stored.observations.filter((item) => item.state === "superseded")).toEqual([
      row({ state: "superseded" }),
    ]);
  });

  it("does not let accounts_get overwrite or restamp a current balance_get", () => {
    const current = row({ source: "balance_get", observedAt: AT, currentCents: 9_000 });
    const same = applyBalanceObservations([current], {
      userId: USER,
      observedAt: LATER,
      source: "accounts_get",
      drafts: [draft({ currentCents: 9_000, availableCents: 7_500 })],
    });
    expect(same.observations).toEqual([current]);
    const changed = applyBalanceObservations([current], {
      userId: USER,
      observedAt: LATER,
      source: "accounts_get",
      drafts: [draft({ currentCents: 1_000 })],
    });
    expect(changed.observations).toEqual([current]);
  });

  it("does not let an ineligible balance_get replace eligible evidence", () => {
    const current = row({ source: "accounts_get", currentCents: 13_533 });
    const stored = applyBalanceObservations([current], {
      userId: USER,
      observedAt: LATER,
      source: "balance_get",
      drafts: [draft({ currentCents: null, availableCents: 1 })],
    });
    expect(stored.observations).toEqual([current]);
  });

  it("keeps superseded rows out of the public read and accepts both sources", () => {
    expect(
      toBalanceObservationPublic({
        id: "obs",
        user_id: USER,
        plaid_account_id: "plaid-checking",
        current_cents: 1,
        available_cents: 1,
        iso_currency_code: "USD",
        unofficial_currency_code: null,
        observed_at: AT,
        source: "balance_get",
        state: "superseded",
      })
    ).toBeNull();
    expect(
      toBalanceObservationPublic({
        id: "obs",
        user_id: USER,
        plaid_account_id: "plaid-checking",
        current_cents: 1,
        available_cents: 1,
        iso_currency_code: "USD",
        unofficial_currency_code: null,
        observed_at: AT,
        source: "balance_get",
        state: "current",
      })?.source
    ).toBe("balance_get");
  });
});

describe("associated real-time targets", () => {
  it("requests only associated checking and savings accounts", () => {
    expect(
      associatedDepositoryAccountIds({
        accounts: [
          { plaidAccountId: "checking", accountType: "depository", subtype: "checking" },
          { plaidAccountId: "savings", accountType: "depository", subtype: "savings" },
          { plaidAccountId: "card", accountType: "credit", subtype: "credit card" },
          { plaidAccountId: "other", accountType: "depository", subtype: "checking" },
        ],
        associatedPlaidAccountIds: ["checking", "savings", "card"],
      })
    ).toEqual(["checking", "savings"]);
    expect(
      associatedDepositoryAccountIds({
        accounts: [
          { plaidAccountId: "checking", accountType: "depository", subtype: "checking" },
        ],
        associatedPlaidAccountIds: [],
      })
    ).toEqual([]);
  });
});

describe("foreground freshness", () => {
  afterEach(() => {
    resetForegroundBalanceRefreshSession();
  });

  it("keeps five minutes of freshness and a 60-second duplicate floor", () => {
    expect(FOREGROUND_BALANCE_REFRESH_WINDOW_MS).toBe(60_000);
    expect(REAL_TIME_BALANCE_FRESHNESS_MS).toBe(5 * FOREGROUND_BALANCE_REFRESH_WINDOW_MS);
  });

  it("skips a reload while stored balance_get evidence is inside the duplicate window", () => {
    resetForegroundBalanceRefreshSession();
    const observedAt = new Date(NOW - 30_000).toISOString();
    expect(
      planForegroundBalanceRefresh({
        authenticated: true,
        visible: true,
        now: NOW,
        realTimeObservedAt: observedAt,
      })
    ).toEqual({ action: "skip" });
    expect(
      realtimeBalanceRequestNeeded({
        accountIds: ["checking"],
        observations: [
          { plaidAccountId: "checking", source: "balance_get", observedAt },
        ],
        nowMs: NOW,
      })
    ).toBe(false);
  });

  it("asks again once stored balance_get evidence is outside the duplicate window and aged", () => {
    const observedAt = new Date(NOW - REAL_TIME_BALANCE_FRESHNESS_MS).toISOString();
    expect(
      realtimeBalanceRequestNeeded({
        accountIds: ["checking"],
        observations: [
          { plaidAccountId: "checking", source: "balance_get", observedAt },
        ],
        nowMs: NOW,
      })
    ).toBe(true);
    expect(
      planForegroundBalanceRefresh({
        authenticated: true,
        visible: true,
        now: NOW,
        realTimeObservedAt: observedAt,
      }).action
    ).toBe("request");
  });

  it("does not schedule a wake that would call again while evidence is already aged", () => {
    expect(
      realtimeFreshnessWakeDelayMs({
        now: NOW,
        realTimeObservedAt: new Date(NOW - REAL_TIME_BALANCE_FRESHNESS_MS).toISOString(),
      })
    ).toBeNull();
    expect(
      realtimeFreshnessWakeDelayMs({
        now: NOW,
        realTimeObservedAt: new Date(NOW - 1_000).toISOString(),
      })
    ).toBe(REAL_TIME_BALANCE_FRESHNESS_MS - 1_000);
  });

  it("re-evaluates on focus through the planner and does not poll", () => {
    const hook = readFileSync(resolve(process.cwd(), "hooks/usePlaidConnections.ts"), "utf8");
    expect(hook).toContain('addEventListener("focus"');
    expect(hook).toContain("visibilitychange");
    expect(hook).not.toContain("setInterval");
    const wake = hook.slice(hook.indexOf("const wake = window.setTimeout"), hook.indexOf("clearTimeout"));
    expect(wake).toContain("recordVisibleBalances(false)");
    expect(wake).not.toContain("requestForegroundBalanceRefresh");
    expect(wake).not.toContain("/accounts/balance/get");
    expect(newestRealtimeObservedAt([
      { source: "accounts_get", observedAt: LATER },
      { source: "balance_get", observedAt: AT },
    ])).toBe(AT);
  });
});

describe("evidence captions", () => {
  const declared: EffectiveAccountPosition = {
    accountId: "acct-checking",
    balance: 335.33,
    source: "declared",
    asOf: "2026-09-01",
  };
  const cached: EffectiveAccountPosition = {
    accountId: "acct-checking",
    balance: 135.33,
    source: "observed",
    currentCents: 13_533,
    observedAt: AT,
    observationId: "obs",
    observationSource: "accounts_get",
  };
  const realtime = (observedAt: string): EffectiveAccountPosition => ({
    ...cached,
    observationSource: "balance_get",
    observedAt,
  });
  const ready: BalanceObservationLoad = {
    status: "ready",
    evidence: { plaidAccounts: [], observations: [], associations: [] },
  };

  it("labels loading Money Available as the declared balance", () => {
    expect(
      describeMoneyAvailableEvidence({
        load: { status: "loading" },
        positions: [declared],
        nowMs: NOW,
      })
    ).toBe("Declared balance, while evidence resolves.");
  });

  it("labels cached, fresh, and aged evidence differently", () => {
    expect(describeAccountEvidenceLine({ position: cached, nowMs: NOW })).toContain(
      "Cached Plaid balance"
    );
    const freshAt = new Date(NOW - 1_000).toISOString();
    const fresh = describeAccountEvidenceLine({
      position: realtime(freshAt),
      nowMs: NOW,
    });
    expect(fresh).toContain("Institution-refreshed balance");
    const aged = describeAccountEvidenceLine({
      position: realtime(new Date(NOW - REAL_TIME_BALANCE_FRESHNESS_MS - 1).toISOString()),
      nowMs: NOW,
    });
    expect(aged).toContain("Institution balance from");
    expect(aged.toLowerCase()).not.toContain("fresh");
    expect(aged.toLowerCase()).not.toContain("current");
    expect(
      describeMoneyAvailableEvidence({
        load: ready,
        positions: [cached],
        nowMs: NOW,
      })
    ).toContain("Cached Plaid balance");
    expect(
      describeMoneyAvailableEvidence({
        load: ready,
        positions: [realtime(freshAt)],
        nowMs: NOW,
      })
    ).toContain("Institution-refreshed balance");
    const agedMoney = describeMoneyAvailableEvidence({
      load: ready,
      positions: [realtime(AT)],
      nowMs: NOW,
    });
    expect(agedMoney).toContain("Earlier institution balance");
    expect(agedMoney.toLowerCase()).not.toContain("fresh");
    expect(agedMoney.toLowerCase()).not.toContain("current");
  });
});

describe("intelligence contract v3", () => {
  function contract(source: "accounts_get" | "balance_get", observedAt: string, now: string) {
    return assembleIntelligenceContract({
      state: { ...EMPTY_STATE, accounts: [checking()] },
      ianaTimeZone: "America/Boise",
      now: new Date(now),
      generatedAt: now,
      balanceEvidence: {
        status: "ready",
        plaidAccounts: [
          { plaidAccountId: "plaid-checking", accountType: "depository", subtype: "checking" },
        ],
        observations: [
          {
            id: "obs",
            userId: USER,
            plaidAccountId: "plaid-checking",
            currentCents: 13_533,
            availableCents: 1,
            isoCurrencyCode: "USD",
            unofficialCurrencyCode: null,
            observedAt,
            source,
          },
        ],
        associations: [
          { financialAccountId: "acct-checking", plaidAccountId: "plaid-checking" },
        ],
      },
    });
  }

  it("uses effective money and distinguishes cached, fresh, and aged readings", () => {
    const cached = contract("accounts_get", AT, "2026-09-28T18:00:00.000Z");
    expect(cached.meta.contract_version).toBe("4");
    expect(cached.position.money_available_cents).toBe(13_533);
    expect(cached.position.operational_balance_fields).toEqual([
      "money_available_cents",
      "effective_balance_cents",
    ]);
    expect(cached.position.declared_balance_role).toBe("provenance_fallback");
    expect(cached.position.accounts[0]).toMatchObject({
      declared_balance_cents: 33_533,
      effective_balance_cents: 13_533,
      effective_source: "observed",
      observation_kind: "cached_accounts_get",
      institution_reading_age: null,
    });
    expect(cached.boundaries.unknowns).toContain("cached_accounts_get_balance");
    expect(cached.boundaries.unknowns).toContain("plaid_is_not_vault_truth");

    const freshAt = "2026-09-28T17:59:00.000Z";
    const fresh = contract("balance_get", freshAt, "2026-09-28T18:00:00.000Z");
    expect(fresh.position.accounts[0]).toMatchObject({
      observation_kind: "real_time_balance_get",
      institution_reading_age: "fresh",
      effective_balance_cents: 13_533,
    });
    expect(fresh.boundaries.unknowns).not.toContain("cached_accounts_get_balance");

    const aged = contract("balance_get", AT, "2026-09-28T18:00:00.000Z");
    expect(aged.position.accounts[0]).toMatchObject({
      observation_kind: "real_time_balance_get",
      institution_reading_age: "aged",
    });
    expect(JSON.stringify(aged.position.accounts[0])).not.toContain("fresh");
  });

  it("does not call Plaid from the intelligence route", () => {
    const route = readFileSync(resolve(process.cwd(), "app/api/intelligence/route.ts"), "utf8");
    expect(route).not.toContain("/accounts/get");
    expect(route).not.toContain("/accounts/balance/get");
    expect(route).not.toContain("plaidFetch");
    expect(route).not.toContain("recordPlaid");
  });
});

describe("migration source", () => {
  const migration = readFileSync(
    resolve(process.cwd(), "supabase/migrations/20261004_plaid_realtime_balance_source.sql"),
    "utf8"
  );

  const sourceNormalize = [
    "    next_source := obs.value->>'source';",
    "    IF next_source IS NULL THEN",
    "      next_source := 'accounts_get';",
    "    ELSIF next_source NOT IN ('accounts_get', 'balance_get') THEN",
    "      RETURN jsonb_build_object('status', 'rejected');",
  ].join("\n");

  it("defaults missing or JSON-null source to accounts_get and rejects unknown explicit values", () => {
    expect(migration).toContain("CHECK (source IN ('accounts_get', 'balance_get'))");
    // `->>'source'` is NULL for a missing key and for JSON null — both become accounts_get.
    expect(migration).toContain(sourceNormalize);
    expect(migration.split(sourceNormalize)).toHaveLength(3);
    expect(migration).not.toContain(
      "IF next_source IS NULL OR next_source NOT IN ('accounts_get', 'balance_get') THEN"
    );
    expect(migration).toContain(
      "legacy deployed recorder omitted source and only\n  -- called /accounts/get"
    );
    // Explicit accounts_get and balance_get remain accepted; '' and unknown strings reject.
    expect(migration).toContain("next_source NOT IN ('accounts_get', 'balance_get')");
    expect(migration).toContain("RETURN jsonb_build_object('status', 'rejected')");
    expect(migration.indexOf("next_source := 'accounts_get';")).toBeLessThan(
      migration.indexOf("FOR UPDATE")
    );
    expect(migration.indexOf("RETURN jsonb_build_object('status', 'rejected')")).toBeLessThan(
      migration.indexOf("FOR UPDATE")
    );
  });

  it("keeps evidence-strength rules after source normalization", () => {
    const writeNormalizeAt = migration.lastIndexOf(sourceNormalize);
    expect(writeNormalizeAt).toBeGreaterThan(-1);
    expect(migration.indexOf("existing.source = 'balance_get'", writeNormalizeAt)).toBeGreaterThan(
      writeNormalizeAt
    );
    expect(migration.indexOf("NOT incoming_eligible", writeNormalizeAt)).toBeGreaterThan(
      writeNormalizeAt
    );
    expect(migration).toContain("source = next_source");
    expect(migration).not.toContain("checked_at");
    expect(migration).not.toContain("changed_at");
    expect(migration).not.toContain("CREATE TABLE");
    expect(migration).not.toContain("wealth_engine_vaults");
    expect(migration).not.toContain("schema_version");
  });
});

describe("endpoint ownership", () => {
  it("leaves transaction sync and the daily cache off the paid Balance call", () => {
    const sync = readFileSync(
      resolve(process.cwd(), "app/api/plaid/sync-transactions/route.ts"),
      "utf8"
    );
    const route = readFileSync(
      resolve(process.cwd(), "app/api/plaid/observe-balances/route.ts"),
      "utf8"
    );
    const scheduled = route.slice(
      route.indexOf("export async function GET"),
      route.indexOf("export async function POST")
    );
    expect(sync).not.toContain("recordPlaidRealtimeBalanceObservations");
    expect(sync).not.toContain("/accounts/balance/get");
    expect(sync).toContain("bootstrapPlaidAccountIdentityIfAbsent");
    expect(scheduled).toContain("recordPlaidBalanceObservations(");
    expect(scheduled).not.toContain("recordPlaidRealtimeBalanceObservations");
    expect(scheduled).not.toContain("/accounts/balance/get");
  });
});
