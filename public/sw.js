/**
 * Wealth Engine production worker.
 *
 * Navigation is network-first so a cached HTML document cannot outlive the
 * hashed Next.js chunks it references. The cached document is only an
 * offline fallback. `/api/*`, the worker script, and cross-origin calls
 * (Supabase, Plaid) are not stored here.
 *
 * Keep the branching aligned with `lib/babylon/sw-policy.ts`.
 * This file does not read or write localStorage.
 * A push, when one arrives, shows fixed generic copy and opens `/`.
 * It does not read the payload or financial records.
 */
const CACHE_NAME = "babylon-engine-v2";

self.addEventListener("install", (event) => {
  // Do not precache "/". Install-time HTML is what stranded clients on
  // VaultLoading after the next build replaced /_next/static hashes.
  event.waitUntil(self.skipWaiting());
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(
        keys
          .filter((key) => key !== CACHE_NAME)
          .map((key) => caches.delete(key))
      );
      await self.clients.claim();
      const windows = await self.clients.matchAll({
        type: "window",
        includeUncontrolled: true,
      });
      await Promise.all(
        windows.map(async (client) => {
          if (typeof client.navigate !== "function" || !client.url) return;
          try {
            await client.navigate(client.url);
          } catch {
            // A later reload still uses this worker. Do not block activate.
          }
        })
      );
    })()
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;

  let url;
  try {
    url = new URL(request.url);
  } catch {
    return;
  }

  if (url.origin !== self.location.origin) return;
  if (url.pathname === "/sw.js" || url.pathname.startsWith("/api/")) return;

  if (request.mode === "navigate" || request.destination === "document") {
    event.respondWith(networkFirstDocument(request));
    return;
  }

  if (url.pathname.startsWith("/_next/static/")) {
    event.respondWith(cacheFirstImmutable(request));
  }
});

async function networkFirstDocument(request) {
  const cache = await caches.open(CACHE_NAME);
  const cacheKey = new Request(request.url, { method: "GET" });
  try {
    const response = await fetch(request.url, {
      cache: "no-store",
      credentials: "same-origin",
      redirect: "follow",
    });
    if (response && response.ok && response.type === "basic") {
      await cache.put(cacheKey, response.clone());
    }
    return response;
  } catch (error) {
    const cached = await cache.match(cacheKey);
    if (cached) return cached;
    throw error;
  }
}

async function cacheFirstImmutable(request) {
  const cache = await caches.open(CACHE_NAME);
  const cached = await cache.match(request);
  if (cached) return cached;
  const response = await fetch(request);
  if (response && response.ok && response.type === "basic") {
    await cache.put(request, response.clone());
  }
  return response;
}

self.addEventListener("push", (event) => {
  event.waitUntil(
    self.registration.showNotification("Wealth Engine", {
      body: "Wealth Engine needs your attention.",
      tag: "wealth-engine-attention",
    })
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const target = new URL("/", self.location.origin).href;
  event.waitUntil(
    (async () => {
      const windows = await self.clients.matchAll({
        type: "window",
        includeUncontrolled: true,
      });
      for (const client of windows) {
        let origin = "";
        try {
          origin = new URL(client.url).origin;
        } catch {
          continue;
        }
        if (origin !== self.location.origin) continue;
        if (typeof client.navigate === "function") {
          try {
            await client.navigate(target);
          } catch {
            // Focusing the open app still lands on SecurityGate.
          }
        }
        if (typeof client.focus === "function") {
          await client.focus();
          return;
        }
      }
      await self.clients.openWindow(target);
    })()
  );
});
