/**
 * Recorded-administration Quiet.
 *
 * Supported claim, and only when status is "quiet":
 * "Nothing in the current recorded operating record requires administration."
 *
 * This is not Attention quiet and it is not a claim that finances are good.
 * Kinds stay due_obligation and month_close. Debt confirmation stays in
 * debt-semantics. Restriction stays in account-restriction. Protected
 * overflow stays in protected-money.
 */

import { restrictedDeclared, hasRestrictionConflict } from "@/lib/babylon/account-restriction";
import {
  composeFinancialAttention,
  type ComposedFinancialAttention,
} from "@/lib/babylon/attention";
import { operationalAccountPosition } from "@/lib/babylon/balance-evidence-load";
import type { EffectiveAccountPosition } from "@/lib/babylon/balance-observation";
import { needsDebtPositionTransition } from "@/lib/babylon/debt-semantics";
import { protectedOverflowExceeds } from "@/lib/babylon/protected-money";
import type { DebtEntry, ExpenseEntry, FinancialAccount } from "@/types/babylon";

export const RECORDED_ADMINISTRATION_QUIET_CLAIM =
  "Nothing in the current recorded operating record requires administration.";

export type RecordedAdministrationGate =
  | "due_obligation"
  | "month_close"
  | "debt_position_confirmation"
  | "protected_overflow"
  | "restriction_conflict";

export type RecordedAdministrationUnknown =
  | "attention_unknown"
  | "position_evidence_loading"
  | "position_evidence_unavailable"
  | "observed_position_blocked"
  | "cloud_conflict";

export type RecordedPositionTruth =
  | {
      status: "knowable";
      /**
       * Balances from operationalAccountPosition. A missing row uses that
       * function's declared fallback. Do not substitute a raw declaration
       * while a linked reading is still unresolved.
       */
      positions: readonly EffectiveAccountPosition[];
    }
  | { status: "loading" }
  | { status: "unavailable" }
  | { status: "blocked" };

export type RecordedAdministrationQuiet =
  | {
      status: "quiet";
      claim: typeof RECORDED_ADMINISTRATION_QUIET_CLAIM;
      /** From the month-close predicate. Absence does not set this true. */
      currentMonthClosed: boolean;
    }
  | {
      status: "action_outstanding";
      gates: readonly RecordedAdministrationGate[];
    }
  | {
      status: "unknown";
      reasons: readonly RecordedAdministrationUnknown[];
    };

function operationalBalance(
  account: FinancialAccount,
  positions: readonly EffectiveAccountPosition[]
): number {
  const position = positions.find((row) => row.accountId === account.id);
  if (position) return position.balance;
  return operationalAccountPosition({ account, load: undefined }).balance;
}

function restrictionConflictIds(
  accounts: readonly FinancialAccount[],
  positions: readonly EffectiveAccountPosition[]
): string[] {
  const ids: string[] = [];
  for (const account of accounts) {
    if (
      hasRestrictionConflict(
        operationalBalance(account, positions),
        restrictedDeclared(account)
      )
    ) {
      ids.push(account.id);
    }
  }
  ids.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  return ids;
}

/**
 * Read-only. Unknown blocks Quiet and does not assert action.
 * Attention quiet is necessary and not sufficient.
 */
export function composeRecordedAdministrationQuiet(input: {
  expenses: readonly ExpenseEntry[];
  today: string;
  currentMonthKey: string | null;
  lastClosedMonthKey: string | null;
  debtSemanticsVersion: number;
  debts: readonly DebtEntry[];
  openingWealthBuilding: number;
  openingEmergencyFund: number;
  moneyAvailable: number;
  accounts: readonly FinancialAccount[];
  positionTruth: RecordedPositionTruth;
  /** Two copies of the record disagree. Not a financial Attention item. */
  cloudConflict: boolean;
}): RecordedAdministrationQuiet {
  const attention: ComposedFinancialAttention = composeFinancialAttention({
    expenses: input.expenses,
    today: input.today,
    currentMonthKey: input.currentMonthKey,
    lastClosedMonthKey: input.lastClosedMonthKey,
  });

  const reasons: RecordedAdministrationUnknown[] = [];
  if (
    attention.due.knowledge === "unknown" ||
    attention.monthClose.knowledge === "unknown"
  ) {
    reasons.push("attention_unknown");
  }
  if (input.cloudConflict) reasons.push("cloud_conflict");
  if (input.positionTruth.status === "loading") {
    reasons.push("position_evidence_loading");
  } else if (input.positionTruth.status === "unavailable") {
    reasons.push("position_evidence_unavailable");
  } else if (input.positionTruth.status === "blocked") {
    reasons.push("observed_position_blocked");
  }

  if (reasons.length > 0) {
    return { status: "unknown", reasons };
  }

  const gates: RecordedAdministrationGate[] = [];
  if (attention.due.knowledge === "present") gates.push("due_obligation");
  if (attention.monthClose.knowledge === "present") gates.push("month_close");
  if (
    needsDebtPositionTransition({
      debtSemanticsVersion: input.debtSemanticsVersion,
      debts: input.debts,
    })
  ) {
    gates.push("debt_position_confirmation");
  }

  const positions =
    input.positionTruth.status === "knowable" ? input.positionTruth.positions : [];
  if (
    protectedOverflowExceeds({
      openingWealthBuilding: input.openingWealthBuilding,
      openingEmergencyFund: input.openingEmergencyFund,
      moneyAvailable: input.moneyAvailable,
      accounts: input.accounts,
      positions,
    })
  ) {
    gates.push("protected_overflow");
  }
  if (restrictionConflictIds(input.accounts, positions).length > 0) {
    gates.push("restriction_conflict");
  }

  if (gates.length > 0) return { status: "action_outstanding", gates };

  const currentMonthClosed =
    attention.monthClose.knowledge === "absent"
      ? attention.monthClose.currentMonthClosed
      : false;
  return {
    status: "quiet",
    claim: RECORDED_ADMINISTRATION_QUIET_CLAIM,
    currentMonthClosed,
  };
}
