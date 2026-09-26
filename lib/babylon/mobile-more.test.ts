import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { MOBILE_DESTINATIONS, MOBILE_NAV_ITEMS } from "@/lib/babylon/constants";
import { PHONE_MORE_GROUPS } from "@/lib/babylon/mobile-more";

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
  const panelSource = readFileSync(
    "components/babylon/vault-maintenance-panel.tsx",
    "utf8"
  );
  const sidebarSource = readFileSync(
    "components/babylon/app-sidebar.tsx",
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
    expect(moreSource).toContain("Close Month");
    expect(moreSource).toContain("Profile name");
    expect(moreSource).not.toContain("BOOTSTRAP_CONFIRM");
    expect(moreSource).not.toContain("Clear this ledger?");
    expect(moreSource).not.toContain("serviceWorker");
    expect(moreSource).not.toContain("Notification");
    expect(moreSource).not.toContain("PushManager");
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
