import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { todayIso } from "@/lib/babylon/engine";
import {
  civilDateInTimeZone,
  resolveCivilDate,
} from "@/lib/babylon/civil-time";

describe("resolveCivilDate", () => {
  const evening = new Date("2026-01-15T06:30:00.000Z");

  it("returns the same civil date for the same instant and zone", () => {
    expect(resolveCivilDate(evening, "America/Boise")).toBe(
      resolveCivilDate(evening, "America/Boise")
    );
    expect(resolveCivilDate(evening, "America/Boise")).toBe("2026-01-14");
    expect(civilDateInTimeZone(evening, "America/Boise")).toBe(
      resolveCivilDate(evening, "America/Boise")
    );
  });

  it("can resolve one instant to different dates in Boise and New York", () => {
    expect(resolveCivilDate(evening, "America/Boise")).toBe("2026-01-14");
    expect(resolveCivilDate(evening, "America/New_York")).toBe("2026-01-15");
  });

  it("follows the spring-forward and fall-back transitions", () => {
    expect(resolveCivilDate(new Date("2026-03-08T06:30:00.000Z"), "America/Boise")).toBe(
      "2026-03-07"
    );
    expect(resolveCivilDate(new Date("2026-03-08T08:30:00.000Z"), "America/Boise")).toBe(
      "2026-03-08"
    );
    expect(resolveCivilDate(new Date("2026-03-08T09:30:00.000Z"), "America/Boise")).toBe(
      "2026-03-08"
    );
    expect(resolveCivilDate(new Date("2026-07-15T05:30:00.000Z"), "America/Boise")).toBe(
      "2026-07-14"
    );
    expect(resolveCivilDate(new Date("2026-11-01T05:30:00.000Z"), "America/Denver")).toBe(
      "2026-10-31"
    );
    expect(resolveCivilDate(new Date("2026-11-01T07:30:00.000Z"), "America/Denver")).toBe(
      "2026-11-01"
    );
    expect(resolveCivilDate(new Date("2026-11-01T08:30:00.000Z"), "America/Denver")).toBe(
      "2026-11-01"
    );
  });

  it("crosses month and year boundaries in the supplied zone", () => {
    expect(resolveCivilDate(new Date("2026-03-01T06:30:00.000Z"), "America/Boise")).toBe(
      "2026-02-28"
    );
    expect(resolveCivilDate(new Date("2026-03-01T07:30:00.000Z"), "America/Boise")).toBe(
      "2026-03-01"
    );
    expect(resolveCivilDate(new Date("2026-01-01T06:30:00.000Z"), "America/Boise")).toBe(
      "2025-12-31"
    );
    expect(resolveCivilDate(new Date("2026-01-01T07:30:00.000Z"), "America/Boise")).toBe(
      "2026-01-01"
    );
  });

  it("fails closed for an invalid, empty, or missing zone", () => {
    expect(resolveCivilDate(evening, "")).toBeNull();
    expect(resolveCivilDate(evening, "   ")).toBeNull();
    expect(resolveCivilDate(evening, "UTC-7")).toBeNull();
    expect(resolveCivilDate(evening, "America/NotARealZone")).toBeNull();
    expect(resolveCivilDate(evening, null as unknown as string)).toBeNull();
  });

  it("fails closed for an invalid instant", () => {
    expect(resolveCivilDate(new Date(Number.NaN), "America/Boise")).toBeNull();
    expect(resolveCivilDate(new Date("not-a-time"), "America/Boise")).toBeNull();
  });

  it("does not follow the host calendar day or the current clock", () => {
    expect(resolveCivilDate(evening, "Pacific/Auckland")).toBe("2026-01-15");
    expect(resolveCivilDate(evening, "Pacific/Pago_Pago")).toBe("2026-01-14");
    expect(resolveCivilDate(evening, "America/Boise")).not.toBe(
      evening.toISOString().slice(0, 10)
    );
    const hostDay = todayIso(evening);
    const resolved = [
      resolveCivilDate(evening, "America/Boise"),
      resolveCivilDate(evening, "America/New_York"),
      resolveCivilDate(evening, "Pacific/Auckland"),
      resolveCivilDate(evening, "Pacific/Pago_Pago"),
    ];
    expect(new Set(resolved).size).toBeGreaterThan(1);
    expect(resolved.every((day) => day === "2026-01-14" || day === "2026-01-15")).toBe(
      true
    );
    expect(hostDay === "2026-01-14" || hostDay === "2026-01-15").toBe(true);

    const source = readFileSync("lib/babylon/civil-time.ts", "utf8");
    const body = source.slice(
      source.indexOf("export function resolveCivilDate"),
      source.indexOf("export function civilDateInTimeZone")
    );
    expect(body).not.toContain("Date.now");
    expect(body).not.toContain("todayIso");
    expect(body).not.toContain("new Date(");
    expect(body).not.toContain("notification_preferences");
    expect(body).not.toContain("resolvedOptions");
    expect(source).not.toContain("expense");
    expect(source).not.toContain("dueDate");
  });

  it("is the production financial clock through financialCivilDate", () => {
    const hook = readFileSync("hooks/useBabylonEngine.ts", "utf8");
    const engine = readFileSync("lib/babylon/engine.ts", "utf8");
    const intelligence = readFileSync("lib/babylon/intelligence-contract.ts", "utf8");
    const evaluator = readFileSync("lib/babylon/notification-evaluator.ts", "utf8");
    const device = readFileSync("lib/babylon/notification-device.ts", "utf8");
    expect(hook).toContain("financialCivilDate(");
    expect(hook).toContain("todayIso(");
    expect(hook).not.toContain("resolveCivilDate");
    expect(engine).toContain("export function todayIso");
    expect(engine).not.toContain("resolveCivilDate");
    expect(intelligence).toContain("financialCivilDate(");
    expect(intelligence).not.toContain("civilDateInTimeZone(");
    expect(intelligence).not.toContain("resolveCivilDate");
    expect(evaluator).toContain("civilDateInTimeZone(");
    expect(evaluator).not.toContain("resolveCivilDate");
    expect(device).toContain("preferenceTimezoneRefresh");
    expect(device).not.toContain("financialTimeZone");
    expect(device).not.toContain("resolveCivilDate");
  });
});
