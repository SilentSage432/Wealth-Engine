"use client";

import { useEffect } from "react";

/**
 * Registers the PWA service worker on production hosts only.
 * Skips localhost so Next.js HMR / turbopack are never shadowed by a stale cache.
 */
export function ServiceWorkerRegistrar() {
  useEffect(() => {
    if (
      typeof window === "undefined" ||
      !("serviceWorker" in navigator) ||
      window.location.hostname === "localhost" ||
      window.location.hostname === "127.0.0.1"
    ) {
      return;
    }

    window.navigator.serviceWorker
      .register("/sw.js")
      .then((reg) => {
        console.log("PWA Service Worker registered safely:", reg.scope);
      })
      .catch((err) => {
        console.error("PWA Registration halted:", err);
      });
  }, []);

  return null;
}
