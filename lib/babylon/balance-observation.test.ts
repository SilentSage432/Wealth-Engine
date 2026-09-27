import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { deriveDueAttention } from "@/lib/babylon/attention";
import {
  acceptObservedBalance,
  applyBalanceObservations,
  associateFinancialAccount,
  BALANCE_OBSERVATION_SOURCE,
  compareRecordedBalance,
  currentBalanceObservation,
  depositoryChoiceLabel,
  describeAccountBalance,
  dollarsFromCents,
  parsePlaidBalanceGetResponse,
  recordedBalanceCents,
  removeFinancialAccountAssociation,
  toBalanceObservationJson,
  unassociatedDepositoryAccountIds,
  type AccountAssociationRecord,
  type BalanceObservationRecord,
  type PlaidBalanceDraft,
} from "@/lib/babylon/balance-observation";
import { EMPTY_STATE } from "@/lib/babylon/constants";
import { sumAccountBalances } from "@/lib/babylon/financial-position";
import {
  assembleIntelligenceContract,
  intelligenceCents,
} from "@/lib/babylon/intelligence-contract";
import { parsePlaidAccountsGetResponse } from "@/lib/babylon/plaid-transaction-sync";
import type { FinancialAccount } from "@/types/babylon";

const USER = "user-a";
const OTHER = "user-b";
const AT = "2026-09-26T15:00:00.000Z";
const LATER = "2026-09-26T16:00:00.000Z";

function checkingAccount(balance = 10, id = "acct-checking"): FinancialAccount {
  return {
    id,
    name: "Everyday",
    kind: "checking",
    balance,
    asOf: "2026-09-01",
  };
}

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

function observation(
  partial: Partial<BalanceObservationRecord> = {}
): BalanceObservationRecord {
  return {
    userId: USER,
    plaidAccountId: "plaid-checking",
    currentCents: 8_000,
    availableCents: 7_500,
    isoCurrencyCode: "USD",
    unofficialCurrencyCode: null,
    observedAt: AT,
    source: BALANCE_OBSERVATION_SOURCE,
    state: "current",
    ...partial,
  };
}

function accountPayload(partial: Record<string, unknown> = {}) {
  return {
    accounts: [
      {
        account_id: "plaid-checking",
        name: "Everyday Checking",
        mask: "1234",
        type: "depository",
        subtype: "checking",
        official_name: "Official",
        balances: {
          current: 80,
          available: 75,
          iso_currency_code: "USD",
          unofficial_currency_code: null,
          limit: 424242,
        },
        ...partial,
      },
    ],
  };
}

