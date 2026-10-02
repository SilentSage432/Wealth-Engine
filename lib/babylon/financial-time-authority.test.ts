import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { canonicalIanaTimeZone } from "@/lib/babylon/civil-time";
import {
  CLOUD_VAULT_SCHEMA_VERSION,
  financialVaultFingerprint,
  parseCloudVaultData,
  serializeCloudVaultData,
} from "@/lib/babylon/cloud-vault";
import { EMPTY_STATE } from "@/lib/babylon/constants";
import { preferenceTimezoneRefresh } from "@/lib/babylon/notification-device";
import {
  buildLedgerBackup,
  normalizePersistedState,
  validateLedgerBackup,
} from "@/lib/babylon/persistence";
import { compareVaultStructure } from "@/lib/babylon/vault-structural-diff";
import type { PersistedState } from "@/types/babylon";

const root = resolve(__dirname, "../..");

function source(path: string): string {
  return readFileSync(resolve(root, path), "utf8");
}

function historicalVault(): PersistedState {
  return {
    ...EMPTY_STATE,
    displayName: "Ada",
    lastClosedMonthKey: "2026-08",
    accounts: [
      {
        id: "acct-1",
        name: "Checking",
        kind: "checking",
        balance: 500,
        asOf: "2026-09-25",
      },
    ],
    incomes: [
      {
        id: "income-1",
        source: "Payroll",
        amount: 1000,
        date: "2026-09-01",
        interval: "monthly",
        kind: "primary",
        wealthShare: 300,
        debtShare: 0,
        expenditureShare: 700,
        debtRedirected: true,
      },
    ],
    expenses: [
      {
        id: "expense-1",
        name: "Rent",
        category: "need",
        amount: 900,
        date: "2026-09-01",
        dueDate: "2026-09-01",
        isSettled: true,
        recurrenceMonth: "2026-09",
        recurringObligationId: "rule-1",
      },
    ],
    allocations: [
      {
        id: "alloc-1",
        incomeId: "income-1",
        date: "2026-09-01",
        monthKey: "2026-09",
        gross: 1000,
        wealth: 300,
        debt: 0,
        expenditure: 700,
      },
    ],
    activityLog: [
      {
        id: "activity-1",
        kind: "income",
        title: "Payroll",
        createdAt: "2026-09-01T15:00:00.000Z",
      },
    ],
    recurringObligations: [
      {
        id: "rule-1",
        name: "Rent",
        amount: 900,
        category: "need",
        budgetCategoryId: "housing",
        dueDay: 1,
        startMonth: "2026-09",
        isActive: true,
        createdAt: "2026-08-01",
        skippedMonths: ["2026-07"],
      },
    ],
    paySchedules: [
      {
        id: "pay-1",
        label: "Payroll",
        cadence: "biweekly",
        anchorDate: "2026-09-04",
        createdAt: "2026-08-01",
        expectedAmount: 1000,
      },
    ],
  };
}

function withoutZone(state: PersistedState): Omit<PersistedState, "financialTimeZone"> {
  const rest = { ...state };
  delete rest.financialTimeZone;
  return rest;
}

