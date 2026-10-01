import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { hasRestrictionConflict } from "@/lib/babylon/account-restriction";
import { deriveAvailableAfterPlannedNeeds } from "@/lib/babylon/available-after-planned-needs";
import {
  composeFinancialAttention,
  financialAttentionEpistemic,
} from "@/lib/babylon/attention";
import {
  operationalAccountPosition,
  operationalMoneyAvailable,
  type BalanceObservationLoad,
} from "@/lib/babylon/balance-evidence-load";
import type { BalanceObservationPublic } from "@/lib/babylon/balance-observation";
import {
  composeRecordedAdministrationQuiet,
  RECORDED_ADMINISTRATION_QUIET_CLAIM,
  type RecordedPositionTruth,
} from "@/lib/babylon/financial-quiet";
import {
  protectedExceedsAvailable,
  protectedOverflowExceeds,
} from "@/lib/babylon/protected-money";
import type { DebtEntry, FinancialAccount } from "@/types/babylon";

const AT = "2026-09-27T08:14:00.000Z";

function debt(): DebtEntry {
  return {
    id: "card",
    creditor: "Card",
    totalDebt: 100,
    remainingDebt: 40,
    monthlyAllocation: 25,
    createdAt: "2026-09-01",
    interestRate: 0,
  };
}

function account(
  partial: Partial<FinancialAccount> & Pick<FinancialAccount, "id">
): FinancialAccount {
  return {
    name: "Checking",
    kind: "checking",
    balance: 1000,
    asOf: "2026-09-01",
    ...partial,
  };
}

function knowable(positions: RecordedPositionTruth & { status: "knowable" } extends never
  ? never
  : Extract<RecordedPositionTruth, { status: "knowable" }>["positions"]): RecordedPositionTruth {
  return { status: "knowable", positions };
}

function quietBase(overrides: Partial<Parameters<typeof composeRecordedAdministrationQuiet>[0]> = {}) {
  return composeRecordedAdministrationQuiet({
    expenses: [],
    today: "2026-09-15",
    currentMonthKey: "2026-09",
    lastClosedMonthKey: null,
    debtSemanticsVersion: 2,
    debts: [],
    openingWealthBuilding: 0,
    openingEmergencyFund: 0,
    moneyAvailable: 1000,
    accounts: [],
    positionTruth: knowable([]),
    cloudConflict: false,
    ...overrides,
  });
}

