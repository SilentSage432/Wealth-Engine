// @vitest-environment jsdom

import { createElement, type ComponentProps } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { FinancialPosition } from "@/components/babylon/financial-position";
import type { FinancialPositionBalanceObservation } from "@/components/babylon/financial-position";
import { MobileHome } from "@/components/babylon/mobile-home";
import {
  BALANCE_EVIDENCE_UNAVAILABLE_LABEL,
  moneyAvailableEvidenceIsFreshExplanation,
} from "@/lib/babylon/balance-evidence-load";
import {
  alreadySetAsideExplain,
  availableAfterPlannedNeedsExplain,
  availableToUseExplain,
  LIQUID_POSITION_SCOPE,
  plannedNeedsShortfallExplain,
  recordedDebtExplain,
} from "@/lib/babylon/financial-position-composition";
import { DISCREET_MASK } from "@/lib/babylon/discreet";
import type { AvailableAfterPlannedNeeds } from "@/lib/babylon/available-after-planned-needs";
import type { EffectiveAccountPosition } from "@/lib/babylon/balance-observation";
import type { FinancialAccount } from "@/types/babylon";

afterEach(() => {
  cleanup();
});

const FRESH_EVIDENCE =
  "Institution-refreshed balance where an eligible reading exists. Declared balances otherwise.";
const AGED_EVIDENCE =
  "Earlier institution balance where an eligible reading exists. Declared balances otherwise.";
const CACHED_EVIDENCE =
  "Cached Plaid balance where an eligible reading exists. Declared balances otherwise.";
const RESOLVING_EVIDENCE = "Declared balance, while evidence resolves.";

function planned(shortfall = 0): AvailableAfterPlannedNeeds {
  return {
    availableAfterPlannedNeeds: shortfall > 0 ? 0 : 40,
    plannedNeedsShortfall: shortfall,
    rawDifference: shortfall > 0 ? -shortfall : 40,
    freeBeforeNeeds: shortfall > 0 ? 0 : 40,
  };
}

function checking(partial: Partial<FinancialAccount> = {}): FinancialAccount {
  return {
    id: "acct-checking",
    name: "Everyday",
    kind: "checking",
    balance: 80,
    asOf: "2026-09-01",
    ...partial,
  };
}

function observation(input: {
  source: "accounts_get" | "balance_get";
  observedAt: string;
}): FinancialPositionBalanceObservation {
  return {
    load: {
      status: "ready",
      evidence: {
        plaidAccounts: [
          {
            id: "pa",
            userId: "user-a",
            plaidItemId: "item",
            plaidAccountId: "plaid-checking",
            name: "Everyday",
            mask: "1234",
            accountType: "depository",
            subtype: "checking",
          },
        ],
        observations: [
          {
            id: "obs",
            userId: "user-a",
            plaidAccountId: "plaid-checking",
            currentCents: 8_000,
            availableCents: 7_500,
            isoCurrencyCode: "USD",
            unofficialCurrencyCode: null,
            observedAt: input.observedAt,
            source: input.source,
          },
        ],
        associations: [
          {
            id: "assoc",
            userId: "user-a",
            financialAccountId: "acct-checking",
            plaidAccountId: "plaid-checking",
            confirmedAt: "2026-09-01T00:00:00.000Z",
          },
        ],
      },
    },
    institutions: [],
    onAssociate: async () => true,
    onRemoveAssociation: async () => true,
  };
}

function renderPosition(partial: Partial<ComponentProps<typeof FinancialPosition>> = {}) {
  return render(
    createElement(FinancialPosition, {
      accounts: [],
      moneyAvailable: 100,
      openingWealthBuilding: 1,
      openingEmergencyFund: 2,
      protectedMoney: 3,
      wealthBuildingPosition: 0,
      emergencyFundPosition: 0,
      protectedOverAvailable: false,
      upcomingNeeds: 15,
      availableAfterPlannedNeeds: planned(),
      remainingDebt: 9,
      onAddAccount: () => true,
      onUpdateAccount: () => true,
      onRemoveAccount: () => ({ status: "applied" as const }),
      onSetAccountPurpose: () => ({ status: "applied" as const }),
      onClearAccountPurpose: () => ({ status: "applied" as const }),
      onUpdateProtected: () => null,
      ...partial,
    })
  );
}

function renderHome(partial: Partial<ComponentProps<typeof MobileHome>> = {}) {
  return render(
    createElement(MobileHome, {
      moneyAvailable: 100,
      protectedMoney: 3,
      protectedOverAvailable: false,
      availableAfterPlannedNeeds: planned(),
      upcomingNeeds: 15,
      remainingDebt: 9,
      expenses: [],
      dueAttention: [],
      onMarkPaid: () => undefined,
      recentActivity: [],
      discreet: false,
      onNavigate: () => undefined,
      ...partial,
    })
  );
}