describe("steward financial timezone authority", () => {
  it("keeps an absent zone unknown and does not adopt the device zone", () => {
    const stored = normalizePersistedState(EMPTY_STATE);
    expect(stored.financialTimeZone).toBeUndefined();
    expect(Object.prototype.hasOwnProperty.call(stored, "financialTimeZone")).toBe(
      false
    );
    expect(canonicalIanaTimeZone("America/Denver")).toBe("America/Denver");
  });

  it("round-trips a valid IANA zone and fails closed on invalid text", () => {
    const established = normalizePersistedState({
      ...EMPTY_STATE,
      financialTimeZone: " America/Boise ",
    });
    expect(established.financialTimeZone).toBe("America/Boise");

    for (const invalid of ["", "   ", "UTC-7", "GMT-7", "+07:00", "Not/AZone"]) {
      const stored = normalizePersistedState({
        ...EMPTY_STATE,
        financialTimeZone: invalid,
      });
      expect(stored.financialTimeZone).toBeUndefined();
    }
  });

  it("persists an explicit set and a later explicit change", () => {
    const first = normalizePersistedState({
      ...EMPTY_STATE,
      financialTimeZone: "America/Denver",
    });
    expect(first.financialTimeZone).toBe("America/Denver");
    const changed = normalizePersistedState({
      ...first,
      financialTimeZone: "America/Chicago",
    });
    expect(changed.financialTimeZone).toBe("America/Chicago");
    const untouched = normalizePersistedState(first);
    expect(untouched.financialTimeZone).toBe("America/Denver");
  });

  it("leaves historical evidence and recurrence rows unchanged", () => {
    const before = normalizePersistedState(historicalVault());
    const after = normalizePersistedState({
      ...before,
      financialTimeZone: "Pacific/Auckland",
    });
    expect(after.financialTimeZone).toBe("Pacific/Auckland");
    expect(withoutZone(after)).toEqual(withoutZone(before));
    expect(before.expenses.map((row) => row.id)).toEqual(["expense-1"]);
    expect(before.incomes.map((row) => row.date)).toEqual(["2026-09-01"]);
    expect(before.accounts.map((row) => row.asOf)).toEqual(["2026-09-25"]);
    expect(before.allocations.map((row) => row.monthKey)).toEqual(["2026-09"]);
    expect(before.recurringObligations[0]?.startMonth).toBe("2026-09");
    expect(before.recurringObligations[0]?.skippedMonths).toEqual(["2026-07"]);
    const payday = before.paySchedules[0];
    expect(payday && "anchorDate" in payday ? payday.anchorDate : null).toBe(
      "2026-09-04"
    );
    expect(before.activityLog[0]?.createdAt).toBe("2026-09-01T15:00:00.000Z");
    expect(before.lastClosedMonthKey).toBe("2026-08");
    expect(after.expenses.map((row) => row.id)).toEqual(["expense-1"]);
    expect(after.recurringObligations).toEqual(before.recurringObligations);
  });

  it("omits an unknown zone from the cloud document and fingerprint", () => {
    expect(CLOUD_VAULT_SCHEMA_VERSION).toBe(6);
    const document = serializeCloudVaultData(EMPTY_STATE);
    expect(document).not.toHaveProperty("financialTimeZone");
    const parsed = parseCloudVaultData(document);
    expect(parsed?.financialTimeZone).toBeUndefined();
    expect(financialVaultFingerprint(EMPTY_STATE)).toBe(
      financialVaultFingerprint(parsed!)
    );

    const withZone = {
      ...EMPTY_STATE,
      financialTimeZone: "America/Boise",
    };
    const zoned = serializeCloudVaultData(withZone);
    expect(zoned.financialTimeZone).toBe("America/Boise");
    expect(parseCloudVaultData(zoned)?.financialTimeZone).toBe("America/Boise");
    expect(financialVaultFingerprint(withZone)).not.toBe(
      financialVaultFingerprint(EMPTY_STATE)
    );
    expect(financialVaultFingerprint(withZone)).toBe(
      financialVaultFingerprint({
        ...EMPTY_STATE,
        financialTimeZone: "America/Boise",
      })
    );
  });

  it("rejects a non-canonical or invalid cloud zone instead of rewriting it", () => {
    const document = serializeCloudVaultData(EMPTY_STATE);
    expect(parseCloudVaultData({ ...document, financialTimeZone: "UTC-7" })).toBeNull();
    expect(
      parseCloudVaultData({ ...document, financialTimeZone: " America/Boise " })
    ).toBeNull();
    expect(parseCloudVaultData({ ...document, financialTimeZone: "GMT-7" })).toBeNull();
  });

  it("explains a timezone-only fingerprint change as a planning edit", () => {
    const diff = compareVaultStructure(EMPTY_STATE, {
      ...EMPTY_STATE,
      financialTimeZone: "America/Boise",
    });
    expect(diff.summary.documentIdentity).toBe("different");
    expect(diff.summary.hasFinancialOrPlanningDifferences).toBe(true);
    expect(diff.summary.documentRepresentationAlsoDiffers).toBe(false);
    expect(diff.scalars.find((row) => row.key === "financialTimeZone")?.status).toBe(
      "different"
    );
  });

  it("keeps version 10 free of the zone and round-trips version 11", () => {
    const historical = buildLedgerBackup(historicalVault());
    const asVersion10 = validateLedgerBackup({
      ...historical,
      version: 10,
      financialTimeZone: "America/Chicago",
    });
    expect(asVersion10?.version).toBe(10);
    expect(asVersion10?.financialTimeZone).toBeUndefined();

    const current = buildLedgerBackup({
      ...historicalVault(),
      financialTimeZone: "America/Boise",
    });
    expect(current.version).toBe(12);
    const asVersion11 = validateLedgerBackup({ ...current, version: 11 });
    expect(asVersion11?.version).toBe(11);
    expect(asVersion11?.financialTimeZone).toBe("America/Boise");
    expect(current.financialTimeZone).toBe("America/Boise");
    expect(validateLedgerBackup(current)?.financialTimeZone).toBe("America/Boise");
    expect(
      validateLedgerBackup({ ...current, financialTimeZone: "UTC-7" })
    ).toBeNull();
    expect(
      validateLedgerBackup({ ...current, financialTimeZone: " America/Boise " })
    ).toBeNull();
    const unknown = buildLedgerBackup(historicalVault());
    expect(unknown.version).toBe(12);
    expect(unknown.financialTimeZone).toBeUndefined();
    expect(validateLedgerBackup(unknown)?.financialTimeZone).toBeUndefined();
  });

  it("does not couple notification timezone to the financial zone", () => {
    const vault = normalizePersistedState({
      ...EMPTY_STATE,
      financialTimeZone: "America/Boise",
      ianaTimezone: "America/Chicago",
    });
    expect(vault.financialTimeZone).toBe("America/Boise");
    expect(vault).not.toHaveProperty("ianaTimezone");

    const preference = { enabled: true, ianaTimezone: "America/Chicago" };
    expect(preferenceTimezoneRefresh(preference, "America/Denver")).toEqual({
      enabled: true,
      ianaTimezone: "America/Denver",
    });
    expect(vault.financialTimeZone).toBe("America/Boise");
    expect(preference.ianaTimezone).toBe("America/Chicago");

    const device = source("lib/babylon/notification-device.ts");
    const delivery = source("lib/babylon/notification-delivery.ts");
    expect(device).not.toContain("financialTimeZone");
    expect(delivery).toContain("financialCivilDate(");
    expect(delivery).toContain("civilDateInTimeZone(input.now, input.timeZone)");
    expect(device).toContain("export function preferenceTimezoneRefresh");
  });

  it("derives production financialToday from the steward zone", () => {
    const engine = source("hooks/useBabylonEngine.ts");
    expect(engine).toContain("useState<string | null>(null)");
    expect(engine).toContain("financialCivilDate(new Date(), financialTimeZoneRef.current)");
    expect(engine).not.toContain("useState(() => todayIso())");
    const setter = engine.slice(
      engine.indexOf("const establishFinancialTimeZone"),
      engine.indexOf("const recurringRef")
    );
    expect(setter).toContain("setFinancialTimeZone(canonical)");
    expect(setter).not.toContain("setExpenses");
    expect(setter).not.toContain("readBrowserIanaTimeZone");
    expect(setter).not.toContain("resolvedOptions");
    expect(setter).not.toContain("preferenceTimezoneRefresh");
    expect(engine).not.toContain("resolveCivilDate");
    expect(engine).not.toContain("financialToday:");
  });

  it("offers the device zone only as a confirmed draft", () => {
    const field = source("components/babylon/financial-time-zone-field.tsx");
    const sidebar = source("components/babylon/app-sidebar.tsx");
    const more = source("components/babylon/mobile-more.tsx");
    expect(field).toContain("Wealth Engine&apos;s financial calendar");
    expect(field).toContain("Not established");
    expect(field).toContain("readBrowserIanaTimeZone");
    expect(field).toContain("as the draft");
    expect(field).toContain("not saved until you confirm");
    expect(field).not.toContain("preferenceTimezoneRefresh");
    expect(field).not.toContain("Clear financial");
    expect(sidebar).toContain("<FinancialTimeZoneField");
    expect(more).toContain("<FinancialTimeZoneField");
    expect(more.indexOf("<FinancialTimeZoneField")).toBeLessThan(
      more.indexOf("<DeviceNotifications")
    );
  });
});