describe("composeRecordedAdministrationQuiet", () => {
  it("is quiet only when all five administration gates are clear", () => {
    const result = quietBase();
    expect(composeFinancialAttention({
      expenses: [],
      today: "2026-09-15",
      currentMonthKey: "2026-09",
      lastClosedMonthKey: null,
    }).quiet).toBe(true);
    expect(result).toEqual({
      status: "quiet",
      claim: RECORDED_ADMINISTRATION_QUIET_CLAIM,
      currentMonthClosed: false,
    });
    expect(result.status === "quiet" && result.claim).toBe(
      "Nothing in the current recorded operating record requires administration."
    );
  });

  it("does not treat Attention quiet as recorded-administration quiet when debt confirmation is outstanding", () => {
    const attention = composeFinancialAttention({
      expenses: [],
      today: "2026-09-15",
      currentMonthKey: "2026-09",
      lastClosedMonthKey: null,
    });
    expect(attention.quiet).toBe(true);
    expect(financialAttentionEpistemic(attention)).toBe("quiet");
    const result = quietBase({
      debtSemanticsVersion: 1,
      debts: [debt()],
    });
    expect(result).toEqual({
      status: "action_outstanding",
      gates: ["debt_position_confirmation"],
    });
  });

  it("does not treat Attention quiet as Quiet when protected overflow is true", () => {
    const checking = account({
      id: "checking",
      balance: 800,
      purpose: "wealth_building",
    });
    const position = operationalAccountPosition({ account: checking, load: undefined });
    expect(protectedExceedsAvailable(300, 0, 1000)).toBe(false);
    expect(
      protectedOverflowExceeds({
        openingWealthBuilding: 300,
        openingEmergencyFund: 0,
        moneyAvailable: 1000,
        accounts: [checking],
        positions: [position],
      })
    ).toBe(true);
    const result = quietBase({
      openingWealthBuilding: 300,
      moneyAvailable: 1000,
      accounts: [checking],
      positionTruth: knowable([position]),
    });
    expect(result).toEqual({
      status: "action_outstanding",
      gates: ["protected_overflow"],
    });
  });

  it("does not treat Attention quiet as Quiet when a restriction conflicts with operational position", () => {
    const checking = account({ id: "acct-checking", balance: 100, restrictedAmount: 50 });
    const observation: BalanceObservationPublic = {
      id: "obs-checking",
      userId: "user-a",
      plaidAccountId: "plaid-checking",
      currentCents: 4_000,
      availableCents: null,
      isoCurrencyCode: "USD",
      unofficialCurrencyCode: null,
      observedAt: AT,
      source: "accounts_get",
    };
    const load: BalanceObservationLoad = {
      status: "ready",
      evidence: {
        plaidAccounts: [
          {
            id: "pa-1",
            userId: "user-a",
            plaidItemId: "item-1",
            plaidAccountId: "plaid-checking",
            name: "Checking",
            mask: "1234",
            accountType: "depository",
            subtype: "checking",
          },
        ],
        observations: [observation],
        associations: [
          {
            id: "assoc-1",
            userId: "user-a",
            financialAccountId: "acct-checking",
            plaidAccountId: "plaid-checking",
            confirmedAt: AT,
          },
        ],
      },
    };
    const position = operationalAccountPosition({ account: checking, load });
    expect(position.balance).toBe(40);
    expect(hasRestrictionConflict(checking.balance, 50)).toBe(false);
    expect(hasRestrictionConflict(position.balance, 50)).toBe(true);
    const result = quietBase({
      accounts: [checking],
      moneyAvailable: operationalMoneyAvailable({ accounts: [checking], load }),
      positionTruth: knowable([position]),
    });
    expect(result).toEqual({
      status: "action_outstanding",
      gates: ["restriction_conflict"],
    });
  });

  it("stays unknown when Attention itself is unknown", () => {
    const result = quietBase({
      today: "2026-02-31",
      debtSemanticsVersion: 1,
      debts: [debt()],
    });
    expect(result).toEqual({
      status: "unknown",
      reasons: ["attention_unknown"],
    });
  });

  it("lets a non-last day participate without claiming the month is closed", () => {
    const result = quietBase({
      today: "2026-09-29",
      currentMonthKey: "2026-09",
      lastClosedMonthKey: null,
    });
    expect(result).toEqual({
      status: "quiet",
      claim: RECORDED_ADMINISTRATION_QUIET_CLAIM,
      currentMonthClosed: false,
    });
  });

  it("does not let a positive planned-needs shortfall block Quiet", () => {
    const shortfall = deriveAvailableAfterPlannedNeeds({
      deployablePosition: 100,
      deployableProtected: 0,
      upcomingNeeds: 250,
    });
    expect(shortfall.plannedNeedsShortfall).toBeGreaterThan(0);
    expect(quietBase().status).toBe("quiet");
  });

  it("does not read a missing plan or expected funding", () => {
    const source = readFileSync(
      resolve(process.cwd(), "lib/babylon/financial-quiet.ts"),
      "utf8"
    );
    expect(source).not.toContain("monthlyPlans");
    expect(source).not.toContain("no_expected_funding");
    expect(source).not.toContain("plannedNeedsShortfall");
    expect(source).not.toContain("deriveExpectedPaydays");
    expect(source).not.toContain("BUDGET_WARNING");
    expect(quietBase().status).toBe("quiet");
  });

  it("treats loading position evidence as unknown and does not assert action", () => {
    const result = quietBase({
      debtSemanticsVersion: 1,
      debts: [debt()],
      positionTruth: { status: "loading" },
    });
    expect(result).toEqual({
      status: "unknown",
      reasons: ["position_evidence_loading"],
    });
  });

  it("treats unavailable position evidence with nothing retained as unknown", () => {
    const result = quietBase({
      positionTruth: { status: "unavailable" },
    });
    expect(result).toEqual({
      status: "unknown",
      reasons: ["position_evidence_unavailable"],
    });
  });

  it("treats a blocked observed reading as unknown rather than Attention", () => {
    const checking = account({ id: "checking", balance: 10, restrictedAmount: 50 });
    const position = operationalAccountPosition({ account: checking, load: undefined });
    const result = quietBase({
      accounts: [checking],
      positionTruth: { status: "blocked" },
    });
    expect(hasRestrictionConflict(position.balance, 50)).toBe(true);
    expect(result).toEqual({
      status: "unknown",
      reasons: ["observed_position_blocked"],
    });
  });

  it("treats a cloud conflict as unknown for the singular record", () => {
    const result = quietBase({ cloudConflict: true });
    expect(result).toEqual({
      status: "unknown",
      reasons: ["cloud_conflict"],
    });
  });

  it("adds no Attention kind", () => {
    const attention = readFileSync(resolve(process.cwd(), "lib/babylon/attention.ts"), "utf8");
    const quiet = readFileSync(resolve(process.cwd(), "lib/babylon/financial-quiet.ts"), "utf8");
    const established = attention.slice(
      attention.indexOf("export type EstablishedAttentionItem"),
      attention.indexOf("export type DueAttentionEpistemic")
    );
    expect(established).toContain('kind: "due_obligation"');
    expect(established).toContain('kind: "month_close"');
    expect(established).not.toContain("shortfall");
    expect(quiet).toContain("composeFinancialAttention");
    expect(quiet).not.toContain("deriveDueAttention");
    expect(quiet).not.toContain("deriveMonthCloseAttention");
  });
});
