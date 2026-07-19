"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  BABYLON_WISDOM,
  DEFAULT_BUDGET_TARGETS,
  DONUT_COLORS,
  EMPTY_STATE,
} from "@/lib/babylon/constants";
import {
  allocateIncome,
  applyDebtAllocation,
  buildBudgetVariances,
  buildChartData,
  effectiveHourlyRate,
  monthKeyFromDate,
  roundMoney,
  todayIso,
  totalOriginalDebt,
  totalRemainingDebt,
} from "@/lib/babylon/engine";
import {
  buildLedgerBackup,
  clearPersistedState,
  loadPersistedState,
  savePersistedState,
  validateLedgerBackup,
} from "@/lib/babylon/persistence";
import { generateId } from "@/lib/utils";
import type {
  AllocationEvent,
  BudgetTarget,
  DebtEntry,
  DebtInput,
  DonutSlice,
  ExpenditureBarTone,
  ExpenseEntry,
  ExpenseInput,
  IncomeEntry,
  IncomeInput,
  NavSection,
  PersistedState,
  TributeMode,
} from "@/types/babylon";

function cloneDefaultBudgetTargets(): BudgetTarget[] {
  return DEFAULT_BUDGET_TARGETS.map((t) => ({ ...t }));
}

export function useBabylonEngine() {
  const [hydrated, setHydrated] = useState(false);
  const [incomes, setIncomes] = useState<IncomeEntry[]>([]);
  const [expenses, setExpenses] = useState<ExpenseEntry[]>([]);
  const [debts, setDebts] = useState<DebtEntry[]>([]);
  const [allocations, setAllocations] = useState<AllocationEvent[]>([]);
  const [budgetTargets, setBudgetTargets] = useState<BudgetTarget[]>(
    cloneDefaultBudgetTargets
  );
  const [displayName, setDisplayName] = useState("Steward");

  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [activeNav, setActiveNav] = useState<NavSection>("overview");
  const [clock, setClock] = useState(() => new Date());
  const [wisdomIndex, setWisdomIndex] = useState(0);

  const [tributeOpen, setTributeOpen] = useState(false);
  const [tributeMode, setTributeMode] = useState<TributeMode>("income");

  useEffect(() => {
    const stored = loadPersistedState();
    setIncomes(stored.incomes);
    setExpenses(stored.expenses);
    setDebts(stored.debts);
    setAllocations(stored.allocations);
    setBudgetTargets(
      stored.budgetTargets.length > 0
        ? stored.budgetTargets
        : cloneDefaultBudgetTargets()
    );
    setDisplayName(stored.displayName);
    setHydrated(true);
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    const payload: PersistedState = {
      incomes,
      expenses,
      debts,
      allocations,
      budgetTargets,
      displayName,
    };
    savePersistedState(payload);
  }, [
    hydrated,
    incomes,
    expenses,
    debts,
    allocations,
    budgetTargets,
    displayName,
  ]);

  useEffect(() => {
    const timer = window.setInterval(() => setClock(new Date()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    const timer = window.setInterval(() => {
      setWisdomIndex((prev) => (prev + 1) % BABYLON_WISDOM.length);
    }, 8000);
    return () => window.clearInterval(timer);
  }, []);

  const hasActiveDebt = useMemo(
    () => debts.some((d) => d.remainingDebt > 0),
    [debts]
  );

  const goldRetained = useMemo(
    () => roundMoney(allocations.reduce((sum, a) => sum + a.wealth, 0)),
    [allocations]
  );

  const debtAllocated = useMemo(
    () => roundMoney(allocations.reduce((sum, a) => sum + a.debt, 0)),
    [allocations]
  );

  const expenditurePool = useMemo(
    () => roundMoney(allocations.reduce((sum, a) => sum + a.expenditure, 0)),
    [allocations]
  );

  const totalSpent = useMemo(
    () => roundMoney(expenses.reduce((sum, e) => sum + e.amount, 0)),
    [expenses]
  );

  const expenditureRemaining = useMemo(
    () => roundMoney(Math.max(0, expenditurePool - totalSpent)),
    [expenditurePool, totalSpent]
  );

  const expenditureUsedPct = useMemo(() => {
    if (expenditurePool <= 0) return 0;
    return Math.min(100, Math.round((totalSpent / expenditurePool) * 100));
  }, [totalSpent, expenditurePool]);

  const expenditureRemainingPct = useMemo(
    () => Math.max(0, 100 - expenditureUsedPct),
    [expenditureUsedPct]
  );

  const expenditureBarTone = useMemo((): ExpenditureBarTone => {
    if (expenditureRemainingPct > 40) return "emerald";
    if (expenditureRemainingPct > 15) return "amber";
    return "crimson";
  }, [expenditureRemainingPct]);

  const progressIndicatorClass = useMemo(() => {
    if (expenditureBarTone === "emerald") return "bg-emerald-500";
    if (expenditureBarTone === "amber") return "bg-amber-500";
    return "bg-rose-500";
  }, [expenditureBarTone]);

  const originalDebt = useMemo(() => totalOriginalDebt(debts), [debts]);
  const remainingDebt = useMemo(() => totalRemainingDebt(debts), [debts]);

  const clearedDebt = useMemo(
    () => roundMoney(Math.max(0, originalDebt - remainingDebt)),
    [originalDebt, remainingDebt]
  );

  const debtClearPct = useMemo(() => {
    if (originalDebt <= 0) return 100;
    return Math.min(100, Math.round((clearedDebt / originalDebt) * 100));
  }, [clearedDebt, originalDebt]);

  const totalIncome = useMemo(
    () => roundMoney(incomes.reduce((sum, i) => sum + i.amount, 0)),
    [incomes]
  );

  const needSpend = useMemo(
    () =>
      roundMoney(
        expenses
          .filter((e) => e.category === "need")
          .reduce((sum, e) => sum + e.amount, 0)
      ),
    [expenses]
  );

  const desireSpend = useMemo(
    () =>
      roundMoney(
        expenses
          .filter((e) => e.category === "desire")
          .reduce((sum, e) => sum + e.amount, 0)
      ),
    [expenses]
  );

  const currentMonthKey = useMemo(
    () => monthKeyFromDate(todayIso()),
    // Recompute when the calendar day may roll over with the live clock.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [clock]
  );

  const currentMonthExpenses = useMemo(
    () => expenses.filter((e) => monthKeyFromDate(e.date) === currentMonthKey),
    [expenses, currentMonthKey]
  );

  const currentMonthNeed = useMemo(
    () =>
      roundMoney(
        currentMonthExpenses
          .filter((e) => e.category === "need")
          .reduce((sum, e) => sum + e.amount, 0)
      ),
    [currentMonthExpenses]
  );

  const currentMonthDesire = useMemo(
    () =>
      roundMoney(
        currentMonthExpenses
          .filter((e) => e.category === "desire")
          .reduce((sum, e) => sum + e.amount, 0)
      ),
    [currentMonthExpenses]
  );

  const currentMonthExpenditurePool = useMemo(
    () =>
      roundMoney(
        allocations
          .filter((a) => a.monthKey === currentMonthKey)
          .reduce((sum, a) => sum + a.expenditure, 0)
      ),
    [allocations, currentMonthKey]
  );

  const currentMonthSpent = useMemo(
    () => roundMoney(currentMonthNeed + currentMonthDesire),
    [currentMonthNeed, currentMonthDesire]
  );

  const currentMonthRemaining = useMemo(
    () =>
      roundMoney(Math.max(0, currentMonthExpenditurePool - currentMonthSpent)),
    [currentMonthExpenditurePool, currentMonthSpent]
  );

  /** Unspent current-month living allowance available for discretionary spend. */
  const desiresPoolRemaining = currentMonthRemaining;

  const budgetVariances = useMemo(
    () => buildBudgetVariances(budgetTargets, currentMonthExpenses),
    [budgetTargets, currentMonthExpenses]
  );

  const budgetPlannedTotal = useMemo(
    () =>
      roundMoney(
        budgetTargets.reduce((sum, t) => sum + Math.max(0, t.plannedAmount), 0)
      ),
    [budgetTargets]
  );

  const budgetActualTotal = useMemo(
    () =>
      roundMoney(
        budgetVariances.reduce((sum, row) => sum + row.actualAmount, 0)
      ),
    [budgetVariances]
  );

  const hourlyLaborRate = useMemo(
    () => effectiveHourlyRate(incomes),
    [incomes]
  );

  const chartData = useMemo(
    () => buildChartData(allocations),
    [allocations]
  );

  const wealthSpark = useMemo(() => {
    let running = 0;
    return chartData.map((point, index) => {
      running = roundMoney(running + point.wealth);
      return { index, value: running };
    });
  }, [chartData]);

  const donutData = useMemo((): DonutSlice[] => {
    return [
      { name: "Needs", value: currentMonthNeed, color: DONUT_COLORS.need },
      { name: "Desires", value: currentMonthDesire, color: DONUT_COLORS.desire },
      {
        name: "Unspent Allowance",
        value: currentMonthRemaining,
        color: DONUT_COLORS.remaining,
      },
    ].filter((s) => s.value > 0);
  }, [currentMonthNeed, currentMonthDesire, currentMonthRemaining]);

  const greeting = useMemo(() => {
    const hour = clock.getHours();
    if (hour < 12) return "Good morning";
    if (hour < 17) return "Good afternoon";
    return "Good evening";
  }, [clock]);

  const localizedDate = useMemo(
    () =>
      clock.toLocaleDateString("en-US", {
        weekday: "long",
        year: "numeric",
        month: "long",
        day: "numeric",
      }),
    [clock]
  );

  const localizedTime = useMemo(
    () =>
      clock.toLocaleTimeString("en-US", {
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
      }),
    [clock]
  );

  const openTribute = useCallback((mode: TributeMode = "income") => {
    setTributeMode(mode);
    setTributeOpen(true);
  }, []);

  const closeTribute = useCallback(() => {
    setTributeOpen(false);
  }, []);

  const addIncome = useCallback(
    (input: IncomeInput): boolean => {
      if (
        !input.source.trim() ||
        !Number.isFinite(input.amount) ||
        input.amount <= 0
      ) {
        return false;
      }

      const split = allocateIncome(input.amount, hasActiveDebt);
      const id = generateId();
      const date = input.date || todayIso();

      const entry: IncomeEntry = {
        id,
        source: input.source.trim(),
        amount: roundMoney(input.amount),
        date,
        interval: input.interval,
        ...split,
      };

      const event: AllocationEvent = {
        id: generateId(),
        incomeId: id,
        date,
        monthKey: monthKeyFromDate(date),
        gross: entry.amount,
        wealth: split.wealthShare,
        debt: split.debtShare,
        expenditure: split.expenditureShare,
      };

      setIncomes((prev) => [entry, ...prev]);
      setAllocations((prev) => [event, ...prev]);

      if (split.debtShare > 0) {
        setDebts((prev) => applyDebtAllocation(prev, split.debtShare));
      }

      setTributeOpen(false);
      return true;
    },
    [hasActiveDebt]
  );

  const addExpense = useCallback(
    (input: ExpenseInput): boolean => {
      if (
        !input.name.trim() ||
        !Number.isFinite(input.amount) ||
        input.amount <= 0 ||
        !input.dueDate ||
        !input.budgetCategoryId.trim()
      ) {
        return false;
      }

      const knownTarget = budgetTargets.some(
        (t) => t.id === input.budgetCategoryId
      );
      if (!knownTarget) return false;

      const entry: ExpenseEntry = {
        id: generateId(),
        name: input.name.trim(),
        category: input.category,
        amount: roundMoney(input.amount),
        date: input.date || todayIso(),
        dueDate: input.dueDate,
        budgetCategoryId: input.budgetCategoryId,
      };

      setExpenses((prev) => [entry, ...prev]);
      setTributeOpen(false);
      return true;
    },
    [budgetTargets]
  );

  const addDebt = useCallback((input: DebtInput): boolean => {
    if (
      !input.creditor.trim() ||
      !Number.isFinite(input.totalDebt) ||
      input.totalDebt <= 0 ||
      !Number.isFinite(input.monthlyAllocation) ||
      input.monthlyAllocation <= 0
    ) {
      return false;
    }

    const entry: DebtEntry = {
      id: generateId(),
      creditor: input.creditor.trim(),
      totalDebt: roundMoney(input.totalDebt),
      remainingDebt: roundMoney(input.totalDebt),
      monthlyAllocation: roundMoney(input.monthlyAllocation),
      createdAt: todayIso(),
    };

    setDebts((prev) => [entry, ...prev]);
    setTributeOpen(false);
    return true;
  }, []);

  const updateBudgetTarget = useCallback((id: string, newAmount: number) => {
    if (!Number.isFinite(newAmount) || newAmount < 0) return;
    const next = roundMoney(newAmount);
    setBudgetTargets((prev) =>
      prev.map((t) => (t.id === id ? { ...t, plannedAmount: next } : t))
    );
  }, []);

  const clearAllData = useCallback(() => {
    clearPersistedState();
    setIncomes([]);
    setExpenses([]);
    setDebts([]);
    setAllocations([]);
    setBudgetTargets(cloneDefaultBudgetTargets());
    setDisplayName(EMPTY_STATE.displayName);
    setTributeOpen(false);
    setTributeMode("income");
  }, []);

  const exportBackup = useCallback(() => {
    const backup = buildLedgerBackup({
      incomes,
      expenses,
      debts,
      allocations,
      budgetTargets,
      displayName,
    });
    const blob = new Blob([JSON.stringify(backup, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    const stamp = todayIso();
    anchor.href = url;
    anchor.download = `wealth-engine-backup-${stamp}.json`;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
  }, [incomes, expenses, debts, allocations, budgetTargets, displayName]);

  const importBackup = useCallback((raw: unknown): string | null => {
    const backup = validateLedgerBackup(raw);
    if (!backup) {
      return "Invalid backup file. Expected a Wealth Engine JSON export with incomes, expenses, and debts.";
    }

    const next: PersistedState = {
      incomes: backup.incomes,
      expenses: backup.expenses,
      debts: backup.debts,
      allocations: backup.allocations,
      budgetTargets:
        backup.budgetTargets.length > 0
          ? backup.budgetTargets
          : cloneDefaultBudgetTargets(),
      displayName: backup.displayName,
    };

    savePersistedState(next);
    setIncomes(next.incomes);
    setExpenses(next.expenses);
    setDebts(next.debts);
    setAllocations(next.allocations);
    setBudgetTargets(next.budgetTargets);
    setDisplayName(next.displayName);
    setTributeOpen(false);
    setTributeMode("income");
    setActiveNav("overview");
    return null;
  }, []);

  const deleteIncome = useCallback((id: string) => {
    setIncomes((prev) => prev.filter((i) => i.id !== id));
    setAllocations((prev) => prev.filter((a) => a.incomeId !== id));
  }, []);

  const deleteExpense = useCallback((id: string) => {
    setExpenses((prev) => prev.filter((e) => e.id !== id));
  }, []);

  const deleteDebt = useCallback((id: string) => {
    setDebts((prev) => prev.filter((d) => d.id !== id));
  }, []);

  const previewAllocation = useCallback(
    (gross: number) => allocateIncome(gross, hasActiveDebt),
    [hasActiveDebt]
  );

  const selectNav = useCallback((section: NavSection) => {
    setActiveNav(section);
    setSidebarOpen(false);
  }, []);

  return {
    hydrated,
    incomes,
    expenses,
    debts,
    allocations,
    budgetTargets,
    displayName,
    setDisplayName,
    sidebarOpen,
    setSidebarOpen,
    activeNav,
    selectNav,
    wisdomIndex,
    setWisdomIndex,
    tributeOpen,
    setTributeOpen,
    tributeMode,
    setTributeMode,
    openTribute,
    closeTribute,
    hasActiveDebt,
    goldRetained,
    debtAllocated,
    expenditurePool,
    totalSpent,
    expenditureRemaining,
    expenditureRemainingPct,
    expenditureBarTone,
    progressIndicatorClass,
    clearedDebt,
    originalDebt,
    remainingDebt,
    debtClearPct,
    totalIncome,
    needSpend,
    desireSpend,
    currentMonthNeed,
    currentMonthDesire,
    currentMonthRemaining,
    desiresPoolRemaining,
    budgetVariances,
    budgetPlannedTotal,
    budgetActualTotal,
    currentMonthExpenditurePool,
    hourlyLaborRate,
    chartData,
    wealthSpark,
    donutData,
    greeting,
    localizedDate,
    localizedTime,
    addIncome,
    addExpense,
    addDebt,
    updateBudgetTarget,
    clearAllData,
    exportBackup,
    importBackup,
    deleteIncome,
    deleteExpense,
    deleteDebt,
    previewAllocation,
  };
}

export type BabylonEngine = ReturnType<typeof useBabylonEngine>;
