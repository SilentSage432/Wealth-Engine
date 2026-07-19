import type {
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
export const GREETING_NAME_FALLBACK = "Steward";

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
  "A part of all you earn is yours to keep.",
  "Guard thy treasures from loss.",
  "Do not confuse necessary expenses with thy desires.",
  "Make thy gold multiply — put each coin to labor.",
  "Control thy expenditures that thy purse may fatten.",
  "Ensure a future income — prepare for the days to come.",
  "Increase thy ability to earn — cultivate thy own powers.",
  "Better a little caution than a great regret.",
  "Wealth, like a tree, grows from a tiny seed.",
  "The soul that is empty cannot fill its purse.",
];

export const INTERVAL_LABELS: Record<IncomeInterval, string> = {
  "one-time": "One-time",
  weekly: "Weekly",
  biweekly: "Bi-weekly",
  monthly: "Monthly",
  yearly: "Yearly",
};

export const STREAM_KIND_LABELS: Record<IncomeStreamKind, string> = {
  primary: "Primary Labor",
  side_hustle: "Side Hustle",
  passive: "Passive Engine",
  other: "Other",
};

export const STREAM_KIND_ORDER: readonly IncomeStreamKind[] = [
  "primary",
  "side_hustle",
  "passive",
  "other",
] as const;

export const NAV_ITEMS: ReadonlyArray<{
  id: NavSection;
  label: string;
  icon: ComponentType<{ className?: string }>;
}> = [
  { id: "overview", label: "Command Deck", icon: LayoutDashboard },
  { id: "ledgers", label: "Ledger Matrices", icon: ScrollText },
  { id: "wisdom", label: "Babylon Wisdom", icon: BookOpen },
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
  displayName: "",
  activityLog: [],
  emergencyShield: 0,
  periodArchives: [],
  lastClosedMonthKey: null,
};
