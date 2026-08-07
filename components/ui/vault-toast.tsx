"use client";

import { useEffect, useState } from "react";
import {
  VAULT_TOAST_EVENT,
  type VaultToastDetail,
} from "@/lib/babylon/vault-toast";
import { cn } from "@/lib/utils";

/**
 * Lightweight toast host for vault / Plaid fail-soft messaging.
 * Mount once near the app shell (e.g. SecurityGate).
 */
export function VaultToastHost() {
  const [toast, setToast] = useState<VaultToastDetail | null>(null);

  useEffect(() => {
    const onToast = (event: Event) => {
      const custom = event as CustomEvent<VaultToastDetail>;
      setToast(custom.detail);
    };
    window.addEventListener(VAULT_TOAST_EVENT, onToast);
    return () => window.removeEventListener(VAULT_TOAST_EVENT, onToast);
  }, []);

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(null), toast.durationMs);
    return () => window.clearTimeout(timer);
  }, [toast]);

  if (!toast) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      className={cn(
        "pointer-events-none fixed inset-x-0 bottom-6 z-[80] flex justify-center px-4",
        "animate-fade-up"
      )}
    >
      <p
        className={cn(
          "max-w-md rounded-lg border px-4 py-3 text-sm shadow-xl backdrop-blur-md",
          toast.tone === "error" &&
            "border-rose-900/50 bg-rose-950/90 text-rose-100",
          toast.tone === "success" &&
            "border-emerald-800/50 bg-emerald-950/90 text-emerald-100",
          toast.tone === "info" &&
            "border-slate-700 bg-slate-900/95 text-slate-100"
        )}
      >
        {toast.message}
      </p>
    </div>
  );
}
