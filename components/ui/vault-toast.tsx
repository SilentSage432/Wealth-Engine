"use client";

import { useEffect, useState } from "react";
import { X } from "lucide-react";
import {
  VAULT_TOAST_EVENT,
  type VaultToastDetail,
} from "@/lib/babylon/vault-toast";
import { cn } from "@/lib/utils";

/**
 * Lightweight toast host for vault / Plaid fail-soft messaging.
 * Mount once near the app shell (e.g. SecurityGate).
 * `durationMs: 0` stays until the steward dismisses it.
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
    if (!toast || toast.durationMs <= 0) return;
    const timer = window.setTimeout(() => setToast(null), toast.durationMs);
    return () => window.clearTimeout(timer);
  }, [toast]);

  if (!toast) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      className={cn(
        "fixed inset-x-0 bottom-6 z-[80] flex justify-center px-4",
        "animate-fade-up"
      )}
    >
      <div
        className={cn(
          "flex max-w-md items-start gap-3 rounded-lg border px-4 py-3 text-sm shadow-xl backdrop-blur-md",
          toast.tone === "error" &&
            "border-rose-900/50 bg-rose-950/90 text-rose-100",
          toast.tone === "success" &&
            "border-emerald-800/50 bg-emerald-950/90 text-emerald-100",
          toast.tone === "info" &&
            "border-slate-700 bg-slate-900/95 text-slate-100"
        )}
      >
        <p className="min-w-0 flex-1 pt-0.5">{toast.message}</p>
        <button
          type="button"
          onClick={() => setToast(null)}
          className="shrink-0 rounded-md p-1 opacity-80 transition-opacity hover:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/50"
          aria-label="Dismiss notification"
        >
          <X className="h-4 w-4" aria-hidden="true" />
        </button>
      </div>
    </div>
  );
}
