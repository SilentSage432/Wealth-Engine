// @vitest-environment jsdom

import { createElement, type ComponentProps } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { FinancialPosition } from "@/components/babylon/financial-position";
import { MobileHome } from "@/components/babylon/mobile-home";
import type { DestinationRelationship } from "@/lib/babylon/financial-destination";
import { formatCurrency } from "@/lib/utils";
import type { FinancialDestinationDeclaration } from "@/types/babylon";

afterEach(() => {
  cleanup();
});

function declaration(): FinancialDestinationDeclaration {
  return {
    id: "d1",
    dimension: "owned_emergency_fund",
    relation: "at_least",
    amount: 8500,
    declaredAt: "2026-10-01T18:00:00.000Z",
    supersedesId: null,
    label: "Foundation",
  };
}

function known(position: number): DestinationRelationship {
  const targetAmount = 8500;
  const below = position < targetAmount;
  return {
    status: "known",
    relationship: below ? "below" : "at_or_above",
    position,
    targetAmount,
    remaining: below ? targetAmount - position : 0,
    amountAbove: below ? 0 : position - targetAmount,
    declaredAt: declaration().declaredAt,
    declaration: declaration(),
  };
}

function positionProps(
  partial: Partial<ComponentProps<typeof FinancialPosition>> = {}
): ComponentProps<typeof FinancialPosition> {
  return {
    accounts: [],
    moneyAvailable: 10000,
    openingWealthBuilding: 0,
    openingEmergencyFund: 500,
    protectedMoney: 500,
    wealthBuildingPosition: 0,
    emergencyFundPosition: 0,
    protectedOverAvailable: false,
    upcomingNeeds: 0,
    availableAfterPlannedNeeds: {
      availableAfterPlannedNeeds: 10000,
      plannedNeedsShortfall: 0,
      rawDifference: 10000,
      freeBeforeNeeds: 10000,
    },
    remainingDebt: 0,
    onAddAccount: () => true,
    onUpdateAccount: () => true,
    onRemoveAccount: () => ({ status: "applied" }),
    onSetAccountPurpose: () => ({ status: "applied" }),
    onClearAccountPurpose: () => ({ status: "applied" }),
    onUpdateProtected: () => null,
    ...partial,
  };
}

describe("desktop Emergency Fund destination authorship", () => {
  it("establishes a destination from the amount the steward types", () => {
    const onDeclare = vi.fn(() => null);
    render(
      createElement(FinancialPosition, {
        ...positionProps({ onDeclareEmergencyFundDestination: onDeclare }),
      })
    );
    expect(screen.getByRole("button", { name: "Edit" })).toBeTruthy();
    const amount = screen.queryByLabelText("Minimum amount");
    expect(amount).toBeNull();
    fireEvent.click(
      screen.getByRole("button", { name: "Declare Emergency Fund minimum" })
    );
    const field = screen.getByLabelText("Minimum amount") as HTMLInputElement;
    expect(field.value).toBe("");
    fireEvent.change(field, { target: { value: "8500" } });
    fireEvent.change(screen.getByLabelText("Label"), {
      target: { value: "Foundation" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save declaration" }));
    expect(onDeclare).toHaveBeenCalledWith({
      amount: 8500,
      label: "Foundation",
    });
  });

  it("asks for a replacement without mutating the shown declaration", () => {
    const onDeclare = vi.fn(() => null);
    render(
      createElement(FinancialPosition, {
        ...positionProps({
          emergencyFundDestination: known(2000),
          onDeclareEmergencyFundDestination: onDeclare,
        }),
      })
    );
    expect(screen.getByText(formatCurrency(8500))).toBeTruthy();
    expect(screen.getByText(/remaining to the declared minimum/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Declare a new minimum" }));
    const field = screen.getByLabelText("Minimum amount") as HTMLInputElement;
    expect(field.value).toBe("");
    fireEvent.change(field, { target: { value: "10000" } });
    fireEvent.click(screen.getByRole("button", { name: "Save declaration" }));
    expect(onDeclare).toHaveBeenCalledWith({ amount: 10000 });
    expect(screen.getByText(formatCurrency(8500))).toBeTruthy();
  });

  it("does not state a distance while the comparison is unknown", () => {
    render(
      createElement(FinancialPosition, {
        ...positionProps({
          emergencyFundDestination: {
            status: "unknown",
            reasons: ["protected_overflow"],
            declaration: declaration(),
          },
          onDeclareEmergencyFundDestination: () => null,
        }),
      })
    );
    expect(
      screen.getByText(/not stated while Already Set Aside exceeds Liquid Position/)
    ).toBeTruthy();
    expect(screen.queryByText(/remaining to the declared minimum/)).toBeNull();
    expect(screen.queryByText(/above the declared minimum/)).toBeNull();
  });
});

describe("mobile Emergency Fund destination projection", () => {
  it("shows the relationship and offers no declaration control", () => {
    render(
      createElement(MobileHome, {
        moneyAvailable: 10000,
        protectedMoney: 500,
        protectedOverAvailable: false,
        availableAfterPlannedNeeds: {
          availableAfterPlannedNeeds: 10000,
          plannedNeedsShortfall: 0,
          rawDifference: 10000,
          freeBeforeNeeds: 10000,
        },
        upcomingNeeds: 0,
        remainingDebt: 0,
        expenses: [],
        dueAttention: [],
        onMarkPaid: () => undefined,
        recentActivity: [],
        discreet: false,
        onNavigate: () => undefined,
        emergencyFundDestination: known(9000),
      })
    );
    expect(screen.getByText(/above the declared minimum/)).toBeTruthy();
    expect(
      screen.queryByRole("button", { name: "Declare Emergency Fund minimum" })
    ).toBeNull();
    expect(
      screen.queryByRole("button", { name: "Declare a new minimum" })
    ).toBeNull();
    expect(screen.queryByRole("button", { name: "Save declaration" })).toBeNull();
  });

  it("keeps phone Financial Position read-only when a callback is supplied", () => {
    const onDeclare = vi.fn(() => null);
    render(
      createElement(FinancialPosition, {
        ...positionProps({
          readOnly: true,
          emergencyFundDestination: known(2000),
          onDeclareEmergencyFundDestination: onDeclare,
        }),
      })
    );
    expect(screen.getByText(/remaining to the declared minimum/)).toBeTruthy();
    expect(
      screen.queryByRole("button", { name: "Declare a new minimum" })
    ).toBeNull();
    expect(screen.queryByRole("button", { name: "Edit" })).toBeNull();
    expect(onDeclare).not.toHaveBeenCalled();
  });
});
