import {
  DEBT_RATE,
  EXPENDITURE_RATE,
  WEALTH_RATE,
} from "@/lib/babylon/constants";
import type {
  AllocationSplit,
  ChartMonthPoint,
  DebtEntry,
} from "@/types/babylon";

export function monthKeyFromDate(isoDate: string): string {
  return isoDate.slice(0, 7);
}

export function formatMonthLabel(monthKey: string): string {
  const [year, month] = monthKey.split("-").map(Number);
  const date = new Date(year, month - 1, 1);
  return date.toLocaleDateString("en-US", { month: "short", year: "2-digit" });
}

export function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

export function roundMoney(value: number): number {
  return Math.round(value * 100) / 100;
}

export function allocateIncome(
  gross: number,
  hasActiveDebt: boolean
): AllocationSplit {
  const wealthBase = roundMoney(gross * WEALTH_RATE);
  const debtBase = roundMoney(gross * DEBT_RATE);
  const expenditureShare = roundMoney(gross * EXPENDITURE_RATE);

  if (hasActiveDebt) {
    return {
      wealthShare: wealthBase,
      debtShare: debtBase,
      expenditureShare,
      debtRedirected: false,
    };
  }

  return {
    wealthShare: roundMoney(wealthBase + debtBase),
    debtShare: 0,
    expenditureShare,
    debtRedirected: true,
  };
}

export function applyDebtAllocation(
  debts: DebtEntry[],
  amount: number
): DebtEntry[] {
  if (amount <= 0 || debts.length === 0) {
    return debts;
  }

  let remaining = amount;
  const active = debts
    .map((d) => ({ ...d }))
    .sort((a, b) => a.remainingDebt - b.remainingDebt);

  for (const debt of active) {
    if (remaining <= 0) break;
    if (debt.remainingDebt <= 0) continue;
    const applied = Math.min(debt.remainingDebt, remaining);
    debt.remainingDebt = roundMoney(debt.remainingDebt - applied);
    remaining = roundMoney(remaining - applied);
  }

  return active;
}

export function totalRemainingDebt(debts: DebtEntry[]): number {
  return roundMoney(debts.reduce((sum, d) => sum + d.remainingDebt, 0));
}

export function totalOriginalDebt(debts: DebtEntry[]): number {
  return roundMoney(debts.reduce((sum, d) => sum + d.totalDebt, 0));
}

export function buildChartData(
  allocations: Array<{
    monthKey: string;
    gross: number;
    wealth: number;
    debt: number;
    expenditure: number;
  }>
): ChartMonthPoint[] {
  const map = new Map<string, ChartMonthPoint>();

  allocations.forEach((a) => {
    const existing = map.get(a.monthKey);
    if (existing) {
      existing.income = roundMoney(existing.income + a.gross);
      existing.wealth = roundMoney(existing.wealth + a.wealth);
      existing.debt = roundMoney(existing.debt + a.debt);
      existing.expenditure = roundMoney(existing.expenditure + a.expenditure);
    } else {
      map.set(a.monthKey, {
        month: a.monthKey,
        label: formatMonthLabel(a.monthKey),
        income: a.gross,
        wealth: a.wealth,
        debt: a.debt,
        expenditure: a.expenditure,
      });
    }
  });

  return Array.from(map.values()).sort((a, b) => a.month.localeCompare(b.month));
}
