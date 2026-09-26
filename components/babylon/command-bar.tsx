"use client";

import { useEffect, useState } from "react";
import { CalendarCheck, CalendarDays, Eye, EyeOff, Menu, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PlaidLinkButton } from "@/components/babylon/plaid-link-button";
import { VaultErrorBoundary } from "@/components/babylon/vault-error-boundary";
import { GREETING_NAME_FALLBACK } from "@/lib/babylon/constants";

function greetingForHour(hour: number): string {
  if (hour < 12) return "Good morning";
  if (hour < 17) return "Good afternoon";
  return "Good evening";
}

interface CommandBarProps {
  username: string;
  monthAlreadyClosed?: boolean;
  openMonthMessage?: string | null;
  isDiscreetMode?: boolean;
  plaidLaunching?: boolean;
  plaidInitializing?: boolean;
  onUsernameChange: (value: string) => void;
  onOpenSidebar: () => void;
  onRecordTribute: () => void;
  onOpenMonthlyClose?: () => void;
  onToggleDiscreetMode?: () => void;
  onLinkBank?: () => void;
}

export function CommandBar({
  username,
  monthAlreadyClosed = false,
  openMonthMessage = null,
  isDiscreetMode = false,
  plaidLaunching = false,
  plaidInitializing = false,
  onUsernameChange,
  onOpenSidebar,
  onRecordTribute,
  onOpenMonthlyClose,
  onToggleDiscreetMode,
  onLinkBank,
}: CommandBarProps) {
  const greetingName = username.trim() || GREETING_NAME_FALLBACK;
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  const greeting = greetingForHour(now.getHours());
  const localizedDate = now.toLocaleDateString("en-US", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  });
  const localizedTime = now.toLocaleTimeString("en-US", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });

  return (
    <header className="border-b border-slate-800/60 bg-slate-950">
      <div className="mx-auto flex w-full max-w-screen-2xl flex-col gap-3 px-3 py-3 sm:gap-4 sm:px-6 sm:py-4 lg:flex-row lg:items-center lg:justify-between lg:px-8">
        <div className="flex min-w-0 items-start gap-2 sm:gap-3">
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="mt-0.5 shrink-0 lg:hidden"
            onClick={onOpenSidebar}
            aria-label="Open navigation"
          >
            <Menu className="h-5 w-5" />
          </Button>
          <div className="min-w-0 animate-fade-up">
            <h1 className="font-[family-name:var(--font-display)] text-xl font-semibold leading-tight text-slate-50 md:text-2xl lg:text-3xl">
              {greeting},{" "}
              <span className="bg-gradient-to-r from-emerald-300 to-amber-300 bg-clip-text text-transparent">
                {greetingName}
              </span>
            </h1>
            <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-400 sm:text-sm">
              <span className="inline-flex items-center gap-1.5">
                <CalendarDays className="h-3.5 w-3.5 shrink-0 text-slate-500" />
                <span className="truncate">{localizedDate}</span>
              </span>
              <span className="hidden text-slate-700 sm:inline">·</span>
              <span className="font-mono text-[11px] tabular-nums text-slate-500 sm:text-xs">
                {localizedTime}
              </span>
            </div>
          </div>
        </div>

        <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto sm:gap-3 lg:justify-end">
          {onToggleDiscreetMode && (
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
              className="shrink-0"
            >
              {isDiscreetMode ? (
                <EyeOff className="h-4 w-4 text-amber-300" aria-hidden="true" />
              ) : (
                <Eye className="h-4 w-4" aria-hidden="true" />
              )}
            </Button>
          )}

          <VaultErrorBoundary compact>
            <PlaidLinkButton
              variant="icon"
              launching={plaidLaunching}
              initializing={plaidInitializing || !onLinkBank}
              onClick={onLinkBank}
            />
          </VaultErrorBoundary>

          <Input
            value={username}
            onChange={(e) => onUsernameChange(e.target.value)}
            onBlur={(e) => onUsernameChange(e.target.value)}
            placeholder={GREETING_NAME_FALLBACK}
            className="h-11 min-h-11 w-full max-w-none border-slate-800 bg-slate-900/50 text-base sm:w-36 sm:max-w-[10rem] md:h-9 md:min-h-9 md:text-xs lg:w-40"
            aria-label="Profile name"
          />
          {onOpenMonthlyClose && (
            <Button
              type="button"
              variant="outline"
              size="lg"
              className="min-h-11 w-full flex-1 sm:w-auto sm:flex-none"
              onClick={onOpenMonthlyClose}
              disabled={monthAlreadyClosed}
              aria-label={
                monthAlreadyClosed
              ? "Month already closed"
              : "Close this month"
              }
            >
              <CalendarCheck className="h-4 w-4" aria-hidden="true" />
              {monthAlreadyClosed ? "Month closed" : "Close Month"}
            </Button>
          )}
          <Button
            type="button"
            variant="amber"
            size="lg"
            className="min-h-11 w-full flex-1 shadow-amber-900/20 sm:w-auto sm:flex-none"
            onClick={onRecordTribute}
            aria-label="Add (shortcut N)"
            title="Add · N"
          >
            <Plus className="h-4 w-4" aria-hidden="true" />
            Add
          </Button>
        </div>
        {openMonthMessage && onOpenMonthlyClose ? (
          <p className="text-sm leading-relaxed text-slate-300">
            {openMonthMessage}{" "}
            <button
              type="button"
              className="font-medium text-emerald-300 underline-offset-2 hover:underline"
              onClick={onOpenMonthlyClose}
            >
              Review close
            </button>
          </p>
        ) : null}
      </div>
    </header>
  );
}
