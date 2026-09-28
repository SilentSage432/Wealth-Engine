import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  deriveBalanceObservationLoad,
  operationalAccountPosition,
  operationalMoneyAvailable,
  presentAccountObservation,
  type BalanceEvidenceRead,
  type BalanceObservationEvidence,
  type BalanceObservationLoad,
} from "@/lib/babylon/balance-evidence-load";
import { describeAccountBalance } from "@/lib/babylon/balance-observation";
import {
  listAccountAssociations,
  listCurrentBalanceObservations,
  listPlaidAccounts,
} from "@/lib/babylon/plaid-client";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import type { FinancialAccount } from "@/types/babylon";

vi.mock("@/lib/supabase/client", () => ({
  getSupabaseBrowserClient: vi.fn(),
}));

const AT = "2026-09-27T08:14:00.000Z";

const checking: FinancialAccount = {
  id: "acct-checking",
  name: "Everyday",
  kind: "checking",
  balance: 80,
  asOf: "2026-09-01",
};

const cash: FinancialAccount = {
  id: "acct-cash",
  name: "Wallet",
  kind: "cash",
  balance: 15,
  asOf: "2026-09-01",
};

function success<T>(data: T): BalanceEvidenceRead<T> {
  return { status: "success", data };
}

function emptyEvidence(): BalanceObservationEvidence {
  return { plaidAccounts: [], observations: [], associations: [] };
}

function linkedEvidence(): BalanceObservationEvidence {
  return {
    plaidAccounts: [
      {
        id: "pa-1",
        userId: "user-1",
        plaidItemId: "item-1",
        plaidAccountId: "plaid-checking",
        name: "Checking",
        mask: "1234",
        accountType: "depository",
        subtype: "checking",
      },
    ],
    observations: [
      {
        id: "obs-checking",
        userId: "user-1",
        plaidAccountId: "plaid-checking",
        currentCents: 9_000,
        availableCents: 8_000,
        isoCurrencyCode: "USD",
        unofficialCurrencyCode: null,
        observedAt: AT,
        source: "accounts_get",
      },
    ],
    associations: [
      {
        id: "assoc-1",
        userId: "user-1",
        financialAccountId: checking.id,
        plaidAccountId: "plaid-checking",
        confirmedAt: AT,
      },
    ],
  };
}

function derive(input: {
  enabled?: boolean;
  accounts?: BalanceEvidenceRead<BalanceObservationEvidence["plaidAccounts"]>;
  observations?: BalanceEvidenceRead<BalanceObservationEvidence["observations"]>;
  associations?: BalanceEvidenceRead<BalanceObservationEvidence["associations"]>;
  retained?: BalanceObservationEvidence | null;
}) {
  return deriveBalanceObservationLoad({
    enabled: input.enabled ?? true,
    accounts: input.accounts ?? { status: "pending" },
    observations: input.observations ?? { status: "pending" },
    associations: input.associations ?? { status: "pending" },
    retained: input.retained ?? null,
  });
}

function queryClient(result: { data: unknown[] | null; error: { message: string } | null }) {
  const chain = {
    select: () => chain,
    eq: () => chain,
    order: () => chain,
    then: (
      onFulfilled?: (value: typeof result) => unknown,
      onRejected?: (reason: unknown) => unknown
    ) => Promise.resolve(result).then(onFulfilled, onRejected),
  };
  return { from: () => chain };
}

