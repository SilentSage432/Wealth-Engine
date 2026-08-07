"use client";

import { useEffect, useRef, useState } from "react";
import { Fingerprint, Loader2, Lock, Shield } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { VaultToastHost } from "@/components/ui/vault-toast";
import {
  clearWebAuthnCredential,
  hasWebAuthnCredential,
  isSessionUnlocked,
  isVaultConfigured,
  isWebAuthnAvailable,
  lockSession,
  markSessionUnlocked,
  registerWebAuthnCredential,
  setVaultPin,
  unlockWithWebAuthn,
  VAULT_IDLE_LOCK_MS,
  verifyVaultPin,
} from "@/lib/babylon/security";

type GatePhase = "setup" | "authenticating" | "pin_entry";

interface SecurityGateProps {
  children: React.ReactNode;
}

/**
 * Blocks the Command Deck until PIN or platform authenticator unlocks the session.
 * Also enforces idle auto-lock and multitasking privacy blur.
 *
 * WebAuthn is best-effort: a 1.5s hard timeout + explicit PIN bypass prevent
 * domain-mismatch lockouts (e.g. localhost → Vercel hostname).
 */
export function SecurityGate({ children }: SecurityGateProps) {
  const [ready, setReady] = useState(false);
  const [unlocked, setUnlocked] = useState(false);
  const [configured, setConfigured] = useState(false);
  const [phase, setPhase] = useState<GatePhase>("pin_entry");
  const [privacyObscured, setPrivacyObscured] = useState(false);
  const [pin, setPin] = useState("");
  const [confirmPin, setConfirmPin] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [needsBioReenroll, setNeedsBioReenroll] = useState(false);
  const [biometricHint, setBiometricHint] = useState<string | null>(null);
  const idleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const bioAttemptRef = useRef(0);
  const webauthn = isWebAuthnAvailable();

  const fallThroughToPin = (message?: string) => {
    setPhase("pin_entry");
    setBusy(false);
    if (message) setError(message);
  };

  const finishUnlock = async (opts?: { reenrollBiometrics?: boolean }) => {
    markSessionUnlocked();
    setUnlocked(true);
    setPin("");
    setConfirmPin("");
    setError(null);
    setBusy(false);

    if (opts?.reenrollBiometrics && webauthn) {
      try {
        clearWebAuthnCredential();
        const enrolled = await registerWebAuthnCredential();
        setNeedsBioReenroll(false);
        if (enrolled) {
          setBiometricHint("Biometrics enrolled for this device.");
        }
      } catch {
        // PIN already unlocked — enrollment is optional.
      }
    }
  };

  useEffect(() => {
    const conf = isVaultConfigured();
    setConfigured(conf);

    if (!conf) {
      setPhase("setup");
      setUnlocked(false);
      setReady(true);
      return;
    }

    if (isSessionUnlocked()) {
      setUnlocked(true);
      setReady(true);
      return;
    }

    setUnlocked(false);
    if (webauthn && hasWebAuthnCredential()) {
      setPhase("authenticating");
    } else {
      setPhase("pin_entry");
    }
    setReady(true);
  }, [webauthn]);

  // Auto-attempt WebAuthn once when entering authenticating; never hang.
  useEffect(() => {
    if (!ready || unlocked || phase !== "authenticating") return;

    const attemptId = ++bioAttemptRef.current;
    let cancelled = false;

    const run = async () => {
      setError(null);
      setBusy(true);
      try {
        const result = await unlockWithWebAuthn();
        if (cancelled || attemptId !== bioAttemptRef.current) return;

        if (result === "success") {
          await finishUnlock();
          return;
        }

        // Domain / credential failure: drop stale id so we re-enroll after PIN.
        // Soft timeout: keep credential, just fall through to PIN.
        if (result === "failed" || result === "unavailable") {
          clearWebAuthnCredential();
          setNeedsBioReenroll(true);
          fallThroughToPin(
            "Biometrics unavailable on this domain. Enter your 4-digit PIN."
          );
          return;
        }

        fallThroughToPin(
          "Biometrics timed out. Enter your 4-digit PIN, or try biometrics again."
        );
      } catch {
        if (cancelled || attemptId !== bioAttemptRef.current) return;
        clearWebAuthnCredential();
        setNeedsBioReenroll(true);
        fallThroughToPin("Biometrics unavailable. Enter your 4-digit PIN.");
      }
    };

    void run();

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- gate lifecycle bind
  }, [ready, unlocked, phase]);

  useEffect(() => {
    if (!biometricHint) return;
    const timer = window.setTimeout(() => setBiometricHint(null), 4000);
    return () => window.clearTimeout(timer);
  }, [biometricHint]);

  const lockVault = () => {
    if (!isVaultConfigured()) return;
    lockSession();
    setUnlocked(false);
    setPin("");
    setConfirmPin("");
    setError(null);
    if (webauthn && hasWebAuthnCredential()) {
      setPhase("authenticating");
    } else {
      setPhase("pin_entry");
    }
  };

  // Idle auto-lock (3 minutes of no pointer / keyboard / touch activity).
  useEffect(() => {
    if (!ready || !unlocked || !configured) return;

    const resetIdle = () => {
      if (idleTimerRef.current) clearTimeout(idleTimerRef.current);
      idleTimerRef.current = setTimeout(() => {
        lockVault();
      }, VAULT_IDLE_LOCK_MS);
    };

    const activityEvents: Array<keyof WindowEventMap> = [
      "pointerdown",
      "keydown",
      "touchstart",
      "mousemove",
      "scroll",
    ];

    resetIdle();
    for (const eventName of activityEvents) {
      window.addEventListener(eventName, resetIdle, { passive: true });
    }

    return () => {
      if (idleTimerRef.current) clearTimeout(idleTimerRef.current);
      for (const eventName of activityEvents) {
        window.removeEventListener(eventName, resetIdle);
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- lockVault closes over phase helpers
  }, [ready, unlocked, configured, webauthn]);

  // Multitasking / background privacy: blur balances in app switcher previews.
  useEffect(() => {
    if (!ready) return;

    const syncPrivacy = () => {
      const hidden =
        document.visibilityState === "hidden" || !document.hasFocus();
      setPrivacyObscured(hidden);
    };

    const onVisibility = () => syncPrivacy();
    const onBlur = () => setPrivacyObscured(true);
    const onFocus = () => {
      if (document.visibilityState === "visible") {
        setPrivacyObscured(false);
      }
    };

    syncPrivacy();
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("blur", onBlur);
    window.addEventListener("focus", onFocus);

    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("blur", onBlur);
      window.removeEventListener("focus", onFocus);
    };
  }, [ready]);

  const handleSetup = async () => {
    setError(null);
    setBusy(true);
    try {
      await setVaultPin(pin);
      setConfigured(true);
      if (webauthn) {
        await registerWebAuthnCredential();
      }
      await finishUnlock();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not set PIN.");
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
        setBusy(false);
        return;
      }
      const shouldReenroll = needsBioReenroll && webauthn;
      await finishUnlock({ reenrollBiometrics: shouldReenroll });
    } finally {
      setBusy(false);
    }
  };

  const handleBiometric = () => {
    setError(null);
    setPhase("authenticating");
  };

  const bypassToPin = () => {
    bioAttemptRef.current += 1;
    fallThroughToPin();
  };

  if (!ready) return null;

  const title =
    phase === "setup"
      ? "Set Vault Master PIN"
      : phase === "authenticating"
        ? "Opening the vault..."
        : "Unlock Vault";

  return (
    <>
      {unlocked ? children : null}

      {!unlocked && (
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
                    {title}
                  </h1>
                </div>
              </div>

              {phase === "setup" && (
                <div className="space-y-4">
                  <p className="text-sm text-slate-400">
                    Create a 4-digit master PIN for this origin. On supported
                    devices you can also enroll platform biometrics (Face ID /
                    fingerprint).
                  </p>
                  <Input
                    type="password"
                    inputMode="numeric"
                    maxLength={4}
                    placeholder="Create PIN"
                    value={pin}
                    onChange={(e) =>
                      setPin(e.target.value.replace(/\D/g, "").slice(0, 4))
                    }
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
                      setConfirmPin(
                        e.target.value.replace(/\D/g, "").slice(0, 4)
                      )
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
              )}

              {phase === "authenticating" && (
                <div className="space-y-4">
                  <div className="flex flex-col items-center gap-3 py-4 text-slate-300">
                    <Loader2
                      className="h-8 w-8 animate-spin text-emerald-400"
                      aria-hidden="true"
                    />
                    <p className="text-sm text-slate-400">
                      Waiting for biometrics…
                    </p>
                  </div>
                  <Button
                    variant="outline"
                    className="w-full"
                    onClick={bypassToPin}
                  >
                    <Lock className="h-4 w-4" aria-hidden="true" />
                    Use 4-Digit PIN
                  </Button>
                </div>
              )}

              {phase === "pin_entry" && (
                <div className="space-y-4">
                  <Input
                    type="password"
                    inputMode="numeric"
                    maxLength={4}
                    placeholder="••••"
                    value={pin}
                    onChange={(e) =>
                      setPin(e.target.value.replace(/\D/g, "").slice(0, 4))
                    }
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
                  {webauthn && hasWebAuthnCredential() && (
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
      )}

      {privacyObscured && unlocked && (
        <div
          className="fixed inset-0 z-[70] bg-slate-950/80 backdrop-blur-2xl"
          aria-hidden="true"
          data-privacy-obscure="true"
        />
      )}

      {biometricHint && unlocked && (
        <div
          role="status"
          className="pointer-events-none fixed inset-x-0 bottom-20 z-[75] flex justify-center px-4"
        >
          <p className="rounded-lg border border-emerald-800/50 bg-emerald-950/90 px-4 py-2 text-sm text-emerald-100 shadow-xl backdrop-blur-md">
            {biometricHint}
          </p>
        </div>
      )}

      <VaultToastHost />
    </>
  );
}
