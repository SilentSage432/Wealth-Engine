"use client";

import { useMemo, useState } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  desiresPoolSharePct,
  laborHoursForAmount,
} from "@/lib/babylon/engine";
import { formatCurrency } from "@/lib/utils";

interface AffordabilityAnchorProps {
  desiresPoolRemaining: number;
  hourlyLaborRate: number;
}

export function AffordabilityAnchor({
  desiresPoolRemaining,
  hourlyLaborRate,
}: AffordabilityAnchorProps) {
  const [amountRaw, setAmountRaw] = useState("");

  const amount = useMemo(() => {
    const parsed = Number.parseFloat(amountRaw);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
  }, [amountRaw]);

  const poolPct = useMemo(
    () =>
      amount === null
        ? null
        : desiresPoolSharePct(amount, desiresPoolRemaining),
    [amount, desiresPoolRemaining]
  );

  const laborHours = useMemo(
    () =>
      amount === null ? null : laborHoursForAmount(amount, hourlyLaborRate),
    [amount, hourlyLaborRate]
  );

  return (
    <section className="animate-fade-up rounded-xl border border-slate-800/80 bg-slate-900/40 px-4 py-4 sm:px-5">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div className="min-w-0 flex-1 space-y-1">
          <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-500">
            Affordability Anchor
          </p>
          <p className="text-sm text-slate-400">
            Test a discretionary purchase against this month&apos;s remaining
            Desires pool and your labor rate.
          </p>
        </div>

        <div className="w-full shrink-0 space-y-1.5 sm:max-w-[14rem]">
          <Label
            htmlFor="affordability-amount"
            className="text-[11px] uppercase tracking-wider text-slate-500"
          >
            Purchase amount
          </Label>
          <Input
            id="affordability-amount"
            type="number"
            min="0.01"
            step="0.01"
            placeholder="0.00"
            value={amountRaw}
            onChange={(e) => setAmountRaw(e.target.value)}
            className="border-slate-800 bg-slate-950/60 tabular-nums"
          />
        </div>
      </div>

      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <div className="rounded-lg border border-slate-800/70 bg-slate-950/40 px-3.5 py-3">
          <p className="text-[10px] uppercase tracking-wider text-slate-500">
            Of remaining Desires pool
          </p>
          <p className="mt-1 font-[family-name:var(--font-display)] text-2xl font-semibold tabular-nums text-slate-100">
            {poolPct === null ? "—" : `${poolPct}%`}
          </p>
          <p className="mt-1 text-xs text-slate-500">
            Pool remaining: {formatCurrency(desiresPoolRemaining)}
          </p>
        </div>
        <div className="rounded-lg border border-slate-800/70 bg-slate-950/40 px-3.5 py-3">
          <p className="text-[10px] uppercase tracking-wider text-slate-500">
            Labor hours required
          </p>
          <p className="mt-1 font-[family-name:var(--font-display)] text-2xl font-semibold tabular-nums text-slate-100">
            {laborHours === null ? "—" : `${laborHours}h`}
          </p>
          <p className="mt-1 text-xs text-slate-500">
            {hourlyLaborRate > 0
              ? `Effective rate: ${formatCurrency(hourlyLaborRate)}/hr`
              : "Add recurring income to compute rate"}
          </p>
        </div>
      </div>
    </section>
  );
}