describe("balance evidence load", () => {
  it("is ready when all three reads succeed with evidence", () => {
    const evidence = linkedEvidence();
    const derived = derive({
      accounts: success(evidence.plaidAccounts),
      observations: success(evidence.observations),
      associations: success(evidence.associations),
    });
    expect(derived.load).toEqual({ status: "ready", evidence });
    expect(derived.retained).toEqual(evidence);
    expect(presentAccountObservation({ account: checking, load: derived.load }).status).toBe(
      "ready"
    );
  });

  it("is ready when all three reads succeed with no rows", () => {
    const evidence = emptyEvidence();
    const derived = derive({
      accounts: success(evidence.plaidAccounts),
      observations: success(evidence.observations),
      associations: success(evidence.associations),
    });
    expect(derived.load.status).toBe("ready");
    if (derived.load.status !== "ready") return;
    expect(derived.load.evidence).toEqual(evidence);
    const presented = presentAccountObservation({ account: checking, load: derived.load });
    expect(presented.status).toBe("ready");
    expect(
      describeAccountBalance({
        account: checking,
        associatedPlaidAccountId: null,
        accountType: null,
        subtype: null,
        observation: null,
      }).status
    ).toBe("unlinked");
  });

  it("is unavailable when the observation read fails", () => {
    const derived = derive({
      accounts: success([]),
      observations: { status: "error" },
      associations: success([]),
    });
    expect(derived.load).toEqual({ status: "unavailable", evidence: null });
    const presented = presentAccountObservation({ account: checking, load: derived.load });
    expect(presented).toEqual({
      status: "unavailable",
      observedAt: null,
      currentCents: null,
    });
  });

  it("is unavailable when the association read fails", () => {
    const derived = derive({
      accounts: success(linkedEvidence().plaidAccounts),
      observations: success(linkedEvidence().observations),
      associations: { status: "error" },
    });
    expect(derived.load.status).toBe("unavailable");
    const presented = presentAccountObservation({ account: checking, load: derived.load });
    expect(presented.status).toBe("unavailable");
    expect(presented).not.toHaveProperty("view");
  });

  it("is unavailable when the Plaid account read fails", () => {
    const derived = derive({
      accounts: { status: "error" },
      observations: success([]),
      associations: success([]),
    });
    expect(derived.load).toEqual({ status: "unavailable", evidence: null });
  });

  it("keeps a first-load failure free of fabricated evidence", () => {
    const derived = derive({
      accounts: { status: "error" },
      observations: { status: "error" },
      associations: { status: "error" },
      retained: null,
    });
    expect(derived).toEqual({
      load: { status: "unavailable", evidence: null },
      retained: null,
    });
    expect(operationalMoneyAvailable({ accounts: [checking], load: derived.load })).toBe(80);
  });

  it("keeps the last successful evidence when a later refresh fails", () => {
    const evidence = linkedEvidence();
    const first = derive({
      accounts: success(evidence.plaidAccounts),
      observations: success(evidence.observations),
      associations: success(evidence.associations),
    });
    const second = derive({
      accounts: success(evidence.plaidAccounts),
      observations: { status: "error" },
      associations: success(evidence.associations),
      retained: first.retained,
    });
    expect(second.load).toEqual({ status: "unavailable", evidence });
    expect(second.retained).toBe(first.retained);
    expect(second.retained?.observations).not.toEqual([]);
    const presented = presentAccountObservation({ account: checking, load: second.load });
    expect(presented).toEqual({
      status: "unavailable",
      observedAt: AT,
      currentCents: 9_000,
    });
    expect(operationalMoneyAvailable({ accounts: [checking], load: second.load })).toBe(90);
    expect(operationalAccountPosition({ account: checking, load: second.load })).toMatchObject({
      source: "observed",
      balance: 90,
      observedAt: AT,
      currentCents: 9_000,
    });
  });

  it("replaces retained evidence when a later read succeeds empty", () => {
    const evidence = linkedEvidence();
    const first = derive({
      accounts: success(evidence.plaidAccounts),
      observations: success(evidence.observations),
      associations: success(evidence.associations),
    });
    const empty = emptyEvidence();
    const second = derive({
      accounts: success(empty.plaidAccounts),
      observations: success(empty.observations),
      associations: success(empty.associations),
      retained: first.retained,
    });
    expect(second.load).toEqual({ status: "ready", evidence: empty });
    expect(second.retained).toEqual(empty);
    expect(operationalMoneyAvailable({ accounts: [checking], load: second.load })).toBe(80);
  });

  it("becomes ready when a failed read is followed by success", () => {
    const failed = derive({
      accounts: { status: "error" },
      observations: { status: "error" },
      associations: { status: "error" },
    });
    expect(failed.load.status).toBe("unavailable");
    const evidence = linkedEvidence();
    const recovered = derive({
      accounts: success(evidence.plaidAccounts),
      observations: success(evidence.observations),
      associations: success(evidence.associations),
      retained: failed.retained,
    });
    expect(recovered.load).toEqual({ status: "ready", evidence });
    expect(operationalMoneyAvailable({ accounts: [checking], load: recovered.load })).toBe(90);
    expect(operationalAccountPosition({ account: checking, load: recovered.load })).toMatchObject({
      source: "observed",
      observedAt: AT,
    });
  });

  it("hides observation UI while loading or signed out, including cash", () => {
    expect(derive({ enabled: false }).load).toEqual({ status: "disabled" });
    expect(
      presentAccountObservation({
        account: checking,
        load: { status: "loading" },
      }).status
    ).toBe("hidden");
    expect(
      presentAccountObservation({
        account: cash,
        load: { status: "unavailable", evidence: null },
      }).status
    ).toBe("hidden");
  });

  it("wires operational position and keeps association controls", () => {
    const engine = readFileSync(
      resolve(process.cwd(), "hooks/useBabylonEngine.ts"),
      "utf8"
    );
    const contract = readFileSync(
      resolve(process.cwd(), "lib/babylon/intelligence-contract.ts"),
      "utf8"
    );
    const position = readFileSync(
      resolve(process.cwd(), "components/babylon/financial-position.tsx"),
      "utf8"
    );
    const home = readFileSync(
      resolve(process.cwd(), "components/babylon/mobile-home.tsx"),
      "utf8"
    );
    const load = readFileSync(
      resolve(process.cwd(), "lib/babylon/balance-evidence-load.ts"),
      "utf8"
    );
    expect(engine).toContain("operationalMoneyAvailable");
    expect(engine).not.toContain("sumAccountBalances(accounts)");
    expect(engine).not.toContain("acceptObservedBalance");
    expect(contract).toContain('INTELLIGENCE_CONTRACT_VERSION = "3"');
    expect(contract).not.toContain("balances_are_manual");
    expect(contract).not.toContain("no_reconciliation");
    expect(contract).toContain("plaid_is_not_vault_truth");
    expect(contract).toContain("balance_change_cause_unknown");
    expect(position).toContain("operationalAccountPosition");
    expect(position).toContain("describeAccountEvidenceLine");
    expect(position).toContain("describeMoneyAvailableEvidence");
    expect(position).not.toContain("Update balance");
    expect(position).not.toContain("observedBalanceUpdate");
    expect(position).toContain("Associate");
    expect(position).toContain("Remove link");
    expect(position).toContain("Edit Account");
    expect(home).not.toContain("Update balance");
    expect(home).not.toContain("Balances you entered");
    expect(position).toContain("BALANCE_EVIDENCE_UNAVAILABLE_LABEL");
    expect(load).toContain("Balance evidence unavailable");
    expect(position).toContain("No unlinked checking or savings account is available.");
    expect(position).toContain("Observed balance is unknown.");
  });
});

