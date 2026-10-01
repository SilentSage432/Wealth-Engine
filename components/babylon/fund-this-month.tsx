"use client";

import { useState, type ReactNode } from "react";
import { ExpectedPayScheduleEditor } from "@/components/babylon/expected-pay-schedule-editor";
import { OverviewDisclosure } from "@/components/babylon/overview-disclosure";
import { Button } from "@/components/ui/button";
import {
  composeFundThisMonthView,
  formatCivilDateLabel,
  fundingResponsibilityLabel,
  type FundThisMonthView,
} from "@/lib/babylon/paycheck-planner-ui";
import { cn } from "@/lib/utils";
import type {
  MonthlyPlanRevision,
  PaySchedule,
  TemporalObligationFact,
} from "@/types/babylon";

interface FundThisMonthSectionProps {
  revision: MonthlyPlanRevision;
  paySchedules: readonly PaySchedule[];
  money: (value: number) => string;
  onUpsertPaySchedule: (
    schedule: PaySchedule
  ) => { ok: true } | { ok: false; message: string };
  onRemovePaySchedule: (id: string) => void;
  financialToday?: string | null;
  /** Desktop Overview only. Phone leaves this unset. */
  disclosure?: boolean;
  planSummary?: ReactNode;
  children?: ReactNode;
}

