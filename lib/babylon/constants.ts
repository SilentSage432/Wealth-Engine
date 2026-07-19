import type { IncomeInterval, NavSection, PersistedState } from "@/types/babylon";
import { BookOpen, LayoutDashboard, ScrollText } from "lucide-react";
import type { ComponentType } from "react";

export const STORAGE_KEY = "wealth-engine-babylon-v2";

export const WEALTH_RATE = 0.1;
export const DEBT_RATE = 0.2;
export const EXPENDITURE_RATE = 0.7;

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
  displayName: "Steward",
};
