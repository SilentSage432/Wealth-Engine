import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { MOBILE_DESTINATIONS, MOBILE_NAV_ITEMS } from "@/lib/babylon/constants";
import {
  PHONE_MORE_GROUPS,
  phoneCloudSessionStartsClosed,
} from "@/lib/babylon/mobile-more";
import type { VaultSyncView } from "@/lib/babylon/vault-sync";

describe("phone More composition", () => {
  it("orders More as setup, connections, guidance, data, then danger", () => {
    expect(PHONE_MORE_GROUPS).toEqual([
      "financial-setup",
      "connections",
      "guidance",
      "data-cloud",
      "danger-zone",
    ]);
  });

  it("keeps phone navigation on Home, Budget, Ledger, and More", () => {
    expect(MOBILE_DESTINATIONS).toEqual(["home", "budget", "ledger", "more"]);
    expect(MOBILE_NAV_ITEMS.map((item) => item.label)).toEqual([
      "Home",
      "Budget",
      "Ledger",
      "More",
    ]);
  });
});

describe("phone More source boundaries", () => {
  const moreSource = readFileSync(
    "components/babylon/mobile-more.tsx",
    "utf8"
  );
  const profileNameSource = readFileSync(
    "components/babylon/profile-name-field.tsx",
    "utf8"
  );
  const panelSource = readFileSync(
    "components/babylon/vault-maintenance-panel.tsx",
    "utf8"
  );
  const sidebarSource = readFileSync(
    "components/babylon/app-sidebar.tsx",
    "utf8"
  );
  const commandBarSource = readFileSync(
    "components/babylon/command-bar.tsx",
    "utf8"
  );
  const mobileHeaderSource = readFileSync(
    "components/babylon/mobile-header.tsx",
    "utf8"
  );
  const positionSource = readFileSync(
    "components/babylon/financial-position.tsx",
    "utf8"
  );
  const banksSource = readFileSync(
    "components/babylon/connected-banks-card.tsx",
    "utf8"
  );
  const homeSource = readFileSync(
    "components/babylon/mobile-home.tsx",
    "utf8"
  );
  const budgetSource = readFileSync(
    "components/babylon/mobile-budget.tsx",
    "utf8"
  );
  const ledgerSource = readFileSync(
    "components/babylon/mobile-ledger.tsx",
    "utf8"
  );
  const dashboard = readFileSync(
    "components/babylon/wealth-engine-dashboard.tsx",
    "utf8"
  );
  const desktopBlock = dashboard.split("{desktopLayout && (")[2];

  it("groups existing capabilities and shares maintenance with the sidebar", () => {
    expect(moreSource.indexOf('aria-label="Financial setup"')).toBeLessThan(
      moreSource.indexOf('aria-label="Connections"')
    );
    expect(moreSource.indexOf('aria-label="Connections"')).toBeLessThan(
      moreSource.indexOf('aria-label="Guidance"')
    );
    expect(moreSource.indexOf('aria-label="Guidance"')).toBeLessThan(
      moreSource.indexOf('aria-label="Data and cloud"')
    );
    expect(moreSource.indexOf('aria-label="Data and cloud"')).toBeLessThan(
      moreSource.indexOf('aria-label="Danger zone"')
    );
    expect(moreSource).toContain('presentation="manage"');
    expect(moreSource).toContain("VaultCloudSession");
    expect(moreSource).toContain("VaultDataBackups");
    expect(moreSource).toContain("VaultResetLedger");
    expect(moreSource).toContain("aria-expanded");
    expect(moreSource).not.toContain("Close Month");
    expect(moreSource).toContain("ProfileNameField");
    expect(profileNameSource).toContain("Profile name");
    expect(sidebarSource).toContain("ProfileNameField");
    expect(commandBarSource).not.toContain("onUsernameChange");
    expect(commandBarSource).not.toContain("Profile name");
    expect(commandBarSource).not.toContain("<Input");
    expect(mobileHeaderSource).not.toContain("onUsernameChange");
    expect(mobileHeaderSource).not.toContain("ProfileNameField");
    expect(mobileHeaderSource).not.toContain("<Input");
    expect(moreSource).not.toContain("BOOTSTRAP_CONFIRM");
    expect(moreSource).not.toContain("Clear this ledger?");
    expect(moreSource).not.toContain("serviceWorker");
    expect(moreSource).not.toContain("PushManager");
    expect(moreSource.indexOf('aria-label="Data and cloud"')).toBeLessThan(
      moreSource.indexOf("<DeviceNotifications")
    );
    expect(moreSource.indexOf("<DeviceNotifications")).toBeLessThan(
      moreSource.indexOf('aria-label="Danger zone"')
    );
    expect(homeSource).not.toContain("DeviceNotifications");
    expect(budgetSource).not.toContain("DeviceNotifications");
    expect(ledgerSource).not.toContain("DeviceNotifications");
    expect(sidebarSource).not.toContain("DeviceNotifications");
    expect(panelSource).toContain("function VaultMaintenancePanel");
    expect(panelSource).toContain("<VaultCloudSession");
    expect(panelSource).toContain("<VaultDataBackups");
    expect(panelSource).toContain("<VaultResetLedger");
    expect(panelSource).toContain("<AllocationReference");
    expect(panelSource).toContain("Clear this ledger?");
    expect(panelSource).toContain("Delete ledger data");
    expect(sidebarSource).toContain("<VaultMaintenancePanel");
    expect(positionSource).toContain('presentation = "full"');
    expect(banksSource).toContain('density = "full"');
    expect(desktopBlock).toContain("{financialPosition}");
    expect(desktopBlock).toContain("WisdomBox");
    expect(homeSource).not.toContain("MobileMore");
    expect(budgetSource).not.toContain("MobileMore");
    expect(ledgerSource).not.toContain("MobileMore");
  });
});

