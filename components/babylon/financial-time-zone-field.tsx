"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { canonicalIanaTimeZone } from "@/lib/babylon/civil-time";
import { readBrowserIanaTimeZone } from "@/lib/babylon/notification-device";

interface FinancialTimeZoneFieldProps {
  financialTimeZone?: string;
  onEstablish: (zone: string) => boolean;
}

/**
 * Steward confirmation for the financial calendar timezone.
 * The browser zone may fill the draft. It is not saved until the steward
 * confirms. Notification delivery is a separate setting.
 */
export function FinancialTimeZoneField({
  financialTimeZone,
  onEstablish,
}: FinancialTimeZoneFieldProps) {
  const [draft, setDraft] = useState(financialTimeZone ?? "");
  const [note, setNote] = useState<string | null>(null);
  useEffect(() => {
    setDraft(financialTimeZone ?? "");
  }, [financialTimeZone]);
  const suggestion = readBrowserIanaTimeZone();
  const established = financialTimeZone ?? null;

  function save() {
    const accepted = onEstablish(draft);
    setNote(accepted ? null : "Enter a valid IANA timezone.");
  }

  const draftCanonical = canonicalIanaTimeZone(draft);
  const unchanged = draftCanonical !== null && draftCanonical === established;

  return (
    <div className="space-y-2 rounded-lg border border-slate-800 bg-slate-900/40 p-3">
      <p className="text-xs font-medium text-slate-200">Financial time zone</p>
      <p className="text-xs leading-relaxed text-slate-400">
        This is Wealth Engine&apos;s financial calendar. It is not this
        device&apos;s clock and not notification delivery.
      </p>
      <p className="text-xs text-slate-300">
        {established ? established : "Not established"}
      </p>
      <Input
        value={draft}
        onChange={(event) => {
          setDraft(event.target.value);
          setNote(null);
        }}
        aria-label="Financial time zone"
        placeholder="America/Denver"
        className="border-slate-800 bg-slate-900/50"
      />
      {suggestion ? (
        <Button
          type="button"
          variant="ghost"
          className="h-auto px-0 text-xs text-slate-300"
          onClick={() => {
            setDraft(suggestion);
            setNote(
              `This device suggests ${suggestion}. It is not saved until you confirm.`
            );
          }}
        >
          Use {suggestion} as the draft
        </Button>
      ) : null}
      <Button
        type="button"
        size="sm"
        disabled={!draft.trim() || unchanged}
        onClick={save}
      >
        {established ? "Change financial time zone" : "Establish financial time zone"}
      </Button>
      {note ? <p className="text-xs text-slate-400">{note}</p> : null}
    </div>
  );
}
