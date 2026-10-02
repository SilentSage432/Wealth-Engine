"use client";

import { useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { DestinationRelationship } from "@/lib/babylon/financial-destination";

const ESTABLISH_LABEL = "Declare Emergency Fund minimum";
const REPLACE_LABEL = "Declare a new minimum";

function reasonSentence(reason: "protected_overflow" | "cloud_conflict"): string {
  if (reason === "protected_overflow") {
    return "This comparison is not stated while Already Set Aside exceeds Liquid Position.";
  }
  return "This comparison is not stated while this device and the cloud copy disagree.";
}

/**
 * Reads the derived Emergency Fund destination relationship.
 * Authoring appends a declaration. It does not edit history.
 */
export function EmergencyFundDestinationReading({
  relationship,
  money,
  authoring,
  onDeclare,
}: {
  relationship: DestinationRelationship;
  money: (value: number) => string;
  authoring: boolean;
  onDeclare?: (input: {
    amount: number;
    label?: string;
    rationale?: string;
  }) => string | null;
}) {
  const [open, setOpen] = useState(false);
  const [amount, setAmount] = useState("");
  const [label, setLabel] = useState("");
  const [rationale, setRationale] = useState("");
  const [error, setError] = useState<string | null>(null);
  const canAuthor = authoring && Boolean(onDeclare);

  if (relationship.status === "no_destination" && !canAuthor) return null;

  const close = () => {
    setOpen(false);
    setAmount("");
    setLabel("");
    setRationale("");
    setError(null);
  };

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!onDeclare) return;
    const parsed = Number.parseFloat(amount);
    if (!Number.isFinite(parsed) || parsed < 0) {
      setError("Enter a minimum of zero or more.");
      return;
    }
    const rejection = onDeclare({
      amount: parsed,
      ...(label.trim() ? { label: label.trim() } : {}),
      ...(rationale.trim() ? { rationale: rationale.trim() } : {}),
    });
    if (rejection) {
      setError(rejection);
      return;
    }
    close();
  };

  const form = open ? (
    <form className="mt-3 space-y-2" onSubmit={submit}>
      <div className="space-y-1">
        <Label htmlFor="emergency-fund-destination-amount">Minimum amount</Label>
        <Input
          id="emergency-fund-destination-amount"
          type="number"
          min="0"
          step="0.01"
          inputMode="decimal"
          value={amount}
          onChange={(event) => setAmount(event.target.value)}
          required
        />
      </div>
      <div className="space-y-1">
        <Label htmlFor="emergency-fund-destination-label">Label</Label>
        <Input
          id="emergency-fund-destination-label"
          value={label}
          onChange={(event) => setLabel(event.target.value)}
        />
      </div>
      <div className="space-y-1">
        <Label htmlFor="emergency-fund-destination-rationale">Note</Label>
        <Input
          id="emergency-fund-destination-rationale"
          value={rationale}
          onChange={(event) => setRationale(event.target.value)}
        />
      </div>
      <p className="text-[11px] leading-relaxed text-slate-500">
        You declare this minimum. Wealth Engine does not calculate it.
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

  if (relationship.status === "no_destination") {
    return (
      <div className="mt-3 border-t border-slate-800/80 pt-3">
        {canAuthor ? (
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => setOpen(true)}
          >
            {ESTABLISH_LABEL}
          </Button>
        ) : null}
        {form}
      </div>
    );
  }

  return (
    <div className="mt-3 space-y-1 border-t border-slate-800/80 pt-3">
      <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-500">
        Emergency Fund destination
      </p>
      {relationship.status === "known" ? (
        <div className="space-y-1 text-xs leading-relaxed text-slate-300">
          {relationship.declaration.label ? (
            <p>{relationship.declaration.label}</p>
          ) : null}
          <p>
            Owned Emergency Fund position{" "}
            <span className="tabular-nums text-slate-100">
              {money(relationship.position)}
            </span>
          </p>
          <p>
            Declared minimum{" "}
            <span className="tabular-nums text-slate-100">
              {money(relationship.targetAmount)}
            </span>
          </p>
          {relationship.relationship === "below" ? (
            <p>
              <span className="tabular-nums text-slate-100">
                {money(relationship.remaining)}
              </span>{" "}
              remaining to the declared minimum
            </p>
          ) : relationship.amountAbove > 0 ? (
            <p>
              <span className="tabular-nums text-slate-100">
                {money(relationship.amountAbove)}
              </span>{" "}
              above the declared minimum
            </p>
          ) : (
            <p>At the declared minimum</p>
          )}
          {relationship.declaration.rationale ? (
            <p className="text-slate-500">{relationship.declaration.rationale}</p>
          ) : null}
        </div>
      ) : (
        <div className="space-y-1 text-xs leading-relaxed text-slate-400">
          {relationship.declaration ? (
            <p>
              Declared minimum{" "}
              <span className="tabular-nums text-slate-100">
                {money(relationship.declaration.amount)}
              </span>
            </p>
          ) : null}
          {relationship.reasons.length === 0 ? (
            <p>This comparison is not stated.</p>
          ) : (
            relationship.reasons.map((reason) => (
              <p key={reason}>{reasonSentence(reason)}</p>
            ))
          )}
        </div>
      )}
      {canAuthor && !open ? (
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="mt-2"
          onClick={() => setOpen(true)}
        >
          {REPLACE_LABEL}
        </Button>
      ) : null}
      {canAuthor ? form : null}
    </div>
  );
}
