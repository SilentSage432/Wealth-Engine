/**
 * Speed-Tribute quick presets — domain vocabulary for 1-tap entry chips.
 * Presentation renders these; Application maps them into IncomeInput / ExpenseInput.
 * Does not own allocation math or persistence.
 */

import type { ExpenseKind, IncomeStreamKind } from "@/types/babylon";

export interface QuickPreset {
  id: string;
  label: string;
  icon: string;
  type: "income" | "expense";
  amount?: number;
  categoryOrSource: string;
  kind?:
    | "primary_w2"
    | "side_hustle"
    | "capital_yield"
    | "windfall"
    | "need"
    | "desire";
}

export const DEFAULT_PRESETS: QuickPreset[] = [
  {
    id: "lowes-paycheck",
    label: "Lowe's Paycheck",
    icon: "💰",
    type: "income",
    categoryOrSource: "Lowe's",
    kind: "primary_w2",
  },
  {
    id: "groceries",
    label: "Groceries",
    icon: "🛒",
    type: "expense",
    categoryOrSource: "Groceries",
    kind: "need",
  },
  {
    id: "gas",
    label: "Gas / Transit",
    icon: "🚗",
    type: "expense",
    categoryOrSource: "Gas",
    kind: "need",
  },
  {
    id: "coffee-treat",
    label: "Coffee / Treat",
    icon: "☕",
    type: "expense",
    categoryOrSource: "Dining & Treats",
    kind: "desire",
  },
  {
    id: "rent-housing",
    label: "Rent / Housing",
    icon: "🏠",
    type: "expense",
    categoryOrSource: "Housing",
    kind: "need",
  },
];

/** Map preset income kind → canonical IncomeStreamKind (types/babylon.ts). */
export function resolvePresetIncomeKind(
  kind: QuickPreset["kind"]
): IncomeStreamKind {
  switch (kind) {
    case "primary_w2":
      return "primary";
    case "side_hustle":
      return "side_hustle";
    case "capital_yield":
      return "passive";
    case "windfall":
      return "other";
    default:
      return "primary";
  }
}

/** Map preset expense kind → canonical ExpenseKind (types/babylon.ts). */
export function resolvePresetExpenseKind(
  kind: QuickPreset["kind"]
): ExpenseKind {
  return kind === "desire" ? "desire" : "need";
}
