import { describe, expect, it } from "vitest";
import {
  deriveDeployablePosition,
  deriveRestrictedEffectiveTotal,
} from "@/lib/babylon/account-restriction";
import { deriveAvailableAfterPlannedNeeds } from "@/lib/babylon/available-after-planned-needs";
import { CLOUD_VAULT_SCHEMA_VERSION } from "@/lib/babylon/cloud-vault";
import { EMPTY_STATE } from "@/lib/babylon/constants";
import { allocateIncome } from "@/lib/babylon/engine";
import { sumAccountBalances } from "@/lib/babylon/financial-position";
import { INTELLIGENCE_CONTRACT_VERSION } from "@/lib/babylon/intelligence-contract";
import {
  buildLedgerBackup,
  LEDGER_BACKUP_VERSION,
  normalizePersistedState,
  validateLedgerBackup,
} from "@/lib/babylon/persistence";
import { totalProtectedMoney } from "@/lib/babylon/protected-money";
import {
  deriveExpectedPaydays,
  deriveExpectedPaydaysForSchedules,
  parsePaySchedule,
} from "@/lib/babylon/pay-schedule";
import type {
  BiweeklyPaySchedule,
  MonthlyPaySchedule,
  PaySchedule,
  SemimonthlyPaySchedule,
  WeeklyPaySchedule,
} from "@/types/babylon";

function weekly(
  partial: Partial<WeeklyPaySchedule> & Pick<WeeklyPaySchedule, "anchorDate">
): WeeklyPaySchedule {
  return {
    id: partial.id ?? "sched-weekly",
    cadence: "weekly",
    anchorDate: partial.anchorDate,
    createdAt: partial.createdAt ?? "2026-01-01",
    ...(partial.expectedAmount !== undefined
      ? { expectedAmount: partial.expectedAmount }
      : {}),
    ...(partial.label !== undefined ? { label: partial.label } : {}),
  };
}

function biweekly(
  partial: Partial<BiweeklyPaySchedule> & Pick<BiweeklyPaySchedule, "anchorDate">
): BiweeklyPaySchedule {
  return {
    id: partial.id ?? "sched-biweekly",
    cadence: "biweekly",
    anchorDate: partial.anchorDate,
    createdAt: partial.createdAt ?? "2026-01-01",
    ...(partial.expectedAmount !== undefined
      ? { expectedAmount: partial.expectedAmount }
      : {}),
    ...(partial.label !== undefined ? { label: partial.label } : {}),
  };
}

function semimonthly(
  partial: Partial<SemimonthlyPaySchedule> &
    Pick<SemimonthlyPaySchedule, "firstDay" | "secondDay">
): SemimonthlyPaySchedule {
  return {
    id: partial.id ?? "sched-semi",
    cadence: "semimonthly",
    firstDay: partial.firstDay,
    secondDay: partial.secondDay,
    createdAt: partial.createdAt ?? "2026-01-01",
    ...(partial.expectedAmount !== undefined
      ? { expectedAmount: partial.expectedAmount }
      : {}),
    ...(partial.label !== undefined ? { label: partial.label } : {}),
  };
}

function monthly(
  partial: Partial<MonthlyPaySchedule> & Pick<MonthlyPaySchedule, "dayOfMonth">
): MonthlyPaySchedule {
  return {
    id: partial.id ?? "sched-monthly",
    cadence: "monthly",
    dayOfMonth: partial.dayOfMonth,
    createdAt: partial.createdAt ?? "2026-01-01",
    ...(partial.expectedAmount !== undefined
      ? { expectedAmount: partial.expectedAmount }
      : {}),
    ...(partial.label !== undefined ? { label: partial.label } : {}),
  };
}