function toggle(name = "How this is calculated") {
  return screen.getByRole("button", { name });
}

function shows(text: string): boolean {
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  let node = walker.nextNode();
  while (node) {
    const parent = node.parentElement;
    if (
      parent &&
      parent.closest("[hidden]") === null &&
      node.textContent?.includes(text)
    ) {
      return true;
    }
    node = walker.nextNode();
  }
  return false;
}

describe("money available evidence placement", () => {
  const declared: EffectiveAccountPosition = {
    accountId: "acct-checking",
    balance: 80,
    source: "declared",
    asOf: "2026-09-01",
  };
  const now = Date.parse("2026-09-30T12:00:00.000Z");

  it("keeps every non-fresh caption with the headline", () => {
    expect(
      moneyAvailableEvidenceIsFreshExplanation({
        load: { status: "loading" },
        positions: [declared],
        nowMs: now,
      })
    ).toBe(false);
    expect(
      moneyAvailableEvidenceIsFreshExplanation({
        load: { status: "disabled" },
        positions: [declared],
        nowMs: now,
      })
    ).toBe(false);
    expect(
      moneyAvailableEvidenceIsFreshExplanation({
        load: { status: "unavailable", evidence: null },
        positions: [declared],
        nowMs: now,
      })
    ).toBe(false);
    expect(
      moneyAvailableEvidenceIsFreshExplanation({
        load: undefined,
        positions: [],
        nowMs: now,
      })
    ).toBe(false);
  });

  it("treats an all-fresh institution reading as explanation", () => {
    const fresh: EffectiveAccountPosition = {
      accountId: "acct-checking",
      balance: 80,
      source: "observed",
      currentCents: 8_000,
      observedAt: new Date(now - 1_000).toISOString(),
      observationId: "obs",
      observationSource: "balance_get",
    };
    expect(
      moneyAvailableEvidenceIsFreshExplanation({
        load: {
          status: "ready",
          evidence: { plaidAccounts: [], observations: [], associations: [] },
        },
        positions: [fresh],
        nowMs: now,
      })
    ).toBe(true);
  });
});

