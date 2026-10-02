"use client";

import { useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  formatDirectionShare,
  type WealthDirectionState,
} from "@/lib/babylon/financial-direction";
import { formatCurrency } from "@/lib/utils";

const ESTABLISH_LABEL = "Declare Emergency Fund direction";
const REPLACE_LABEL = "Declare a new share";

/**
 * Percent text to integer basis points.
 * "50" is 5000. "50.5" is 5050. Blank and non-canonical percents are null.
 */
export function percentToBasisPoints(raw: string): number | null {
  const trimmed = raw.trim();
  if (!/^\d+(\.\d{1,2})?$/.test(trimmed)) return null;
  const [whole, fraction = ""] = trimmed.split(".");
  const padded = (fraction + "00").slice(0, 2);
  const basisPoints = Number(whole) * 100 + Number(padded);
  if (!Number.isInteger(basisPoints) || basisPoints < 1 || basisPoints > 10000) {
    return null;
  }
  return basisPoints;
}

/**
 * Standing intent for new received Wealth Building capacity.
 * Authoring appends a declaration. It does not edit history or a monthly plan.
 */
export function WealthDirectionPanel({
  direction,
  authoring,
  onDeclare,
  destinationAmount,
}: {
  direction: WealthDirectionState;
  authoring: boolean;
  onDeclare?: (input: { basisPoints: number }) => string | null;
  destinationAmount?: number | null;
}) {
  const [open, setOpen] = useState(false);
  const [share, setShare] = useState("");
  const [error, setError] = useState<string | null>(null);
  const canAuthor = authoring && Boolean(onDeclare);

  const close = () => {
    setOpen(false);
    setShare("");
    setError(null);
  };

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!onDeclare) return;
    const basisPoints = percentToBasisPoints(share);
    if (basisPoints === null) {
      setError("Enter a share from 0.01% through 100%.");
      return;
    }
    const rejection = onDeclare({ basisPoints });
    if (rejection) {
      setError(rejection);
      return;
    }
    close();
  };

  const form = open ? (
    <form className="mt-3 space-y-2" onSubmit={submit}>
      <div className="space-y-1">
        <Label htmlFor="wealth-direction-share">
          Share of new Wealth Building capacity
        </Label>
        <Input
          id="wealth-direction-share"
          type="text"
          inputMode="decimal"
          value={share}
          onChange={(event) => setShare(event.target.value)}
          required
        />
      </div>
      <p className="text-[11px] leading-relaxed text-slate-500">
        You declare this share. Wealth Engine does not choose it.
      </p>
      {error ? (
        <p role="alert" className="text-xs leading-relaxed text-amber-200">
          {error}
        </p>
      ) : null}
      <div className="flex flex-wrap gap-2">
        <Button type="submit" size="sm">
          Save declaration
        </Button>
        <Button type="button" size="sm" variant="outline" onClick={close}>
          Cancel
        </Button>
      </div>
    </form>
  ) : null;

  const destinationContext =
    typeof destinationAmount === "number" ? (
      <p className="mt-2 text-[11px] leading-relaxed text-slate-500">
        Separate from this intent, the Emergency Fund destination is a minimum
        of {formatCurrency(destinationAmount)}.
      </p>
    ) : null;

  if (direction.status === "invalid") {
    return (
      <section
        aria-label="Wealth Direction"
        className="rounded-xl border border-slate-800/90 bg-slate-950/60 p-3 sm:p-4"
      >
        <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-500">
          Wealth Direction
        </p>
        <p className="mt-2 text-sm leading-relaxed text-slate-300">
          This direction is not stated.
        </p>
      </section>
    );
  }

  const current =
    direction.status === "valid_direction" ? direction.declaration : null;

  return (
    <section
      aria-label="Wealth Direction"
      className="rounded-xl border border-slate-800/90 bg-slate-950/60 p-3 sm:p-4"
    >
      <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-500">
        Wealth Direction
      </p>
      <p className="mt-2 text-sm leading-relaxed text-slate-200">
        {current
          ? `${formatDirectionShare(current.basisPoints)} of new received Wealth Building capacity is intended for the Emergency Fund. The rest remains Wealth Building.`
          : "No additional purpose has been declared for new Wealth Building capacity."}
      </p>
      <p className="mt-1 text-[11px] leading-relaxed text-slate-500">
        This applies to new received Wealth Building capacity. It is intent,
        not proof money moved. A monthly plan amount is planned capacity, not
        received income.
      </p>
      {destinationContext}
      {canAuthor && !open ? (
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="mt-3"
          onClick={() => setOpen(true)}
        >
          {current ? REPLACE_LABEL : ESTABLISH_LABEL}
        </Button>
      ) : null}
      {canAuthor ? form : null}
    </section>
  );
}