describe("phone cloud session disclosure policy", () => {
  const kinds: VaultSyncView["kind"][] = [
    "signed_out",
    "checking",
    "syncing",
    "cloud_unavailable",
    "account_only",
    "offer_bootstrap",
    "offer_hydrate",
    "clean",
    "local_dirty",
    "offline_pending",
    "pending_verification",
    "conflict",
    "unsupported_schema",
    "invalid_vault",
    "owner_mismatch",
    "unexpected_revision",
  ];

  it("closes only a signed-in clean session", () => {
    for (const syncKind of kinds) {
      expect(
        phoneCloudSessionStartsClosed({
          isCloudSynced: true,
          syncKind,
          cloudBusy: false,
          reconciliationActive: false,
          conflictRefreshNote: null,
        })
      ).toBe(syncKind === "clean");
    }
  });

  it("stays open when signed out, busy, reconciling, or refreshing a conflict", () => {
    const clean = {
      isCloudSynced: true,
      syncKind: "clean" as const,
      cloudBusy: false,
      reconciliationActive: false,
      conflictRefreshNote: null,
    };
    expect(phoneCloudSessionStartsClosed({ ...clean, isCloudSynced: false })).toBe(
      false
    );
    expect(phoneCloudSessionStartsClosed({ ...clean, cloudBusy: true })).toBe(
      false
    );
    expect(
      phoneCloudSessionStartsClosed({ ...clean, reconciliationActive: true })
    ).toBe(false);
    expect(
      phoneCloudSessionStartsClosed({
        ...clean,
        conflictRefreshNote: "Still current",
      })
    ).toBe(false);
  });
});

describe("phone More maintenance boundaries", () => {
  const moreSource = readFileSync(
    "components/babylon/mobile-more.tsx",
    "utf8"
  );
  const panelSource = readFileSync(
    "components/babylon/vault-maintenance-panel.tsx",
    "utf8"
  );
  const sidebarSource = readFileSync(
    "components/babylon/app-sidebar.tsx",
    "utf8"
  );
  const homeSource = readFileSync(
    "components/babylon/mobile-home.tsx",
    "utf8"
  );
  const budgetSource = readFileSync(
    "components/babylon/mobile-budget.tsx",
    "utf8"
  );
  const ledgerSource = readFileSync(
    "components/babylon/mobile-ledger.tsx",
    "utf8"
  );
  const dashboard = readFileSync(
    "components/babylon/wealth-engine-dashboard.tsx",
    "utf8"
  );
  const panelFn = panelSource
    .split("export function VaultMaintenancePanel")[1]
    .split("export function VaultCloudSession")[0];

  it("compresses phone maintenance without changing the desktop panel", () => {
    expect(moreSource.indexOf('regionId="more-profile-name"')).toBeLessThan(
      moreSource.indexOf('aria-label="Connections"')
    );
    expect(moreSource.indexOf('regionId="more-cloud-session"')).toBeLessThan(
      moreSource.indexOf("<DeviceNotifications")
    );
    expect(moreSource.indexOf("<DeviceNotifications")).toBeLessThan(
      moreSource.indexOf("startClosedWhenQuiet")
    );
    expect(moreSource.indexOf("startClosedWhenQuiet")).toBeLessThan(
      moreSource.indexOf('regionId="more-danger-zone"')
    );
    expect(moreSource).toContain("phoneCloudSessionStartsClosed");
    expect(moreSource).not.toContain("disclosureWhenHealthy");
    expect(panelFn).not.toContain("startClosedWhenQuiet");
    expect(panelFn).not.toContain("PhoneMaintenanceDisclosure");
    expect(sidebarSource).not.toContain("PhoneMaintenanceDisclosure");
    expect(sidebarSource).not.toContain("startClosedWhenQuiet");
    expect(homeSource).not.toContain("PhoneMaintenanceDisclosure");
    expect(budgetSource).not.toContain("PhoneMaintenanceDisclosure");
    expect(ledgerSource).not.toContain("PhoneMaintenanceDisclosure");
    expect(dashboard).not.toContain("PhoneMaintenanceDisclosure");
    expect(dashboard).not.toContain("startClosedWhenQuiet");
  });
});
