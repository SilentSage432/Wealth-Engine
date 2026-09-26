import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  deriveCorrelatedInternalMovements,
  type CorrelatedInternalMovement,
  type CorrelatedMovementAccount,
  type CorrelatedMovementObservation,
} from "@/lib/babylon/correlated-internal-movement";

const USER = "user-synthetic";
const ITEM = "item-synthetic";
const CHECKING = "acct-synth-checking";
const SAVINGS = "acct-synth-savings";
const CARD = "acct-synth-card";
const OTHER_CHECKING = "acct-synth-other";

function observation(
  partial: Partial<CorrelatedMovementObservation> &
    Pick<CorrelatedMovementObservation, "plaidTransactionId" | "accountId" | "amount">
): CorrelatedMovementObservation {
  return {
    userId: partial.userId ?? USER,
    category: partial.category ?? null,
    date: partial.date ?? "2026-04-01",
    pending: partial.pending ?? false,
    removed: partial.removed ?? false,
    plaidTransactionId: partial.plaidTransactionId,
    accountId: partial.accountId,
    amount: partial.amount,
  };
}

function accounts(): CorrelatedMovementAccount[] {
  return [
    {
      userId: USER,
      plaidItemId: ITEM,
      plaidAccountId: CHECKING,
      accountType: "depository",
      subtype: "checking",
    },
    {
      userId: USER,
      plaidItemId: ITEM,
      plaidAccountId: SAVINGS,
      accountType: "depository",
      subtype: "savings",
    },
    {
      userId: USER,
      plaidItemId: ITEM,
      plaidAccountId: CARD,
      accountType: "credit",
      subtype: "credit card",
    },
    {
      userId: USER,
      plaidItemId: ITEM,
      plaidAccountId: OTHER_CHECKING,
      accountType: "depository",
      subtype: "checking",
    },
  ];
}

function derive(
  observations: readonly CorrelatedMovementObservation[],
  accountRows: readonly CorrelatedMovementAccount[] = accounts()
): readonly CorrelatedInternalMovement[] {
  return deriveCorrelatedInternalMovements({
    observations,
    accounts: accountRows,
  });
}

function transferPair(amount = 25): CorrelatedMovementObservation[] {
  return [
    observation({
      plaidTransactionId: "txn-transfer-out",
      accountId: CHECKING,
      amount,
      category: "Transfer / Withdrawal",
    }),
    observation({
      plaidTransactionId: "txn-transfer-in",
      accountId: SAVINGS,
      amount: -amount,
      category: "Transfer / Deposit",
    }),
  ];
}

function cardPair(amount = 40): CorrelatedMovementObservation[] {
  return [
    observation({
      plaidTransactionId: "txn-card-out",
      accountId: CHECKING,
      amount,
      category: "Payment / Credit Card",
    }),
    observation({
      plaidTransactionId: "txn-card-in",
      accountId: CARD,
      amount: -amount,
      category: "Payment / Credit Card",
    }),
  ];
}

function shuffle<T>(items: readonly T[], seed: number): T[] {
  const next = [...items];
  let state = seed >>> 0;
  for (let index = next.length - 1; index > 0; index -= 1) {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    const swapIndex = state % (index + 1);
    const current = next[index];
    next[index] = next[swapIndex];
    next[swapIndex] = current;
  }
  return next;
}

function participatingIds(
  movements: readonly CorrelatedInternalMovement[]
): string[] {
  return movements.flatMap((movement) => [
    movement.sourcePlaidTransactionId,
    movement.destinationPlaidTransactionId,
  ]);
}

