"use client";

import { Landmark, ShieldCheck, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { NAV_ITEMS } from "@/lib/babylon/constants";
import { cn } from "@/lib/utils";
import type { NavSection } from "@/types/babylon";

interface AppSidebarProps {
  open: boolean;
  activeNav: NavSection;
  onClose: () => void;
  onSelectNav: (section: NavSection) => void;
}

export function AppSidebar({
  open,
  activeNav,
  onClose,
  onSelectNav,
}: AppSidebarProps) {
  return (
    <aside
      className={cn(
        "fixed inset-y-0 left-0 z-50 flex w-72 flex-col border-r border-slate-800/80 bg-slate-950/95 backdrop-blur-xl transition-transform duration-300 lg:translate-x-0",
        open ? "translate-x-0" : "-translate-x-full"
      )}
    >
      <div className="flex items-center justify-between border-b border-slate-800/80 px-5 py-5">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-emerald-500 to-emerald-700 shadow-lg shadow-emerald-900/40">
            <Landmark className="h-5 w-5 text-white" />
          </div>
          <div>
            <p className="font-[family-name:var(--font-display)] text-xl font-semibold leading-none tracking-wide text-slate-50">
              Wealth Engine
            </p>
            <p className="mt-1 text-[10px] uppercase tracking-[0.2em] text-emerald-500/80">
              Babylon Ledger
            </p>
          </div>
        </div>
        <Button
          variant="ghost"
          size="icon"
          className="lg:hidden"
          onClick={onClose}
        >
          <X className="h-4 w-4" />
        </Button>
      </div>

      <nav className="flex flex-1 flex-col gap-1 p-4">
        {NAV_ITEMS.map((item) => {
          const Icon = item.icon;
          const active = activeNav === item.id;
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => onSelectNav(item.id)}
              className={cn(
                "flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-all duration-200",
                active
                  ? "bg-emerald-500/10 text-emerald-400 shadow-inner"
                  : "text-slate-400 hover:bg-slate-900 hover:text-slate-100"
              )}
            >
              <Icon className="h-4 w-4" />
              {item.label}
            </button>
          );
        })}
      </nav>

      <div className="border-t border-slate-800/80 p-4">
        <Card className="border-emerald-900/40 bg-gradient-to-br from-slate-900 to-slate-950">
          <CardContent className="space-y-3 p-4">
            <div className="flex items-center gap-2 text-emerald-400">
              <ShieldCheck className="h-4 w-4" />
              <span className="text-xs font-semibold uppercase tracking-wider">
                10 / 20 / 70
              </span>
            </div>
            <p className="text-xs leading-relaxed text-slate-400">
              Autonomous allocation keeps a tenth forever yours, satisfies
              creditors with a fifth, and lives within seven-tenths.
            </p>
            <div className="grid grid-cols-3 gap-1.5 text-center text-[10px]">
              <div className="rounded-md bg-emerald-500/10 py-1.5 text-emerald-400">
                Keep
              </div>
              <div className="rounded-md bg-amber-500/10 py-1.5 text-amber-400">
                Debt
              </div>
              <div className="rounded-md bg-slate-800 py-1.5 text-slate-300">
                Live
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    </aside>
  );
}