describe("WE-PAY-SCHEDULE-001 weekly", () => {
  it("derives ordinary month occurrences from a phase anchor", () => {
    const schedule = weekly({ anchorDate: "2026-09-04" });
    const days = deriveExpectedPaydays(schedule, "2026-10").map((row) => row.date);
    expect(days).toEqual([
      "2026-10-02",
      "2026-10-09",
      "2026-10-16",
      "2026-10-23",
      "2026-10-30",
    ]);
  });

  it("includes a boundary occurrence on the first of the month when on lattice", () => {
    const schedule = weekly({ anchorDate: "2026-10-01" });
    const days = deriveExpectedPaydays(schedule, "2026-10").map((row) => row.date);
    expect(days[0]).toBe("2026-10-01");
    expect(days.at(-1)).toBe("2026-10-29");
  });

  it("derives months before the anchor from the same phase lattice", () => {
    const schedule = weekly({ anchorDate: "2026-10-02" });
    const september = deriveExpectedPaydays(schedule, "2026-09").map(
      (row) => row.date
    );
    expect(september).toContain("2026-09-04");
    expect(september).toContain("2026-09-25");
  });
});

describe("WE-PAY-SCHEDULE-001 biweekly", () => {
  it("identifies a 2-payday month", () => {
    // Anchor Fri 2026-10-02 → Oct 2, 16 (30 is +28 days = still Oct; wait 2+14=16, 16+14=30 → 3)
    // Use anchor that yields 2 in November: Nov 2026 from Oct 2 → Nov 13, 27
    const schedule = biweekly({ anchorDate: "2026-10-02" });
    const november = deriveExpectedPaydays(schedule, "2026-11").map(
      (row) => row.date
    );
    expect(november).toEqual(["2026-11-13", "2026-11-27"]);
    expect(november).toHaveLength(2);
  });

  it("identifies a 3-payday month without calling the third extra", () => {
    const schedule = biweekly({ anchorDate: "2026-10-02" });
    const october = deriveExpectedPaydays(schedule, "2026-10").map(
      (row) => row.date
    );
    expect(october).toEqual(["2026-10-02", "2026-10-16", "2026-10-30"]);
    expect(october).toHaveLength(3);
  });

  it("keeps sequence continuity across a month boundary", () => {
    const schedule = biweekly({ anchorDate: "2026-10-02" });
    const october = deriveExpectedPaydays(schedule, "2026-10").map((r) => r.date);
    const november = deriveExpectedPaydays(schedule, "2026-11").map((r) => r.date);
    expect(october.at(-1)).toBe("2026-10-30");
    expect(november[0]).toBe("2026-11-13");
  });
});

describe("WE-PAY-SCHEDULE-001 semimonthly", () => {
  it("supports an explicit day pair", () => {
    const schedule = semimonthly({ firstDay: 1, secondDay: 15 });
    expect(deriveExpectedPaydays(schedule, "2026-10").map((r) => r.date)).toEqual([
      "2026-10-01",
      "2026-10-15",
    ]);
  });

  it("supports 15th + last civil day", () => {
    const schedule = semimonthly({ firstDay: 15, secondDay: "last" });
    expect(deriveExpectedPaydays(schedule, "2026-10").map((r) => r.date)).toEqual([
      "2026-10-15",
      "2026-10-31",
    ]);
  });

  it("resolves February and leap-year February last day", () => {
    const schedule = semimonthly({ firstDay: 15, secondDay: "last" });
    expect(deriveExpectedPaydays(schedule, "2026-02").map((r) => r.date)).toEqual([
      "2026-02-15",
      "2026-02-28",
    ]);
    expect(deriveExpectedPaydays(schedule, "2024-02").map((r) => r.date)).toEqual([
      "2024-02-15",
      "2024-02-29",
    ]);
  });

  it("keeps weekend on the declared civil date", () => {
    // 2026-11-01 is Sunday; 2026-11-15 is Sunday.
    const schedule = semimonthly({ firstDay: 1, secondDay: 15 });
    expect(deriveExpectedPaydays(schedule, "2026-11").map((r) => r.date)).toEqual([
      "2026-11-01",
      "2026-11-15",
    ]);
  });
});

