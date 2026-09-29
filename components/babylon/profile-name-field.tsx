"use client";

import { Input } from "@/components/ui/input";
import { GREETING_NAME_FALLBACK } from "@/lib/babylon/constants";
import { cn } from "@/lib/utils";

interface ProfileNameFieldProps {
  value: string;
  onChange: (value: string) => void;
  className?: string;
  inputClassName?: string;
}

/**
 * Steward profile-name configuration. Presentation only — persistence stays
 * on `setUsername` / `babylon_username`. Belongs on management surfaces
 * (phone More, desktop sidebar), not primary chrome greetings.
 */
export function ProfileNameField({
  value,
  onChange,
  className,
  inputClassName,
}: ProfileNameFieldProps) {
  return (
    <label className={cn("block space-y-1", className)}>
      <span className="text-xs text-slate-400">Profile name</span>
      <Input
        value={value}
        onChange={(event) => onChange(event.target.value)}
        onBlur={(event) => onChange(event.target.value)}
        placeholder={GREETING_NAME_FALLBACK}
        aria-label="Profile name"
        className={cn("border-slate-800 bg-slate-900/50", inputClassName)}
      />
    </label>
  );
}
