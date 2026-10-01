// @vitest-environment jsdom

import { createElement, useState, type ComponentProps } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DeviceNotifications } from "@/components/babylon/device-notifications";
import { MobileMore } from "@/components/babylon/mobile-more";
import { VaultDataBackups } from "@/components/babylon/vault-maintenance-panel";
import type { VaultSyncView } from "@/lib/babylon/vault-sync";

vi.mock("@/lib/supabase/client", () => ({
  getSupabaseBrowserClient: () => null,
}));

afterEach(() => {
  cleanup();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

function planned() {
  return {
    availableAfterPlannedNeeds: 0,
    plannedNeedsShortfall: 0,
    rawDifference: 0,
    freeBeforeNeeds: 0,
  };
}

function moreProps(
  partial: Partial<ComponentProps<typeof MobileMore>> = {}
) {
  const spies = {
    onExportBackup: vi.fn(),
    onImportBackup: vi.fn(() => null as string | null),
    onClearAllData: vi.fn(),
    onOpenMonthlyClose: vi.fn(),
    onSignOutCloud: vi.fn(async () => true),
    onCheckCloud: vi.fn(async () => undefined),
    onConnectCloud: vi.fn(),
    onBootstrapCloud: vi.fn(async () => undefined),
    onUsernameChange: vi.fn(),
  };
  const props: ComponentProps<typeof MobileMore> = {
    username: "Ada",
    onUsernameChange: spies.onUsernameChange,
    monthAlreadyClosed: false,
    onOpenMonthlyClose: spies.onOpenMonthlyClose,
    wisdomIndex: 0,
    onSelectWisdomIndex: vi.fn(),
    connectedCount: 1,
    banksLoading: false,
    plaidLaunching: false,
    plaidInitializing: false,
    isCloudSynced: true,
    onConnectBank: vi.fn(),
    onRequireAuth: vi.fn(),
    budgetTargets: [],
    onExportBackup: spies.onExportBackup,
    onImportBackup: spies.onImportBackup,
    onClearAllData: spies.onClearAllData,
    vaultSync: { kind: "clean", revision: 4 },
    cloudUsername: "Ada",
    onConnectCloud: spies.onConnectCloud,
    onSignOutCloud: spies.onSignOutCloud,
    onBootstrapCloud: spies.onBootstrapCloud,
    onHydrateCloud: vi.fn(async () => undefined),
    onCheckCloud: spies.onCheckCloud,
    accounts: [],
    moneyAvailable: 10,
    openingWealthBuilding: 1,
    openingEmergencyFund: 2,
    protectedMoney: 3,
    wealthBuildingPosition: 0,
    emergencyFundPosition: 0,
    protectedOverAvailable: false,
    upcomingNeeds: 0,
    availableAfterPlannedNeeds: planned(),
    remainingDebt: 0,
    discreet: false,
    onAddAccount: () => true,
    onUpdateAccount: () => true,
    onRemoveAccount: () => ({ status: "applied" as const }),
    onSetAccountPurpose: () => ({ status: "applied" as const }),
    onClearAccountPurpose: () => ({ status: "applied" as const }),
    onUpdateProtected: () => null,
    ...partial,
  };
  return { props, spies };
}

function control(id: string): HTMLButtonElement | null {
  return document.querySelector(`[aria-controls="${id}"]`);
}

function renderMore(
  partial: Partial<ComponentProps<typeof MobileMore>> = {}
) {
  const built = moreProps(partial);
  return { ...built, ...render(createElement(MobileMore, built.props)) };
}

describe("phone More maintenance compression", () => {
  it("keeps the More group order and leaves close-month and connections visible", () => {
    renderMore();
    const labels = ["Financial setup", "Connections", "Guidance", "Data and cloud", "Danger zone"];
    const headings = labels.map((label) => screen.getByRole("heading", { name: label }));
    for (let index = 1; index < headings.length; index += 1) {
      expect(
        headings[index - 1].compareDocumentPosition(headings[index]) &
          Node.DOCUMENT_POSITION_FOLLOWING
      ).toBeTruthy();
    }
    expect(screen.getByRole("button", { name: "Close this month" })).toBeTruthy();
    expect(screen.getByText("1 bank connected")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Connect Bank" })).toBeTruthy();
    expect(screen.getByRole("button", { name: /Financial Guidance/ })).toBeTruthy();
    expect(screen.getByText("No accounts yet.")).toBeTruthy();
    expect(document.getElementById("more-account-machinery")).toBeNull();
    expect(
      screen.getByText("This browser cannot receive notifications.")
    ).toBeTruthy();
    expect(control("more-device-notifications")).toBeNull();
  });

  it("starts quiet profile, cloud, backup, and reset controls closed", () => {
    const setItem = vi.spyOn(Storage.prototype, "setItem");
    const { spies } = renderMore();
    expect(screen.getByText("Profile name · Ada")).toBeTruthy();
    expect(screen.queryByRole("textbox", { name: "Profile name" })).toBeNull();
    expect(
      screen.getByRole("textbox", { name: "Profile name", hidden: true })
    ).toBeTruthy();
    expect(control("more-cloud-session")?.textContent).toContain("Ada");
    expect(control("more-cloud-session")?.textContent).toContain(
      "Up to date · revision 4"
    );
    expect(screen.getByText("No import result on this device.")).toBeTruthy();
    expect(
      screen.getByText(/Reset ledger deletes the income, categories, expenses, and debts/)
    ).toBeTruthy();
    expect(control("more-profile-name")?.getAttribute("aria-expanded")).toBe("false");
    expect(control("more-cloud-session")?.getAttribute("aria-expanded")).toBe("false");
    expect(control("more-data-backups")?.getAttribute("aria-expanded")).toBe("false");
    expect(control("more-danger-zone")?.getAttribute("aria-expanded")).toBe("false");
    expect(screen.queryByRole("button", { name: "Sign out" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Export" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Reset ledger" })).toBeNull();
    expect(screen.getByRole("button", { name: "Sign out", hidden: true })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Export", hidden: true })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Reset ledger", hidden: true })).toBeTruthy();

    for (const id of [
      "more-profile-name",
      "more-cloud-session",
      "more-data-backups",
      "more-danger-zone",
    ]) {
      const button = control(id);
      expect(button).toBeTruthy();
      button?.focus();
      fireEvent.click(button as HTMLButtonElement);
      expect(document.activeElement).toBe(button);
      expect(button?.getAttribute("aria-expanded")).toBe("true");
    }

    expect(spies.onUsernameChange).not.toHaveBeenCalled();
    expect(spies.onSignOutCloud).not.toHaveBeenCalled();
    expect(spies.onCheckCloud).not.toHaveBeenCalled();
    expect(spies.onConnectCloud).not.toHaveBeenCalled();
    expect(spies.onBootstrapCloud).not.toHaveBeenCalled();
    expect(spies.onExportBackup).not.toHaveBeenCalled();
    expect(spies.onClearAllData).not.toHaveBeenCalled();
    expect(spies.onOpenMonthlyClose).not.toHaveBeenCalled();
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(setItem).not.toHaveBeenCalled();
    setItem.mockRestore();

    fireEvent.click(screen.getByRole("button", { name: "Export" }));
    expect(spies.onExportBackup).toHaveBeenCalledOnce();
    expect(screen.getByLabelText("Profile name")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Sign out" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Reset ledger" })).toBeTruthy();
  });

  it("keeps a profile name being edited when the disclosure closes", () => {
    function Harness() {
      const [username, setUsername] = useState("Ada");
      return createElement(MobileMore, {
        ...moreProps().props,
        username,
        onUsernameChange: setUsername,
      });
    }
    render(createElement(Harness));
    fireEvent.click(control("more-profile-name") as HTMLButtonElement);
    const input = screen.getByLabelText("Profile name") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "Ada Lane" } });
    fireEvent.click(control("more-profile-name") as HTMLButtonElement);
    expect(control("more-profile-name")?.getAttribute("aria-expanded")).toBe(
      "false"
    );
    expect(screen.getByText("Profile name · Ada Lane")).toBeTruthy();
    expect(
      (
        screen.getByRole("textbox", {
          name: "Profile name",
          hidden: true,
        }) as HTMLInputElement
      ).value
    ).toBe("Ada Lane");
    fireEvent.click(control("more-profile-name") as HTMLButtonElement);
    expect((screen.getByLabelText("Profile name") as HTMLInputElement).value).toBe(
      "Ada Lane"
    );
  });

  it("says when the profile name is blank", () => {
    renderMore({ username: "   " });
    expect(screen.getByText("Profile name is blank.")).toBeTruthy();
  });

  it.each([
    [{ kind: "conflict", baselineRevision: 2, cloudRevision: 5 }, "Sync conflict — both copies preserved"],
    [{ kind: "local_dirty", revision: 3 }, "Changes waiting to sync"],
    [{ kind: "offer_bootstrap" }, "The cloud vault has not been initialized."],
    [{ kind: "cloud_unavailable" }, "Cloud sync couldn't complete"],
    [{ kind: "checking" }, "Checking cloud state…"],
  ] as const)("keeps %j cloud state visible", (vaultSync, text) => {
    renderMore({ vaultSync: vaultSync as VaultSyncView });
    expect(control("more-cloud-session")).toBeNull();
    expect(screen.getByText(text)).toBeTruthy();
  });

  it("keeps sign-in, a busy clean session, and reconciliation visible", () => {
    const { unmount } = renderMore({
      isCloudSynced: false,
      vaultSync: { kind: "signed_out" },
    });
    expect(control("more-cloud-session")).toBeNull();
    expect(screen.getByRole("button", { name: "Sign in" })).toBeTruthy();
    unmount();

    const { unmount: unmountBusy } = renderMore({ cloudBusy: true });
    expect(control("more-cloud-session")).toBeNull();
    expect(screen.getByText("Up to date · revision 4")).toBeTruthy();
    unmountBusy();

    renderMore({ reconciliationActive: true });
    expect(control("more-cloud-session")).toBeNull();
    expect(screen.getByText("Up to date · revision 4")).toBeTruthy();
  });

  it("shows an import failure and a restored backup instead of the quiet summary", async () => {
    const onImportBackup = vi.fn((raw: unknown) =>
      raw && typeof raw === "object" && "ok" in raw ? null : "Backup could not be restored."
    );
    const { unmount } = renderMore({ onImportBackup });
    fireEvent.click(control("more-data-backups") as HTMLButtonElement);
    const input = screen.getByLabelText("Import backup JSON") as HTMLInputElement;
    fireEvent.change(input, {
      target: { files: [new File(["{"], "bad.json", { type: "application/json" })] },
    });
    expect(await screen.findByText("Could not read that file as JSON.")).toBeTruthy();
    expect(control("more-data-backups")).toBeNull();
    expect(onImportBackup).not.toHaveBeenCalled();
    unmount();

    renderMore({ onImportBackup });
    fireEvent.click(control("more-data-backups") as HTMLButtonElement);
    fireEvent.change(screen.getByLabelText("Import backup JSON"), {
      target: {
        files: [new File(['{"ok":true}'], "backup.json", { type: "application/json" })],
      },
    });
    expect(await screen.findByText("Backup restored.")).toBeTruthy();
    expect(control("more-data-backups")).toBeNull();
    expect(onImportBackup).toHaveBeenCalledOnce();
  });
});