describe("WE-PAY-SCHEDULE-001 monthly", () => {
  it("derives an ordinary day", () => {
    const schedule = monthly({ dayOfMonth: 15 });
    expect(deriveExpectedPaydays(schedule, "2026-10").map((r) => r.date)).toEqual([
      "2026-10-15",
    ]);
  });

  it("clamps day 31 in a 30-day month", () => {
    const schedule = monthly({ dayOfMonth: 31 });
    expect(deriveExpectedPaydays(schedule, "2026-09").map((r) => r.date)).toEqual([
      "2026-09-30",
    ]);
  });

  it("clamps day 31 in February and leap-year February", () => {
    const schedule = monthly({ dayOfMonth: 31 });
    expect(deriveExpectedPaydays(schedule, "2026-02").map((r) => r.date)).toEqual([
      "2026-02-28",
    ]);
    expect(deriveExpectedPaydays(schedule, "2024-02").map((r) => r.date)).toEqual([
      "2024-02-29",
    ]);
  });
});

describe("WE-PAY-SCHEDULE-001 general", () => {
  it("keeps occurrences inside the requested periodKey only", () => {
    const schedule = biweekly({ anchorDate: "2026-10-02" });
    for (const row of deriveExpectedPaydays(schedule, "2026-10")) {
      expect(row.periodKey).toBe("2026-10");
      expect(row.date.startsWith("2026-10-")).toBe(true);
    }
  });

  it("orders deterministically without duplicates", () => {
    const schedule = weekly({ anchorDate: "2026-10-01" });
    const days = deriveExpectedPaydays(schedule, "2026-10").map((r) => r.date);
    expect(days).toEqual([...days].sort());
    expect(new Set(days).size).toBe(days.length);
  });

  it("treats expectedAmount and label as optional metadata", () => {
    const bare = biweekly({ anchorDate: "2026-10-02" });
    const rich = biweekly({
      anchorDate: "2026-10-02",
      expectedAmount: 1500,
      label: "Lowe's",
    });
    const bareRow = deriveExpectedPaydays(bare, "2026-10")[0];
    const richRow = deriveExpectedPaydays(rich, "2026-10")[0];
    expect(bareRow?.expectedAmount).toBeUndefined();
    expect(bareRow?.label).toBeUndefined();
    expect(richRow?.expectedAmount).toBe(1500);
    expect(richRow?.label).toBe("Lowe's");
  });

  it("merges multiple schedules without semantic collision", () => {
    const lowes = biweekly({
      id: "lowes",
      anchorDate: "2026-10-02",
      label: "Lowe's",
    });
    const side = monthly({ id: "side", dayOfMonth: 1, label: "Side" });
    const rows = deriveExpectedPaydaysForSchedules([lowes, side], "2026-10");
    expect(rows.map((r) => r.date)).toEqual([
      "2026-10-01",
      "2026-10-02",
      "2026-10-16",
      "2026-10-30",
    ]);
    expect(rows.filter((r) => r.scheduleId === "lowes")).toHaveLength(3);
    expect(rows.filter((r) => r.scheduleId === "side")).toHaveLength(1);
  });

  it("rejects malformed schedules safely", () => {
    expect(parsePaySchedule(null)).toBeNull();
    expect(parsePaySchedule({ cadence: "weekly" })).toBeNull();
    expect(
      parsePaySchedule({
        id: "x",
        cadence: "weekly",
        anchorDate: "2026-02-31",
        createdAt: "2026-01-01",
      })
    ).toBeNull();
    expect(
      parsePaySchedule({
        id: "x",
        cadence: "semimonthly",
        firstDay: 15,
        secondDay: 15,
        createdAt: "2026-01-01",
      })
    ).toBeNull();
    expect(
      parsePaySchedule({
        id: "x",
        cadence: "monthly",
        dayOfMonth: 15,
        createdAt: "2026-01-01",
        expectedAmount: 0,
      })
    ).toBeNull();
    expect(deriveExpectedPaydays({} as PaySchedule, "2026-10")).toEqual([]);
  });
});

