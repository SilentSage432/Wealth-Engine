"use client";

import { DEFAULT_PRESETS, type QuickPreset } from "@/lib/babylon/presets";
import { cn } from "@/lib/utils";

interface SpeedTributeBarProps {
  presets?: readonly QuickPreset[];
  onSelectPreset: (preset: QuickPreset) => void;
  className?: string;
}

/**
 * Horizontal 1-tap preset chips for Speed-Tribute entry.
 * Opens Application tribute flow; does not invent ledger math.
 */
export function SpeedTributeBar({
  presets = DEFAULT_PRESETS,
  onSelectPreset,
  className,
}: SpeedTributeBarProps) {
  return (
    <div
      className={cn(
        "border-b border-slate-800/60 bg-slate-950/70 backdrop-blur-xl",
        className
      )}
    >
      <div className="mx-auto flex w-full max-w-screen-2xl items-center gap-2 px-3 py-2.5 sm:px-6 lg:px-8">
        <p className="hidden shrink-0 text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-500 sm:block">
          Speed Tribute
        </p>
        <div
          role="list"
          aria-label="Quick tribute presets"
          className="flex min-w-0 flex-1 gap-2 overflow-x-auto scrollbar-thin pb-0.5"
        >
          {presets.map((preset) => (
            <button
              key={preset.id}
              type="button"
              role="listitem"
              onClick={() => onSelectPreset(preset)}
              aria-label={`${preset.type === "income" ? "Income" : "Expense"} preset: ${preset.label}`}
              className={cn(
                "inline-flex shrink-0 items-center gap-1.5 rounded-lg border px-3 py-2 text-xs font-medium transition-colors",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/50",
                preset.type === "income"
                  ? "border-emerald-900/50 bg-emerald-950/40 text-emerald-200 hover:bg-emerald-900/50"
                  : "border-slate-700/80 bg-slate-900/60 text-slate-200 hover:bg-slate-800/80"
              )}
            >
              <span aria-hidden="true" className="text-sm leading-none">
                {preset.icon}
              </span>
              <span className="whitespace-nowrap">{preset.label}</span>
              {preset.amount != null && (
                <span className="tabular-nums text-slate-500">
                  ${preset.amount}
                </span>
              )}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
