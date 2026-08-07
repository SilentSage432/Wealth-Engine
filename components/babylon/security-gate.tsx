"use client";

import { useEffect, useState } from "react";
import { Fingerprint, Lock, Shield } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  isSessionUnlocked,
  isVaultConfigured,
  isWebAuthnAvailable,
  markSessionUnlocked,
  registerWebAuthnCredential,
  setVaultPin,
  unlockWithWebAuthn,
  verifyVaultPin,
} from "@/lib/babylon/security";

interface SecurityGateProps {
  children: React.ReactNode;
}

/**
 * Blocks the Command Deck until PIN or platform authenticator unlocks the session.
 */
export function SecurityGate({ children }: SecurityGateProps) {
  const [ready, setReady] = useState(false);
  const [unlocked, setUnlocked] = useState(false);
  const [configured, setConfigured] = useState(false);
  const [pin, setPin] = useState("");
  const [confirmPin, setConfirmPin] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const webauthn = isWebAuthnAvailable();

  useEffect(() => {
    const conf = isVaultConfigured();
    setConfigured(conf);
    setUnlocked(!conf || isSessionUnlocked());
    setReady(true);
  }, []);

  const finishUnlock = () => {
    markSessionUnlocked();
    setUnlocked(true);
    setPin("");
    setConfirmPin("");
    setError(null);
  };

  const handleSetup = async () => {
    setError(null);
    setBusy(true);
    try {
      await setVaultPin(pin);
      if (webauthn) {
        await registerWebAuthnCredential();
      }
      setConfigured(true);
      finishUnlock();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not set PIN.");
    } finally {
      setBusy(false);
    }
  };

  const handleUnlockPin = async () => {
    setError(null);
    setBusy(true);
    try {
      const ok = await verifyVaultPin(pin);
      if (!ok) {
        setError("Incorrect PIN.");
        return;
      }
      finishUnlock();
    } finally {
      setBusy(false);
    }
  };

  const handleBiometric = async () => {
    setError(null);
    setBusy(true);
    try {
      const ok = await unlockWithWebAuthn();
      if (!ok) {
        setError("Biometric unlock unavailable. Use your PIN.");
        return;
      }
      finishUnlock();
    } finally {
      setBusy(false);
    }
  };

  if (!ready) return null;
  if (unlocked) return <>{children}</>;

  return (
    <div className="relative min-h-dvh overflow-hidden bg-slate-950">
      <div
        className="pointer-events-none absolute inset-0 luxury-grid opacity-40 blur-sm"
        aria-hidden="true"
      />
      <div className="relative z-10 flex min-h-dvh items-center justify-center px-4 py-10">
        <div className="w-full max-w-md rounded-2xl border border-slate-800 bg-slate-950/90 p-6 shadow-2xl backdrop-blur-xl sm:p-8">
          <div className="mb-6 flex items-center gap-3">
            <div className="rounded-xl bg-emerald-500/10 p-3 text-emerald-400">
              <Shield className="h-6 w-6" aria-hidden="true" />
            </div>
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-500">
                Privacy Shield
              </p>
              <h1 className="font-[family-name:var(--font-display)] text-2xl text-slate-50">
                {configured ? "Unlock Vault" : "Secure Your Vault"}
              </h1>
            </div>
          </div>

          {!configured ? (
            <div className="space-y-4">
              <p className="text-sm text-slate-400">
                Set a 4-digit PIN to gate the Command Deck. On supported devices
                you can also enroll platform biometrics (Face ID / fingerprint).
              </p>
              <Input
                type="password"
                inputMode="numeric"
                maxLength={4}
                placeholder="Create PIN"
                value={pin}
                onChange={(e) => setPin(e.target.value.replace(/\D/g, "").slice(0, 4))}
                aria-label="Create 4-digit PIN"
                className="border-slate-800 bg-slate-900/60 text-center text-lg tracking-[0.4em]"
              />
              <Input
                type="password"
                inputMode="numeric"
                maxLength={4}
                placeholder="Confirm PIN"
                value={confirmPin}
                onChange={(e) =>
                  setConfirmPin(e.target.value.replace(/\D/g, "").slice(0, 4))
                }
                aria-label="Confirm 4-digit PIN"
                className="border-slate-800 bg-slate-900/60 text-center text-lg tracking-[0.4em]"
              />
              <Button
                className="w-full"
                disabled={busy || pin.length !== 4 || pin !== confirmPin}
                onClick={handleSetup}
              >
                <Lock className="h-4 w-4" aria-hidden="true" />
                Enable Vault Lock
              </Button>
            </div>
          ) : (
            <div className="space-y-4">
              <Input
                type="password"
                inputMode="numeric"
                maxLength={4}
                placeholder="••••"
                value={pin}
                onChange={(e) => setPin(e.target.value.replace(/\D/g, "").slice(0, 4))}
                aria-label="Enter 4-digit PIN"
                className="border-slate-800 bg-slate-900/60 text-center text-lg tracking-[0.4em]"
                onKeyDown={(e) => {
                  if (e.key === "Enter" && pin.length === 4) {
                    void handleUnlockPin();
                  }
                }}
              />
              <Button
                className="w-full"
                disabled={busy || pin.length !== 4}
                onClick={handleUnlockPin}
              >
                Unlock with PIN
              </Button>
              {webauthn && (
                <Button
                  variant="outline"
                  className="w-full"
                  disabled={busy}
                  onClick={handleBiometric}
                >
                  <Fingerprint className="h-4 w-4" aria-hidden="true" />
                  Use Biometrics
                </Button>
              )}
            </div>
          )}

          {error && (
            <p
              role="alert"
              className="mt-4 rounded-md border border-rose-900/50 bg-rose-500/10 px-3 py-2 text-sm text-rose-300"
            >
              {error}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
