"use client";

import { Landmark, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { emitVaultToast } from "@/lib/babylon/vault-toast";
import { cn } from "@/lib/utils";

type PlaidLinkButtonVariant = "icon" | "button";

interface PlaidLinkButtonProps {
  variant?: PlaidLinkButtonVariant;
  /** True while link-token fetch / Link modal is opening. */
  launching?: boolean;
  /** True before the Plaid controller is ready (never hide the control). */
  initializing?: boolean;
  disabled?: boolean;
  className?: string;
  label?: string;
  onClick?: () => void;
}

/**
 * Presentation control that launches Plaid Link.
 * Always mounts — never returns null for missing tokens / env setup.
 */
export function PlaidLinkButton({
  variant = "button",
  launching = false,
  initializing = false,
  disabled = false,
  className,
  label = "Connect Bank",
  onClick,
}: PlaidLinkButtonProps) {
  const busy = launching || initializing;
  const displayLabel = initializing
    ? "Connect Bank"
    : launching
      ? "Opening…"
      : label;

  const handleClick = () => {
    if (initializing || !onClick) {
      emitVaultToast({
        tone: "info",
        message: "Initializing Plaid connection...",
        durationMs: 0,
      });
      return;
    }
    onClick();
  };

  if (variant === "icon") {
    return (
      <Button
        type="button"
        variant="ghost"
        size="icon"
        onClick={handleClick}
        disabled={disabled}
        aria-busy={busy || undefined}
        aria-label={
          initializing
            ? "Connect bank — initializing"
            : launching
              ? "Opening bank link…"
              : "Connect bank account"
        }
        title="Connect Bank"
        className={cn(
          "shrink-0 border border-transparent",
          initializing && "opacity-80",
          className
        )}
      >
        {busy ? (
          <Loader2
            className="h-4 w-4 animate-spin text-emerald-300"
            aria-hidden="true"
          />
        ) : (
          <Landmark className="h-4 w-4 text-emerald-300" aria-hidden="true" />
        )}
      </Button>
    );
  }

  return (
    <Button
      type="button"
      variant="outline"
      onClick={handleClick}
      disabled={disabled}
      aria-busy={busy || undefined}
      aria-label={displayLabel}
      className={cn("gap-2", className)}
    >
      {busy ? (
        <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
      ) : (
        <Landmark className="h-4 w-4" aria-hidden="true" />
      )}
      {displayLabel}
    </Button>
  );
}
