"use client";

import { useEffect, useState, type FormEvent } from "react";
import { Cloud, Loader2, Shield } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { isSupabaseConfigured } from "@/lib/supabase/client";
import {
  signInWithPassword,
  signUpWithPassword,
} from "@/lib/supabase/auth";
import { cn } from "@/lib/utils";

type AuthMode = "sign_in" | "sign_up";

type FormFeedback = {
  tone: "error" | "success";
  message: string;
};

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MIN_PASSWORD = 6;

interface AuthModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Prefill steward name on Create Account. */
  defaultUsername?: string;
  /** Called after a successful auth; parent may set local username. */
  onAuthenticated?: (payload: {
    userId: string;
    username: string;
    mode: AuthMode;
  }) => void;
}

export function AuthModal({
  open,
  onOpenChange,
  defaultUsername = "",
  onAuthenticated,
}: AuthModalProps) {
  const [mode, setMode] = useState<AuthMode>("sign_in");
  const [username, setUsername] = useState(defaultUsername);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<FormFeedback | null>(null);

  useEffect(() => {
    if (!open) return;
    setMode("sign_in");
    setUsername(defaultUsername);
    setEmail("");
    setPassword("");
    setBusy(false);
    setFeedback(null);
  }, [open, defaultUsername]);

  const configured = isSupabaseConfigured();

  const validate = (): string | null => {
    if (!configured) {
      return "Cloud vault is not configured on this build.";
    }
    if (mode === "sign_up") {
      const name = username.trim();
      if (!name) return "Choose a steward username.";
      if (name.length > 40) return "Username must be 40 characters or fewer.";
    }
    const trimmedEmail = email.trim();
    if (!trimmedEmail) return "Email is required.";
    if (!EMAIL_RE.test(trimmedEmail)) {
      return "Enter a valid email address.";
    }
    if (!password) return "Password is required.";
    if (password.length < MIN_PASSWORD) {
      return `Password must be at least ${MIN_PASSWORD} characters.`;
    }
    return null;
  };

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    const validationError = validate();
    if (validationError) {
      setFeedback({ tone: "error", message: validationError });
      return;
    }

    setBusy(true);
    setFeedback(null);

    const result =
      mode === "sign_in"
        ? await signInWithPassword(email, password)
        : await signUpWithPassword(email, password, username);

    setBusy(false);

    if (!result.ok) {
      setFeedback({ tone: "error", message: result.message });
      return;
    }

    const stewardName =
      mode === "sign_up"
        ? username.trim() || "Steward"
        : defaultUsername.trim() || "Steward";

    setFeedback({
      tone: "success",
      message:
        mode === "sign_up"
          ? "Steward account created. Securing your vault…"
          : "Signed in. Syncing cloud vault…",
    });

    onAuthenticated?.({
      userId: result.userId,
      username: stewardName,
      mode,
    });

    window.setTimeout(() => onOpenChange(false), 650);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md gap-0 overflow-hidden p-0 sm:max-w-md">
        <div className="border-b border-slate-800/80 bg-gradient-to-br from-slate-900 via-slate-950 to-emerald-950/30 px-6 py-5">
          <DialogHeader className="space-y-2 text-left">
            <div className="flex items-center gap-2 text-emerald-400">
              <Shield className="h-4 w-4" />
              <span className="text-[10px] font-semibold uppercase tracking-[0.18em]">
                Cloud Vault
              </span>
            </div>
            <DialogTitle className="font-[family-name:var(--font-display)] text-2xl font-semibold tracking-wide text-slate-50">
              {mode === "sign_in" ? "Sign In" : "Create Steward Account"}
            </DialogTitle>
            <DialogDescription className="text-sm text-slate-400">
              {mode === "sign_in"
                ? "Reconnect to your secured Babylon ledger across devices."
                : "Lock anonymous local history behind a password — your vault migrates automatically."}
            </DialogDescription>
          </DialogHeader>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4 px-6 py-5">
          {!configured && (
            <p
              role="alert"
              className="rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-200"
            >
              Supabase env keys are missing. Cloud auth stays offline until
              configured.
            </p>
          )}

          {mode === "sign_up" && (
            <div className="space-y-2">
              <Label htmlFor="auth-username">Username</Label>
              <Input
                id="auth-username"
                autoComplete="username"
                placeholder="Steward"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                disabled={busy}
              />
            </div>
          )}

          <div className="space-y-2">
            <Label htmlFor="auth-email">Email</Label>
            <Input
              id="auth-email"
              type="email"
              autoComplete="email"
              inputMode="email"
              placeholder="you@domain.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              disabled={busy}
              required
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="auth-password">Password</Label>
            <Input
              id="auth-password"
              type="password"
              autoComplete={
                mode === "sign_in" ? "current-password" : "new-password"
              }
              placeholder={`At least ${MIN_PASSWORD} characters`}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              disabled={busy}
              required
              minLength={MIN_PASSWORD}
            />
          </div>

          {feedback && (
            <p
              role="status"
              className={cn(
                "rounded-md border px-3 py-2 text-xs leading-relaxed",
                feedback.tone === "error"
                  ? "border-rose-500/35 bg-rose-500/10 text-rose-200"
                  : "border-emerald-500/35 bg-emerald-500/10 text-emerald-200"
              )}
            >
              {feedback.message}
            </p>
          )}

          <DialogFooter className="flex-col gap-3 sm:flex-col">
            <Button
              type="submit"
              disabled={busy || !configured}
              className="h-11 w-full bg-emerald-600 text-white hover:bg-emerald-500"
            >
              {busy ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Working…
                </>
              ) : mode === "sign_in" ? (
                <>
                  <Cloud className="h-4 w-4" />
                  Sign In to Vault
                </>
              ) : (
                <>
                  <Shield className="h-4 w-4" />
                  Create Steward Account
                </>
              )}
            </Button>

            <button
              type="button"
              disabled={busy}
              onClick={() => {
                setMode((prev) =>
                  prev === "sign_in" ? "sign_up" : "sign_in"
                );
                setFeedback(null);
              }}
              className="text-center text-xs text-slate-400 transition-colors hover:text-emerald-400"
            >
              {mode === "sign_in"
                ? "New here? Create Steward Account"
                : "Already sealed? Sign In"}
            </button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
