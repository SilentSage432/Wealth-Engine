import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { deriveAvailableAfterPlannedNeeds } from "@/lib/babylon/available-after-planned-needs";
import {
  operationalAccountPosition,
  operationalMoneyAvailable,
  type BalanceObservationLoad,
} from "@/lib/babylon/balance-evidence-load";
import {
  deriveEffectiveAccountPositions,
  deriveEffectiveMoneyAvailable,
  toBalanceObservationPublic,
  type BalanceObservationPublic,
} from "@/lib/babylon/balance-observation";
import { EMPTY_STATE } from "@/lib/babylon/constants";
import { livingBudgetRemaining } from "@/lib/babylon/engine";
import { sumAccountBalances } from "@/lib/babylon/financial-position";
import { assembleIntelligenceContract } from "@/lib/babylon/intelligence-contract";
import {
  protectedDesignationError,
  protectedExceedsAvailable,
} from "@/lib/babylon/protected-money";
import type { FinancialAccount } from "@/types/babylon";

const AT = "2026-09-27T08:14:00.000Z";

function account(
  partial: Partial<FinancialAccount> & Pick<FinancialAccount, "id" | "kind">
): FinancialAccount {
  return {
    name: partial.kind === "cash" ? "Cash" : "Checking",
    balance: 80,
    asOf: "2026-09-01",
    ...partial,
  };
}

function observation(
  partial: Partial<BalanceObservationPublic> = {}
): BalanceObservationPublic {
  return {
    id: "obs-checking",
    userId: "user-a",
    plaidAccountId: "plaid-checking",
    currentCents: 9_000,
    availableCents: 1,
    isoCurrencyCode: "USD",
    unofficialCurrencyCode: null,
    observedAt: AT,
    source: "accounts_get",
    ...partial,
  };
}

function evidence(input: {
  accounts?: readonly FinancialAccount[];
  observations?: readonly BalanceObservationPublic[];
  plaidAccountId?: string;
  accountType?: string | null;
  subtype?: string | null;
  financialAccountId?: string;
}) {
  const financialAccountId = input.financialAccountId ?? "acct-checking";
  const plaidAccountId = input.plaidAccountId ?? "plaid-checking";
  return {
    accounts: input.accounts ?? [account({ id: financialAccountId, kind: "checking" })],
    plaidAccounts: [
      {
        plaidAccountId,
        accountType: input.accountType === undefined ? "depository" : input.accountType,
        subtype: input.subtype === undefined ? "checking" : input.subtype,
      },
    ],
    observations: input.observations ?? [observation({ plaidAccountId })],
    associations: [{ financialAccountId, plaidAccountId }],
  };
}

function ready(bundle: ReturnType<typeof evidence>): Extract<
  BalanceObservationLoad,
  { status: "ready" }
> {
  return {
    status: "ready",
    evidence: {
      plaidAccounts: bundle.plaidAccounts.map((row) => ({
        id: "pa-1",
        userId: "user-a",
        plaidItemId: "item-1",
        name: "Checking",
        mask: "1234",
        ...row,
      })),
      observations: bundle.observations,
      associations: bundle.associations.map((row) => ({
        id: "assoc-1",
        userId: "user-a",
        confirmedAt: AT,
        ...row,
      })),
    },
  };
}

