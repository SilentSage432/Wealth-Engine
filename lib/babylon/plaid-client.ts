"use client";

import { plaidUserMessage } from "@/lib/babylon/plaid-errors";
import {
  isPlaidClientConfigured,
  PLAID_ITEM_PUBLIC_COLUMNS,
  PLAID_OBSERVATION_COLUMNS,
  toPlaidItemPublic,
  toPlaidObservationPublic,
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
