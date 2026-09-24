import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  SW_CACHE_NAME,
  planServiceWorkerFetch,
  retiredCacheNames,
} from "@/lib/babylon/sw-policy";

const ORIGIN = "https://wealth.example";

function plan(
  pathname: string,
  extras?: Partial<Parameters<typeof planServiceWorkerFetch>[0]>
) {
  return planServiceWorkerFetch({
    method: "GET",
    requestUrl: `${ORIGIN}${pathname}`,
    scopeOrigin: ORIGIN,
    mode: "cors",
    destination: "",
    ...extras,
  });
}

describe("planServiceWorkerFetch", () => {
  it("loads a document from the network before any cached shell", () => {
    expect(
      plan("/", { mode: "navigate", destination: "document" })
    ).toBe("network-first-document");
  });

  it("does not persist API, worker, or cross-origin responses", () => {
    expect(plan("/api/plaid/link-token")).toBe("passthrough");
    expect(plan("/api/plaid/exchange-token")).toBe("passthrough");
    expect(plan("/sw.js")).toBe("passthrough");
    expect(
      planServiceWorkerFetch({
        method: "GET",
        requestUrl: "https://example.supabase.co/auth/v1/token",
        scopeOrigin: ORIGIN,
        mode: "cors",
        destination: "",
      })
    ).toBe("passthrough");
    expect(
      plan("/api/plaid/link-token", { method: "POST", mode: "cors" })
    ).toBe("passthrough");
  });

  it("may cache content-hashed Next static files and nothing else by default", () => {
    expect(plan("/_next/static/chunks/app.js")).toBe("cache-first-immutable");
    expect(plan("/manifest.webmanifest")).toBe("passthrough");
    expect(plan("/icons/icon-192x192.png")).toBe("passthrough");
  });
});

describe("retiredCacheNames", () => {
  it("drops the previous shell cache and keeps the live name", () => {
    expect(
      retiredCacheNames(["babylon-engine-v1", SW_CACHE_NAME, "other"])
    ).toEqual(["babylon-engine-v1", "other"]);
  });
});

describe("service worker source", () => {
  const worker = readFileSync("public/sw.js", "utf8");
  const registrar = readFileSync(
    "components/layout/ServiceWorkerRegistrar.tsx",
    "utf8"
  );

  it("ships the live cache name and retires every other cache on activate", () => {
    expect(SW_CACHE_NAME).toBe("babylon-engine-v2");
    expect(worker).toContain(`const CACHE_NAME = "${SW_CACHE_NAME}"`);
    expect(worker).not.toContain("babylon-engine-v1");
    expect(worker).toContain("caches.delete");
    expect(worker).toContain("skipWaiting");
    expect(worker).toContain("clients.claim");
  });

  it("network-first navigations bypass HTTP cache and never store /api", () => {
    expect(worker).toContain('request.mode === "navigate"');
    expect(worker).toContain('cache: "no-store"');
    expect(worker).toContain('url.pathname.startsWith("/api/")');
    expect(worker.indexOf('url.pathname.startsWith("/api/")')).toBeLessThan(
      worker.indexOf("event.respondWith")
    );
  });

  it("still does not register on localhost", () => {
    expect(registrar).toContain('window.location.hostname === "localhost"');
    expect(registrar).toContain('window.location.hostname === "127.0.0.1"');
    expect(registrar).toContain('updateViaCache: "none"');
  });
});
