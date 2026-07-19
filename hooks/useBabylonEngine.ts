"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  BABYLON_WISDOM,
  DONUT_COLORS,
  GREETING_NAME_FALLBACK,
} from "@/lib/babylon/constants";
import {
  allocateIncome,
  applyDebtAllocation,
  buildBudgetVariances,
  buildChartData,
  buildTributeEngineSnapshot,
  computeDesiresPoolRemaining,
  monthKeyFromDate,
  primaryHourlyRate,
  reverseDebtAllocation,
  roundMoney,
  todayIso,
  totalOriginalDebt,
  totalRemainingDebt,
} from "@/lib/babylon/engine";
import {
  buildLedgerBackup,
  clearPersistedState,
  clearUsername,
  loadPersistedState,
  loadUsername,
  savePersistedState,
  saveUsername,
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

export function useBabylonEngine() {
  const [hydrated, setHydrated] = useState(false);
  const [incomes, setIncomes] = useState<IncomeEntry[]>([]);
  const [expenses, setExpenses] = useState<ExpenseEntry[]>([]);
  const [debts, setDebts] = useState<DebtEntry[]>([]);
  const [allocations, setAllocations] = useState<AllocationEvent[]>([]);
  const [budgetTargets, setBudgetTargets] = useState<BudgetTarget[]>([]);
  /** Profile name input value — may be empty; greeting uses a visual fallback. */
  const [username, setUsernameState] = useState("");

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
    setBudgetTargets(stored.budgetTargets);
    setUsernameState(loadUsername(stored.displayName));
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
      displayName: username,
    };
    savePersistedState(payload);
  }, [
    hydrated,
    incomes,
    expenses,
    debts,
    allocations,
    budgetTargets,
    username,
  ]);

  const setUsername = useCallback((value: string) => {
    setUsernameState(value);
    saveUsername(value);
  }, []);

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

  /** Lifetime expenditure total — ledger need/desire mix (not Triad month card). */
  const lifetimeSpent = useMemo(
    () => roundMoney(needSpend + desireSpend),
    [needSpend, desireSpend]
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

  /** Golden Triad expenditure card — current calendar month only. */
  const expenditurePool = currentMonthExpenditurePool;
  const totalSpent = currentMonthSpent;

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

  const essentialPlannedTotal = useMemo(
    () =>
      roundMoney(
        budgetTargets
          .filter((t) => t.isEssential)
          .reduce((sum, t) => sum + Math.max(0, t.plannedAmount), 0)
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

  /** Unspent discretionary slice of the current-month 70% pool. */
  const desiresPoolRemaining = useMemo(
    () =>
      computeDesiresPoolRemaining(
        currentMonthExpenditurePool,
        currentMonthNeed,
        currentMonthDesire,
        essentialPlannedTotal
      ),
    [
      currentMonthExpenditurePool,
      currentMonthNeed,
      currentMonthDesire,
      essentialPlannedTotal,
    ]
  );

  /** Primary labor hourly rate for Affordability Anchor. */
  const hourlyLaborRate = useMemo(() => primaryHourlyRate(incomes), [incomes]);

  const tributeEngines = useMemo(
    () => buildTributeEngineSnapshot(incomes, currentMonthKey),
    [incomes, currentMonthKey]
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
        input.amount <= 0 ||
        !input.kind
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
        kind: input.kind,
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

  const updateBudgetTargetFull = useCallback(
    (id: string, updatedData: Partial<Omit<BudgetTarget, "id">>): boolean => {
      const exists = budgetTargets.some((t) => t.id === id);
      if (!exists) return false;

      if (
        updatedData.categoryName !== undefined &&
        !updatedData.categoryName.trim()
      ) {
        return false;
      }

      if (
        updatedData.plannedAmount !== undefined &&
        (!Number.isFinite(updatedData.plannedAmount) ||
          updatedData.plannedAmount < 0)
      ) {
        return false;
      }

      setBudgetTargets((prev) =>
        prev.map((t) => {
          if (t.id !== id) return t;
          return {
            ...t,
            ...(updatedData.categoryName !== undefined
              ? { categoryName: updatedData.categoryName.trim() }
              : {}),
            ...(updatedData.plannedAmount !== undefined
              ? { plannedAmount: roundMoney(updatedData.plannedAmount) }
              : {}),
            ...(updatedData.isEssential !== undefined
              ? { isEssential: updatedData.isEssential }
              : {}),
          };
        })
      );
      return true;
    },
    [budgetTargets]
  );

  const deleteBudgetTarget = useCallback(
    (id: string, reassignToId?: string | null) => {
      setBudgetTargets((prev) => {
        const canReassign =
          typeof reassignToId === "string" &&
          reassignToId !== id &&
          prev.some((t) => t.id === reassignToId);
        const targetId = canReassign ? reassignToId : null;

        setExpenses((expensesPrev) =>
          expensesPrev.map((e) => {
            if (e.budgetCategoryId !== id) return e;
            return targetId
              ? { ...e, budgetCategoryId: targetId }
              : { ...e, budgetCategoryId: undefined };
          })
        );

        return prev.filter((t) => t.id !== id);
      });
    },
    []
  );

  const addBudgetTarget = useCallback(
    (
      target: Omit<BudgetTarget, "id">,
      options?: { closeModal?: boolean }
    ): string | null => {
      const categoryName = target.categoryName.trim();
      if (
        !categoryName ||
        !Number.isFinite(target.plannedAmount) ||
        target.plannedAmount < 0
      ) {
        return null;
      }

      const entry: BudgetTarget = {
        id: generateId(),
        categoryName,
        plannedAmount: roundMoney(target.plannedAmount),
        isEssential: target.isEssential,
      };

      setBudgetTargets((prev) => [...prev, entry]);
      if (options?.closeModal !== false) {
        setTributeOpen(false);
      }
      return entry.id;
    },
    []
  );

  const clearAllData = useCallback(() => {
    clearPersistedState();
    clearUsername();
    setIncomes([]);
    setExpenses([]);
    setDebts([]);
    setAllocations([]);
    setBudgetTargets([]);
    setUsernameState("");
    setTributeOpen(false);
    setTributeMode("income");
    setActiveNav("overview");
    setSidebarOpen(false);
  }, []);

  const exportBackup = useCallback(() => {
    const backup = buildLedgerBackup({
      incomes,
      expenses,
      debts,
      allocations,
      budgetTargets,
      displayName: username,
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
  }, [incomes, expenses, debts, allocations, budgetTargets, username]);

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
      budgetTargets: backup.budgetTargets,
      displayName: backup.displayName,
    };

    savePersistedState(next);
    saveUsername(backup.displayName);
    setIncomes(next.incomes);
    setExpenses(next.expenses);
    setDebts(next.debts);
    setAllocations(next.allocations);
    setBudgetTargets(next.budgetTargets);
    setUsernameState(backup.displayName);
    setTributeOpen(false);
    setTributeMode("income");
    setActiveNav("overview");
    return null;
  }, []);

  const deleteIncome = useCallback((id: string) => {
    setIncomes((prev) => {
      const target = prev.find((i) => i.id === id);
      if (target && target.debtShare > 0) {
        setDebts((debtsPrev) =>
          reverseDebtAllocation(debtsPrev, target.debtShare)
        );
      }
      return prev.filter((i) => i.id !== id);
    });
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
    username,
    setUsername,
    /** Visual greeting name — never locks the input value. */
    greetingName: username.trim() || GREETING_NAME_FALLBACK,
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
    lifetimeSpent,
    currentMonthNeed,
    currentMonthDesire,
    currentMonthRemaining,
    desiresPoolRemaining,
    tributeEngines,
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
    updateBudgetTargetFull,
    deleteBudgetTarget,
    addBudgetTarget,
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
