"use client";

import { useState } from "react";
import { Eye, EyeOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import { FINANCIAL_CALENDAR_UNKNOWN } from "@/lib/babylon/civil-time";
import { GREETING_NAME_FALLBACK } from "@/lib/babylon/constants";

function greetingForHour(hour: number): string {
  if (hour < 12) return "Good morning";
  if (hour < 17) return "Good afternoon";
  return "Good evening";
}

interface MobileHeaderProps {
  username: string;
  isDiscreetMode: boolean;
  openMonthMessage?: string | null;
  onToggleDiscreetMode: () => void;
  financialCalendarKnown?: boolean;
}

/**
 * Compact phone identity. No clock, so this component does not start a timer.
 * The hour is read once when the header mounts.
 */
export function MobileHeader({
  username,
  isDiscreetMode,
  openMonthMessage = null,
  onToggleDiscreetMode,
  financialCalendarKnown = true,
}: MobileHeaderProps) {
  const [greetingHour] = useState(() => new Date().getHours());
  const greetingName = username.trim() || GREETING_NAME_FALLBACK;
  const greeting = greetingForHour(greetingHour);

  return (
    <header className="border-b border-slate-800/60 bg-slate-950 pt-[env(safe-area-inset-top,0px)]">
      <div className="flex items-center justify-between gap-3 px-3 py-2.5">
        <div className="min-w-0">
          <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-500">
            Wealth Engine
          </p>
          <h1 className="truncate font-[family-name:var(--font-display)] text-lg font-semibold leading-tight text-slate-50">
            {greeting},{" "}
            <span className="bg-gradient-to-r from-emerald-300 to-amber-300 bg-clip-text text-transparent">
              {greetingName}
            </span>
          </h1>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <Button
            type="button"
            variant="ghost"
            size="icon"
            onClick={onToggleDiscreetMode}
            aria-pressed={isDiscreetMode}
            aria-label={
              isDiscreetMode ? "Disable discreet mode" : "Enable discreet mode"
            }
            title="Discreet Mode"
          >
            {isDiscreetMode ? (
              <EyeOff className="h-4 w-4 text-amber-300" aria-hidden="true" />
            ) : (
              <Eye className="h-4 w-4" aria-hidden="true" />
            )}
          </Button>
        </div>
      </div>
      {openMonthMessage && financialCalendarKnown ? (
        <p className="px-3 pb-2.5 text-sm leading-relaxed text-slate-300">
          {openMonthMessage}
        </p>
      ) : openMonthMessage ? (
        <p className="px-3 pb-2.5 text-sm leading-relaxed text-slate-300">
          {FINANCIAL_CALENDAR_UNKNOWN}
        </p>
      ) : null}
    </header>
  );
}
