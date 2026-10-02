import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { CLOUD_VAULT_SCHEMA_VERSION } from "@/lib/babylon/cloud-vault";
import {
  allocateIncome,
  computeDesiresPoolRemaining,
  desiresPoolSharePct,
  livingBudgetRemaining,
} from "@/lib/babylon/engine";
import { LEDGER_BACKUP_VERSION } from "@/lib/babylon/persistence";

const LABOR_HOUR_TOKENS = [
  "WORK_HOURS_PER_WEEK",
  "effectiveHourlyRate",
  "primaryHourlyRate",
  "laborHoursForAmount",
  "hourlyLaborRate",
  "monthlyIncomeEquivalent",
  "latestRecurringBySource",
  "SpendingPowerFocus",
  "hrs of work",
  "hours of main income",
  "Main income hours",
  "affordability hours",
];

function source(path: string): string {
  return readFileSync(path, "utf8");
}

describe("labor-hour removal", () => {
  const engine = source("lib/babylon/engine.ts");
  const hook = source("hooks/useBabylonEngine.ts");
  const dashboard = source("components/babylon/wealth-engine-dashboard.tsx");
  const budget = source("components/babylon/mobile-budget.tsx");
  const anchor = source("components/babylon/affordability-anchor.tsx");
  const triad = source("components/babylon/golden-triad.tsx");
  const types = source("types/babylon.ts");
  const persistence = source("lib/babylon/persistence.ts");
  const cloud = source("lib/babylon/cloud-vault.ts");

  it("deletes the labor-hour helpers and leaves income allocation in place", () => {
    for (const token of LABOR_HOUR_TOKENS) {
      expect(engine).not.toContain(token);
      expect(hook).not.toContain(token);
    }
    expect(engine).toContain("export function allocateIncome");
    expect(engine).toContain("export function livingBudgetRemaining");
    expect(engine).toContain("export function computeDesiresPoolRemaining");
    expect(engine).toContain("export function desiresPoolSharePct");
    expect(allocateIncome(1000, true)).toEqual({
      wealthShare: 100,
      debtShare: 200,
      expenditureShare: 700,
      debtRedirected: false,
    });
    expect(livingBudgetRemaining(700, 1.33)).toBe(698.67);
    expect(computeDesiresPoolRemaining(700, 200, 50, 300)).toBe(350);
    expect(desiresPoolSharePct(42.5, 50)).toBe(85);
  });

  it("removes the desktop hours card and keeps the Living Budget on the triad", () => {
    const overview = dashboard.slice(dashboard.indexOf("{showOverview && ("));
    expect(overview).not.toContain("SpendingPowerFocus");
    expect(overview).not.toContain("focusCards");
    expect(overview).not.toContain("hrs of work");
    expect(overview.indexOf("{upcomingNeedsCard}")).toBeLessThan(
      overview.indexOf("{triad}")
    );
    expect(triad).toContain("Living Budget · 70%");
    expect(dashboard).toContain(
      "expenditureRemaining={engine.expenditureRemaining}"
    );
  });

  it("removes the phone hours sentence and keeps the Living Budget figures", () => {
    expect(budget).toContain('aria-label="Living Budget"');
    expect(budget).toContain("expenditureRemaining");
    expect(budget).toContain("expenditureRemainingPct");
    expect(budget).toContain("expenditurePool");
    expect(budget).not.toContain("hours of main income");
    expect(budget).not.toContain("laborHours");
    expect(budget).not.toContain("/hr");
  });

  it("keeps the wants-pool percentage and drops the labor-hour half", () => {
    expect(anchor).toContain("desiresPoolSharePct");
    expect(anchor).toContain("Of money left for wants");
    expect(anchor).not.toContain("Main income hours");
    expect(anchor).not.toContain("hourlyLaborRate");
    expect(anchor).not.toContain("laborHoursForAmount");
    expect(anchor).not.toContain("/hr");
  });

  it("leaves income history, backup version 13, and cloud schema 6 untouched", () => {
    expect(types).toContain("export interface IncomeEntry");
    expect(types).not.toContain("hourlyLaborRate");
    expect(types).not.toContain("AffordabilitySnapshot");
    expect(persistence).toContain("incomes");
    expect(cloud).toContain("incomes");
    expect(LEDGER_BACKUP_VERSION).toBe(13);
    expect(CLOUD_VAULT_SCHEMA_VERSION).toBe(6);
    expect(persistence).not.toContain("hourlyLaborRate");
    expect(cloud).not.toContain("hourlyLaborRate");
  });
});
