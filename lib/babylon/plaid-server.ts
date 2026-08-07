import "server-only";

import { NextResponse } from "next/server";
import {
  PLAID_USER_ERRORS,
  type PlaidUserErrorCode,
} from "@/lib/babylon/plaid-errors";

/** Server-only Plaid credentials — never referenced from client modules. */
export type PlaidServerConfig = {
  clientId: string;
  secret: string;
  /** sandbox | development | production */
  env: string;
  baseUrl: string;
};

const PLAID_HOSTS: Record<string, string> = {
  sandbox: "https://sandbox.plaid.com",
  development: "https://development.plaid.com",
  production: "https://production.plaid.com",
};

export function getPlaidServerConfig(): PlaidServerConfig | null {
  const clientId = process.env.PLAID_CLIENT_ID?.trim();
  const secret = process.env.PLAID_SECRET?.trim();
  const env = (
    process.env.PLAID_ENV?.trim() ||
    process.env.NEXT_PUBLIC_PLAID_ENV?.trim() ||
    "sandbox"
  ).toLowerCase();

  if (!clientId || !secret) return null;

  const baseUrl = PLAID_HOSTS[env] ?? PLAID_HOSTS.sandbox;
  return { clientId, secret, env, baseUrl };
}

export function plaidJsonError(
  code: PlaidUserErrorCode,
  status = 502
): NextResponse {
  return NextResponse.json({ error: PLAID_USER_ERRORS[code], code }, { status });
}

/**
 * Fail-soft Plaid REST helper. Logs server-side detail; returns only safe user copy.
 */
export async function plaidFetch<T>(
  path: string,
  body: Record<string, unknown>
): Promise<{ ok: true; data: T } | { ok: false; response: NextResponse }> {
  const config = getPlaidServerConfig();
  if (!config) {
    return { ok: false, response: plaidJsonError("not_configured", 503) };
  }

  try {
    const res = await fetch(`${config.baseUrl}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        client_id: config.clientId,
        secret: config.secret,
        ...body,
      }),
    });

    const payload = (await res.json().catch(() => null)) as
      | (T & { error_message?: string; error_code?: string })
      | null;

    if (!res.ok) {
      console.error("[plaid] API error", {
        path,
        status: res.status,
        error_code: payload?.error_code,
        // Never forward raw error_message to clients — may include internals.
      });
      return { ok: false, response: plaidJsonError("upstream_failed", 502) };
    }

    return { ok: true, data: payload as T };
  } catch (err) {
    console.error("[plaid] network failure — local vault unaffected.", err);
    return { ok: false, response: plaidJsonError("network", 503) };
  }
}
