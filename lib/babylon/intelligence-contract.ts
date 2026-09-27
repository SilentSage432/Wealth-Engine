import { deriveAvailableAfterPlannedNeeds } from "@/lib/babylon/available-after-planned-needs";
import {
  deriveDueAttention,
  deriveMonthCloseAttention,
} from "@/lib/babylon/attention";
import { DEBT_RATE, EXPENDITURE_RATE, WEALTH_RATE } from "@/lib/babylon/constants";
import {
  actualSpendTotals,
  allocateIncome,
  buildBudgetVariances,
  livingBudgetRemaining,
  monthKeyFromDate,
  roundMoney,
  totalOriginalDebt,
  totalRemainingDebt,
  upcomingNeedsTotal,
} from "@/lib/babylon/engine";
import {
  deriveEffectiveAccountPosition,
  deriveEffectiveAccountPositions,
  deriveEffectiveMoneyAvailable,
  type BalanceObservationPublic,
} from "@/lib/babylon/balance-observation";
import { sumAccountBalances } from "@/lib/babylon/financial-position";
import { civilDateInTimeZone } from "@/lib/babylon/notification-delivery";
import {
  protectedExceedsAvailable,
  totalEmergencyFund,
  totalProtectedMoney,
  totalWealthBuilding,
} from "@/lib/babylon/protected-money";
import { materializeRecurringObligations } from "@/lib/babylon/recurring-obligations";
import type { ExpenseEntry, PersistedState } from "@/types/babylon";

/** Machine-readable contract. Not the vault and not a Muse API. */
export const INTELLIGENCE_CONTRACT_VERSION = "2";

const STANDING_UNKNOWNS = [
  "no_expected_payday",
  "plaid_is_not_vault_truth",
  "cached_accounts_get_balance",
  "balance_change_cause_unknown",
  // The reasoners exist. This contract does not include their outputs.
  "internal_observational_reasoners_excluded",
] as const;

export type IntelligenceUnknown =
  | (typeof STANDING_UNKNOWNS)[number]
  | "apr_unverified"
  | "civil_date_unknown"
  | "balance_evidence_unavailable";

/**
 * Stored balance evidence for this read.
 * `ready` may be empty. `unavailable` is a failed read, not an empty one.
 */
export type IntelligenceBalanceEvidence =
  | {
      status: "ready";
      plaidAccounts: readonly {
        plaidAccountId: string;
        accountType: string | null;
        subtype: string | null;
      }[];
      observations: readonly BalanceObservationPublic[];
      associations: readonly {
        financialAccountId: string;
        plaidAccountId: string;
      }[];
    }
  | { status: "unavailable" };

export interface IntelligenceContractInput {
  state: PersistedState;
  /** Stored notification timezone. Null when the steward has no usable preference. */
  ianaTimeZone: string | null;
  now: Date;
  generatedAt: string;
  balanceEvidence: IntelligenceBalanceEvidence;
}

/**
 * Integer cents from the vault's rounded dollar number.
 * Unknown stays unknown at the call site. This helper is only for a real amount.
 */
export function intelligenceCents(value: number): number {
  return Math.round(roundMoney(value) * 100);
}

function sumMoney(values: readonly number[]): number {
  return values.reduce((sum, value) => roundMoney(sum + value), 0);
}

function rateBps(rate: number): number {
  return Math.round(rate * 10_000);
}

/** Stored 0 cannot be separated from the soft-migrated missing APR. Withhold it. */
function interestRatePpm(interestRate: number): number | null {
  if (!Number.isFinite(interestRate) || interestRate <= 0) return null;
  return Math.round(interestRate * 10_000);
}

