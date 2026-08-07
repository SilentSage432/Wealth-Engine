"use client";

import { Landmark, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type PlaidLinkButtonVariant = "icon" | "button";

interface PlaidLinkButtonProps {
  variant?: PlaidLinkButtonVariant;
  launching?: boolean;
  disabled?: boolean;
  className?: string;
  label?: string;
  onClick: () => void;
}

/**
 * Presentation control that launches Plaid Link (handler owned by caller).
 */
export function PlaidLinkButton({
  variant = "button",
  launching = false,
  disabled = false,
  className,
  label = "Link Bank",
  onClick,
}: PlaidLinkButtonProps) {
  if (variant === "icon") {
    return (
      <Button
        type="button"
        variant="ghost"
        size="icon"
        onClick={onClick}
        disabled={disabled || launching}
        aria-label={launching ? "Opening bank link…" : "Link bank account"}
        title="Link Bank"
        className={cn("shrink-0", className)}
      >
        {launching ? (
          <Loader2 className="h-4 w-4 animate-spin text-emerald-300" aria-hidden="true" />
        ) : (
          <Landmark className="h-4 w-4" aria-hidden="true" />
        )}
      </Button>
    );
  }

  return (
    <Button
      type="button"
      variant="outline"
      onClick={onClick}
      disabled={disabled || launching}
      aria-label={launching ? "Opening bank link…" : label}
      className={cn("gap-2", className)}
    >
      {launching ? (
        <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
      ) : (
        <Landmark className="h-4 w-4" aria-hidden="true" />
      )}
      {launching ? "Opening…" : label}
    </Button>
  );
}
