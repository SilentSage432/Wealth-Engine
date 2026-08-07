/**
 * Fail-soft Plaid user messaging — Presentation/Application safe.
 * Never includes stack traces or upstream API payloads.
 */

export const PLAID_USER_ERRORS = {
  not_configured:
    "Bank linking is not available yet. Your local vault is unchanged.",
  unauthorized: "Sign in required to connect a bank.",
  session_expired: "Your session expired. Sign in again to continue.",
  missing_public_token: "Bank connection was incomplete. Please try again.",
  exchange_failed:
    "We couldn't finish connecting your bank. Please try again in a moment.",
  link_token_failed:
    "We couldn't start bank linking. Please try again in a moment.",
  upstream_failed:
    "The bank connection service is temporarily unavailable. Your vault is safe.",
  network:
    "Couldn't reach the bank connection service. Check your connection and try again.",
  persist_failed:
    "Bank linked, but we couldn't save the connection. Try again or contact support.",
  unexpected:
    "Something went wrong connecting your bank. Your local vault is unchanged.",
} as const;

export type PlaidUserErrorCode = keyof typeof PLAID_USER_ERRORS;

export function plaidUserMessage(code: PlaidUserErrorCode | string): string {
  if (code in PLAID_USER_ERRORS) {
    return PLAID_USER_ERRORS[code as PlaidUserErrorCode];
  }
  return PLAID_USER_ERRORS.unexpected;
}
