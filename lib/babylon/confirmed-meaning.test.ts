import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  confirmObservationMeaning,
  currentConfirmation,
  isTeachableObservation,
  revokeObservationMeaning,
  signedCentsFromAmount,
  toObservationConfirmation,
  type ConfirmableObservation,
  type ObservationConfirmation,
} from "@/lib/babylon/confirmed-meaning";
import { CLOUD_VAULT_SCHEMA_VERSION } from "@/lib/babylon/cloud-vault";
import { EMPTY_STATE } from "@/lib/babylon/constants";
import { assembleIntelligenceContract } from "@/lib/babylon/intelligence-contract";
import { LEDGER_BACKUP_VERSION } from "@/lib/babylon/persistence";
import type { BudgetTarget, ExpenseEntry } from "@/types/babylon";

const OWNER = "owner-a";
const OTHER = "owner-b";
const NOW = "2026-09-26T12:00:00.000Z";
const LATER = "2026-09-27T12:00:00.000Z";

function observation(
  partial: Partial<ConfirmableObservation> = {}
): ConfirmableObservation {
  return {
    userId: OWNER,
    plaidTransactionId: "txn-posted",
    pendingTransactionId: null,
    accountId: "acct-checking",
    amount: 200,
    name: "VENMO",
    category: "Transfer",
    date: "2026-09-20",
    pending: false,
    removedAt: null,
    isProcessed: false,
    ...partial,
  };
}

function category(
  id = "cat-groceries",
  categoryName = "Groceries",
  plannedAmount = 400
): BudgetTarget {
  return { id, categoryName, plannedAmount, isEssential: true };
}

function confirm(
  obs: ConfirmableObservation | null,
  target: BudgetTarget | null,
  confirmations: readonly ObservationConfirmation[] = [],
  now = NOW,
  nextId = "conf-1"
) {
  return confirmObservationMeaning({
    actorUserId: obs?.userId === OTHER ? OWNER : (obs?.userId ?? OWNER),
    observation: obs,
    budgetTarget: target,
    confirmations,
    now,
    nextId,
  });
}

