import type {
  FinancialAccountKind,
  IncomeInterval,
  IncomeStreamKind,
  NavSection,
  PersistedState,
} from "@/types/babylon";
import { BookOpen, LayoutDashboard, ScrollText } from "lucide-react";
import type { ComponentType } from "react";

export const STORAGE_KEY = "wealth-engine-babylon-v2";

/** Dedicated preference key for the steward profile name (independent of ledger vault). */
export const USERNAME_STORAGE_KEY = "babylon_username";

/** Visual-only greeting fallback when the profile input is empty. */
export const GREETING_NAME_FALLBACK = "Your name";

export const WEALTH_RATE = 0.1;
export const DEBT_RATE = 0.2;
export const EXPENDITURE_RATE = 0.7;

/** Amber warning threshold for category spend vs. planned cap. */
export const BUDGET_WARNING_PCT = 85;

/**
 * Legacy id used only when soft-migrating older desire expenses that lacked
 * `budgetCategoryId`. New installs start with an empty custom blueprint.
 */
export const DISCRETIONARY_BUDGET_ID = "budget-desires";

export const BABYLON_WISDOM: readonly string[] = [
  "Set aside part of every paycheck for Wealth Building before you spend.",
  "Use Debt Payoff on purpose. When the debt is gone, that 20% moves to Wealth Building.",
  "The Living Budget is what you can spend this month. It is not your bank balance.",
  "Available After Planned Needs is current money after what you set aside and known unpaid Needs. It is not your Living Budget.",
  "Mark spending as a Need or a Want so the Living Budget stays clear.",
  "An Emergency Fund holds money you already set aside, plus surplus from a closed month. It is separate from Wealth Building.",
  "Earning more gives the same 10/20/70 split more to work with.",
  "Wants fit inside the Living Budget. They are a problem when they crowd out Needs.",
  "Wealth Building includes money you already set aside plus what this ledger allocates from income. It is not a separate bank balance.",
  "Close each month and review what you set aside, paid down, and spent.",
];

export const INTERVAL_LABELS: Record<IncomeInterval, string> = {
  "one-time": "One-time",
  weekly: "Weekly",
  biweekly: "Bi-weekly",
  monthly: "Monthly",
  yearly: "Yearly",
};

export const STREAM_KIND_LABELS: Record<IncomeStreamKind, string> = {
  primary: "Main Income",
  side_hustle: "Side Income",
  passive: "Passive Income",
  other: "Other Income",
};

export const STREAM_KIND_ORDER: readonly IncomeStreamKind[] = [
  "primary",
  "side_hustle",
  "passive",
  "other",
] as const;

export const ACCOUNT_KIND_LABELS: Record<FinancialAccountKind, string> = {
  checking: "Checking",
  savings: "Savings",
  cash: "Cash",
};

export const NAV_ITEMS: ReadonlyArray<{
  id: NavSection;
  label: string;
  icon: ComponentType<{ className?: string }>;
}> = [
  { id: "overview", label: "Overview", icon: LayoutDashboard },
  { id: "ledgers", label: "Ledger", icon: ScrollText },
  { id: "wisdom", label: "Financial Guidance", icon: BookOpen },
];

export const DONUT_COLORS = {
  need: "#10b981",
  desire: "#f59e0b",
  remaining: "#334155",
} as const;

export const EMPTY_STATE: PersistedState = {
  incomes: [],
  expenses: [],
  debts: [],
  allocations: [],
  budgetTargets: [],
  accounts: [],
  displayName: "",
  activityLog: [],
  emergencyShield: 0,
  periodArchives: [],
  lastClosedMonthKey: null,
  /** New vaults already use Upcoming semantics. Legacy vaults migrate on load. */
  expenseSemanticsVersion: 2,
  openingWealthBuilding: 0,
  openingEmergencyFund: 0,
  recurringObligations: [],
};
