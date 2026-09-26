"use client";

import { MOBILE_NAV_ITEMS, type MobileDestination } from "@/lib/babylon/constants";
import { cn } from "@/lib/utils";

/** Clears the fixed phone bar and the home-indicator inset. */
export const MOBILE_NAV_CLEARANCE =
  "pb-[calc(4.5rem+env(safe-area-inset-bottom,0px))]";

interface MobileBottomNavProps {
  destination: MobileDestination;
  onDestinationChange: (destination: MobileDestination) => void;
}

export function MobileBottomNav({
  destination,
  onDestinationChange,
}: MobileBottomNavProps) {
  return (
    <nav
      aria-label="Primary"
      className="fixed inset-x-0 bottom-0 z-30 border-t border-slate-800/80 bg-slate-950 pb-[env(safe-area-inset-bottom,0px)] lg:hidden"
    >
      <div className="grid grid-cols-4">
        {MOBILE_NAV_ITEMS.map((item) => {
          const Icon = item.icon;
          const active = destination === item.id;
          return (
            <button
              key={item.id}
              type="button"
              aria-current={active ? "page" : undefined}
              onClick={() => onDestinationChange(item.id)}
              className={cn(
                "flex h-16 min-h-16 min-w-0 flex-col items-center justify-center gap-1 px-1 text-[11px] leading-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-emerald-500/60",
                active
                  ? "font-semibold text-emerald-300"
                  : "font-medium text-slate-500"
              )}
            >
              <span
                aria-hidden="true"
                className={cn(
                  "h-0.5 w-5 rounded-full",
                  active ? "bg-current" : "bg-transparent"
                )}
              />
              <Icon
                className="h-5 w-5"
                strokeWidth={active ? 2.5 : 1.75}
                aria-hidden="true"
              />
              <span className="truncate">{item.label}</span>
            </button>
          );
        })}
      </div>
    </nav>
  );
}