describe("confirmed meaning", () => {
  it("confirms a current posted observation as an existing budget category", () => {
    const groceries = category();
    const expense: ExpenseEntry = {
      id: "expense-1",
      name: "Store",
      category: "need",
      amount: 12,
      date: "2026-09-01",
      dueDate: "2026-09-01",
      budgetCategoryId: groceries.id,
      isSettled: false,
    };
    const beforeExpense = { ...expense };
    const beforeCap = groceries.plannedAmount;
    const obs = observation();

    const result = confirm(obs, groceries);

    expect(result.status).toBe("confirmed");
    if (result.status !== "confirmed") return;
    const current = currentConfirmation(result.confirmations, OWNER, obs.plaidTransactionId);
    expect(current).toMatchObject({
      budgetTargetId: groceries.id,
      categoryName: "Groceries",
      signedCents: 20000,
      postedDate: "2026-09-20",
      transactionName: "VENMO",
      categoryText: "Transfer",
      accountId: "acct-checking",
      pending: false,
      confirmedAt: NOW,
      state: "current",
    });
    expect(signedCentsFromAmount(obs.amount)).toBe(20000);
    expect(obs.isProcessed).toBe(false);
    expect(expense).toEqual(beforeExpense);
    expect(groceries.plannedAmount).toBe(beforeCap);
    expect(result.confirmations).toHaveLength(1);
  });

  it("rejects pending and removed observations", () => {
    const pending = confirm(observation({ pending: true }), category());
    const removed = confirm(
      observation({ removedAt: "2026-09-21T00:00:00.000Z" }),
      category()
    );
    expect(pending).toMatchObject({ status: "rejected", reason: "not_teachable" });
    expect(removed).toMatchObject({ status: "rejected", reason: "not_teachable" });
    expect(pending.status === "rejected" && pending.confirmations).toEqual([]);
    expect(removed.status === "rejected" && removed.confirmations).toEqual([]);
    expect(isTeachableObservation({ pending: true, removedAt: null })).toBe(false);
    expect(isTeachableObservation({ pending: false, removedAt: "x" })).toBe(false);
  });

  it("supersedes a different category and keeps the first snapshot", () => {
    const obs = observation();
    const first = confirm(obs, category());
    if (first.status !== "confirmed") throw new Error(first.status);
    const original = first.confirmations[0];
    const changed = observation({ amount: 50, name: "VENMO *STORE", category: "Shops", date: "2026-09-22" });
    const second = confirmObservationMeaning({
      actorUserId: OWNER,
      observation: changed,
      budgetTarget: category("cat-family", "Family Support", 100),
      confirmations: first.confirmations,
      now: LATER,
      nextId: "conf-2",
    });

    expect(second.status).toBe("superseded");
    if (second.status !== "superseded") return;
    const prior = second.confirmations.find((row) => row.id === "conf-1");
    const current = currentConfirmation(second.confirmations, OWNER, obs.plaidTransactionId);
    expect(prior).toEqual({ ...original, state: "superseded" });
    expect(current).toMatchObject({
      id: "conf-2",
      budgetTargetId: "cat-family",
      categoryName: "Family Support",
      signedCents: 5000,
      transactionName: "VENMO *STORE",
      categoryText: "Shops",
      postedDate: "2026-09-22",
      state: "current",
    });
    expect(second.confirmations.filter((row) => row.state === "current")).toHaveLength(1);
  });

  it("does not rewrite a snapshot when the observation later changes or is removed", () => {
    const obs = observation();
    const first = confirm(obs, category());
    if (first.status !== "confirmed") throw new Error(first.status);
    const snapshot = { ...first.confirmations[0] };
    obs.amount = 10;
    obs.name = "OTHER";
    obs.category = "Food";
    obs.date = "2026-09-25";
    obs.removedAt = "2026-09-26T00:00:00.000Z";

    expect(first.confirmations[0]).toEqual(snapshot);
    const again = confirm(
      obs,
      category("cat-family", "Family Support"),
      first.confirmations
    );
    expect(again.status).toBe("rejected");
    if (again.status !== "rejected") return;
    expect(again.confirmations).toEqual([snapshot]);
  });

  it("revokes the current confirmation and keeps history", () => {
    const first = confirm(observation(), category());
    if (first.status !== "confirmed") throw new Error(first.status);
    const superseded = confirmObservationMeaning({
      actorUserId: OWNER,
      observation: observation(),
      budgetTarget: category("cat-family", "Family Support"),
      confirmations: first.confirmations,
      now: LATER,
      nextId: "conf-2",
    });
    if (superseded.status !== "superseded") throw new Error(superseded.status);
    const revoked = revokeObservationMeaning({
      actorUserId: OWNER,
      plaidTransactionId: "txn-posted",
      confirmations: superseded.confirmations,
    });

    expect(revoked.status).toBe("revoked");
    if (revoked.status !== "revoked") return;
    expect(currentConfirmation(revoked.confirmations, OWNER, "txn-posted")).toBeNull();
    expect(revoked.confirmations.map((row) => row.state).sort()).toEqual([
      "revoked",
      "superseded",
    ]);
    expect(revoked.confirmations.find((row) => row.id === "conf-1")).toMatchObject({
      categoryName: "Groceries",
      signedCents: 20000,
      state: "superseded",
    });
    expect(revoked.confirmations.find((row) => row.id === "conf-2")).toMatchObject({
      categoryName: "Family Support",
      state: "revoked",
    });
  });

  it("does not move a pending confirmation onto the posted observation", () => {
    const pendingRow: ObservationConfirmation = {
      id: "conf-pending",
      userId: OWNER,
      plaidTransactionId: "txn-pending",
      budgetTargetId: "cat-groceries",
      categoryName: "Groceries",
      signedCents: 20000,
      postedDate: "2026-09-20",
      transactionName: "VENMO",
      categoryText: "Transfer",
      accountId: "acct-checking",
      pending: false,
      confirmedAt: NOW,
      state: "current",
    };
    const posted = observation({
      plaidTransactionId: "txn-posted",
      pendingTransactionId: "txn-pending",
    });
    expect(currentConfirmation([pendingRow], OWNER, posted.plaidTransactionId)).toBeNull();

    const result = confirmObservationMeaning({
      actorUserId: OWNER,
      observation: posted,
      budgetTarget: category("cat-family", "Family Support"),
      confirmations: [pendingRow],
      now: LATER,
      nextId: "conf-posted",
    });
    expect(result.status).toBe("confirmed");
    if (result.status !== "confirmed") return;
    expect(currentConfirmation(result.confirmations, OWNER, "txn-pending")).toEqual(
      pendingRow
    );
    expect(currentConfirmation(result.confirmations, OWNER, "txn-posted")).toMatchObject({
      budgetTargetId: "cat-family",
      categoryName: "Family Support",
    });
  });

  it("keeps the category snapshot when the live category is renamed or deleted", () => {
    const groceries = category();
    const first = confirm(observation(), groceries);
    if (first.status !== "confirmed") throw new Error(first.status);
    groceries.categoryName = "Household food";
    const renamed = first.confirmations[0];
    expect(renamed?.categoryName).toBe("Groceries");

    const deleted = confirmObservationMeaning({
      actorUserId: OWNER,
      observation: observation(),
      budgetTarget: null,
      confirmations: first.confirmations,
      now: LATER,
      nextId: "conf-2",
    });
    expect(deleted.status).toBe("rejected");
    if (deleted.status !== "rejected") return;
    expect(deleted.reason).toBe("unknown_category");
    expect(deleted.confirmations).toEqual(first.confirmations);
    expect(deleted.confirmations[0]?.budgetTargetId).toBe("cat-groceries");
  });

  it("rejects another owner's observation and leaves their confirmation untouched", () => {
    const foreign = observation({ userId: OTHER, plaidTransactionId: "txn-foreign" });
    const rejected = confirmObservationMeaning({
      actorUserId: OWNER,
      observation: foreign,
      budgetTarget: category(),
      confirmations: [],
      now: NOW,
      nextId: "conf-foreign",
    });
    expect(rejected).toMatchObject({ status: "rejected", reason: "not_owner" });

    const theirs: ObservationConfirmation = {
      id: "conf-theirs",
      userId: OTHER,
      plaidTransactionId: "txn-foreign",
      budgetTargetId: "cat-groceries",
      categoryName: "Groceries",
      signedCents: 20000,
      postedDate: "2026-09-20",
      transactionName: "VENMO",
      categoryText: null,
      accountId: "acct-checking",
      pending: false,
      confirmedAt: NOW,
      state: "current",
    };
    expect(currentConfirmation([theirs], OWNER, "txn-foreign")).toBeNull();
    const revoked = revokeObservationMeaning({
      actorUserId: OWNER,
      plaidTransactionId: "txn-foreign",
      confirmations: [theirs],
    });
    expect(revoked.status).toBe("absent");
    if (revoked.status !== "absent") return;
    expect(revoked.confirmations[0]).toEqual(theirs);
  });

  it("does not enter the intelligence contract", () => {
    const contract = assembleIntelligenceContract({
      state: EMPTY_STATE,
      ianaTimeZone: "America/Boise",
      now: new Date("2026-09-26T18:00:00.000Z"),
      generatedAt: "2026-09-26T18:00:00.000Z",
      balanceEvidence: {
        status: "ready",
        plaidAccounts: [],
        observations: [],
        associations: [],
      },
    });
    const serialized = JSON.stringify(contract);
    expect(contract.meta.contract_version).toBe("4");
    expect(serialized).not.toContain("plaid_observation_confirmations");
    expect(serialized).not.toContain("confirmed_meaning");
    expect(serialized).toContain("plaid_is_not_vault_truth");
    expect(serialized).toContain("internal_observational_reasoners_excluded");

    const source = readFileSync("lib/babylon/intelligence-contract.ts", "utf8");
    expect(source).not.toContain("confirmed-meaning");
    expect(source).not.toContain("plaid_observation_confirmations");
  });

  it("maps a stored confirmation and drops an unreadable row", () => {
    expect(
      toObservationConfirmation({
        id: "conf-1",
        user_id: OWNER,
        plaid_transaction_id: "txn-posted",
        budget_target_id: "cat-groceries",
        category_name: "Groceries",
        signed_cents: "20000",
        posted_date: "2026-09-20",
        transaction_name: "VENMO",
        category_text: null,
        account_id: "acct-checking",
        pending: false,
        confirmed_at: NOW,
        state: "current",
      })?.signedCents
    ).toBe(20000);
    expect(
      toObservationConfirmation({
        id: "conf-1",
        user_id: OWNER,
        plaid_transaction_id: "txn-posted",
        budget_target_id: "cat-groceries",
        category_name: "Groceries",
        signed_cents: 20000,
        posted_date: "2026-09-20",
        transaction_name: "VENMO",
        category_text: null,
        account_id: "acct-checking",
        pending: false,
        confirmed_at: NOW,
        state: "guessed",
      })
    ).toBeNull();
  });
});

