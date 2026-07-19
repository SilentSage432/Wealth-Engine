import { EMPTY_STATE, STORAGE_KEY } from "@/lib/babylon/constants";
import type { PersistedState } from "@/types/babylon";

export function loadPersistedState(): PersistedState {
  if (typeof window === "undefined") {
    return EMPTY_STATE;
  }

  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return EMPTY_STATE;

    const parsed = JSON.parse(raw) as PersistedState;
    return {
      incomes: Array.isArray(parsed.incomes) ? parsed.incomes : [],
      expenses: Array.isArray(parsed.expenses) ? parsed.expenses : [],
      debts: Array.isArray(parsed.debts) ? parsed.debts : [],
      allocations: Array.isArray(parsed.allocations) ? parsed.allocations : [],
      displayName:
        typeof parsed.displayName === "string" && parsed.displayName.trim()
          ? parsed.displayName
          : "Steward",
    };
  } catch {
    return EMPTY_STATE;
  }
}

export function savePersistedState(state: PersistedState): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

export function clearPersistedState(): void {
  if (typeof window === "undefined") return;
  window.localStorage.removeItem(STORAGE_KEY);
}

export function isEmptyLedger(state: PersistedState): boolean {
  return (
    state.incomes.length === 0 &&
    state.expenses.length === 0 &&
    state.debts.length === 0
  );
}
