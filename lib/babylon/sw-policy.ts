/**
 * Service-worker request policy for Wealth Engine.
 *
 * `public/sw.js` inlines this same decision. Tests lock both so a cached
 * HTML document cannot outlive the Next.js chunks it references, and so
 * API / cross-origin responses are never stored by the worker.
 *
 * The ledger, PIN, and WebAuthn credentials live in localStorage /
 * sessionStorage. This policy never names those keys.
 */

export const SW_CACHE_NAME = "babylon-engine-v2";

export type ServiceWorkerFetchPlan =
  | "passthrough"
  | "network-first-document"
  | "cache-first-immutable";

export function planServiceWorkerFetch(input: {
  method: string;
  requestUrl: string;
  scopeOrigin: string;
  mode: string;
  destination: string;
}): ServiceWorkerFetchPlan {
  if (input.method !== "GET") return "passthrough";

  let url: URL;
  try {
    url = new URL(input.requestUrl);
  } catch {
    return "passthrough";
  }

  if (url.origin !== input.scopeOrigin) return "passthrough";
  if (url.pathname === "/sw.js" || url.pathname.startsWith("/api/")) {
    return "passthrough";
  }
  if (input.mode === "navigate" || input.destination === "document") {
    return "network-first-document";
  }
  if (url.pathname.startsWith("/_next/static/")) {
    return "cache-first-immutable";
  }
  return "passthrough";
}

/** Cache names activate should delete. The live name is kept. */
export function retiredCacheNames(
  existingNames: readonly string[],
  liveName: string = SW_CACHE_NAME
): string[] {
  return existingNames.filter((name) => name !== liveName);
}
