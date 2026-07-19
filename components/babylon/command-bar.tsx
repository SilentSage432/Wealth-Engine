"use client";

import { CalendarCheck, CalendarDays, Menu, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { GREETING_NAME_FALLBACK } from "@/lib/babylon/constants";

interface CommandBarProps {
  greeting: string;
  username: string;
  localizedDate: string;
  localizedTime: string;
  monthAlreadyClosed?: boolean;
  onUsernameChange: (value: string) => void;
  onOpenSidebar: () => void;
  onRecordTribute: () => void;
  onOpenMonthlyClose?: () => void;
}

export function CommandBar({
  greeting,
  username,
  localizedDate,
  localizedTime,
  monthAlreadyClosed = false,
  onUsernameChange,
  onOpenSidebar,
  onRecordTribute,
  onOpenMonthlyClose,
}: CommandBarProps) {
  const greetingName = username.trim() || GREETING_NAME_FALLBACK;

  return (
    <header className="sticky top-0 z-30 border-b border-slate-800/60 bg-slate-950/80 backdrop-blur-xl">
      <div className="mx-auto flex w-full max-w-screen-2xl flex-col gap-3 px-3 py-3 sm:gap-4 sm:px-6 sm:py-4 lg:flex-row lg:items-center lg:justify-between lg:px-8">
        <div className="flex min-w-0 items-start gap-2 sm:gap-3">
          <Button
            variant="ghost"
            size="icon"
            className="mt-0.5 shrink-0 lg:hidden"
            onClick={onOpenSidebar}
            aria-label="Open navigation"
          >
            <Menu className="h-5 w-5" />
          </Button>
          <div className="min-w-0 animate-fade-up">
            <p className="text-[10px] uppercase tracking-[0.18em] text-emerald-500/90 sm:text-xs">
              Executive Command
            </p>
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
              variant="outline"
              size="lg"
              className="min-h-11 w-full flex-1 sm:w-auto sm:flex-none"
              onClick={onOpenMonthlyClose}
              disabled={monthAlreadyClosed}
              aria-label={
                monthAlreadyClosed
                  ? "Month already sealed"
                  : "Open monthly close ritual"
              }
            >
              <CalendarCheck className="h-4 w-4" aria-hidden="true" />
              {monthAlreadyClosed ? "Month Sealed" : "Close Month"}
            </Button>
          )}
          <Button
            variant="amber"
            size="lg"
            className="min-h-11 w-full flex-1 shadow-amber-900/20 sm:w-auto sm:flex-none"
            onClick={onRecordTribute}
            aria-label="Record Tribute (shortcut N)"
            title="Record Tribute · N"
          >
            <Plus className="h-4 w-4" aria-hidden="true" />
            Record Tribute
          </Button>
        </div>
      </div>
    </header>
  );
}