describe("desktop Financial Position disclosure", () => {
  it("defaults closed and keeps the readings visible", () => {
    renderPosition({
      wealthBuildingPosition: 4,
      emergencyFundPosition: 5,
    });
    const control = toggle();
    expect(control.getAttribute("aria-expanded")).toBe("false");
    expect(control.getAttribute("aria-controls")).toContain(
      "financial-position-hero-calculation"
    );
    expect(shows("Liquid Position")).toBe(true);
    expect(shows("$100.00")).toBe(true);
    expect(shows("Already Set Aside")).toBe(true);
    expect(shows("$3.00")).toBe(true);
    expect(shows("Existing Wealth Building")).toBe(true);
    expect(shows("Existing Emergency Fund")).toBe(true);
    expect(shows("currently positioned")).toBe(true);
    expect(shows("Available After Planned Needs")).toBe(true);
    expect(shows("$40.00")).toBe(true);
    expect(shows("Upcoming Needs")).toBe(true);
    expect(shows("$15.00")).toBe(true);
    expect(shows("Recorded Debt")).toBe(true);
    expect(shows("$9.00")).toBe(true);
    expect(shows(alreadySetAsideExplain(3))).toBe(false);
    expect(shows(availableAfterPlannedNeedsExplain())).toBe(false);
    expect(shows(recordedDebtExplain(9))).toBe(false);
    expect(shows(LIQUID_POSITION_SCOPE)).toBe(false);
    expect(document.getElementById("financial-position-hero-calculation")?.hidden).toBe(
      true
    );
  });

  it("opens the existing explanations and closes without leaving them accessible", () => {
    renderPosition();
    const control = toggle();
    control.focus();
    fireEvent.click(control);
    expect(control.getAttribute("aria-expanded")).toBe("true");
    expect(document.activeElement).toBe(control);
    expect(shows(alreadySetAsideExplain(3))).toBe(true);
    expect(shows(availableAfterPlannedNeedsExplain())).toBe(true);
    expect(shows(recordedDebtExplain(9))).toBe(true);
    expect(shows(LIQUID_POSITION_SCOPE)).toBe(true);
    expect(shows("does not explain why a balance changed")).toBe(true);
    fireEvent.click(control);
    expect(control.getAttribute("aria-expanded")).toBe("false");
    expect(document.activeElement).toBe(control);
    expect(shows(alreadySetAsideExplain(3))).toBe(false);
    expect(screen.getByRole("region", { name: "Financial Position" }).isConnected).toBe(
      true
    );
  });

  it("keeps shortfall, set-aside conflict, and restriction conflict visible while closed", () => {
    renderPosition({
      protectedOverAvailable: true,
      availableAfterPlannedNeeds: planned(12.5),
      accounts: [
        checking({
          id: "restricted",
          name: "Hold",
          balance: 10,
          restrictedAmount: 40,
        }),
      ],
    });
    expect(shows("Planned Needs Shortfall")).toBe(true);
    expect(shows(plannedNeedsShortfallExplain())).toBe(true);
    expect(shows("$12.50")).toBe(true);
    expect(
      shows("Already-set-aside amounts exceed your current Liquid Position")
    ).toBe(true);
    expect(
      shows("declared unavailable amount is greater than the current")
    ).toBe(true);
    expect(shows(availableAfterPlannedNeedsExplain())).toBe(false);
  });

  it("keeps unavailable, aged, and cached evidence visible and hides a fresh caption", () => {
    const { unmount } = renderPosition({
      balanceObservation: {
        load: { status: "unavailable", evidence: null },
        institutions: [],
        onAssociate: async () => true,
        onRemoveAssociation: async () => true,
      },
    });
    expect(shows(BALANCE_EVIDENCE_UNAVAILABLE_LABEL)).toBe(true);
    expect(shows("Declared balance. Stored balance evidence is unavailable.")).toBe(
      true
    );
    unmount();

    renderPosition({
      accounts: [checking()],
      balanceObservation: observation({
        source: "balance_get",
        observedAt: new Date(Date.now() - 6 * 60 * 1000).toISOString(),
      }),
    });
    expect(shows(AGED_EVIDENCE)).toBe(true);
    cleanup();

    renderPosition({
      accounts: [checking()],
      balanceObservation: observation({
        source: "accounts_get",
        observedAt: new Date().toISOString(),
      }),
    });
    expect(shows(CACHED_EVIDENCE)).toBe(true);
    cleanup();

    renderPosition({
      balanceObservation: {
        load: { status: "loading" },
        institutions: [],
        onAssociate: async () => true,
        onRemoveAssociation: async () => true,
      },
    });
    expect(shows(RESOLVING_EVIDENCE)).toBe(true);
    cleanup();

    renderPosition({
      accounts: [checking()],
      balanceObservation: observation({
        source: "balance_get",
        observedAt: new Date().toISOString(),
      }),
    });
    expect(shows(FRESH_EVIDENCE)).toBe(false);
    fireEvent.click(toggle());
    expect(shows(FRESH_EVIDENCE)).toBe(true);
    expect(shows(LIQUID_POSITION_SCOPE)).toBe(true);
  });

  it("shows the restricted hero explanation only after opening", () => {
    renderPosition({ restrictedEffectiveTotal: 20, deployablePosition: 80 });
    expect(shows("Available to use")).toBe(true);
    expect(shows("Unavailable")).toBe(true);
    expect(shows(availableToUseExplain())).toBe(false);
    fireEvent.click(toggle());
    expect(shows(availableToUseExplain())).toBe(true);
  });

  it("does not reset the set-aside dialog or write disclosure state", () => {
    const setItem = vi.spyOn(Storage.prototype, "setItem");
    renderPosition();
    const section = screen.getByRole("region", { name: "Financial Position" });
    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    expect(screen.getByRole("dialog")).toBeTruthy();
    const control = screen.getByRole("button", {
      name: "How this is calculated",
      hidden: true,
    });
    fireEvent.click(control);
    fireEvent.click(control);
    expect(control.getAttribute("aria-expanded")).toBe("false");
    expect(screen.getByRole("dialog")).toBeTruthy();
    expect(section.isConnected).toBe(true);
    expect(setItem).not.toHaveBeenCalled();
    setItem.mockRestore();
  });

  it("masks visible amounts in discreet mode", () => {
    renderPosition({ discreet: true });
    expect(screen.getAllByText(DISCREET_MASK).length).toBeGreaterThan(0);
    expect(screen.queryByText("$100.00")).toBeNull();
    expect(screen.queryByText("$3.00")).toBeNull();
    expect(screen.queryByText("$40.00")).toBeNull();
    expect(screen.queryByText("$9.00")).toBeNull();
    expect(screen.queryByText("$15.00")).toBeNull();
  });

  it("leaves manage mode explanation visible for phone More", () => {
    renderPosition({ presentation: "manage" });
    expect(screen.queryByRole("button", { name: "How this is calculated" })).toBeNull();
    expect(shows(alreadySetAsideExplain(3))).toBe(true);
    expect(screen.queryByText("Available After Planned Needs")).toBeNull();
  });
});

