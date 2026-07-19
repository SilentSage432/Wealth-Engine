"use client";

import { CalendarDays, Menu, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

interface CommandBarProps {
  greeting: string;
  displayName: string;
  localizedDate: string;
  localizedTime: string;
  onDisplayNameChange: (value: string) => void;
  onOpenSidebar: () => void;
  onRecordTribute: () => void;
}

export function CommandBar({
  greeting,
  displayName,
  localizedDate,
  localizedTime,
  onDisplayNameChange,
  onOpenSidebar,
  onRecordTribute,
}: CommandBarProps) {
  return (
    <header className="sticky top-0 z-30 border-b border-slate-800/60 bg-slate-950/80 backdrop-blur-xl">
      <div className="flex flex-col gap-4 px-4 py-4 sm:px-6 lg:flex-row lg:items-center lg:justify-between lg:px-8">
        <div className="flex items-start gap-3">
          <Button
            variant="ghost"
            size="icon"
            className="mt-0.5 shrink-0 lg:hidden"
            onClick={onOpenSidebar}
          >
            <Menu className="h-5 w-5" />
          </Button>
          <div className="animate-fade-up">
            <p className="text-xs uppercase tracking-[0.18em] text-emerald-500/90">
              Executive Command
            </p>
            <h1 className="font-[family-name:var(--font-display)] text-2xl font-semibold text-slate-50 sm:text-3xl">
              {greeting},{" "}
              <span className="bg-gradient-to-r from-emerald-300 to-amber-300 bg-clip-text text-transparent">
                {displayName}
              </span>
            </h1>
            <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-slate-400">
              <span className="inline-flex items-center gap-1.5">
                <CalendarDays className="h-3.5 w-3.5 text-slate-500" />
                {localizedDate}
              </span>
              <span className="hidden text-slate-700 sm:inline">·</span>
              <span className="font-mono text-xs tabular-nums text-slate-500">
                {localizedTime}
              </span>
            </div>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2 sm:gap-3">
          <Input
            value={displayName}
            onChange={(e) => onDisplayNameChange(e.target.value || "Steward")}
            className="h-9 w-32 border-slate-800 bg-slate-900/50 text-xs sm:w-40"
            aria-label="Display name"
          />
          <Button
            variant="amber"
            size="lg"
            className="shadow-amber-900/20"
            onClick={onRecordTribute}
          >
            <Plus className="h-4 w-4" />
            Record Tribute
          </Button>
        </div>
      </div>
    </header>
  );
}