describe("balance evidence readers", () => {
  beforeEach(() => {
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.mocked(console.error).mockRestore();
    vi.mocked(getSupabaseBrowserClient).mockReset();
  });

  it("returns an empty list when the observation read succeeds with no rows", async () => {
    vi.mocked(getSupabaseBrowserClient).mockReturnValue(
      queryClient({ data: [], error: null }) as never
    );
    await expect(listCurrentBalanceObservations()).resolves.toEqual([]);
    expect(console.error).not.toHaveBeenCalled();
  });

  it("returns usable observations and drops a rejected row without failing the read", async () => {
    vi.mocked(getSupabaseBrowserClient).mockReturnValue(
      queryClient({
        data: [
          {
            id: "obs-old",
            user_id: "user-1",
            plaid_account_id: "plaid-checking",
            current_cents: 5_000,
            available_cents: null,
            iso_currency_code: "USD",
            unofficial_currency_code: null,
            observed_at: AT,
            source: "accounts_get",
            state: "superseded",
          },
          {
            id: "obs-checking",
            user_id: "user-1",
            plaid_account_id: "plaid-checking",
            current_cents: 9_000,
            available_cents: 8_000,
            iso_currency_code: "USD",
            unofficial_currency_code: null,
            observed_at: AT,
            source: "accounts_get",
            state: "current",
          },
        ],
        error: null,
      }) as never
    );
    const rows = await listCurrentBalanceObservations();
    expect(rows).toEqual([
      expect.objectContaining({
        id: "obs-checking",
        currentCents: 9_000,
        observedAt: AT,
        source: "accounts_get",
      }),
    ]);
    const load: BalanceObservationLoad = derive({
      accounts: success([]),
      observations: success(rows),
      associations: success([]),
    }).load;
    expect(load.status).toBe("ready");
  });

  it("throws when the observation read fails, without logging the balance", async () => {
    vi.mocked(getSupabaseBrowserClient).mockReturnValue(
      queryClient({
        data: null,
        error: { message: "current_cents 184726" },
      }) as never
    );
    await expect(listCurrentBalanceObservations()).rejects.toThrow(
      "[plaid] list balance observations failed."
    );
    expect(console.error).toHaveBeenCalledTimes(1);
    expect(console.error).toHaveBeenCalledWith("[plaid] list balance observations failed.");
    expect(JSON.stringify(vi.mocked(console.error).mock.calls)).not.toContain("184726");
  });

  it("throws when the Supabase client is missing", async () => {
    vi.mocked(getSupabaseBrowserClient).mockReturnValue(null);
    await expect(listPlaidAccounts()).rejects.toThrow("[plaid] list accounts failed.");
    await expect(listAccountAssociations()).rejects.toThrow(
      "[plaid] list account associations failed."
    );
  });

  it("throws when an evidence query crashes", async () => {
    vi.mocked(getSupabaseBrowserClient).mockReturnValue({
      from: () => {
        throw new Error("network down");
      },
    } as never);
    await expect(listAccountAssociations()).rejects.toThrow(
      "[plaid] list account associations failed."
    );
    await expect(listPlaidAccounts()).rejects.toThrow("[plaid] list accounts failed.");
  });

  it("returns account and association rows when those reads succeed", async () => {
    vi.mocked(getSupabaseBrowserClient).mockReturnValue(
      queryClient({
        data: [
          {
            id: "pa-1",
            user_id: "user-1",
            plaid_item_id: "item-1",
            plaid_account_id: "plaid-checking",
            name: "Checking",
            mask: "1234",
            account_type: "depository",
            subtype: "checking",
          },
        ],
        error: null,
      }) as never
    );
    await expect(listPlaidAccounts()).resolves.toEqual([
      expect.objectContaining({ plaidAccountId: "plaid-checking", accountType: "depository" }),
    ]);

    vi.mocked(getSupabaseBrowserClient).mockReturnValue(
      queryClient({
        data: [
          {
            id: "assoc-1",
            user_id: "user-1",
            financial_account_id: "",
            plaid_account_id: "plaid-checking",
            confirmed_at: AT,
          },
          {
            id: "assoc-2",
            user_id: "user-1",
            financial_account_id: "acct-checking",
            plaid_account_id: "plaid-checking",
            confirmed_at: AT,
          },
        ],
        error: null,
      }) as never
    );
    const associations = await listAccountAssociations();
    expect(associations).toEqual([
      expect.objectContaining({ financialAccountId: "acct-checking" }),
    ]);
    expect(
      derive({
        accounts: success([]),
        observations: success([]),
        associations: success(associations),
      }).load.status
    ).toBe("ready");
  });
});