describe("effective money available", () => {
  it("replaces one eligible declaration and keeps a match observed", () => {
    const differs = evidence({ observations: [observation({ currentCents: 9_000 })] });
    expect(deriveEffectiveMoneyAvailable(differs)).toBe(90);
    expect(deriveEffectiveAccountPositions(differs)[0]).toMatchObject({
      source: "observed",
      balance: 90,
      observedAt: AT,
      currentCents: 9_000,
    });

    const match = evidence({
      accounts: [account({ id: "acct-checking", kind: "checking", balance: 80 })],
      observations: [observation({ currentCents: 8_000, availableCents: 50_000 })],
    });
    const matched = deriveEffectiveAccountPositions(match)[0];
    expect(matched).toMatchObject({ source: "observed", balance: 80, currentCents: 8_000 });
    expect(deriveEffectiveMoneyAvailable(match)).toBe(80);
  });

  it("sums several observed accounts with cash and an unlinked declaration", () => {
    const checking = account({ id: "acct-checking", kind: "checking", balance: 10 });
    const savings = account({
      id: "acct-savings",
      kind: "savings",
      name: "Savings",
      balance: 20,
    });
    const cash = account({ id: "acct-cash", kind: "cash", name: "Cash", balance: 0.1 });
    const unlinked = account({
      id: "acct-other",
      kind: "checking",
      name: "Other",
      balance: 0.2,
    });
    const sum = deriveEffectiveMoneyAvailable({
      accounts: [checking, savings, cash, unlinked],
      plaidAccounts: [
        { plaidAccountId: "plaid-checking", accountType: "depository", subtype: "checking" },
        { plaidAccountId: "plaid-savings", accountType: "depository", subtype: "savings" },
      ],
      observations: [
        observation({ plaidAccountId: "plaid-checking", currentCents: 1_001, availableCents: 9 }),
        observation({
          id: "obs-savings",
          plaidAccountId: "plaid-savings",
          currentCents: 1_002,
          availableCents: 4,
        }),
      ],
      associations: [
        { financialAccountId: "acct-checking", plaidAccountId: "plaid-checking" },
        { financialAccountId: "acct-savings", plaidAccountId: "plaid-savings" },
      ],
    });
    expect(sum).toBe(20.33);
    expect(sumAccountBalances([checking, savings, cash, unlinked])).toBe(30.3);
  });

  it("falls back for ineligible, negative, non-USD, unofficial, and missing evidence", () => {
    const declared = account({ id: "acct-checking", kind: "checking", balance: 80 });
    const cases = [
      evidence({
        accounts: [declared],
        observations: [observation({ isoCurrencyCode: "EUR" })],
      }),
      evidence({
        accounts: [declared],
        observations: [observation({ currentCents: -50 })],
      }),
      evidence({
        accounts: [declared],
        observations: [observation({ unofficialCurrencyCode: "BTC" })],
      }),
      evidence({
        accounts: [declared],
        plaidAccountId: "missing",
        observations: [observation()],
      }),
      evidence({ accounts: [declared], observations: [] }),
    ];
    for (const item of cases) {
      expect(deriveEffectiveMoneyAvailable(item)).toBe(80);
      expect(deriveEffectiveAccountPositions(item)[0]?.source).toBe("declared");
    }
  });

  it("ignores available cents and a superseded row", () => {
    const bundle = evidence({
      observations: [observation({ currentCents: 9_001, availableCents: 1 })],
    });
    expect(deriveEffectiveMoneyAvailable(bundle)).toBe(90.01);
    const superseded = toBalanceObservationPublic({
      id: "old",
      user_id: "user-a",
      plaid_account_id: "plaid-checking",
      current_cents: 50_000,
      available_cents: 50_000,
      iso_currency_code: "USD",
      unofficial_currency_code: null,
      observed_at: AT,
      source: "accounts_get",
      state: "superseded",
    });
    expect(superseded).toBeNull();
    expect(
      deriveEffectiveMoneyAvailable({
        ...bundle,
        observations: [],
      })
    ).toBe(80);
  });

  it("rounds awkward cents and leaves its inputs unchanged", () => {
    const checking = account({ id: "acct-checking", kind: "checking", balance: 1.01 });
    const savings = account({ id: "acct-savings", kind: "savings", name: "Savings", balance: 2 });
    const observations = [
      observation({ currentCents: 333, availableCents: 1 }),
      observation({ id: "obs-savings", plaidAccountId: "plaid-savings", currentCents: 334 }),
    ];
    const input = {
      accounts: [checking, savings],
      plaidAccounts: [
        { plaidAccountId: "plaid-checking", accountType: "depository", subtype: "checking" },
        { plaidAccountId: "plaid-savings", accountType: "depository", subtype: "savings" },
      ],
      observations,
      associations: [
        { financialAccountId: "acct-checking", plaidAccountId: "plaid-checking" },
        { financialAccountId: "acct-savings", plaidAccountId: "plaid-savings" },
      ],
    };
    const before = structuredClone(input);
    expect(deriveEffectiveMoneyAvailable(input)).toBe(6.67);
    expect(input).toEqual(before);
  });
});

describe("operational position load rules", () => {
  const bundle = evidence({ observations: [observation({ currentCents: 9_000 })] });
  const load = ready(bundle);

  it("uses ready evidence, retained evidence, and declarations otherwise", () => {
    expect(operationalMoneyAvailable({ accounts: bundle.accounts, load })).toBe(90);
    const retained: BalanceObservationLoad = {
      status: "unavailable",
      evidence: load.status === "ready" ? load.evidence : null,
    };
    expect(operationalMoneyAvailable({ accounts: bundle.accounts, load: retained })).toBe(90);
    expect(operationalAccountPosition({ account: bundle.accounts[0]!, load: retained })).toMatchObject({
      source: "observed",
      observedAt: AT,
      balance: 90,
    });
    const missing: BalanceObservationLoad = { status: "unavailable", evidence: null };
    expect(operationalMoneyAvailable({ accounts: bundle.accounts, load: missing })).toBe(80);
    expect(operationalAccountPosition({ account: bundle.accounts[0]!, load: missing }).source).toBe(
      "declared"
    );
    expect(
      operationalMoneyAvailable({ accounts: bundle.accounts, load: { status: "loading" } })
    ).toBe(80);
    expect(
      operationalMoneyAvailable({ accounts: bundle.accounts, load: { status: "disabled" } })
    ).toBe(80);
  });

  it("replaces retained evidence with a successful empty read", () => {
    const empty: BalanceObservationLoad = {
      status: "ready",
      evidence: { plaidAccounts: [], observations: [], associations: [] },
    };
    expect(operationalMoneyAvailable({ accounts: bundle.accounts, load: empty })).toBe(80);
    expect(operationalAccountPosition({ account: bundle.accounts[0]!, load: empty }).source).toBe(
      "declared"
    );
  });
});