describe("WE-PAY-SCHEDULE-001 isolation", () => {
  it("creates no IncomeEntry or AllocationEvent and does not invoke allocation", () => {
    const beforeIncomes = EMPTY_STATE.incomes.length;
    const beforeAllocations = EMPTY_STATE.allocations.length;
    const schedule = biweekly({
      anchorDate: "2026-10-02",
      expectedAmount: 1500,
      label: "Lowe's",
    });
    const rows = deriveExpectedPaydays(schedule, "2026-10");
    expect(rows).toHaveLength(3);
    expect(EMPTY_STATE.incomes).toHaveLength(beforeIncomes);
    expect(EMPTY_STATE.allocations).toHaveLength(beforeAllocations);
    // Planning metadata must not be confused with allocateIncome results.
    expect(allocateIncome(1500, true).wealthShare).toBe(150);
    expect(rows.every((row) => !("wealthShare" in row))).toBe(true);
  });

  it("does not change Financial Position / AAPN arithmetic", () => {
    const accounts = [
      {
        id: "c",
        name: "Checking",
        kind: "checking" as const,
        balance: 2040.67,
        asOf: "2026-10-01",
        restrictedAmount: 2000,
      },
    ];
    const positions = [
      {
        accountId: "c",
        balance: 2040.67,
        source: "declared" as const,
        asOf: "2026-10-01",
      },
    ];
    const owned = sumAccountBalances(accounts);
    const unavailable = deriveRestrictedEffectiveTotal(accounts, positions);
    const deployable = deriveDeployablePosition(accounts, positions);
    const protectedOwned = totalProtectedMoney(0.81, 0);
    const planned = deriveAvailableAfterPlannedNeeds({
      deployablePosition: deployable,
      deployableProtected: 0.81,
      upcomingNeeds: 961.06,
    });

    deriveExpectedPaydays(
      biweekly({ anchorDate: "2026-10-02", expectedAmount: 9999 }),
      "2026-10"
    );

    expect(sumAccountBalances(accounts)).toBe(owned);
    expect(deriveRestrictedEffectiveTotal(accounts, positions)).toBe(unavailable);
    expect(deriveDeployablePosition(accounts, positions)).toBe(deployable);
    expect(totalProtectedMoney(0.81, 0)).toBe(protectedOwned);
    expect(
      deriveAvailableAfterPlannedNeeds({
        deployablePosition: deployable,
        deployableProtected: 0.81,
        upcomingNeeds: 961.06,
      })
    ).toEqual(planned);
  });

  it("persists rules only; backup v11; cloud schema 6; IC v3", () => {
    expect(LEDGER_BACKUP_VERSION).toBe(11);
    expect(CLOUD_VAULT_SCHEMA_VERSION).toBe(6);
    expect(INTELLIGENCE_CONTRACT_VERSION).toBe("4");
    const schedule = biweekly({
      id: "lowes",
      anchorDate: "2026-10-02",
      expectedAmount: 1500,
      label: "Lowe's",
    });
    const state = { ...EMPTY_STATE, paySchedules: [schedule] };
    const backup = buildLedgerBackup(state);
    expect(backup.version).toBe(11);
    expect(backup.paySchedules).toEqual([schedule]);
    expect(backup.incomes).toEqual([]);
    expect(backup.allocations).toEqual([]);

    const validated = validateLedgerBackup(backup);
    expect(validated?.paySchedules).toEqual([schedule]);

    const soft = normalizePersistedState({
      ...EMPTY_STATE,
      paySchedules: undefined,
    });
    expect(soft.paySchedules).toEqual([]);

    // v9 rejects / strips pay schedules on import path (force empty).
    const asV9 = validateLedgerBackup({ ...backup, version: 9 });
    expect(asV9?.paySchedules ?? []).toEqual([]);
  });
});
