"use client";

import {
  ACCOUNT_ASSOCIATION_COLUMNS,
  BALANCE_OBSERVATION_COLUMNS,
  toAccountAssociationPublic,
  toBalanceObservationPublic,
  type AccountAssociationPublic,
  type BalanceObservationPublic,
} from "@/lib/babylon/balance-observation";
import {
  isTeachableObservation,
  PLAID_CONFIRMATION_COLUMNS,
  toObservationConfirmation,
  type ObservationConfirmation,
} from "@/lib/babylon/confirmed-meaning";
import { plaidUserMessage } from "@/lib/babylon/plaid-errors";
import {
  isPlaidClientConfigured,
  PLAID_ACCOUNT_PUBLIC_COLUMNS,
  PLAID_ITEM_PUBLIC_COLUMNS,
  PLAID_OBSERVATION_COLUMNS,
  toPlaidAccountPublic,
  toPlaidItemPublic,
  toPlaidObservationPublic,
  type PlaidAccountPublic,
  type PlaidItemPublic,
  type PlaidObservationPublic,
} from "@/lib/babylon/plaid-schema";
import { emitVaultToast } from "@/lib/babylon/vault-toast";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";

type ApiErrorBody = { error?: string; code?: string };

type PlaidApiFetchOptions = {
  /** Link and exchange announce failures. Foreground observation sync stays quiet. */
  announceError?: boolean;
};

async function authBearer(): Promise<string | null> {
  const supabase = getSupabaseBrowserClient();
  if (!supabase) return null;
  const { data } = await supabase.auth.getSession();
  return data.session?.access_token ?? null;
}

async function plaidApiFetch<T>(
  path: string,
  init?: RequestInit,
  options?: PlaidApiFetchOptions
): Promise<{ ok: true; data: T } | { ok: false }> {
  const announceError = options?.announceError !== false;
  try {
    const token = await authBearer();
    if (!token) {
      if (announceError) {
        emitVaultToast({
          tone: "error",
          message: plaidUserMessage("unauthorized"),
        });
      }
      return { ok: false };
    }

    const res = await fetch(path, {
      ...init,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
        ...(init?.headers ?? {}),
      },
    });

    const body = (await res.json().catch(() => ({}))) as T & ApiErrorBody;

    if (!res.ok) {
      if (announceError) {
        emitVaultToast({
          tone: "error",
          message:
            typeof body.error === "string" && body.error.trim()
              ? body.error
              : plaidUserMessage(body.code ?? "unexpected"),
        });
      }
      return { ok: false };
    }

    return { ok: true, data: body };
  } catch {
    // Fail soft — never throw into the vault hook / crash the SPA.
    if (announceError) {
      emitVaultToast({
        tone: "error",
        message: plaidUserMessage("network"),
      });
    }
    return { ok: false };
  }
}

/** Request a Plaid Link token (server holds PLAID_SECRET). */
export async function requestPlaidLinkToken(): Promise<string | null> {
  const result = await plaidApiFetch<{ link_token: string }>(
    "/api/plaid/link-token",
    { method: "POST" }
  );
  if (!result.ok) return null;
  return result.data.link_token ?? null;
}

/**
 * Exchange public_token on the server. Returns public item metadata only —
 * access_token never enters client state.
 */
export async function exchangePlaidPublicToken(
  publicToken: string,
  institutionName?: string
): Promise<PlaidItemPublic | null> {
  const result = await plaidApiFetch<{ item: PlaidItemPublic }>(
    "/api/plaid/exchange-token",
    {
      method: "POST",
      body: JSON.stringify({
        public_token: publicToken,
        institution_name: institutionName,
      }),
    }
  );
  if (!result.ok) return null;
  return result.data.item ?? null;
}

export async function createPlaidLinkTokenOrToast(): Promise<string | null> {
  if (!isPlaidClientConfigured()) {
    emitVaultToast({
      tone: "error",
      message: plaidUserMessage("not_configured"),
    });
    return null;
  }
  return requestPlaidLinkToken();
}

/**
 * Ask the signed-in route to store Plaid observations for one Item.
 * The body is the plaid_items UUID. The bearer token is the current
 * Supabase session. This does not read or write the financial vault.
 */
export async function requestPlaidObservationSync(
  itemRowId: string
): Promise<boolean> {
  const id = itemRowId.trim();
  if (!id) return false;
  const result = await plaidApiFetch<{ status?: string }>(
    "/api/plaid/sync-transactions",
    {
      method: "POST",
      body: JSON.stringify({ id }),
    },
    { announceError: false }
  );
  if (!result.ok) {
    console.error("[plaid] observation sync failed — ledger unchanged.");
    return false;
  }
  return result.data.status === "synced" || result.data.status === "incomplete";
}

export async function startPlaidLinkExchange(
  publicToken: string,
  institutionName?: string
): Promise<PlaidItemPublic | null> {
  const item = await exchangePlaidPublicToken(publicToken, institutionName);
  if (item) {
    emitVaultToast({
      tone: "success",
      message: `${item.institutionName} connected. No transactions imported.`,
    });
  }
  return item;
}