describe("downstream financial position", () => {
  it("uses effective Money Available for protected conflict and planned needs", () => {
    const bundle = evidence({
      accounts: [account({ id: "acct-checking", kind: "checking", balance: 100 })],
      observations: [observation({ currentCents: 4_000 })],
    });
    const load = ready(bundle);
    const money = operationalMoneyAvailable({ accounts: bundle.accounts, load });
    expect(money).toBe(40);
    expect(sumAccountBalances(bundle.accounts)).toBe(100);
    expect(protectedExceedsAvailable(50, 0, money)).toBe(true);
    expect(protectedExceedsAvailable(50, 0, sumAccountBalances(bundle.accounts))).toBe(false);
    expect(protectedDesignationError(50, 0, money)).toBe(
      "Protected designations exceed your current Money Available. Update your protected amounts or Financial Position."
    );
    expect(protectedDesignationError(50, 0, money)).not.toBeNull();
    const planned = deriveAvailableAfterPlannedNeeds({
      deployablePosition: money,
      deployableProtected: 10,
      upcomingNeeds: 50,
    });
    expect(planned.availableAfterPlannedNeeds).toBe(0);
    expect(planned.plannedNeedsShortfall).toBe(20);
    expect(planned.rawDifference).toBe(-20);
  });

  it("leaves Living Budget and month close on their existing inputs", () => {
    expect(livingBudgetRemaining(70, 30)).toBe(40);
    const planned = readFileSync(
      resolve(process.cwd(), "lib/babylon/available-after-planned-needs.ts"),
      "utf8"
    );
    const engine = readFileSync(resolve(process.cwd(), "hooks/useBabylonEngine.ts"), "utf8");
    expect(planned).not.toContain("balance-observation");
    expect(engine).toContain("livingBudgetRemaining(");
    const close = engine.slice(
      engine.indexOf("const closeMonth"),
      engine.indexOf("const addAccount")
    );
    expect(close).not.toContain("operationalMoneyAvailable");
    expect(close).not.toContain("deriveEffective");
    const dashboard = readFileSync(
      resolve(process.cwd(), "components/babylon/wealth-engine-dashboard.tsx"),
      "utf8"
    );
    expect(dashboard).toContain("moneyAvailable={engine.moneyAvailable}");
    expect(dashboard.match(/moneyAvailable=\{engine\.moneyAvailable\}/g)?.length).toBeGreaterThan(1);
  });

  it("gives Sindarin the same effective position and an explicit evidence failure", () => {
    const checking = account({ id: "acct-checking", kind: "checking", name: "Checking", balance: 80 });
    const observed = observation({ currentCents: 9_000, availableCents: 1 });
    const shared = assembleIntelligenceContract({
      state: { ...EMPTY_STATE, accounts: [checking] },
      ianaTimeZone: "America/Boise",
      now: new Date("2026-09-27T18:00:00.000Z"),
      generatedAt: "2026-09-27T18:00:00.000Z",
      balanceEvidence: {
        status: "ready",
        plaidAccounts: [
          { plaidAccountId: "plaid-checking", accountType: "depository", subtype: "checking" },
        ],
        observations: [observed],
        associations: [
          { financialAccountId: checking.id, plaidAccountId: "plaid-checking" },
        ],
      },
    });
    expect(shared.meta.contract_version).toBe("3");
    expect(shared.position.money_available_cents).toBe(9_000);
    expect(shared.position.accounts[0]).toMatchObject({
      declared_balance_cents: 8_000,
      effective_balance_cents: 9_000,
      effective_source: "observed",
      observed_current_cents: 9_000,
      observed_at: AT,
      observation_kind: "cached_accounts_get",
    });
    expect(shared.boundaries.unknowns).toContain("balance_change_cause_unknown");
    expect(shared.boundaries.unknowns).toContain("cached_accounts_get_balance");
    expect(shared.boundaries.unknowns).toContain("plaid_is_not_vault_truth");
    expect(shared.boundaries.unknowns).not.toContain("balances_are_manual");
    expect(JSON.stringify(shared)).not.toContain(observed.id);
    expect(checking.balance).toBe(80);

    const failed = assembleIntelligenceContract({
      state: { ...EMPTY_STATE, accounts: [checking] },
      ianaTimeZone: "America/Boise",
      now: new Date("2026-09-27T18:00:00.000Z"),
      generatedAt: "2026-09-27T18:00:00.000Z",
      balanceEvidence: { status: "unavailable" },
    });
    expect(failed.position.money_available_cents).toBe(8_000);
    expect(failed.position.accounts[0]?.effective_source).toBe("declared");
    expect(failed.boundaries.unknowns).toContain("balance_evidence_unavailable");
    expect(failed.boundaries.unknowns).not.toContain("balances_are_manual");
  });
});
