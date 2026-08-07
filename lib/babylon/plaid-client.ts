"use client";

import { plaidUserMessage } from "@/lib/babylon/plaid-errors";
import {
  isPlaidClientConfigured,
  PLAID_ITEM_PUBLIC_COLUMNS,
  toPlaidItemPublic,
  type PlaidItemPublic,
} from "@/lib/babylon/plaid-schema";
import { emitVaultToast } from "@/lib/babylon/vault-toast";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";

type ApiErrorBody = { error?: string; code?: string };

async function authBearer(): Promise<string | null> {
  const supabase = getSupabaseBrowserClient();
  if (!supabase) return null;
  const { data } = await supabase.auth.getSession();
  return data.session?.access_token ?? null;
}

async function plaidApiFetch<T>(
  path: string,
  init?: RequestInit
): Promise<{ ok: true; data: T } | { ok: false }> {
  try {
    const token = await authBearer();
    if (!token) {
      emitVaultToast({
        tone: "error",
        message: plaidUserMessage("unauthorized"),
      });
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
      emitVaultToast({
        tone: "error",
        message:
          typeof body.error === "string" && body.error.trim()
            ? body.error
            : plaidUserMessage(body.code ?? "unexpected"),
      });
      return { ok: false };
    }

    return { ok: true, data: body };
  } catch {
    // Fail soft — never throw into the vault hook / crash the SPA.
    emitVaultToast({
      tone: "error",
      message: plaidUserMessage("network"),
    });
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

export async function startPlaidLinkExchange(
  publicToken: string,
  institutionName?: string
): Promise<PlaidItemPublic | null> {
  const item = await exchangePlaidPublicToken(publicToken, institutionName);
  if (item) {
    emitVaultToast({
      tone: "success",
      message: `${item.institutionName} linked. Your vault is up to date.`,
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
