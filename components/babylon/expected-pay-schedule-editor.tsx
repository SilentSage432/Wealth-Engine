"use client";

import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { FINANCIAL_CALENDAR_UNKNOWN } from "@/lib/babylon/civil-time";
import { cadenceLabel } from "@/lib/babylon/paycheck-planner-ui";
import { parsePaySchedule } from "@/lib/babylon/pay-schedule";
import { generateId } from "@/lib/utils";
import type {
  PaySchedule,
  PayScheduleCadence,
  SemimonthlyMonthDay,
} from "@/types/babylon";

export type PayScheduleUpsertResult =
  | { ok: true }
  | { ok: false; message: string };

interface ExpectedPayScheduleEditorProps {
  schedules: readonly PaySchedule[];
  financialToday?: string | null;
  onUpsert: (schedule: PaySchedule) => PayScheduleUpsertResult;
  onRemove: (id: string) => void;
}

function describeSchedule(schedule: PaySchedule): string {
  if (schedule.cadence === "weekly" || schedule.cadence === "biweekly") {
    return `${cadenceLabel(schedule.cadence)} · phase ${schedule.anchorDate}`;
  }
  if (schedule.cadence === "monthly") {
    return `${cadenceLabel(schedule.cadence)} · day ${schedule.dayOfMonth}`;
  }
  return `${cadenceLabel(schedule.cadence)} · ${String(schedule.firstDay)} & ${String(schedule.secondDay)}`;
}

function parseDayField(raw: string): SemimonthlyMonthDay | null {
  const trimmed = raw.trim().toLowerCase();
  if (trimmed === "last") return "last";
  const value = Number.parseInt(trimmed, 10);
  if (!Number.isInteger(value) || value < 1 || value > 31) return null;
  return value;
}

