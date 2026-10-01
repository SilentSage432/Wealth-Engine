"use client";

import { useState, type ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * Phone More presentation disclosure.
 * Open/closed state stays in this component. It is not stored.
 * Children stay mounted so a form, file input, or dialog inside them is not reset.
 * The toggle only changes this open flag.
 */
export function PhoneMaintenanceDisclosure({
  regionId,
  summary,
  children,
  allowClosed,
  className,
}: {
  regionId: string;
  summary: ReactNode;
  children: ReactNode;
  /** When false, the machinery stays visible and there is no toggle. */
  allowClosed: boolean;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const expanded = open || !allowClosed;

  return (
    <div data-more-maintenance={regionId}>
      {allowClosed ? (
        <button
          type="button"
          className={cn(
            "flex min-h-11 w-full items-start justify-between gap-3 rounded-lg border border-slate-800 px-3 py-2 text-left text-sm text-slate-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/60",
            className
          )}
          aria-expanded={expanded}
          aria-controls={regionId}
          onClick={() => setOpen((value) => !value)}
        >
          <span className="min-w-0 flex-1">{summary}</span>
          <span className="shrink-0 pt-0.5 text-xs text-slate-500">
            {expanded ? "Hide" : "Show"}
          </span>
        </button>
      ) : null}
      <div id={regionId} hidden={!expanded}>
        {children}
      </div>
    </div>
  );
}
