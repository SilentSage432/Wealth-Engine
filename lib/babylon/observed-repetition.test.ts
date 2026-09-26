import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  deriveObservedRepetitions,
  type ObservedRepetition,
  type ObservedRepetitionObservation,
} from "@/lib/babylon/observed-repetition";

const USER = "user-synthetic";
const ACCOUNT = "acct-synth-checking";
const OTHER_ACCOUNT = "acct-synth-savings";

const OUTPUT_KEYS = [
  "accountId",
  "categories",
  "dates",
  "direction",
  "evidence",
  "gapDays",
  "plaidTransactionIds",
  "signedCents",
  "userId",
];

const FORBIDDEN_OUTPUT_WORDS = [
  "subscription",
  "bill",
  "paycheck",
  "income",
  "expense",
  "weekly",
  "biweekly",
  "monthly",
];

function observation(
  partial: Partial<ObservedRepetitionObservation> &
    Pick<ObservedRepetitionObservation, "plaidTransactionId">
): ObservedRepetitionObservation {
  return {
    userId: partial.userId ?? USER,
    accountId: partial.accountId ?? ACCOUNT,
    amount: partial.amount ?? 12.34,
    category: partial.category === undefined ? "Shops / Groceries" : partial.category,
    date: partial.date ?? "2026-04-01",
    pending: partial.pending ?? false,
    removed: partial.removed ?? false,
    plaidTransactionId: partial.plaidTransactionId,
  };
}

function derive(
  observations: readonly ObservedRepetitionObservation[],
  excludedTransactionIds?: ReadonlySet<string>
): readonly ObservedRepetition[] {
  return deriveObservedRepetitions({ observations, excludedTransactionIds });
}

function pair(): ObservedRepetitionObservation[] {
  return [
    observation({ plaidTransactionId: "txn-a", date: "2026-04-01" }),
    observation({ plaidTransactionId: "txn-b", date: "2026-04-15" }),
  ];
}