describe("desktop backup controls", () => {
  it("stay open unless phone More asks for the quiet summary", () => {
    const { unmount } = render(
      createElement(
        VaultDataBackups,
        {
          onExportBackup: vi.fn(),
          onImportBackup: () => null,
        },
        "Reset stays here"
      )
    );
    expect(screen.getByRole("button", { name: "Export" })).toBeTruthy();
    expect(screen.getByText("Reset stays here")).toBeTruthy();
    expect(document.getElementById("more-data-backups")).toBeNull();
    unmount();
  });
});

function vapidKey(): string {
  const bytes = new Uint8Array(65);
  bytes[0] = 0x04;
  for (let index = 1; index < bytes.length; index += 1) bytes[index] = index;
  return Buffer.from(bytes).toString("base64url");
}

function stubNotification(permission: NotificationPermission | "denied") {
  const requestPermission = vi.fn(async () => "denied" as NotificationPermission);
  vi.stubGlobal("Notification", { permission, requestPermission });
  vi.stubGlobal("PushManager", class PushManager {});
  Object.defineProperty(navigator, "serviceWorker", {
    configurable: true,
    value: { getRegistration: vi.fn(async () => null) },
  });
  return requestPermission;
}

describe("phone notification controls", () => {
  it("starts a not-enabled device closed and keeps a failure visible", async () => {
    vi.stubEnv("NEXT_PUBLIC_VAPID_PUBLIC_KEY", vapidKey());
    const requestPermission = stubNotification("default");
    render(createElement(DeviceNotifications));
    const toggle = control("more-device-notifications");
    expect(toggle?.getAttribute("aria-expanded")).toBe("false");
    expect(toggle?.textContent).toContain("Not enabled on this device.");
    expect(screen.queryByRole("button", { name: "Enable on this device" })).toBeNull();
    fireEvent.click(toggle as HTMLButtonElement);
    expect(requestPermission).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Enable on this device" }));
    expect(await screen.findByText("Permission was not granted.")).toBeTruthy();
    expect(control("more-device-notifications")).toBeNull();
  });

  it("keeps blocked and unconfigured notification states visible", () => {
    vi.stubEnv("NEXT_PUBLIC_VAPID_PUBLIC_KEY", vapidKey());
    stubNotification("denied");
    const { unmount } = render(createElement(DeviceNotifications));
    expect(
      screen.getByText("Notifications are blocked in this browser.")
    ).toBeTruthy();
    expect(control("more-device-notifications")).toBeNull();
    unmount();

    vi.stubEnv("NEXT_PUBLIC_VAPID_PUBLIC_KEY", "");
    stubNotification("default");
    render(createElement(DeviceNotifications));
    expect(screen.getByText("Notification setup is not available.")).toBeTruthy();
    expect(control("more-device-notifications")).toBeNull();
  });
});