/** Load public Plaid item metadata for the signed-in steward (no access_token). */
export async function listPlaidItems(): Promise<PlaidItemPublic[]> {
  try {
    const supabase = getSupabaseBrowserClient();
    if (!supabase) return [];

    const { data, error } = await supabase
      .from("plaid_items")
      .select(PLAID_ITEM_PUBLIC_COLUMNS)
      .order("created_at", { ascending: false });

    if (error || !data) {
      console.error("[plaid] list items failed — local vault retained.", error);
      return [];
    }

    return data.map((row) =>
      toPlaidItemPublic(
        row as {
          id: string;
          user_id: string;
          item_id: string;
          institution_name: string;
          created_at: string;
        }
      )
    );
  } catch (err) {
    console.error("[plaid] list items crashed — local vault retained.", err);
    return [];
  }
}

/** Owner-scoped Plaid account descriptors. No balances and no access token. */
export async function listPlaidAccounts(): Promise<PlaidAccountPublic[]> {
  try {
    const supabase = getSupabaseBrowserClient();
    if (!supabase) return [];

    const { data, error } = await supabase
      .from("plaid_accounts")
      .select(PLAID_ACCOUNT_PUBLIC_COLUMNS)
      .order("name", { ascending: true });

    if (error || !data) {
      console.error("[plaid] list accounts failed.", error);
      return [];
    }

    return data.map((row) =>
      toPlaidAccountPublic(
        row as {
          id: string;
          user_id: string;
          plaid_item_id: string;
          plaid_account_id: string;
          name: string | null;
          mask: string | null;
          account_type: string | null;
          subtype: string | null;
        }
      )
    );
  } catch (err) {
    console.error("[plaid] list accounts crashed.", err);
    return [];
  }
}

/** Current cached balance observations. Superseded rows stay in the table. */
export async function listCurrentBalanceObservations(): Promise<
  BalanceObservationPublic[]
> {
  try {
    const supabase = getSupabaseBrowserClient();
    if (!supabase) return [];

    const { data, error } = await supabase
      .from("plaid_balance_observations")
      .select(BALANCE_OBSERVATION_COLUMNS)
      .eq("state", "current");

    if (error || !data) {
      console.error("[plaid] list balance observations failed.");
      return [];
    }

    return data.flatMap((row) => {
      const observation = toBalanceObservationPublic(row);
      return observation ? [observation] : [];
    });
  } catch {
    console.error("[plaid] list balance observations failed.");
    return [];
  }
}

/** Steward account links. This does not read the vault. */
export async function listAccountAssociations(): Promise<AccountAssociationPublic[]> {
  try {
    const supabase = getSupabaseBrowserClient();
    if (!supabase) return [];

    const { data, error } = await supabase
      .from("plaid_account_associations")
      .select(ACCOUNT_ASSOCIATION_COLUMNS);

    if (error || !data) {
      console.error("[plaid] list account associations failed.");
      return [];
    }

    return data.flatMap((row) => {
      const association = toAccountAssociationPublic(row);
      return association ? [association] : [];
    });
  } catch {
    console.error("[plaid] list account associations failed.");
    return [];
  }
}

/**
 * Current Plaid observations for the signed-in user.
 * Removed rows are omitted. This does not read or write the financial vault.
 */
export async function listPlaidObservations(): Promise<PlaidObservationPublic[]> {
  try {
    const supabase = getSupabaseBrowserClient();
    if (!supabase) return [];

    const { data, error } = await supabase
      .from("plaid_transactions")
      .select(PLAID_OBSERVATION_COLUMNS)
      .is("removed_at", null)
      .order("date", { ascending: false });

    if (error || !data) {
      console.error("[plaid] list observations failed.", error);
      return [];
    }

    return data.flatMap((row) => {
      const observation = toPlaidObservationPublic(
        row as {
          id: string;
          user_id: string;
          plaid_transaction_id: string;
          pending_transaction_id: string | null;
          account_id: string;
          amount: number | string;
          name: string;
          category: string | null;
          date: string;
          pending: boolean;
          removed_at: string | null;
        }
      );
      return observation ? [observation] : [];
    });
  } catch (err) {
    console.error("[plaid] list observations crashed.", err);
    return [];
  }
}

/**
 * Current posted observations the steward can teach.
 * Pending and removed rows are excluded. This does not classify them.
 */
export async function listTeachablePlaidObservations(): Promise<
  PlaidObservationPublic[]
> {
  const observations = await listPlaidObservations();
  return observations.filter((observation) =>
    isTeachableObservation(observation)
  );
}

/** Owner confirmations, including superseded and revoked history. */
export async function listPlaidObservationConfirmations(): Promise<
  ObservationConfirmation[]
> {
  try {
    const supabase = getSupabaseBrowserClient();
    if (!supabase) return [];

    const { data, error } = await supabase
      .from("plaid_observation_confirmations")
      .select(PLAID_CONFIRMATION_COLUMNS)
      .order("confirmed_at", { ascending: false });

    if (error || !data) {
      console.error("[plaid] list confirmations failed.", error);
      return [];
    }

    return data.flatMap((row) => {
      const confirmation = toObservationConfirmation(row);
      return confirmation ? [confirmation] : [];
    });
  } catch (err) {
    console.error("[plaid] list confirmations crashed.", err);
    return [];
  }
}

