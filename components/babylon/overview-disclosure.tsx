"use client";

import { useState, type ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * Desktop Overview presentation disclosure.
 * Open/closed state stays in this component. It is not stored.
 * Children stay mounted so an editor or launcher inside them is not reset.
 */
export function OverviewDisclosure({
  regionId,
  summary,
  children,
  className,
}: {
  regionId: string;
  summary: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  const [open, setOpen] = useState(false);

  return (
    <div data-overview-disclosure={regionId}>
      <button
        type="button"
        className={cn(
          "flex w-full items-start justify-between gap-3 px-4 py-3 text-left text-slate-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/60 focus-visible:ring-offset-2 focus-visible:ring-offset-slate-950",
          className
        )}
        aria-expanded={open}
        aria-controls={regionId}
        onClick={() => setOpen((value) => !value)}
      >
        <span className="min-w-0 flex-1">{summary}</span>
        <span className="shrink-0 pt-0.5 text-xs font-medium text-slate-500">
          {open ? "Hide" : "Show"}
        </span>
      </button>
      <div id={regionId} hidden={!open}>
        {children}
      </div>
    </div>
  );
}
