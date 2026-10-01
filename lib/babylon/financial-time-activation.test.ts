import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { EMPTY_STATE } from "@/lib/babylon/constants";
import {
  financialCivilDate,
  msUntilNextFinancialMidnight,
  resolveCivilDate,
} from "@/lib/babylon/civil-time";
import {
  financialVaultFingerprint,
  serializeCloudVaultData,
} from "@/lib/babylon/cloud-vault";
import { markExpensePaid } from "@/lib/babylon/engine";
import type { ExpenseEntry, PersistedState } from "@/types/babylon";

function nextCivilDate(now: Date, zone: string): string | null {
  const wait = msUntilNextFinancialMidnight(now, zone);
  if (wait === null) return null;
  return resolveCivilDate(new Date(now.getTime() + wait), zone);
}

describe("financialCivilDate", () => {
  const instant = new Date("2026-01-15T06:30:00.000Z");

  it("is the same date for the same instant and zone", () => {
    expect(financialCivilDate(instant, "America/Boise")).toBe("2026-01-14");
    expect(financialCivilDate(instant, "America/Boise")).toBe(
      resolveCivilDate(instant, "America/Boise")
    );
  });

  it("can differ between Boise and New York", () => {
    expect(financialCivilDate(instant, "America/Boise")).toBe("2026-01-14");
    expect(financialCivilDate(instant, "America/New_York")).toBe("2026-01-15");
  });

  it("is unknown without a steward zone", () => {
    expect(financialCivilDate(instant, undefined)).toBeNull();
    expect(financialCivilDate(instant, null)).toBeNull();
    expect(financialCivilDate(instant, "")).toBeNull();
    expect(financialCivilDate(instant, "UTC-7")).toBeNull();
  });

  it("crosses a month and a year on the financial midnight", () => {
    const yearEnd = new Date("2026-01-01T06:30:00.000Z");
    expect(financialCivilDate(yearEnd, "America/Boise")).toBe("2025-12-31");
    expect(nextCivilDate(yearEnd, "America/Boise")).toBe("2026-01-01");
  });

  it("advances on the financial-zone midnight, including daylight-saving days", () => {
    const winter = new Date("2026-01-15T06:30:00.000Z");
    expect(financialCivilDate(winter, "America/Boise")).toBe("2026-01-14");
    expect(nextCivilDate(winter, "America/Boise")).toBe("2026-01-15");

    const spring = new Date("2026-03-08T08:30:00.000Z");
    expect(financialCivilDate(spring, "America/Boise")).toBe("2026-03-08");
    expect(nextCivilDate(spring, "America/Boise")).toBe("2026-03-09");

    const fall = new Date("2026-11-01T07:30:00.000Z");
    expect(financialCivilDate(fall, "America/Boise")).toBe("2026-11-01");
    expect(nextCivilDate(fall, "America/Boise")).toBe("2026-11-02");
  });
});

describe("activation invariants", () => {
  it("keeps financial today out of the vault fingerprint", () => {
    const state: PersistedState = {
      ...EMPTY_STATE,
      financialTimeZone: "America/Boise",
    };
    const fingerprint = financialVaultFingerprint(state);
    expect(fingerprint).toBe(financialVaultFingerprint({ ...state }));
    expect(serializeCloudVaultData(state)).not.toHaveProperty("financialToday");
    const changed = financialVaultFingerprint({
      ...state,
      financialTimeZone: "America/New_York",
    });
    expect(changed).not.toBe(fingerprint);
  });

  it("stores a paid date as the date the steward confirmed", () => {
    const expense: ExpenseEntry = {
      id: "rent",
      name: "Rent",
      category: "need",
      amount: 100,
      date: "2026-01-01",
      dueDate: "2026-01-14",
      isSettled: false,
    };
    const paid = markExpensePaid(expense, "2026-01-14");
    expect(paid.date).toBe("2026-01-14");
    expect(paid.dueDate).toBe("2026-01-14");
    expect(markExpensePaid(expense, "2026-01-14").date).toBe(paid.date);
  });

  it("refreshes financial today without a vault write or recurrence materialization", () => {
    const hook = readFileSync("hooks/useBabylonEngine.ts", "utf8");
    const effect = hook.slice(
      hook.indexOf("const align = () => {"),
      hook.indexOf("const timer = window.setInterval")
    );
    expect(effect).toContain("financialCivilDate(new Date(), financialTimeZoneRef.current)");
    expect(effect).toContain("msUntilNextFinancialMidnight");
    expect(effect).toContain('window.addEventListener("focus"');
    expect(effect).not.toContain("setExpenses");
    expect(effect).not.toContain("setRecurringObligations");
    expect(effect).not.toContain("todayIso(");
    expect(hook).not.toContain("msUntilNextLocalMidnight");
    const clock = readFileSync("components/babylon/command-bar.tsx", "utf8");
    const greeting = readFileSync("components/babylon/mobile-header.tsx", "utf8");
    expect(clock).toContain("toLocaleTimeString");
    expect(clock).not.toContain("financialCivilDate");
    expect(greeting).toContain("getHours");
    expect(greeting).not.toContain("financialCivilDate");
  });
});