export type ConfirmationWriteResult = {
  status: string;
  reason?: string;
  id?: string;
};

function confirmationFailureMessage(reason: string | undefined): string {
  if (reason === "not_teachable") return "Only a posted transaction can be taught.";
  if (reason === "unknown_category") return "That category is not in the vault.";
  if (reason === "unauthenticated") return plaidUserMessage("unauthorized");
  return "Wealth Engine could not record that meaning.";
}

function readConfirmationResult(value: unknown): ConfirmationWriteResult | null {
  if (!value || typeof value !== "object") return null;
  const status = "status" in value ? value.status : null;
  if (typeof status !== "string" || !status) return null;
  const reason = "reason" in value ? value.reason : undefined;
  const id = "id" in value ? value.id : undefined;
  return {
    status,
    reason: typeof reason === "string" ? reason : undefined,
    id: typeof id === "string" ? id : undefined,
  };
}

/**
 * The signed-in session is the owner. Evidence and the category name are
 * read inside the database function. The caller sends only the two ids.
 */
async function writeOwnerFact(
  call: () => Promise<{ data: unknown; error: { message: string } | null }>,
  failureMessage: (reason: string | undefined) => string,
  logLabel: string
): Promise<ConfirmationWriteResult | null> {
  try {
    const supabase = getSupabaseBrowserClient();
    if (!supabase) {
      emitVaultToast({
        tone: "error",
        message: plaidUserMessage("unauthorized"),
      });
      return null;
    }
    const { data, error } = await call();
    if (error) {
      console.error(logLabel);
      emitVaultToast({
        tone: "error",
        message: failureMessage(undefined),
      });
      return null;
    }
    const result = readConfirmationResult(data);
    if (!result || result.status === "rejected") {
      emitVaultToast({
        tone: "error",
        message: failureMessage(result?.reason),
      });
      return result;
    }
    return result;
  } catch {
    console.error(logLabel);
    emitVaultToast({
      tone: "error",
      message: plaidUserMessage("network"),
    });
    return null;
  }
}

async function writeConfirmation(
  call: () => Promise<{ data: unknown; error: { message: string } | null }>
): Promise<ConfirmationWriteResult | null> {
  return writeOwnerFact(
    call,
    confirmationFailureMessage,
    "[plaid] confirmation write failed."
  );
}

/** Confirm, or supersede, one observation as an existing budget category. */
export async function confirmPlaidObservationMeaning(
  plaidTransactionId: string,
  budgetTargetId: string
): Promise<ConfirmationWriteResult | null> {
  return writeConfirmation(async () => {
    const supabase = getSupabaseBrowserClient();
    if (!supabase) return { data: null, error: { message: "no session" } };
    return supabase.rpc("confirm_plaid_observation", {
      target_plaid_transaction_id: plaidTransactionId,
      target_budget_id: budgetTargetId,
    });
  });
}

function associationFailureMessage(reason: string | undefined): string {
  if (reason === "account_not_in_vault") {
    return "Wealth Engine has not saved that account yet.";
  }
  if (reason === "ineligible_account") {
    return "Only a checking or savings account can be linked.";
  }
  if (reason === "already_associated") {
    return "That account is already linked. Remove the link first.";
  }
  if (reason === "unauthenticated") return plaidUserMessage("unauthorized");
  return "Wealth Engine could not link those accounts.";
}

/** Confirm one vault account corresponds to one Plaid account. */
export async function associatePlaidFinancialAccount(
  financialAccountId: string,
  plaidAccountId: string
): Promise<ConfirmationWriteResult | null> {
  return writeOwnerFact(
    async () => {
      const supabase = getSupabaseBrowserClient();
      if (!supabase) return { data: null, error: { message: "no session" } };
      return supabase.rpc("associate_plaid_financial_account", {
        target_financial_account_id: financialAccountId,
        target_plaid_account_id: plaidAccountId,
      });
    },
    associationFailureMessage,
    "[plaid] account association failed."
  );
}

/** Remove one steward link. The balance observation stays. */
export async function removePlaidFinancialAccountAssociation(
  financialAccountId: string
): Promise<ConfirmationWriteResult | null> {
  return writeOwnerFact(
    async () => {
      const supabase = getSupabaseBrowserClient();
      if (!supabase) return { data: null, error: { message: "no session" } };
      return supabase.rpc("remove_plaid_financial_account_association", {
        target_financial_account_id: financialAccountId,
      });
    },
    associationFailureMessage,
    "[plaid] account association removal failed."
  );
}

/** Revoke the current confirmation. Historical rows stay. */
export async function revokePlaidObservationMeaning(
  plaidTransactionId: string
): Promise<ConfirmationWriteResult | null> {
  return writeConfirmation(async () => {
    const supabase = getSupabaseBrowserClient();
    if (!supabase) return { data: null, error: { message: "no session" } };
    return supabase.rpc("revoke_plaid_observation_confirmation", {
      target_plaid_transaction_id: plaidTransactionId,
    });
  });
}