function TemporalFactList({
  heading,
  facts,
  money,
}: {
  heading: string;
  facts: readonly TemporalObligationFact[];
  money: (value: number) => string;
}) {
  if (facts.length === 0) return null;
  return (
    <div className="space-y-1.5">
      <p className="text-[11px] font-medium uppercase tracking-[0.14em] text-slate-500">
        {heading}
      </p>
      <ul className="space-y-1" aria-label={heading}>
        {facts.map((fact) => (
          <li
            key={`${fact.relationship}-${fact.obligationId}`}
            className="flex items-baseline justify-between gap-3 text-xs text-slate-400"
          >
            <span>
              {fact.label}
              <span className="ml-1.5 text-slate-500">
                · due {formatCivilDateLabel(fact.dueDate)}
              </span>
            </span>
            <span className="tabular-nums text-slate-400">
              {money(fact.amount)}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function FundingPath({
  view,
  money,
}: {
  view: Extract<FundThisMonthView, { status: "path" }>;
  money: (value: number) => string;
}) {
  return (
    <div className="space-y-4">
      <TemporalFactList
        heading="Before first expected payday"
        facts={view.beforeFirstPayday}
        money={money}
      />

      <ol className="space-y-4" aria-label="Expected payday funding path">
        {view.dateGroups.map((group) => (
          <li
            key={group.date}
            className="space-y-3 rounded-xl border border-slate-800/80 bg-slate-950/40 p-3 sm:p-4"
          >
            <div>
              <h4 className="font-[family-name:var(--font-display)] text-base text-slate-50">
                {formatCivilDateLabel(group.date)}
              </h4>
              <p className="text-[11px] uppercase tracking-[0.14em] text-slate-500">
                Expected payday
                {group.fundingSlots.length > 1
                  ? ` · ${group.fundingSlots.length} schedules`
                  : ""}
              </p>
            </div>

            <TemporalFactList
              heading="Due on this expected payday"
              facts={group.dueOnPayday}
              money={money}
            />

            <div className="space-y-3">
              {group.fundingSlots.map((slot) => {
                const scheduleHint =
                  slot.expectedPayday.label?.trim() ||
                  (group.fundingSlots.length > 1
                    ? slot.expectedPayday.scheduleId
                    : null);
                return (
                  <div
                    key={`${slot.expectedPayday.scheduleId}-${slot.expectedPayday.date}`}
                    className="space-y-2"
                  >
                    {scheduleHint ? (
                      <p className="text-xs text-slate-400">{scheduleHint}</p>
                    ) : null}
                    {slot.expectedPayday.expectedAmount !== undefined ? (
                      <p className="text-xs text-slate-500">
                        Expected amount estimate{" "}
                        <span className="tabular-nums text-slate-400">
                          {money(slot.expectedPayday.expectedAmount)}
                        </span>
                        {" · "}
                        not recorded income
                      </p>
                    ) : null}
                    <ul
                      className="space-y-1"
                      aria-label={`Planned responsibilities for ${formatCivilDateLabel(group.date)}`}
                    >
                      {slot.responsibilities
                        .filter(
                          (row) =>
                            row.amount !== 0 || row.monthlyPlannedAmount !== 0
                        )
                        .map((row) => (
                          <li
                            key={`${row.purposeKind}-${row.purposeId}`}
                            className="flex items-baseline justify-between gap-3 text-sm"
                          >
                            <span className="text-slate-200">
                              {fundingResponsibilityLabel(row)}
                            </span>
                            <span className="tabular-nums text-slate-100">
                              {money(row.amount)}
                            </span>
                          </li>
                        ))}
                    </ul>
                    <p className="flex items-baseline justify-between gap-3 border-t border-slate-800/80 pt-2 text-sm">
                      <span className="text-slate-400">
                        Planned responsibility
                      </span>
                      <span className="tabular-nums font-medium text-slate-100">
                        {money(slot.plannedResponsibilityTotal)}
                      </span>
                    </p>
                  </div>
                );
              })}
            </div>

            {group.nextPaydayDate ? (
              <TemporalFactList
                heading={`Due before next expected payday (${formatCivilDateLabel(group.nextPaydayDate)})`}
                facts={group.dueBeforeNextPayday}
                money={money}
              />
            ) : null}
          </li>
        ))}
      </ol>

      <TemporalFactList
        heading="After final expected payday"
        facts={view.afterFinalPayday}
        money={money}
      />
    </div>
  );
}

function PaydayTimingSummary({ view }: { view: FundThisMonthView }) {
  if (view.status === "path") {
    const first = view.dateGroups[0]?.date;
    const countLabel =
      view.expectedPaydayCount === 1
        ? "1 expected payday"
        : `${view.expectedPaydayCount} expected paydays`;
    return (
      <p className="mt-1 text-xs text-slate-400">
        {first ? (
          <>
            First expected payday {formatCivilDateLabel(first)}
            {" · "}
          </>
        ) : null}
        {countLabel}
      </p>
    );
  }
  if (view.status === "no_expected_funding") {
    return (
      <p className="mt-1 text-xs text-slate-400">
        No expected paydays in {view.periodKey}.
      </p>
    );
  }
  return null;
}

export function FundThisMonthSection({
  revision,
  paySchedules,
  money,
  onUpsertPaySchedule,
  onRemovePaySchedule,
  financialToday = null,
  disclosure = false,
  planSummary = null,
  children = null,
}: FundThisMonthSectionProps) {
  const view = composeFundThisMonthView(revision, paySchedules);
  const [editingSchedule, setEditingSchedule] = useState(
    () => paySchedules.length === 0
  );
  const path = view.status === "path" ? <FundingPath view={view} money={money} /> : null;

  return (
    <section
      aria-label="Fund this month"
      className={cn(
        "space-y-3",
        disclosure ? undefined : "border-t border-slate-800/80 pt-4"
      )}
    >
      {disclosure ? (
        <div className="rounded-lg border border-slate-800/80">
          <OverviewDisclosure
            regionId="monthly-plan-detail"
            summary={
              <div>
                {planSummary}
                <PaydayTimingSummary view={view} />
              </div>
            }
          >
            <div className="space-y-4 border-t border-slate-800/80 px-4 py-4">
              {children}
              {path}
            </div>
          </OverviewDisclosure>
        </div>
      ) : null}

      <div className="space-y-1">
        <h3 className="font-[family-name:var(--font-display)] text-base text-slate-50">
          Fund this month
        </h3>
        <p className="text-xs leading-relaxed text-slate-500">
          Expected paydays help organize your monthly plan. They do not count as
          income until money is actually recorded.
        </p>
      </div>

      {disclosure ? null : path}

      {view.status === "no_schedule" ? (
        <div className="space-y-3 rounded-xl border border-dashed border-slate-700/80 bg-slate-950/30 p-4">
          <p className="text-sm text-slate-300">
            Add an expected pay schedule to break this monthly plan into pay
            periods.
          </p>
          {!editingSchedule ? (
            <Button
              type="button"
              size="sm"
              onClick={() => setEditingSchedule(true)}
            >
              Add expected pay schedule
            </Button>
          ) : null}
        </div>
      ) : null}

      {view.status === "no_expected_funding" ? (
        <div className="space-y-2 rounded-xl border border-slate-800/80 bg-slate-950/30 p-4">
          <p className="text-sm text-slate-300">
            No expected paydays fall in {revision.periodKey} for the current
            schedules. The monthly plan is unchanged.
          </p>
        </div>
      ) : null}

      {view.status === "path" || view.status === "no_expected_funding" ? (
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => setEditingSchedule((open) => !open)}
            aria-expanded={editingSchedule}
          >
            {editingSchedule
              ? "Hide expected pay schedule"
              : "Expected pay schedule"}
          </Button>
        </div>
      ) : null}

      {editingSchedule ? (
        <ExpectedPayScheduleEditor
          schedules={paySchedules}
          financialToday={financialToday}
          onUpsert={onUpsertPaySchedule}
          onRemove={onRemovePaySchedule}
        />
      ) : null}
    </section>
  );
}