describe("deriveObservedRepetitions", () => {
  it("emits nothing for one eligible observation", () => {
    expect(derive([observation({ plaidTransactionId: "txn-only" })])).toEqual([]);
  });

  it("emits one structure and a single civil-day gap for two matches", () => {
    const structures = derive(pair());
    expect(structures).toHaveLength(1);
    expect(structures[0]).toMatchObject({
      userId: USER,
      accountId: ACCOUNT,
      direction: "positive",
      signedCents: 1234,
      plaidTransactionIds: ["txn-a", "txn-b"],
      dates: ["2026-04-01", "2026-04-15"],
      gapDays: [14],
      categories: ["Shops / Groceries", "Shops / Groceries"],
    });
    expect(structures[0]?.evidence).toEqual([
      "posted",
      "current",
      "same_account",
      "same_user",
      "same_sign",
      "same_normalized_cents",
      "distinct_transactions",
      "single_interval",
      "category_text_equal",
    ]);
    expect(structures[0]?.evidence).not.toContain("intervals_agree");
  });

  it("emits intervals_agree when three gaps are the same integer", () => {
    const structures = derive([
      observation({ plaidTransactionId: "txn-1", date: "2026-04-01" }),
      observation({ plaidTransactionId: "txn-2", date: "2026-04-15" }),
      observation({ plaidTransactionId: "txn-3", date: "2026-04-29" }),
    ]);
    expect(structures).toHaveLength(1);
    expect(structures[0]?.gapDays).toEqual([14, 14]);
    expect(structures[0]?.evidence).toContain("intervals_agree");
    expect(structures[0]?.evidence).not.toContain("single_interval");
    expect(structures[0]?.evidence).not.toContain("intervals_differ");
  });

  it("keeps a repeated structure when three gaps differ", () => {
    const structures = derive([
      observation({ plaidTransactionId: "txn-1", date: "2026-04-01" }),
      observation({ plaidTransactionId: "txn-2", date: "2026-04-15" }),
      observation({ plaidTransactionId: "txn-3", date: "2026-05-01" }),
    ]);
    expect(structures).toHaveLength(1);
    expect(structures[0]?.plaidTransactionIds).toEqual(["txn-1", "txn-2", "txn-3"]);
    expect(structures[0]?.gapDays).toEqual([14, 16]);
    expect(structures[0]?.evidence).toContain("intervals_differ");
    expect(structures[0]?.evidence).not.toContain("intervals_agree");
  });

  it("withdraws interval agreement when a later gap breaks it", () => {
    const agreed = derive([
      observation({ plaidTransactionId: "txn-1", date: "2026-04-01" }),
      observation({ plaidTransactionId: "txn-2", date: "2026-04-15" }),
      observation({ plaidTransactionId: "txn-3", date: "2026-04-29" }),
    ]);
    expect(agreed[0]?.evidence).toContain("intervals_agree");

    const broken = derive([
      observation({ plaidTransactionId: "txn-1", date: "2026-04-01" }),
      observation({ plaidTransactionId: "txn-2", date: "2026-04-15" }),
      observation({ plaidTransactionId: "txn-3", date: "2026-04-29" }),
      observation({ plaidTransactionId: "txn-4", date: "2026-05-20" }),
    ]);
    expect(broken).toHaveLength(1);
    expect(broken[0]?.plaidTransactionIds).toEqual([
      "txn-1",
      "txn-2",
      "txn-3",
      "txn-4",
    ]);
    expect(broken[0]?.gapDays).toEqual([14, 14, 21]);
    expect(broken[0]?.evidence).toContain("intervals_differ");
    expect(broken[0]?.evidence).not.toContain("intervals_agree");
  });

  it("rejects a pending observation", () => {
    expect(
      derive([
        observation({ plaidTransactionId: "txn-a", date: "2026-04-01", pending: true }),
        observation({ plaidTransactionId: "txn-b", date: "2026-04-15" }),
      ])
    ).toEqual([]);
  });

  it("rejects a removed observation", () => {
    expect(
      derive([
        observation({ plaidTransactionId: "txn-a", date: "2026-04-01" }),
        observation({ plaidTransactionId: "txn-b", date: "2026-04-15", removed: true }),
      ])
    ).toEqual([]);
  });

  it("rejects a zero-cent observation", () => {
    expect(
      derive([
        observation({ plaidTransactionId: "txn-a", date: "2026-04-01", amount: 0 }),
        observation({ plaidTransactionId: "txn-b", date: "2026-04-15", amount: 0 }),
        observation({ plaidTransactionId: "txn-c", date: "2026-05-01", amount: 0.001 }),
      ])
    ).toEqual([]);
  });

  it("rejects every copy of a duplicated transaction id", () => {
    expect(
      derive([
        observation({ plaidTransactionId: "txn-dup", date: "2026-04-01" }),
        observation({ plaidTransactionId: "txn-dup", date: "2026-04-15" }),
        observation({ plaidTransactionId: "txn-only", date: "2026-04-29" }),
      ])
    ).toEqual([]);

    const kept = derive([
      observation({ plaidTransactionId: "txn-dup", date: "2026-04-01" }),
      observation({ plaidTransactionId: "txn-dup", date: "2026-04-15" }),
      observation({ plaidTransactionId: "txn-a", date: "2026-05-01" }),
      observation({ plaidTransactionId: "txn-b", date: "2026-05-15" }),
    ]);
    expect(kept).toHaveLength(1);
    expect(kept[0]?.plaidTransactionIds).toEqual(["txn-a", "txn-b"]);
  });

  it("rejects excluded transaction ids and otherwise keeps the default empty", () => {
    expect(derive(pair(), new Set(["txn-a"]))).toEqual([]);
    const remaining = derive(
      [
        observation({ plaidTransactionId: "txn-1", date: "2026-04-01" }),
        observation({ plaidTransactionId: "txn-2", date: "2026-04-15" }),
        observation({ plaidTransactionId: "txn-3", date: "2026-04-29" }),
      ],
      new Set(["txn-3"])
    );
    expect(remaining[0]?.plaidTransactionIds).toEqual(["txn-1", "txn-2"]);
    expect(remaining[0]?.evidence).toContain("single_interval");
    expect(derive(pair())).toEqual(derive(pair(), new Set()));
  });

  it("does not merge opposite signs", () => {
    const structures = derive([
      observation({ plaidTransactionId: "txn-out-1", date: "2026-04-01", amount: 12.34 }),
      observation({ plaidTransactionId: "txn-out-2", date: "2026-04-15", amount: 12.34 }),
      observation({ plaidTransactionId: "txn-in-1", date: "2026-04-02", amount: -12.34 }),
      observation({ plaidTransactionId: "txn-in-2", date: "2026-04-16", amount: -12.34 }),
    ]);
    expect(structures).toHaveLength(2);
    expect(structures[0]).toMatchObject({
      direction: "positive",
      signedCents: 1234,
      plaidTransactionIds: ["txn-out-1", "txn-out-2"],
    });
    expect(structures[1]).toMatchObject({
      direction: "negative",
      signedCents: -1234,
      plaidTransactionIds: ["txn-in-1", "txn-in-2"],
    });
  });

  it("does not merge different accounts or users", () => {
    const structures = derive([
      observation({ plaidTransactionId: "txn-a1", date: "2026-04-01" }),
      observation({ plaidTransactionId: "txn-a2", date: "2026-04-15" }),
      observation({
        plaidTransactionId: "txn-b1",
        accountId: OTHER_ACCOUNT,
        date: "2026-04-01",
      }),
      observation({
        plaidTransactionId: "txn-b2",
        accountId: OTHER_ACCOUNT,
        date: "2026-04-15",
      }),
      observation({
        plaidTransactionId: "txn-c1",
        userId: "user-other",
        date: "2026-04-03",
      }),
      observation({
        plaidTransactionId: "txn-c2",
        userId: "user-other",
        date: "2026-04-17",
      }),
    ]);
    expect(structures.map((structure) => structure.plaidTransactionIds)).toEqual([
      ["txn-c1", "txn-c2"],
      ["txn-a1", "txn-a2"],
      ["txn-b1", "txn-b2"],
    ]);
  });

  it("does not merge different normalized cents", () => {
    const structures = derive([
      observation({ plaidTransactionId: "txn-a1", date: "2026-04-01", amount: 10 }),
      observation({ plaidTransactionId: "txn-a2", date: "2026-04-15", amount: 10 }),
      observation({ plaidTransactionId: "txn-b1", date: "2026-04-01", amount: 10.01 }),
      observation({ plaidTransactionId: "txn-b2", date: "2026-04-15", amount: 10.01 }),
    ]);
    expect(structures).toHaveLength(2);
    expect(structures[0]?.signedCents).toBe(1000);
    expect(structures[1]?.signedCents).toBe(1001);
  });

  it("groups when category text differs", () => {
    const structures = derive([
      observation({
        plaidTransactionId: "txn-a",
        date: "2026-04-01",
        category: "Shops / Groceries",
      }),
      observation({
        plaidTransactionId: "txn-b",
        date: "2026-04-15",
        category: "Service",
      }),
    ]);
    expect(structures).toHaveLength(1);
    expect(structures[0]?.categories).toEqual(["Shops / Groceries", "Service"]);
    expect(structures[0]?.evidence).toContain("category_text_differs");
    expect(structures[0]?.evidence).not.toContain("category_text_equal");
  });

  it("records category_text_equal when every category string matches", () => {
    const structures = derive(pair());
    expect(structures[0]?.evidence).toContain("category_text_equal");
    expect(structures[0]?.evidence).not.toContain("category_text_differs");
    expect(structures[0]?.evidence).not.toContain("category_text_absent");
  });

  it("records category_text_absent when a category is null", () => {
    const structures = derive([
      observation({ plaidTransactionId: "txn-a", date: "2026-04-01", category: null }),
      observation({ plaidTransactionId: "txn-b", date: "2026-04-15", category: null }),
    ]);
    expect(structures[0]?.categories).toEqual([null, null]);
    expect(structures[0]?.evidence).toContain("category_text_absent");
    expect(structures[0]?.evidence).not.toContain("category_text_equal");
    expect(structures[0]?.evidence).not.toContain("category_text_differs");
  });

  it("records both absent and differing category facts when both are true", () => {
    const structures = derive([
      observation({ plaidTransactionId: "txn-a", date: "2026-04-01", category: null }),
      observation({ plaidTransactionId: "txn-b", date: "2026-04-15", category: "Service" }),
      observation({ plaidTransactionId: "txn-c", date: "2026-04-29", category: "Shops" }),
    ]);
    expect(structures[0]?.evidence).toContain("category_text_absent");
    expect(structures[0]?.evidence).toContain("category_text_differs");
    expect(structures[0]?.evidence).not.toContain("category_text_equal");
  });

  it("keeps a 14-day gap that crosses a month boundary", () => {
    const structures = derive([
      observation({ plaidTransactionId: "txn-a", date: "2026-01-25" }),
      observation({ plaidTransactionId: "txn-b", date: "2026-02-08" }),
    ]);
    expect(structures[0]?.gapDays).toEqual([14]);
    expect(structures[0]?.evidence).toContain("single_interval");
  });

  it("reports the civil-day gap from January 31 to February 28", () => {
    const structures = derive([
      observation({ plaidTransactionId: "txn-jan", date: "2026-01-31" }),
      observation({ plaidTransactionId: "txn-feb", date: "2026-02-28" }),
    ]);
    expect(structures[0]?.dates).toEqual(["2026-01-31", "2026-02-28"]);
    expect(structures[0]?.gapDays).toEqual([28]);
    expect(structures[0]?.evidence).toContain("single_interval");
    expect(structures[0]?.evidence).not.toContain("intervals_agree");
  });

  it("counts civil days across a daylight-saving transition", () => {
    const structures = derive([
      observation({ plaidTransactionId: "txn-a", date: "2026-03-07" }),
      observation({ plaidTransactionId: "txn-b", date: "2026-03-09" }),
    ]);
    expect(structures[0]?.gapDays).toEqual([2]);
  });

  it("returns the same structures for every input permutation", () => {
    const observations = [
      observation({ plaidTransactionId: "txn-b", date: "2026-04-15", category: "Service" }),
      observation({
        plaidTransactionId: "txn-in-2",
        date: "2026-04-16",
        amount: -12.34,
        category: null,
      }),
      observation({ plaidTransactionId: "txn-a", date: "2026-04-01", category: "Service" }),
      observation({
        plaidTransactionId: "txn-in-1",
        date: "2026-04-02",
        amount: -12.34,
        category: null,
      }),
      observation({ plaidTransactionId: "txn-noise", date: "2026-06-01", amount: 3 }),
    ];
    const forward = derive(observations);
    const reversed = derive([...observations].reverse());
    const rotated = derive([...observations.slice(2), ...observations.slice(0, 2)]);
    expect(reversed).toEqual(forward);
    expect(rotated).toEqual(forward);
    expect(forward.map((structure) => structure.plaidTransactionIds)).toEqual([
      ["txn-a", "txn-b"],
      ["txn-in-1", "txn-in-2"],
    ]);
  });

  it("leaves an existing structure unchanged when unrelated observations are added", () => {
    const alone = derive(pair());
    const withNoise = derive([
      ...pair(),
      observation({ plaidTransactionId: "txn-other-amount", amount: 8.5, date: "2026-04-02" }),
      observation({
        plaidTransactionId: "txn-other-account",
        accountId: OTHER_ACCOUNT,
        date: "2026-04-03",
      }),
      observation({ plaidTransactionId: "txn-pending", pending: true, date: "2026-04-04" }),
    ]);
    expect(withNoise).toEqual(alone);
  });

  it("uses a closed output vocabulary with no prediction or score", () => {
    const structures = derive([
      ...pair(),
      observation({ plaidTransactionId: "txn-c", date: "2026-04-29", category: null }),
      observation({
        plaidTransactionId: "txn-in-1",
        date: "2026-05-01",
        amount: -4,
        category: "Transfer / Deposit",
      }),
      observation({
        plaidTransactionId: "txn-in-2",
        date: "2026-05-15",
        amount: -4,
        category: "Service",
      }),
    ]);
    const serialized = JSON.stringify(structures).toLowerCase();
    for (const word of FORBIDDEN_OUTPUT_WORDS) {
      expect(serialized).not.toContain(word);
    }
    for (const structure of structures) {
      expect(Object.keys(structure).sort()).toEqual(OUTPUT_KEYS);
    }
    const source = readFileSync(
      resolve(process.cwd(), "lib/babylon/observed-repetition.ts"),
      "utf8"
    ).toLowerCase();
    for (const word of FORBIDDEN_OUTPUT_WORDS) {
      expect(source).not.toContain(word);
    }
    expect(source).not.toContain("confidence");
    expect(source).not.toContain("probability");
    expect(source).not.toContain("nextdate");
    expect(source).not.toContain("expected");
  });

  it("is pure, does not read processing flags, and does not import movement", () => {
    const observations = pair();
    const snapshot = observations.map((row) => ({ ...row }));
    const first = derive(observations);
    const second = derive(observations);
    expect(second).toEqual(first);
    expect(observations).toEqual(snapshot);

    type ObservationKey = keyof ObservedRepetitionObservation;
    type NameIncluded = "name" extends ObservationKey ? true : false;
    type ProcessedIncluded = "isProcessed" extends ObservationKey ? true : false;
    const nameIsNotAnInput: NameIncluded = false;
    const processedIsNotAnInput: ProcessedIncluded = false;
    expect(nameIsNotAnInput).toBe(false);
    expect(processedIsNotAnInput).toBe(false);

    const source = readFileSync(
      resolve(process.cwd(), "lib/babylon/observed-repetition.ts"),
      "utf8"
    );
    expect(source).not.toContain("isProcessed");
    expect(source).not.toContain("deriveCorrelatedInternalMovements");
    expect(source).not.toMatch(/from ["']@\/lib\/babylon\/correlated/);
    expect(source).not.toMatch(/from ["']@\/lib\/supabase/);
    expect(source).not.toMatch(/from ["']react/);
    expect(source).not.toContain("localStorage");
    expect(source).not.toContain("plaid-server");
    expect(source).not.toContain("wealth_engine_vaults");
    expect(source).not.toContain("recurring-obligations");
  });

  it("is not imported outside its module and test", () => {
    const roots = ["app", "components", "hooks", "lib", "types"].map((dir) =>
      resolve(process.cwd(), dir)
    );
    const offenders: string[] = [];
    const visit = (path: string) => {
      for (const entry of readdirSync(path)) {
        const fullPath = join(path, entry);
        if (statSync(fullPath).isDirectory()) {
          visit(fullPath);
          continue;
        }
        if (!fullPath.endsWith(".ts") && !fullPath.endsWith(".tsx")) continue;
        if (fullPath.endsWith("observed-repetition.ts")) continue;
        if (fullPath.endsWith("observed-repetition.test.ts")) continue;
        const text = readFileSync(fullPath, "utf8");
        if (
          text.includes("observed-repetition") ||
          text.includes("deriveObservedRepetitions")
        ) {
          offenders.push(fullPath);
        }
      }
    };
    for (const root of roots) visit(root);
    expect(offenders).toEqual([]);
  });
});