describe("confirmed meaning boundaries", () => {
  const migration = readFileSync(
    "supabase/migrations/20261001_plaid_confirmed_meaning.sql",
    "utf8"
  );
  const client = readFileSync("lib/babylon/plaid-client.ts", "utf8");
  const meaning = readFileSync("lib/babylon/confirmed-meaning.ts", "utf8");
  const teaching = readFileSync(
    "components/babylon/observation-teaching.tsx",
    "utf8"
  );
  const attention = readFileSync("lib/babylon/attention.ts", "utf8");
  const notifications = readFileSync(
    "lib/babylon/notification-delivery.ts",
    "utf8"
  );

  it("keeps the database writer owner-scoped and snapshot-stable", () => {
    expect(migration).toContain("auth.uid()");
    expect(migration).toContain("SECURITY DEFINER");
    expect(migration).toContain("SET search_path = public");
    expect(migration).toContain("WHERE state = 'current'");
    expect(migration).toContain("SET state = 'superseded'");
    expect(migration).toContain("SET state = 'revoked'");
    expect(migration).toContain("ROUND(obs.amount * 100)::integer");
    expect(migration).toContain("elem->>'categoryName'");
    expect(migration).toContain("GRANT SELECT ON TABLE public.plaid_observation_confirmations TO authenticated");
    expect(migration).toContain("GRANT EXECUTE ON FUNCTION public.confirm_plaid_observation(text, text) TO authenticated");
    expect(migration).toContain("REVOKE ALL ON FUNCTION public.confirm_plaid_observation(text, text) FROM PUBLIC, anon");
    expect(migration).not.toContain("access_token");
    expect(migration).not.toContain("is_processed");
    expect(migration).not.toContain("UPDATE public.plaid_transactions");
    expect(migration).not.toContain("UPDATE public.wealth_engine_vaults");
    expect(migration).not.toContain("GRANT INSERT");
    expect(migration).not.toContain("GRANT UPDATE");
    expect(migration).not.toContain("pending_transaction_id");
    expect(CLOUD_VAULT_SCHEMA_VERSION).toBe(6);
    expect(LEDGER_BACKUP_VERSION).toBe(13);
  });

  it("sends no owner id and does not teach from the ledger or attention", () => {
    const confirmFn = client.slice(
      client.indexOf("export async function confirmPlaidObservationMeaning"),
      client.indexOf("export async function revokePlaidObservationMeaning")
    );
    expect(confirmFn).toContain("confirm_plaid_observation");
    expect(confirmFn).toContain("target_plaid_transaction_id");
    expect(confirmFn).toContain("target_budget_id");
    expect(confirmFn).not.toContain("user_id");
    expect(confirmFn).not.toContain("category_name");
    expect(client).toContain("listTeachablePlaidObservations");
    expect(client).toContain("revoke_plaid_observation_confirmation");
    expect(meaning).not.toContain("is_processed");
    expect(meaning).not.toContain("ExpenseEntry");
    expect(meaning).not.toContain("allocateIncome");
    expect(teaching).toContain("Teach a transaction");
    expect(teaching).toContain("Meaning unknown");
    expect(teaching).not.toContain("accountId");
    expect(teaching).not.toContain("deriveDueAttention");
    expect(teaching).not.toContain("is_processed");
    expect(attention).not.toContain("confirmed-meaning");
    expect(attention).not.toContain("ObservationTeaching");
    expect(notifications).not.toContain("confirmed-meaning");
    expect(readFileSync("components/babylon/mobile-home.tsx", "utf8")).not.toContain(
      "ObservationTeaching"
    );
    expect(readFileSync("components/babylon/mobile-ledger.tsx", "utf8")).not.toContain(
      "ObservationTeaching"
    );
    expect(readFileSync("components/babylon/upcoming-needs.tsx", "utf8")).not.toContain(
      "ObservationTeaching"
    );
    expect(readFileSync("components/babylon/mobile-more.tsx", "utf8")).toContain(
      "ObservationTeaching"
    );
    expect(
      readFileSync("components/babylon/wealth-engine-dashboard.tsx", "utf8")
    ).toContain("ObservationTeaching");
    expect(
      readFileSync("components/babylon/wealth-engine-dashboard.tsx", "utf8")
    ).not.toContain("listPlaidObservations");
  });
});