export function ExpectedPayScheduleEditor({
  schedules,
  financialToday = null,
  onUpsert,
  onRemove,
}: ExpectedPayScheduleEditorProps) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [cadence, setCadence] = useState<PayScheduleCadence>("biweekly");
  const [anchorDate, setAnchorDate] = useState("");
  const [dayOfMonth, setDayOfMonth] = useState("1");
  const [firstDay, setFirstDay] = useState("1");
  const [secondDay, setSecondDay] = useState("15");
  const [label, setLabel] = useState("");
  const [expectedAmount, setExpectedAmount] = useState("");
  const [message, setMessage] = useState<string | null>(null);

  const editing = useMemo(
    () => schedules.find((row) => row.id === editingId) ?? null,
    [schedules, editingId]
  );

  const resetForm = () => {
    setEditingId(null);
    setCadence("biweekly");
    setAnchorDate("");
    setDayOfMonth("1");
    setFirstDay("1");
    setSecondDay("15");
    setLabel("");
    setExpectedAmount("");
    setMessage(null);
  };

  const loadSchedule = (schedule: PaySchedule) => {
    setEditingId(schedule.id);
    setCadence(schedule.cadence);
    setLabel(schedule.label ?? "");
    setExpectedAmount(
      schedule.expectedAmount !== undefined
        ? String(schedule.expectedAmount)
        : ""
    );
    if (schedule.cadence === "weekly" || schedule.cadence === "biweekly") {
      setAnchorDate(schedule.anchorDate);
    } else if (schedule.cadence === "monthly") {
      setDayOfMonth(String(schedule.dayOfMonth));
    } else {
      setFirstDay(String(schedule.firstDay));
      setSecondDay(String(schedule.secondDay));
    }
    setMessage(null);
  };

  const submit = () => {
    const id = editing?.id ?? generateId();
    const createdAt = editing?.createdAt ?? financialToday;
    if (!createdAt) {
      setMessage(FINANCIAL_CALENDAR_UNKNOWN);
      return;
    }
    const amountText = expectedAmount.trim();
    const labelText = label.trim();
    const amountValue =
      amountText === "" ? undefined : Number.parseFloat(amountText);

    const draft: Record<string, unknown> = {
      id,
      createdAt,
      cadence,
      ...(labelText ? { label: labelText } : {}),
      ...(amountValue !== undefined ? { expectedAmount: amountValue } : {}),
    };

    if (cadence === "weekly" || cadence === "biweekly") {
      draft.anchorDate = anchorDate.trim();
    } else if (cadence === "monthly") {
      draft.dayOfMonth = Number.parseInt(dayOfMonth, 10);
    } else {
      const first = parseDayField(firstDay);
      const second = parseDayField(secondDay);
      if (first === null || second === null) {
        setMessage("Enter days 1–31 or last for twice-a-month schedules.");
        return;
      }
      draft.firstDay = first;
      draft.secondDay = second;
    }

    const parsed = parsePaySchedule(draft);
    if (!parsed) {
      setMessage("Check the expected pay schedule fields and try again.");
      return;
    }
    const outcome = onUpsert(parsed);
    if (!outcome.ok) {
      setMessage(outcome.message);
      return;
    }
    resetForm();
  };

  return (
    <div
      className="space-y-4 rounded-xl border border-slate-800/80 bg-slate-950/50 p-4"
      aria-label="Expected pay schedule"
    >
      <div className="space-y-1">
        <h4 className="text-sm font-medium text-slate-100">
          Expected pay schedule
        </h4>
        <p className="text-xs leading-relaxed text-slate-500">
          Planning schedule only. Expected paydays are not income.
        </p>
      </div>

      {schedules.length > 0 ? (
        <ul className="space-y-2" aria-label="Saved expected pay schedules">
          {schedules.map((schedule) => (
            <li
              key={schedule.id}
              className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-slate-800/70 px-3 py-2"
            >
              <div className="min-w-0">
                <p className="truncate text-sm text-slate-200">
                  {schedule.label?.trim() || cadenceLabel(schedule.cadence)}
                </p>
                <p className="text-xs text-slate-500">
                  {describeSchedule(schedule)}
                  {schedule.expectedAmount !== undefined
                    ? ` · estimate ${schedule.expectedAmount}`
                    : ""}
                </p>
              </div>
              <div className="flex gap-2">
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => loadSchedule(schedule)}
                >
                  Edit
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => onRemove(schedule.id)}
                >
                  Remove
                </Button>
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-xs text-slate-500">No expected pay schedule yet.</p>
      )}

      <div className="space-y-3 border-t border-slate-800/80 pt-3">
        <p className="text-xs font-medium uppercase tracking-[0.14em] text-slate-500">
          {editing ? "Edit schedule" : "Add schedule"}
        </p>

        <div className="space-y-2">
          <Label htmlFor="pay-schedule-cadence">Cadence</Label>
          <Select
            value={cadence}
            onValueChange={(value) => setCadence(value as PayScheduleCadence)}
          >
            <SelectTrigger id="pay-schedule-cadence" aria-label="Cadence">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="weekly">Weekly</SelectItem>
              <SelectItem value="biweekly">Every two weeks</SelectItem>
              <SelectItem value="semimonthly">Twice a month</SelectItem>
              <SelectItem value="monthly">Monthly</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {cadence === "weekly" || cadence === "biweekly" ? (
          <div className="space-y-2">
            <Label htmlFor="pay-schedule-anchor">Phase date</Label>
            <Input
              id="pay-schedule-anchor"
              type="date"
              value={anchorDate}
              onChange={(event) => setAnchorDate(event.target.value)}
            />
            <p className="text-[11px] text-slate-500">
              Recurrence phase reference. Not a hard start cutoff.
            </p>
          </div>
        ) : null}

        {cadence === "monthly" ? (
          <div className="space-y-2">
            <Label htmlFor="pay-schedule-dom">Day of month</Label>
            <Input
              id="pay-schedule-dom"
              type="number"
              min={1}
              max={31}
              value={dayOfMonth}
              onChange={(event) => setDayOfMonth(event.target.value)}
            />
          </div>
        ) : null}

        {cadence === "semimonthly" ? (
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="pay-schedule-first">First day</Label>
              <Input
                id="pay-schedule-first"
                value={firstDay}
                onChange={(event) => setFirstDay(event.target.value)}
                placeholder="1 or last"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="pay-schedule-second">Second day</Label>
              <Input
                id="pay-schedule-second"
                value={secondDay}
                onChange={(event) => setSecondDay(event.target.value)}
                placeholder="15 or last"
              />
            </div>
          </div>
        ) : null}

        <div className="space-y-2">
          <Label htmlFor="pay-schedule-label">Label (optional)</Label>
          <Input
            id="pay-schedule-label"
            value={label}
            onChange={(event) => setLabel(event.target.value)}
            placeholder="e.g. Lowe's"
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="pay-schedule-amount">
            Expected amount estimate (optional)
          </Label>
          <Input
            id="pay-schedule-amount"
            type="number"
            min="0"
            step="0.01"
            value={expectedAmount}
            onChange={(event) => setExpectedAmount(event.target.value)}
          />
          <p className="text-[11px] text-slate-500">
            Planning estimate only. Not recorded income.
          </p>
        </div>

        {message ? (
          <p role="alert" className="text-xs text-amber-200">
            {message}
          </p>
        ) : null}

        <div className="flex flex-wrap gap-2">
          {editing ? (
            <Button type="button" variant="outline" onClick={resetForm}>
              Cancel edit
            </Button>
          ) : null}
          <Button type="button" onClick={submit}>
            {editing ? "Save schedule" : "Add schedule"}
          </Button>
        </div>
      </div>
    </div>
  );
}