describe("balance observation", () => {
  it("keeps the identity parser from retaining balance evidence", () => {
    const parsed = parsePlaidAccountsGetResponse(accountPayload());
    expect(parsed).toEqual([
      {
        plaidAccountId: "plaid-checking",
        name: "Everyday Checking",
        mask: "1234",
        accountType: "depository",
        subtype: "checking",
      },
    ]);
    expect(JSON.stringify(parsed)).not.toContain("424242");
    expect(JSON.stringify(parsed)).not.toContain("balances");
  });

  it("stores a depository checking reading with current, available, currency, time, and source", () => {
    const parsed = parsePlaidBalanceGetResponse(accountPayload());
    expect(parsed).toEqual([
      draft({
        currentCents: 8_000,
        availableCents: 7_500,
      }),
    ]);
    expect(JSON.stringify(parsed)).not.toContain("424242");
    expect(JSON.stringify(toBalanceObservationJson(parsed ?? []))).not.toContain("limit");
    const stored = applyBalanceObservations([], {
      userId: USER,
      observedAt: AT,
      drafts: parsed ?? [],
    });
    expect(stored.status).toBe("applied");
    expect(stored.observations).toEqual([
      observation({
        currentCents: 8_000,
        availableCents: 7_500,
        observedAt: AT,
        source: "accounts_get",
      }),
    ]);
  });

  it("stores a depository savings reading the same way", () => {
    const parsed = parsePlaidBalanceGetResponse({
      accounts: [
        {
          account_id: "plaid-savings",
          type: "depository",
          subtype: "savings",
          balances: {
            current: 40,
            available: null,
            iso_currency_code: "USD",
            unofficial_currency_code: null,
            limit: 9,
          },
        },
      ],
    });
    const stored = applyBalanceObservations([], {
      userId: USER,
      observedAt: AT,
      drafts: parsed ?? [],
    });
    expect(stored.observations).toEqual([
      observation({
        plaidAccountId: "plaid-savings",
        currentCents: 4_000,
        availableCents: null,
        observedAt: AT,
        source: "accounts_get",
      }),
    ]);
    expect(JSON.stringify(stored.observations)).not.toContain("\"9\"");
  });

  it("does not make credit or loan readings comparable or stored", () => {
    const parsed = parsePlaidBalanceGetResponse({
      accounts: [
        {
          account_id: "card",
          type: "credit",
          subtype: "credit card",
          balances: { current: 20, available: 80, iso_currency_code: "USD", limit: 100 },
        },
        {
          account_id: "loan",
          type: "loan",
          subtype: "student",
          balances: { current: 20, available: null, iso_currency_code: "USD" },
        },
        {
          account_id: "brokerage",
          type: "investment",
          subtype: "brokerage",
          balances: { current: 20, available: null, iso_currency_code: "USD" },
        },
      ],
    });
    expect(parsed).toEqual([]);
    const compared = compareRecordedBalance({
      associated: true,
      recordedBalance: 0,
      accountType: "credit",
      subtype: "credit card",
      observation: observation({ currentCents: 2_000 }),
    });
    expect(compared).toEqual({ status: "unknown" });
    expect(
      compareRecordedBalance({
        associated: true,
        recordedBalance: 0,
        accountType: "loan",
        subtype: "student",
        observation: observation({ currentCents: 2_000 }),
      })
    ).toEqual({ status: "unknown" });
  });

  it("does not compare a null current, a missing currency, or an unofficial currency", () => {
    const parsed = parsePlaidBalanceGetResponse({
      accounts: [
        {
          account_id: "no-current",
          type: "depository",
          subtype: "checking",
          balances: { current: null, available: 70, iso_currency_code: "USD" },
        },
      ],
    });
    expect(parsed?.[0]?.currentCents).toBeNull();
    expect(parsed?.[0]?.availableCents).toBe(7_000);
    expect(
      compareRecordedBalance({
        associated: true,
        recordedBalance: 0,
        accountType: "depository",
        subtype: "checking",
        observation: {
          currentCents: null,
          availableCents: 7_000,
          isoCurrencyCode: "USD",
          unofficialCurrencyCode: null,
        },
      })
    ).toEqual({ status: "unknown" });
    expect(
      compareRecordedBalance({
        associated: true,
        recordedBalance: 0,
        accountType: "depository",
        subtype: "checking",
        observation: {
          currentCents: 1_000,
          availableCents: 1_000,
          isoCurrencyCode: null,
          unofficialCurrencyCode: null,
        },
      })
    ).toEqual({ status: "unknown" });
    expect(
      compareRecordedBalance({
        associated: true,
        recordedBalance: 0,
        accountType: "depository",
        subtype: "checking",
        observation: {
          currentCents: 1_000,
          availableCents: null,
          isoCurrencyCode: null,
          unofficialCurrencyCode: "BTC",
        },
      })
    ).toEqual({ status: "unknown" });
    expect(
      compareRecordedBalance({
        associated: true,
        recordedBalance: 0,
        accountType: "depository",
        subtype: "checking",
        observation: {
          currentCents: 1_000,
          availableCents: 1_000,
          isoCurrencyCode: "EUR",
          unofficialCurrencyCode: null,
        },
      })
    ).toEqual({ status: "unknown" });
  });

  it("never substitutes available for current", () => {
    const compared = compareRecordedBalance({
      associated: true,
      recordedBalance: 80,
      accountType: "depository",
      subtype: "checking",
      observation: observation({ currentCents: 8_000, availableCents: 1_000 }),
    });
    expect(compared).toEqual({ status: "match", currentCents: 8_000 });
    const accepted = acceptObservedBalance({
      account: checkingAccount(0),
      associated: true,
      accountType: "depository",
      subtype: "checking",
      observation: {
        currentCents: 1_000,
        isoCurrencyCode: "USD",
        unofficialCurrencyCode: null,
      },
      today: "2026-09-26",
    });
    expect(accepted?.balance).toBe(10);
    expect(accepted?.balance).not.toBe(75);
  });

  it("refreshes the stored time when evidence is unchanged and does not add history", () => {
    const first = applyBalanceObservations([], {
      userId: USER,
      observedAt: AT,
      drafts: [draft()],
    });
    const second = applyBalanceObservations(first.observations, {
      userId: USER,
      observedAt: LATER,
      drafts: [draft()],
    });
    expect(second.observations).toHaveLength(1);
    expect(second.observations[0]?.observedAt).toBe(LATER);
    expect(second.observations[0]?.state).toBe("current");
    expect(second.observations.some((row) => row.state === "superseded")).toBe(false);
  });

  it("keeps one superseded predecessor when current, available, or currency changes", () => {
    const first = applyBalanceObservations([], {
      userId: USER,
      observedAt: AT,
      drafts: [draft({ currentCents: 1_000, availableCents: 900 })],
    });
    const currentChanged = applyBalanceObservations(first.observations, {
      userId: USER,
      observedAt: LATER,
      drafts: [draft({ currentCents: 2_000, availableCents: 900 })],
    });
    expect(currentChanged.observations).toHaveLength(2);
    expect(currentChanged.observations.filter((row) => row.state === "superseded")).toEqual([
      expect.objectContaining({ currentCents: 1_000, observedAt: AT }),
    ]);
    expect(currentBalanceObservation(currentChanged.observations, USER, "plaid-checking")).toMatchObject({
      currentCents: 2_000,
      observedAt: LATER,
      state: "current",
    });

    const availableChanged = applyBalanceObservations(currentChanged.observations, {
      userId: USER,
      observedAt: "2026-09-26T17:00:00.000Z",
      drafts: [draft({ currentCents: 2_000, availableCents: 100 })],
    });
    expect(availableChanged.observations.filter((row) => row.state === "superseded")).toHaveLength(1);
    expect(availableChanged.observations).toHaveLength(2);

    const currencyChanged = applyBalanceObservations(availableChanged.observations, {
      userId: USER,
      observedAt: "2026-09-26T18:00:00.000Z",
      drafts: [draft({ currentCents: 2_000, availableCents: 100, isoCurrencyCode: "EUR" })],
    });
    expect(currencyChanged.observations).toHaveLength(2);
    expect(
      currencyChanged.observations.find((row) => row.state === "current")?.isoCurrencyCode
    ).toBe("EUR");
  });

  it("does not move a transaction cursor when a balance reading is stored", () => {
    const cursor = { transactionsCursor: "cursor-1" };
    const stored = applyBalanceObservations([], {
      userId: USER,
      observedAt: AT,
      drafts: [draft()],
    });
    expect(cursor.transactionsCursor).toBe("cursor-1");
    expect(stored).not.toHaveProperty("cursor");
    const migration = readFileSync(
      resolve(process.cwd(), "supabase/migrations/20261002_plaid_balance_observation.sql"),
      "utf8"
    );
    const apply = migration.slice(
      migration.indexOf("CREATE FUNCTION public.apply_plaid_balance_observations"),
      migration.indexOf("CREATE FUNCTION public.associate_plaid_financial_account")
    );
    expect(apply).not.toContain("transactions_cursor");
    expect(apply).not.toContain("sync_lock");
    expect(apply).not.toContain("wealth_engine_vaults");
    const record = readFileSync(
      resolve(process.cwd(), "lib/babylon/plaid-balance-record.ts"),
      "utf8"
    );
    const route = readFileSync(
      resolve(process.cwd(), "app/api/plaid/sync-transactions/route.ts"),
      "utf8"
    );
    const fetch = readFileSync(
      resolve(process.cwd(), "lib/babylon/plaid-sync-fetch.ts"),
      "utf8"
    );
    expect(record).not.toContain("transactions_cursor");
    expect(record).not.toContain("/accounts/balance/get");
    expect(fetch).not.toContain("/accounts/balance/get");
    expect(fetch).toContain('"/accounts/get"');
    expect(route.indexOf("await bootstrapPlaidAccountIdentityIfAbsent")).toBeLessThan(
      route.indexOf("await recordPlaidBalanceObservations")
    );
    expect(route.indexOf("await recordPlaidBalanceObservations")).toBeLessThan(
      route.indexOf("plaidSyncHttpResult(outcome)")
    );
    expect(route).not.toContain("transactions_cursor");
    expect(route).not.toContain("/accounts/balance/get");
  });
});

