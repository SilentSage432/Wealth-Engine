// @vitest-environment jsdom

import { createElement, type ComponentProps } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { FinancialPosition } from "@/components/babylon/financial-position";
import type { FinancialPositionBalanceObservation } from "@/components/babylon/financial-position";
import {
  BALANCE_EVIDENCE_UNAVAILABLE_LABEL,
} from "@/lib/babylon/balance-evidence-load";
import { DISCREET_MASK } from "@/lib/babylon/discreet";
import type { AvailableAfterPlannedNeeds } from "@/lib/babylon/available-after-planned-needs";
import type { FinancialAccount } from "@/types/babylon";

afterEach(() => {
  cleanup();
});

const AGED_EVIDENCE =
  "Earlier institution balance where an eligible reading exists. Declared balances otherwise.";
const RESTRICTION_CONFLICT =
  "The declared unavailable amount is greater than the current account position. Unavailable money is still owned; available from this account is zero until the amounts agree.";
const UNKNOWN_BALANCE = "Observed balance is unknown.";
const NEGATIVE_READING =
  "This stored reading is negative, so the declared balance is used.";

function planned(): AvailableAfterPlannedNeeds {
  return {
    availableAfterPlannedNeeds: 40,
    plannedNeedsShortfall: 0,
    rawDifference: 40,
    freeBeforeNeeds: 40,
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

function renderPosition(
  partial: Partial<ComponentProps<typeof FinancialPosition>> = {}
) {
  return render(
    createElement(FinancialPosition, {
      accounts: [checking()],
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

function accountsToggle() {
  return screen.getByRole("button", { name: /1 account|2 accounts/ });
}

function purposeControl(name: string) {
  return document.querySelector(
    `[aria-label="Purpose for ${name}"]`
  ) as HTMLElement | null;
}

describe("desktop Overview account disclosure", () => {
  it("starts healthy account machinery closed and keeps the position summary", () => {
    renderPosition({
      accounts: [checking(), checking({ id: "acct-savings", name: "Reserve", kind: "savings" })],
    });
    const control = screen.getByRole("button", { name: /2 accounts/ });
    expect(control.getAttribute("aria-expanded")).toBe("false");
    expect(control.getAttribute("aria-controls")).toBe("financial-position-accounts");
    expect(control.tagName).toBe("BUTTON");
    expect(shows("Liquid Position")).toBe(true);
    expect(shows("$100.00")).toBe(true);
    expect(shows("Declared balance, while evidence resolves.")).toBe(true);
    expect(screen.getByRole("button", { name: "Add Account" })).toBeTruthy();
    expect(purposeControl("Everyday")?.closest("[hidden]")).not.toBeNull();
    expect(document.getElementById("financial-position-accounts")?.hidden).toBe(
      true
    );

    control.focus();
    fireEvent.click(control);
    expect(control.getAttribute("aria-expanded")).toBe("true");
    expect(document.activeElement).toBe(control);
    expect(purposeControl("Everyday")?.closest("[hidden]")).toBeNull();
    expect(screen.getByRole("button", { name: "Edit Account Everyday" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Remove Account Everyday" })).toBeTruthy();
    expect(shows("Checking")).toBe(true);

    fireEvent.click(control);
    expect(control.getAttribute("aria-expanded")).toBe("false");
    expect(document.activeElement).toBe(control);
    expect(purposeControl("Everyday")?.closest("[hidden]")).not.toBeNull();
    expect(shows("$100.00")).toBe(true);
  });

  it("leaves an empty account list visible without a disclosure", () => {
    renderPosition({ accounts: [] });
    expect(shows("No accounts yet.")).toBe(true);
    expect(document.getElementById("financial-position-accounts")).toBeNull();
    expect(screen.getByRole("button", { name: "Add Account" })).toBeTruthy();
  });

  it("keeps a restriction conflict visible while the rows stay closed", () => {
    renderPosition({
      accounts: [
        checking({
          id: "restricted",
          name: "Hold",
          balance: 10,
          restrictedAmount: 40,
        }),
      ],
    });
    expect(accountsToggle().getAttribute("aria-expanded")).toBe("false");
    expect(shows("Hold")).toBe(true);
    expect(shows(RESTRICTION_CONFLICT)).toBe(true);
    expect(purposeControl("Hold")?.closest("[hidden]")).not.toBeNull();
    expect(shows("Already Set Aside")).toBe(true);
    expect(shows("Available After Planned Needs")).toBe(true);
  });

  it("keeps a set-aside conflict visible while account rows stay closed", () => {
    renderPosition({ protectedOverAvailable: true });
    expect(accountsToggle().getAttribute("aria-expanded")).toBe("false");
    expect(
      shows("Already-set-aside amounts exceed your current Liquid Position.")
    ).toBe(true);
    expect(purposeControl("Everyday")?.closest("[hidden]")).not.toBeNull();
  });

  it("keeps an unknown observed balance visible while closed", () => {
    renderPosition({
      balanceObservation: linkedObservation({ currentCents: null }),
    });
    expect(shows("Everyday")).toBe(true);
    expect(shows(UNKNOWN_BALANCE)).toBe(true);
    expect(purposeControl("Everyday")?.closest("[hidden]")).not.toBeNull();
  });

  it("keeps a negative stored reading visible while closed", () => {
    renderPosition({
      balanceObservation: linkedObservation({ currentCents: -50 }),
    });
    expect(shows("Everyday")).toBe(true);
    expect(shows(NEGATIVE_READING)).toBe(true);
    expect(shows(AGED_EVIDENCE)).toBe(false);
  });

  it("keeps unavailable and aged headline evidence visible while accounts are closed", () => {
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
    expect(accountsToggle().getAttribute("aria-expanded")).toBe("false");
    unmount();

    renderPosition({
      balanceObservation: linkedObservation({
        currentCents: 8_000,
        source: "balance_get",
        observedAt: new Date(Date.now() - 6 * 60 * 1000).toISOString(),
      }),
    });
    expect(shows(AGED_EVIDENCE)).toBe(true);
    expect(accountsToggle().getAttribute("aria-expanded")).toBe("false");
  });

  it("keeps loading and signed-out evidence visible while account controls stay closed", () => {
    const { unmount } = renderPosition({
      balanceObservation: {
        load: { status: "loading" },
        institutions: [],
        onAssociate: async () => true,
        onRemoveAssociation: async () => true,
      },
    });
    expect(shows("Declared balance, while evidence resolves.")).toBe(true);
    expect(purposeControl("Everyday")?.closest("[hidden]")).not.toBeNull();
    unmount();

    renderPosition({
      balanceObservation: {
        load: { status: "disabled" },
        institutions: [],
        onAssociate: async () => true,
        onRemoveAssociation: async () => true,
      },
    });
    expect(shows("Declared balances.")).toBe(true);
    expect(purposeControl("Everyday")?.closest("[hidden]")).not.toBeNull();
  });

  it("preserves the account editor across the disclosure and does not store it", () => {
    const setItem = vi.spyOn(Storage.prototype, "setItem");
    renderPosition();
    fireEvent.click(accountsToggle());
    fireEvent.click(screen.getByRole("button", { name: "Edit Account Everyday" }));
    const name = screen.getByLabelText("Name") as HTMLInputElement;
    fireEvent.change(name, { target: { value: "Everyday renamed" } });
    const control = screen.getByRole("button", {
      name: /1 account/,
      hidden: true,
    });
    control.focus();
    fireEvent.click(control);
    expect(control.getAttribute("aria-expanded")).toBe("false");
    expect(name.isConnected).toBe(true);
    expect(name.value).toBe("Everyday renamed");
    expect(screen.getByRole("dialog")).toBeTruthy();
    expect(
      screen.getByRole("region", { name: "Financial Position", hidden: true })
        .isConnected
    ).toBe(true);
    expect(setItem).not.toHaveBeenCalled();
    setItem.mockRestore();
  });

  it("masks the account summary in discreet mode", () => {
    renderPosition({ discreet: true });
    expect(shows(DISCREET_MASK)).toBe(true);
    expect(shows("$100.00")).toBe(false);
    expect(shows("$80.00")).toBe(false);
  });

  it("leaves phone account management open", () => {
    renderPosition({ presentation: "manage" });
    expect(document.getElementById("financial-position-accounts")).toBeNull();
    expect(screen.queryByRole("button", { name: /1 account/ })).toBeNull();
    expect(purposeControl("Everyday")?.closest("[hidden]")).toBeNull();
    expect(screen.getByRole("button", { name: "Edit Account Everyday" })).toBeTruthy();
    expect(shows("No special purpose")).toBe(true);
  });
});

function linkedObservation(input: {
  currentCents: number | null;
  source?: "accounts_get" | "balance_get";
  observedAt?: string;
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
            currentCents: input.currentCents,
            availableCents: 7_500,
            isoCurrencyCode: "USD",
            unofficialCurrencyCode: null,
            observedAt: input.observedAt ?? new Date().toISOString(),
            source: input.source ?? "accounts_get",
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