describe("deriveCorrelatedInternalMovements", () => {
  it("accepts an exact depository transfer", () => {
    expect(derive(transferPair())).toEqual([
      {
        sourcePlaidTransactionId: "txn-transfer-out",
        destinationPlaidTransactionId: "txn-transfer-in",
        sourcePlaidAccountId: CHECKING,
        destinationPlaidAccountId: SAVINGS,
        plaidItemId: ITEM,
        date: "2026-04-01",
        absoluteAmount: 25,
        kind: "internal_transfer",
        evidence: [
          "posted",
          "current",
          "different_transaction",
          "different_account",
          "known_account_identity",
          "same_user",
          "same_item",
          "same_date",
          "opposite_amount",
          "transfer_category_pair",
          "depository_accounts",
          "unique_counterpart",
        ],
      },
    ]);
  });

  it("accepts an exact credit-card payment", () => {
    expect(derive(cardPair())).toEqual([
      {
        sourcePlaidTransactionId: "txn-card-out",
        destinationPlaidTransactionId: "txn-card-in",
        sourcePlaidAccountId: CHECKING,
        destinationPlaidAccountId: CARD,
        plaidItemId: ITEM,
        date: "2026-04-01",
        absoluteAmount: 40,
        kind: "credit_card_payment",
        evidence: [
          "posted",
          "current",
          "different_transaction",
          "different_account",
          "known_account_identity",
          "same_user",
          "same_item",
          "same_date",
          "opposite_amount",
          "credit_payment_pair",
          "credit_and_depository_accounts",
          "unique_counterpart",
        ],
      },
    ]);
  });

  it("rejects reversed card signs", () => {
    expect(
      derive([
        observation({
          plaidTransactionId: "txn-card-positive",
          accountId: CARD,
          amount: 40,
          category: "Payment / Credit Card",
        }),
        observation({
          plaidTransactionId: "txn-bank-negative",
          accountId: CHECKING,
          amount: -40,
          category: "Payment / Credit Card",
        }),
      ])
    ).toEqual([]);
  });

  it("rejects unrelated equal purchases", () => {
    expect(
      derive([
        observation({
          plaidTransactionId: "txn-purchase-a",
          accountId: CHECKING,
          amount: 18,
          category: "Shops / Groceries",
        }),
        observation({
          plaidTransactionId: "txn-purchase-b",
          accountId: SAVINGS,
          amount: 18,
          category: "Shops / Groceries",
        }),
      ])
    ).toEqual([]);
  });

  it("rejects the same account", () => {
    expect(
      derive([
        observation({
          plaidTransactionId: "txn-same-out",
          accountId: CHECKING,
          amount: 25,
          category: "Transfer / Withdrawal",
        }),
        observation({
          plaidTransactionId: "txn-same-in",
          accountId: CHECKING,
          amount: -25,
          category: "Transfer / Deposit",
        }),
      ])
    ).toEqual([]);
  });

  it("rejects the same sign", () => {
    expect(
      derive([
        observation({
          plaidTransactionId: "txn-sign-a",
          accountId: CHECKING,
          amount: -25,
          category: "Transfer / Deposit",
        }),
        observation({
          plaidTransactionId: "txn-sign-b",
          accountId: SAVINGS,
          amount: -25,
          category: "Transfer / Deposit",
        }),
      ])
    ).toEqual([]);
  });

  it("rejects a different amount", () => {
    expect(
      derive([
        observation({
          plaidTransactionId: "txn-amount-out",
          accountId: CHECKING,
          amount: 25,
          category: "Transfer / Withdrawal",
        }),
        observation({
          plaidTransactionId: "txn-amount-in",
          accountId: SAVINGS,
          amount: -25.01,
          category: "Transfer / Deposit",
        }),
      ])
    ).toEqual([]);
  });

  it("rejects a different Plaid Item", () => {
    const rows = accounts().map((account) =>
      account.plaidAccountId === SAVINGS
        ? { ...account, plaidItemId: "item-other" }
        : account
    );
    expect(derive(transferPair(), rows)).toEqual([]);
  });

  it("rejects a different date", () => {
    expect(
      derive([
        observation({
          plaidTransactionId: "txn-date-out",
          accountId: CHECKING,
          amount: 25,
          category: "Transfer / Withdrawal",
          date: "2026-04-01",
        }),
        observation({
          plaidTransactionId: "txn-date-in",
          accountId: SAVINGS,
          amount: -25,
          category: "Transfer / Deposit",
          date: "2026-04-02",
        }),
      ])
    ).toEqual([]);
  });

  it("rejects a pending observation", () => {
    const [moneyOut, moneyIn] = transferPair();
    expect(derive([{ ...moneyOut, pending: true }, moneyIn])).toEqual([]);
  });

  it("rejects a removed observation", () => {
    const [moneyOut, moneyIn] = transferPair();
    expect(derive([moneyOut, { ...moneyIn, removed: true }])).toEqual([]);
  });

  it("rejects unknown account identity", () => {
    expect(
      derive(transferPair(), [
        {
          userId: USER,
          plaidItemId: ITEM,
          plaidAccountId: SAVINGS,
          accountType: "depository",
          subtype: "savings",
        },
      ])
    ).toEqual([]);
  });

  it("rejects a missing account type", () => {
    const rows = accounts().map((account) =>
      account.plaidAccountId === CHECKING
        ? { ...account, accountType: "" }
        : account
    );
    expect(derive(transferPair(), rows)).toEqual([]);
  });

  it("rejects duplicate account identity", () => {
    const rows = accounts();
    rows.push({
      userId: USER,
      plaidItemId: "item-other",
      plaidAccountId: CHECKING,
      accountType: "depository",
      subtype: "checking",
    });
    expect(derive(transferPair(), rows)).toEqual([]);
  });

  it("rejects a duplicate transaction id", () => {
    const [moneyOut, moneyIn] = transferPair();
    expect(
      derive([
        moneyOut,
        { ...moneyOut, amount: 25 },
        moneyIn,
      ])
    ).toEqual([]);
  });

  it("fails closed when one observation has two partners", () => {
    expect(
      derive([
        observation({
          plaidTransactionId: "txn-hub-in",
          accountId: SAVINGS,
          amount: -30,
          category: "Transfer / Deposit",
        }),
        observation({
          plaidTransactionId: "txn-hub-out-a",
          accountId: CHECKING,
          amount: 30,
          category: "Transfer / Withdrawal",
        }),
        observation({
          plaidTransactionId: "txn-hub-out-b",
          accountId: OTHER_CHECKING,
          amount: 30,
          category: "Transfer / Withdrawal",
        }),
      ])
    ).toEqual([]);
  });

  it("fails closed on a three-account same-amount collision", () => {
    expect(
      derive([
        observation({
          plaidTransactionId: "txn-three-out",
          accountId: CHECKING,
          amount: 15,
          category: "Transfer / Withdrawal",
        }),
        observation({
          plaidTransactionId: "txn-three-in-b",
          accountId: SAVINGS,
          amount: -15,
          category: "Transfer / Deposit",
        }),
        observation({
          plaidTransactionId: "txn-three-in-c",
          accountId: OTHER_CHECKING,
          amount: -15,
          category: "Transfer / Deposit",
        }),
      ])
    ).toEqual([]);
  });

  it("returns the same movements when input order changes", () => {
    const observations = [
      ...cardPair(55).map((row) => ({ ...row, date: "2026-05-02" })),
      ...transferPair(12).map((row) => ({ ...row, date: "2026-05-09" })),
      observation({
        plaidTransactionId: "txn-noise",
        accountId: CHECKING,
        amount: 4,
        category: "Shops / Groceries",
        date: "2026-05-01",
      }),
    ];
    const canonical = derive(observations);
    expect(canonical.map((movement) => movement.kind)).toEqual([
      "credit_card_payment",
      "internal_transfer",
    ]);
    expect(derive(shuffle(observations, 7), shuffle(accounts(), 11))).toEqual(
      canonical
    );
    expect(derive([...observations].reverse(), [...accounts()].reverse())).toEqual(
      canonical
    );
  });

  it("matches 10.1 with 10.10 and rejects a one-cent difference", () => {
    expect(
      derive([
        observation({
          plaidTransactionId: "txn-cents-out",
          accountId: CHECKING,
          amount: 10.1,
          category: "Transfer / Withdrawal",
        }),
        observation({
          plaidTransactionId: "txn-cents-in",
          accountId: SAVINGS,
          amount: -10.1,
          category: "Transfer / Deposit",
        }),
      ])[0]?.absoluteAmount
    ).toBe(10.1);

    expect(
      derive([
        observation({
          plaidTransactionId: "txn-cents-out",
          accountId: CHECKING,
          amount: 10.1,
          category: "Transfer / Withdrawal",
        }),
        observation({
          plaidTransactionId: "txn-cents-in",
          accountId: SAVINGS,
          amount: -Number("10.10"),
          category: "Transfer / Deposit",
        }),
      ])
    ).toHaveLength(1);

    expect(
      derive([
        observation({
          plaidTransactionId: "txn-cents-out",
          accountId: CHECKING,
          amount: 10.1,
          category: "Transfer / Withdrawal",
        }),
        observation({
          plaidTransactionId: "txn-cents-in",
          accountId: SAVINGS,
          amount: -10.11,
          category: "Transfer / Deposit",
        }),
      ])
    ).toEqual([]);
  });

  it("keeps isProcessed outside the input contract", () => {
    type ObservationKey = keyof CorrelatedMovementObservation;
    type ProcessedIncluded = "isProcessed" extends ObservationKey ? true : false;
    const processedIsNotAnInput: ProcessedIncluded = false;
    expect(processedIsNotAnInput).toBe(false);

    const [moneyOut, moneyIn] = transferPair();
    const flagged: CorrelatedMovementObservation & { isProcessed?: boolean } = {
      ...moneyOut,
      isProcessed: true,
    };
    const clean = derive([moneyOut, moneyIn]);
    expect(derive([flagged, { ...moneyIn, isProcessed: false }])).toEqual(clean);

    const source = readFileSync(
      resolve(process.cwd(), "lib/babylon/correlated-internal-movement.ts"),
      "utf8"
    );
    expect(source).not.toContain("isProcessed");
    expect(source).not.toMatch(/from ["']@\/lib\/supabase/);
    expect(source).not.toMatch(/from ["']react/);
    expect(source).not.toContain("localStorage");
    expect(source).not.toContain("plaid-server");
    expect(source).not.toContain("wealth_engine_vaults");
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
        if (fullPath.endsWith("correlated-internal-movement.ts")) continue;
        if (fullPath.endsWith("correlated-internal-movement.test.ts")) continue;
        const text = readFileSync(fullPath, "utf8");
        if (text.includes("correlated-internal-movement")) {
          offenders.push(fullPath);
        }
      }
    };
    for (const root of roots) visit(root);
    expect(offenders).toEqual([]);
  });

  it("matches the synthetic production shape without private data", () => {
    const observations: CorrelatedMovementObservation[] = [];

    for (let index = 0; index < 24; index += 1) {
      const amount = 10 + index;
      observations.push(
        observation({
          plaidTransactionId: `txn-transfer-out-${index}`,
          accountId: CHECKING,
          amount,
          category: "Transfer / Withdrawal",
          date: "2026-03-01",
        }),
        observation({
          plaidTransactionId: `txn-transfer-in-${index}`,
          accountId: SAVINGS,
          amount: -amount,
          category: "Transfer / Deposit",
          date: "2026-03-01",
        })
      );
    }

    for (let index = 0; index < 23; index += 1) {
      const amount = 80 + index;
      observations.push(
        observation({
          plaidTransactionId: `txn-card-out-${index}`,
          accountId: CHECKING,
          amount,
          category: "Payment / Credit Card",
          date: "2026-03-02",
        }),
        observation({
          plaidTransactionId: `txn-card-in-${index}`,
          accountId: CARD,
          amount: -amount,
          category: "Payment / Credit Card",
          date: "2026-03-02",
        })
      );
    }

    for (let index = 0; index < 4; index += 1) {
      const amount = 400 + index;
      observations.push(
        observation({
          plaidTransactionId: `txn-pending-out-${index}`,
          accountId: CHECKING,
          amount,
          category: "Transfer / Withdrawal",
          date: "2026-03-03",
          pending: true,
        }),
        observation({
          plaidTransactionId: `txn-pending-partner-${index}`,
          accountId: SAVINGS,
          amount: -amount,
          category: "Transfer / Deposit",
          date: "2026-03-03",
        })
      );
    }

    const noiseCount = 339 - observations.length;
    for (let index = 0; index < noiseCount; index += 1) {
      observations.push(
        observation({
          plaidTransactionId: `txn-noise-${index}`,
          accountId: CHECKING,
          amount: 1000 + index,
          category: "Shops / Groceries",
          date: "2026-08-15",
        })
      );
    }

    expect(observations).toHaveLength(339);
    expect(observations.filter((row) => row.pending)).toHaveLength(4);

    const movements = derive(shuffle(observations, 42), shuffle(accounts(), 9));
    const ids = participatingIds(movements);
    expect(movements).toHaveLength(47);
    expect(new Set(ids).size).toBe(94);
    expect(ids).toHaveLength(94);
    expect(movements.filter((movement) => movement.kind === "internal_transfer")).toHaveLength(
      24
    );
    expect(movements.filter((movement) => movement.kind === "credit_card_payment")).toHaveLength(
      23
    );
    expect(ids.some((id) => id.startsWith("txn-pending-"))).toBe(false);
    expect(ids.some((id) => id.startsWith("txn-noise-"))).toBe(false);
  });
});