export function assembleIntelligenceContract(input: IntelligenceContractInput) {
  const state = input.state;
  const civilDate = input.ianaTimeZone
    ? civilDateInTimeZone(input.now, input.ianaTimeZone)
    : null;
  const currentMonthKey = civilDate ? civilDate.slice(0, 7) : null;
  const hasActiveDebt = state.debts.some((debt) => debt.remainingDebt > 0);
  const redirect = allocateIncome(1, hasActiveDebt).debtRedirected;

  const materialized = civilDate
    ? materializeRecurringObligations(
        state.recurringObligations,
        state.expenses,
        civilDate,
        (() => {
          let n = 0;
          return () => `memory-${n++}`;
        })()
      )
    : { expenses: state.expenses, created: [] as ExpenseEntry[] };
  const derivedIds = new Set(materialized.created.map((expense) => expense.id));
  const readingExpenses = materialized.expenses;

  const monthAllocations =
    currentMonthKey === null
      ? []
      : state.allocations.filter((allocation) => allocation.monthKey === currentMonthKey);
  const monthIncomes =
    currentMonthKey === null
      ? []
      : state.incomes.filter(
          (income) => monthKeyFromDate(income.date) === currentMonthKey
        );
  const pool =
    currentMonthKey === null
      ? null
      : sumMoney(monthAllocations.map((allocation) => allocation.expenditure));
  const spent =
    currentMonthKey === null
      ? null
      : actualSpendTotals(state.expenses, currentMonthKey).total;
  const monthExpenses =
    currentMonthKey === null
      ? []
      : state.expenses.filter(
          (expense) => monthKeyFromDate(expense.date) === currentMonthKey
        );

  const upcomingNeeds = upcomingNeedsTotal(readingExpenses);
  const balanceEvidence = input.balanceEvidence;
  const positions =
    balanceEvidence.status === "ready"
      ? deriveEffectiveAccountPositions({
          accounts: state.accounts,
          plaidAccounts: balanceEvidence.plaidAccounts,
          observations: balanceEvidence.observations,
          associations: balanceEvidence.associations,
        })
      : state.accounts.map((account) =>
          deriveEffectiveAccountPosition({
            account,
            associatedPlaidAccountId: null,
            accountType: null,
            subtype: null,
            observation: null,
          })
        );
  const moneyAvailable =
    balanceEvidence.status === "ready"
      ? deriveEffectiveMoneyAvailable({
          accounts: state.accounts,
          plaidAccounts: balanceEvidence.plaidAccounts,
          observations: balanceEvidence.observations,
          associations: balanceEvidence.associations,
        })
      : sumAccountBalances(state.accounts);
  const openingProtected = totalProtectedMoney(
    state.openingWealthBuilding,
    state.openingEmergencyFund
  );
  const available = deriveAvailableAfterPlannedNeeds({
    moneyAvailable,
    protectedMoney: openingProtected,
    upcomingNeeds,
  });
  const trackedWealth = sumMoney(state.allocations.map((allocation) => allocation.wealth));
  const originalDebt = totalOriginalDebt(state.debts);
  const remainingDebt = totalRemainingDebt(state.debts);

  const due =
    civilDate === null ? [] : deriveDueAttention(readingExpenses, civilDate);
  const monthClose =
    civilDate === null || currentMonthKey === null
      ? null
      : deriveMonthCloseAttention({
          today: civilDate,
          currentMonthKey,
          lastClosedMonthKey: state.lastClosedMonthKey,
        });

  const debts = state.debts.map((debt) => ({
    subject_ref: debt.id,
    creditor: debt.creditor,
    original_cents: intelligenceCents(debt.totalDebt),
    remaining_cents: intelligenceCents(debt.remainingDebt),
    monthly_allocation_cents: intelligenceCents(debt.monthlyAllocation),
    interest_rate_ppm: interestRatePpm(debt.interestRate),
  }));
  const unknowns: IntelligenceUnknown[] = [...STANDING_UNKNOWNS];
  if (debts.some((debt) => debt.interest_rate_ppm === null) && state.debts.length > 0) {
    unknowns.push("apr_unverified");
  }
  if (!civilDate) unknowns.push("civil_date_unknown");
  if (balanceEvidence.status === "unavailable") {
    unknowns.push("balance_evidence_unavailable");
  }

  const attention: Array<
    | { kind: "due_obligation"; civil_date: string; subject_ref: string }
    | {
        kind: "month_close";
        civil_date: string;
        month_key: string;
        statement: string;
      }
  > = [];
  if (civilDate) {
    for (const item of due) {
      attention.push({
        kind: "due_obligation",
        civil_date: civilDate,
        subject_ref: item.id,
      });
    }
    if (monthClose) {
      attention.push({
        kind: "month_close",
        civil_date: civilDate,
        month_key: monthClose.monthKey,
        statement: monthClose.message,
      });
    }
  }

  return {
    meta: {
      contract_version: INTELLIGENCE_CONTRACT_VERSION,
      generated_at: input.generatedAt,
      iana_timezone: input.ianaTimeZone,
      civil_date: civilDate,
      current_month_key: currentMonthKey,
      month_closed:
        currentMonthKey === null
          ? null
          : state.lastClosedMonthKey === currentMonthKey,
    },
    purpose: {
      wealth_rate_bps: rateBps(WEALTH_RATE),
      debt_rate_bps: rateBps(DEBT_RATE),
      expenditure_rate_bps: rateBps(EXPENDITURE_RATE),
      debt_share_redirects_to_wealth: redirect,
      current_month_recorded_income_cents:
        currentMonthKey === null
          ? null
          : intelligenceCents(sumMoney(monthIncomes.map((income) => income.amount))),
      current_month_allocated_wealth_cents:
        currentMonthKey === null
          ? null
          : intelligenceCents(sumMoney(monthAllocations.map((allocation) => allocation.wealth))),
      current_month_allocated_debt_cents:
        currentMonthKey === null
          ? null
          : intelligenceCents(sumMoney(monthAllocations.map((allocation) => allocation.debt))),
      current_month_allocated_expenditure_cents:
        currentMonthKey === null ? null : intelligenceCents(pool ?? 0),
    },
    budget: {
      living_budget_pool_cents: pool === null ? null : intelligenceCents(pool),
      living_budget_spent_cents: spent === null ? null : intelligenceCents(spent),
      living_budget_remaining_cents:
        pool === null || spent === null
          ? null
          : intelligenceCents(livingBudgetRemaining(pool, spent)),
      living_budget_shortfall_cents:
        pool === null || spent === null
          ? null
          : intelligenceCents(Math.max(0, roundMoney(spent - pool))),
      categories:
        currentMonthKey === null
          ? state.budgetTargets.map((target) => ({
              subject_ref: target.id,
              name: target.categoryName,
              planned_cents: intelligenceCents(target.plannedAmount),
              settled_cents: null,
              variance_cents: null,
              is_essential: target.isEssential,
            }))
          : buildBudgetVariances(state.budgetTargets, monthExpenses).map((category) => ({
              subject_ref: category.id,
              name: category.categoryName,
              planned_cents: intelligenceCents(category.plannedAmount),
              settled_cents: intelligenceCents(category.actualAmount),
              variance_cents: intelligenceCents(category.variance),
              is_essential: category.isEssential,
            })),
    },
    protected_money: {
      opening_wealth_building_cents: intelligenceCents(state.openingWealthBuilding),
      opening_emergency_fund_cents: intelligenceCents(state.openingEmergencyFund),
      tracked_wealth_allocation_cents: intelligenceCents(trackedWealth),
      tracked_emergency_shield_cents: intelligenceCents(state.emergencyShield),
      wealth_building_total_cents: intelligenceCents(
        totalWealthBuilding(state.openingWealthBuilding, trackedWealth)
      ),
      emergency_fund_total_cents: intelligenceCents(
        totalEmergencyFund(state.openingEmergencyFund, state.emergencyShield)
      ),
      opening_protected_cents: intelligenceCents(openingProtected),
    },
    position: {
      money_available_cents: intelligenceCents(moneyAvailable),
      protected_exceeds_money_available: protectedExceedsAvailable(
        state.openingWealthBuilding,
        state.openingEmergencyFund,
        moneyAvailable
      ),
      accounts: state.accounts.map((account, index) => {
        const position = positions[index];
        const declared = {
          name: account.name,
          kind: account.kind,
          declared_balance_cents: intelligenceCents(account.balance),
          declared_as_of: account.asOf,
        };
        if (position?.source === "observed") {
          return {
            ...declared,
            effective_balance_cents: intelligenceCents(position.balance),
            effective_source: "observed" as const,
            observed_current_cents: position.currentCents,
            observed_at: position.observedAt,
            observation_kind: "cached_accounts_get" as const,
          };
        }
        return {
          ...declared,
          effective_balance_cents: intelligenceCents(position?.balance ?? account.balance),
          effective_source: "declared" as const,
          observed_current_cents: null,
          observed_at: null,
          observation_kind: null,
        };
      }),
    },
    available_after_planned_needs: {
      available_cents: intelligenceCents(available.availableAfterPlannedNeeds),
      shortfall_cents: intelligenceCents(available.plannedNeedsShortfall),
      raw_difference_cents: intelligenceCents(available.rawDifference),
      upcoming_needs_cents: intelligenceCents(upcomingNeeds),
    },
    obligations: {
      unpaid: readingExpenses
        .filter((expense) => !expense.isSettled)
        .slice()
        .sort(
          (a, b) =>
            a.dueDate.localeCompare(b.dueDate) ||
            a.name.localeCompare(b.name) ||
            a.id.localeCompare(b.id)
        )
        .map((expense) => ({
          subject_ref: expense.id,
          name: expense.name,
          amount_cents: intelligenceCents(expense.amount),
          due_date: expense.dueDate,
          kind: expense.category,
          origin: derivedIds.has(expense.id)
            ? ("derived_from_rule" as const)
            : ("recorded" as const),
        })),
    },
    debts: {
      debts,
      original_total_cents: intelligenceCents(originalDebt),
      remaining_total_cents: intelligenceCents(remainingDebt),
      cleared_cents: intelligenceCents(Math.max(0, roundMoney(originalDebt - remainingDebt))),
    },
    attention: {
      items: attention,
    },
    boundaries: {
      unknowns,
    },
  };
}