describe("phone Home disclosure", () => {
  it("defaults closed and keeps Home readings visible", () => {
    renderHome();
    const control = toggle();
    expect(control.getAttribute("aria-expanded")).toBe("false");
    expect(control.getAttribute("aria-controls")).toContain(
      "home-position-hero-calculation"
    );
    expect(control.getAttribute("aria-controls")).toContain("home-aapn-calculation");
    expect(shows("Liquid Position")).toBe(true);
    expect(shows("$100.00")).toBe(true);
    expect(shows("Already Set Aside")).toBe(true);
    expect(shows("Available After Planned Needs")).toBe(true);
    expect(shows("$40.00")).toBe(true);
    expect(shows("Recorded Debt")).toBe(true);
    expect(shows("Upcoming Needs")).toBe(true);
    expect(shows("$15.00")).toBe(true);
    expect(shows(alreadySetAsideExplain(3))).toBe(false);
    expect(shows(recordedDebtExplain(9))).toBe(false);
    expect(shows(LIQUID_POSITION_SCOPE)).toBe(false);
    expect(shows("Debt is not")).toBe(false);
    expect(document.getElementById("home-aapn-calculation")?.hidden).toBe(true);
  });

  it("reveals the existing Home explanations when opened", () => {
    renderHome();
    const control = toggle();
    control.focus();
    fireEvent.click(control);
    expect(control.getAttribute("aria-expanded")).toBe("true");
    expect(shows(alreadySetAsideExplain(3))).toBe(true);
    expect(shows(recordedDebtExplain(9))).toBe(true);
    expect(shows(LIQUID_POSITION_SCOPE)).toBe(true);
    expect(shows("Debt is not")).toBe(true);
    fireEvent.click(control);
    expect(control.getAttribute("aria-expanded")).toBe("false");
    expect(document.activeElement).toBe(control);
    expect(shows("Debt is not")).toBe(false);
    expect(screen.getByRole("button", { name: "Manage accounts" })).toBeTruthy();
  });

  it("keeps shortfall and set-aside conflict visible while closed", () => {
    renderHome({
      protectedOverAvailable: true,
      availableAfterPlannedNeeds: planned(12.5),
    });
    expect(shows("Planned Needs Shortfall")).toBe(true);
    expect(shows(plannedNeedsShortfallExplain())).toBe(true);
    expect(shows("Already-set-aside amounts exceed Liquid Position.")).toBe(true);
    expect(shows("Debt is not")).toBe(false);
  });

  it("keeps non-fresh evidence visible and puts a fresh caption behind the disclosure", () => {
    const { unmount } = renderHome({
      balanceObservation: {
        load: { status: "unavailable", evidence: null },
        institutions: [],
        onAssociate: async () => true,
        onRemoveAssociation: async () => true,
      },
    });
    expect(shows(BALANCE_EVIDENCE_UNAVAILABLE_LABEL)).toBe(true);
    expect(shows("Declared balance. Stored balance evidence is unavailable.")).toBe(
      true
    );
    unmount();

    renderHome({
      accounts: [checking()],
      balanceObservation: observation({
        source: "balance_get",
        observedAt: new Date(Date.now() - 6 * 60 * 1000).toISOString(),
      }),
    });
    expect(shows(AGED_EVIDENCE)).toBe(true);
    cleanup();

    renderHome({
      accounts: [checking()],
      balanceObservation: observation({
        source: "accounts_get",
        observedAt: new Date().toISOString(),
      }),
    });
    expect(shows(CACHED_EVIDENCE)).toBe(true);
    cleanup();

    renderHome({
      accounts: [checking()],
      balanceObservation: observation({
        source: "balance_get",
        observedAt: new Date().toISOString(),
      }),
    });
    expect(shows(FRESH_EVIDENCE)).toBe(false);
    fireEvent.click(toggle());
    expect(shows(FRESH_EVIDENCE)).toBe(true);
  });

  it("masks Home amounts in discreet mode", () => {
    renderHome({ discreet: true });
    expect(screen.getAllByText(DISCREET_MASK).length).toBeGreaterThan(0);
    expect(screen.queryByText("$100.00")).toBeNull();
    expect(screen.queryByText("$40.00")).toBeNull();
  });
});