describe("account association", () => {
  const vault = [
    { id: "acct-checking", kind: "checking" },
    { id: "acct-savings", kind: "savings" },
    { id: "acct-cash", kind: "cash" },
  ];
  const plaid = {
    userId: USER,
    plaidAccountId: "plaid-checking",
    accountType: "depository",
    subtype: "checking",
  };

  function associate(
    associations: readonly AccountAssociationRecord[],
    partial: Partial<Parameters<typeof associateFinancialAccount>[1]> = {}
  ) {
    return associateFinancialAccount(associations, {
      userId: USER,
      financialAccountId: "acct-checking",
      plaidAccountId: "plaid-checking",
      confirmedAt: AT,
      vaultAccounts: vault,
      plaidAccount: plaid,
      ...partial,
    });
  }

  it("links one checking account to one depository account and rejects a second link either way", () => {
    const first = associate([]);
    expect(first.status).toBe("associated");
    expect(first.associations).toHaveLength(1);
    const same = associate(first.associations);
    expect(same.status).toBe("unchanged");
    expect(same.associations).toHaveLength(1);
    const otherVault = associate(first.associations, {
      financialAccountId: "acct-savings",
    });
    expect(otherVault).toMatchObject({ status: "rejected", reason: "already_associated" });
    const otherPlaid = associate(first.associations, {
      plaidAccountId: "plaid-savings",
      plaidAccount: {
        ...plaid,
        plaidAccountId: "plaid-savings",
        subtype: "savings",
      },
    });
    expect(otherPlaid).toMatchObject({ status: "rejected", reason: "already_associated" });
  });

  it("rejects a cross-owner link", () => {
    const result = associate([], {
      plaidAccount: { ...plaid, userId: OTHER },
      foreignPlaidAccountIds: [{ userId: OTHER, plaidAccountId: "plaid-checking" }],
    });
    expect(result).toMatchObject({ status: "rejected", reason: "cross_owner" });
    expect(result.associations).toEqual([]);
  });

  it("does not associate cash, credit, or a shared name", () => {
    const cash = associate([], { financialAccountId: "acct-cash" });
    expect(cash).toMatchObject({ status: "rejected", reason: "ineligible_account" });
    const credit = associate([], {
      plaidAccount: {
        ...plaid,
        accountType: "credit",
        subtype: "credit card",
      },
    });
    expect(credit).toMatchObject({ status: "rejected", reason: "ineligible_account" });
    const sameName = [
      checkingAccount(10, "left"),
      { ...checkingAccount(20, "right"), name: "Everyday" },
    ];
    expect(sameName[0]?.name).toBe(sameName[1]?.name);
    expect(associate([]).associations).toHaveLength(1);
    const source = readFileSync(
      resolve(process.cwd(), "lib/babylon/balance-observation.ts"),
      "utf8"
    );
    const fn = source.slice(
      source.indexOf("export function associateFinancialAccount"),
      source.indexOf("export function removeFinancialAccountAssociation")
    );
    expect(fn).not.toContain("mask");
    expect(fn).not.toContain(".name");
    const migration = readFileSync(
      resolve(process.cwd(), "supabase/migrations/20261002_plaid_balance_observation.sql"),
      "utf8"
    );
    const sql = migration.slice(
      migration.indexOf("CREATE FUNCTION public.associate_plaid_financial_account")
    );
    expect(sql).not.toContain("->> 'name'");
    expect(sql).not.toContain("->>'name'");
    expect(sql).not.toContain("->>'mask'");
    expect(depositoryChoiceLabel({
      name: "Everyday",
      mask: "1234",
      subtype: "checking",
      institutionName: "Example Bank",
    })).toBe("Everyday · ····1234 · Example Bank");
  });

  it("removes a link and lets the Plaid account be linked again", () => {
    const linked = associate([]).associations;
    const removed = removeFinancialAccountAssociation(linked, {
      userId: USER,
      financialAccountId: "acct-checking",
    });
    expect(removed.status).toBe("removed");
    expect(removed.associations).toEqual([]);
    const again = associate(removed.associations, { financialAccountId: "acct-savings" });
    expect(again.status).toBe("associated");
    expect(again.associations[0]?.financialAccountId).toBe("acct-savings");
  });

  it("replaces a link whose vault account is gone and refuses a live one", () => {
    const stale: AccountAssociationRecord = {
      userId: USER,
      financialAccountId: "deleted-account",
      plaidAccountId: "plaid-checking",
      confirmedAt: AT,
    };
    const replaced = associate([stale]);
    expect(replaced.status).toBe("associated");
    expect(replaced.associations).toEqual([
      {
        userId: USER,
        financialAccountId: "acct-checking",
        plaidAccountId: "plaid-checking",
        confirmedAt: AT,
      },
    ]);
    const live = associate(replaced.associations, { financialAccountId: "acct-savings" });
    expect(live.status).toBe("rejected");
  });

  it("offers only unlinked depository checking and savings accounts", () => {
    const ids = unassociatedDepositoryAccountIds({
      userId: USER,
      plaidAccounts: [
        plaid,
        { ...plaid, plaidAccountId: "plaid-savings", subtype: "savings" },
        { ...plaid, plaidAccountId: "card", accountType: "credit", subtype: "credit card" },
        { ...plaid, userId: OTHER, plaidAccountId: "other-checking" },
      ],
      associations: [
        {
          userId: USER,
          financialAccountId: "acct-checking",
          plaidAccountId: "plaid-checking",
          confirmedAt: AT,
        },
      ],
      liveFinancialAccountIds: ["acct-checking"],
    });
    expect(ids).toEqual(["plaid-savings"]);
  });
});

describe("deterministic comparison and accept", () => {
  const linked = {
    associated: true,
    accountType: "depository",
    subtype: "checking",
  };

  it("compares exact cents and treats zero as no discrepancy", () => {
    expect(recordedBalanceCents(10.01)).toBe(intelligenceCents(10.01));
    expect(dollarsFromCents(1_001)).toBe(10.01);
    const match = compareRecordedBalance({
      ...linked,
      recordedBalance: 80,
      observation: observation({ currentCents: 8_000, availableCents: 1 }),
    });
    expect(match).toEqual({ status: "match", currentCents: 8_000 });
    expect(
      describeAccountBalance({
        account: checkingAccount(80),
        associatedPlaidAccountId: "plaid-checking",
        accountType: "depository",
        subtype: "checking",
        observation: {
          id: "row",
          userId: USER,
          plaidAccountId: "plaid-checking",
          currentCents: 8_000,
          availableCents: 1,
          isoCurrencyCode: "USD",
          unofficialCurrencyCode: null,
          observedAt: AT,
          source: "accounts_get",
        },
      }).status
    ).toBe("match");
    expect(
      acceptObservedBalance({
        account: checkingAccount(80),
        ...linked,
        observation: observation({ currentCents: 8_000 }),
        today: "2026-09-26",
      })
    ).toBeNull();
  });

  it("reports a signed cent difference without changing the vault balance", () => {
    const account = checkingAccount(80);
    const accounts = [account];
    const view = describeAccountBalance({
      account,
      associatedPlaidAccountId: "plaid-checking",
      accountType: "depository",
      subtype: "checking",
      observation: {
        id: "row",
        userId: USER,
        plaidAccountId: "plaid-checking",
        currentCents: 12_550,
        availableCents: 12_000,
        isoCurrencyCode: "USD",
        unofficialCurrencyCode: null,
        observedAt: AT,
        source: "accounts_get",
      },
    });
    expect(view).toMatchObject({
      status: "differs",
      differenceCents: 4_550,
      canAccept: true,
    });
    const lower = compareRecordedBalance({
      ...linked,
      recordedBalance: 125.5,
      observation: observation({ currentCents: 8_000 }),
    });
    expect(lower).toMatchObject({ status: "differs", differenceCents: -4_550 });
    expect(sumAccountBalances(accounts)).toBe(80);
    expect(account.balance).toBe(80);
    expect(account.asOf).toBe("2026-09-01");
  });

  it("accepts the observed current into only that account and sets the local civil date", () => {
    const checking = checkingAccount(80);
    const savings: FinancialAccount = {
      id: "acct-savings",
      name: "Reserve",
      kind: "savings",
      balance: 20,
      asOf: "2026-09-01",
    };
    const accepted = acceptObservedBalance({
      account: checking,
      ...linked,
      observation: observation({ currentCents: 12_550 }),
      today: "2026-09-26",
    });
    expect(accepted).toEqual({
      name: "Everyday",
      kind: "checking",
      balance: 125.5,
      asOf: "2026-09-26",
    });
    const nextAccounts = [savings, { ...checking, ...accepted! }];
    expect(sumAccountBalances(nextAccounts)).toBe(145.5);
    expect(savings.balance).toBe(20);
    expect(
      compareRecordedBalance({
        ...linked,
        recordedBalance: accepted!.balance,
        observation: observation({ currentCents: 12_550 }),
      }).status
    ).toBe("match");
  });

  it("refuses a negative observed current and never accepts available", () => {
    const negative = acceptObservedBalance({
      account: checkingAccount(80),
      ...linked,
      observation: observation({ currentCents: -50, availableCents: 100 }),
      today: "2026-09-26",
    });
    expect(negative).toBeNull();
    expect(
      describeAccountBalance({
        account: checkingAccount(80),
        associatedPlaidAccountId: "plaid-checking",
        accountType: "depository",
        subtype: "checking",
        observation: {
          id: "row",
          userId: USER,
          plaidAccountId: "plaid-checking",
          currentCents: -50,
          availableCents: 100,
          isoCurrencyCode: "USD",
          unofficialCurrencyCode: null,
          observedAt: AT,
          source: "accounts_get",
        },
      })
    ).toMatchObject({ status: "differs", canAccept: false, differenceCents: -8_050 });
    const fromAvailable = acceptObservedBalance({
      account: checkingAccount(0),
      ...linked,
      observation: {
        currentCents: 2_500,
        isoCurrencyCode: "USD",
        unofficialCurrencyCode: null,
      },
      today: "2026-09-26",
    });
    expect(fromAvailable?.balance).toBe(25);
  });

  it("hides association on cash and leaves Financial Position math on vault balances", () => {
    const cash: FinancialAccount = {
      id: "acct-cash",
      name: "Wallet",
      kind: "cash",
      balance: 15,
      asOf: "2026-09-01",
    };
    expect(
      describeAccountBalance({
        account: cash,
        associatedPlaidAccountId: null,
        accountType: null,
        subtype: null,
        observation: null,
      }).status
    ).toBe("hidden");
    expect(sumAccountBalances([checkingAccount(80), cash])).toBe(95);
  });

  it("leaves Attention, confirmed meaning, repetition, movement, and the contract untouched", () => {
    const expenses = EMPTY_STATE.expenses;
    expect(deriveDueAttention(expenses, "2026-09-26")).toEqual([]);
    const state = {
      ...EMPTY_STATE,
      accounts: [checkingAccount(80)],
    };
    const before = assembleIntelligenceContract({
      state,
      ianaTimeZone: "America/Boise",
      now: new Date("2026-09-26T18:00:00.000Z"),
      generatedAt: "2026-09-26T18:00:00.000Z",
    });
    expect(before.position.money_available_cents).toBe(8_000);
    expect(before.boundaries.unknowns).toContain("balances_are_manual");
    expect(before.boundaries.unknowns).toContain("no_reconciliation");
    expect(before.boundaries.unknowns).toContain("plaid_is_not_vault_truth");
    expect(before.attention.items).toEqual([]);
    expect(JSON.stringify(before)).not.toContain("plaid-checking");
    expect(JSON.stringify(before)).not.toContain("accounts_get");

    const accepted = acceptObservedBalance({
      account: state.accounts[0]!,
      ...linked,
      observation: observation({ currentCents: 9_000 }),
      today: "2026-09-26",
    });
    const after = assembleIntelligenceContract({
      state: {
        ...state,
        accounts: [{ ...state.accounts[0]!, balance: accepted!.balance, asOf: accepted!.asOf }],
      },
      ianaTimeZone: "America/Boise",
      now: new Date("2026-09-26T18:00:00.000Z"),
      generatedAt: "2026-09-26T18:00:00.000Z",
    });
    expect(after.position.money_available_cents).toBe(9_000);
    expect(after.position.accounts[0]?.as_of).toBe("2026-09-26");
    expect(after.boundaries.unknowns).toEqual(before.boundaries.unknowns);
    expect(after.attention.items).toEqual([]);

    const untouched = [
      "lib/babylon/attention.ts",
      "lib/babylon/confirmed-meaning.ts",
      "lib/babylon/intelligence-contract.ts",
      "lib/babylon/notification-evaluator.ts",
      "vercel.json",
      `lib/babylon/${["observed", "repetition"].join("-")}.ts`,
      `lib/babylon/${["correlated", "internal", "movement"].join("-")}.ts`,
    ];
    for (const file of untouched) {
      const source = readFileSync(resolve(process.cwd(), file), "utf8");
      expect(source).not.toContain("balance-observation");
      expect(source).not.toContain("plaid_balance_observations");
      expect(source).not.toContain("plaid_account_associations");
    }
  });
});
