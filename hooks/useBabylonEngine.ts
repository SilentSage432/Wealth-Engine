"use client";

import { useMutation } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  BABYLON_WISDOM,
  DONUT_COLORS,
  GREETING_NAME_FALLBACK,
} from "@/lib/babylon/constants";
import {
  cloudUpdateExpenseSettled,
  cloudUpsertBudgetTargets,
  cloudUpsertExpense,
  cloudUpsertIncome,
} from "@/lib/babylon/cloud-sync";
import {
  migrateLocalLedgerToCloud,
  type LocalVaultSnapshot,
} from "@/lib/babylon/cloud-hydrate";
import {
  allocateIncome,
  applyDebtAllocation,
  buildBudgetVariances,
  buildChartData,
  buildTributeEngineSnapshot,
  computeDesiresPoolRemaining,
  formatMonthLabel,
  monthKeyFromDate,
  primaryHourlyRate,
  reverseDebtAllocation,
  roundMoney,
  scaleBudgetCapsToPool,
  splitSurplusToDebtWealth,
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
import { signOutCloudSession } from "@/lib/supabase/auth";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import { generateId } from "@/lib/utils";
import type {
  ActivityEvent,
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
  MonthlyCloseSummary,
  NavSection,
  PeriodArchive,
  PersistedState,
  SurplusDisposition,
  TributeMode,
} from "@/types/babylon";

const ACTIVITY_LOG_LIMIT = 40;

function logCloudSyncFailure(operation: string, error: unknown) {
  console.error(`[cloud-sync] ${operation} failed — local vault retained.`, error);
}

export function useBabylonEngine() {
  const [hydrated, setHydrated] = useState(false);
  const [incomes, setIncomes] = useState<IncomeEntry[]>([]);
  const [expenses, setExpenses] = useState<ExpenseEntry[]>([]);
  const [debts, setDebts] = useState<DebtEntry[]>([]);
  const [allocations, setAllocations] = useState<AllocationEvent[]>([]);
  const [budgetTargets, setBudgetTargets] = useState<BudgetTarget[]>([]);
  const [activityLog, setActivityLog] = useState<ActivityEvent[]>([]);
  const [emergencyShield, setEmergencyShield] = useState(0);
  const [periodArchives, setPeriodArchives] = useState<PeriodArchive[]>([]);
  const [lastClosedMonthKey, setLastClosedMonthKey] = useState<string | null>(
    null
  );
  /** Profile name input value — may be empty; greeting uses a visual fallback. */
  const [username, setUsernameState] = useState("");
  /** Auth user id when a verified Supabase session is present; null = local-only. */
  const [cloudUserId, setCloudUserId] = useState<string | null>(null);
  const cloudUserIdRef = useRef<string | null>(null);
  /**
   * True after the auth client's initial session sweep has been applied
   * outside its exclusive lock (see onAuthStateChange insulation below).
   */
  const [authReady, setAuthReady] = useState(false);
  const [authOpen, setAuthOpen] = useState(false);
  const [cloudHydrating, setCloudHydrating] = useState(false);
  const hydrationAttemptedRef = useRef<Set<string>>(new Set());
  const ledgerSnapshotRef = useRef<LocalVaultSnapshot>({
    incomes: [],
    expenses: [],
    budgetTargets: [],
    username: "",
    monthKey: "",
  });

  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [activeNav, setActiveNav] = useState<NavSection>("overview");
  const [clock, setClock] = useState(() => new Date());
  const [wisdomIndex, setWisdomIndex] = useState(0);

  const [tributeOpen, setTributeOpen] = useState(false);
  const [tributeMode, setTributeMode] = useState<TributeMode>("income");
  const [monthlyCloseOpen, setMonthlyCloseOpen] = useState(false);

  useEffect(() => {
    cloudUserIdRef.current = cloudUserId;
  }, [cloudUserId]);

  const currentMonthKey = useMemo(
    () => monthKeyFromDate(todayIso()),
    // Recompute when the calendar day may roll over with the live clock.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [clock]
  );

  useEffect(() => {
    ledgerSnapshotRef.current = {
      incomes,
      expenses,
      budgetTargets,
      username,
      monthKey: currentMonthKey,
    };
  }, [incomes, expenses, budgetTargets, username, currentMonthKey]);

  const { mutate: mutateUpsertIncome } = useMutation({
    mutationFn: ({
      userId,
      entry,
    }: {
      userId: string;
      entry: IncomeEntry;
    }) => cloudUpsertIncome(userId, entry),
    onError: (error) => logCloudSyncFailure("upsertIncome", error),
  });

  const { mutate: mutateUpsertExpense } = useMutation({
    mutationFn: ({
      userId,
      entry,
    }: {
      userId: string;
      entry: ExpenseEntry;
    }) => cloudUpsertExpense(userId, entry),
    onError: (error) => logCloudSyncFailure("upsertExpense", error),
  });

  const { mutate: mutateUpdateExpenseSettled } = useMutation({
    mutationFn: ({
      userId,
      expenseId,
      isSettled,
    }: {
      userId: string;
      expenseId: string;
      isSettled: boolean;
    }) => cloudUpdateExpenseSettled(userId, expenseId, isSettled),
    onError: (error) => logCloudSyncFailure("updateExpenseSettled", error),
  });

  const { mutate: mutateUpsertBudgetTargets } = useMutation({
    mutationFn: ({
      userId,
      targets,
      monthKey,
    }: {
      userId: string;
      targets: BudgetTarget[];
      monthKey: string;
    }) => cloudUpsertBudgetTargets(userId, targets, monthKey),
    onError: (error) => logCloudSyncFailure("upsertBudgetTargets", error),
  });

  const queueCloudWrite = useCallback(
    (write: (userId: string) => void) => {
      const userId = cloudUserIdRef.current;
      if (!userId) return;
      write(userId);
    },
    []
  );

  const pushActivity = useCallback(
    (event: Omit<ActivityEvent, "id" | "createdAt"> & { createdAt?: string }) => {
      const entry: ActivityEvent = {
        id: generateId(),
        createdAt: event.createdAt ?? new Date().toISOString(),
        kind: event.kind,
        title: event.title,
        ...(event.subtitle ? { subtitle: event.subtitle } : {}),
        ...(event.amount !== undefined ? { amount: event.amount } : {}),
        ...(event.streamKind ? { streamKind: event.streamKind } : {}),
      };
      setActivityLog((prev) => [entry, ...prev].slice(0, ACTIVITY_LOG_LIMIT));
    },
    []
  );

  useEffect(() => {
    const stored = loadPersistedState();
    setIncomes(stored.incomes);
    setExpenses(stored.expenses);
    setDebts(stored.debts);
    setAllocations(stored.allocations);
    setBudgetTargets(stored.budgetTargets);
    setActivityLog(stored.activityLog);
    setEmergencyShield(stored.emergencyShield);
    setPeriodArchives(stored.periodArchives);
    setLastClosedMonthKey(stored.lastClosedMonthKey);
    setUsernameState(loadUsername(stored.displayName));
    setHydrated(true);
  }, []);

  useEffect(() => {
    const supabase = getSupabaseBrowserClient();
    if (!supabase) {
      setCloudUserId(null);
      setAuthReady(true);
      return;
    }

    let active = true;
    const deferredTimers = new Set<ReturnType<typeof setTimeout>>();

    /**
     * Supabase holds an exclusive auth lock while `onAuthStateChange` runs.
     * Any nested auth/PostgREST call (including work kicked off by React
     * effects that read localStorage then hit Supabase) can deadlock the
     * initial mobile session sweep. Defer all React state application to
     * the next macrotask so the lock is released first.
     */
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      const timer = setTimeout(() => {
        deferredTimers.delete(timer);
        if (!active) return;
        setCloudUserId(session?.user.id ?? null);
        setAuthReady(true);
      }, 0);
      deferredTimers.add(timer);
    });

    return () => {
      active = false;
      for (const timer of deferredTimers) {
        clearTimeout(timer);
      }
      deferredTimers.clear();
      subscription.unsubscribe();
    };
  }, []);

  /** One-time local → cloud hydration when a session appears over an empty vault. */
  useEffect(() => {
    // Wait for authReady so hydration never races the insulated INITIAL_SESSION apply.
    if (!hydrated || !authReady || !cloudUserId) return;
    if (hydrationAttemptedRef.current.has(cloudUserId)) return;

    let cancelled = false;
    setCloudHydrating(true);

    void (async () => {
      try {
        const result = await migrateLocalLedgerToCloud(
          cloudUserId,
          ledgerSnapshotRef.current
        );
        if (cancelled) return;

        if (result.remapped) {
          setIncomes(result.remapped.incomes);
          setExpenses(result.remapped.expenses);
          setBudgetTargets(result.remapped.budgetTargets);
        }

        if (result.migrated) {
          pushActivity({
            kind: "close",
            title: "Cloud vault sealed",
            subtitle: "Local ledger migrated to your secure account",
          });
        }
      } catch (error) {
        console.error(
          "[cloud-hydrate] local→cloud migration failed — local vault retained.",
          error
        );
      } finally {
        if (!cancelled) {
          hydrationAttemptedRef.current.add(cloudUserId);
          setCloudHydrating(false);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [hydrated, authReady, cloudUserId, pushActivity]);

  useEffect(() => {
    if (!hydrated) return;
    const payload: PersistedState = {
      incomes,
      expenses,
      debts,
      allocations,
      budgetTargets,
      displayName: username,
      activityLog,
      emergencyShield,
      periodArchives,
      lastClosedMonthKey,
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
    activityLog,
    emergencyShield,
    periodArchives,
    lastClosedMonthKey,
  ]);

  const setUsername = useCallback((value: string) => {
    setUsernameState(value);
    saveUsername(value);
  }, []);

  const handleAuthenticated = useCallback(
    (payload: { userId: string; username: string; mode: "sign_in" | "sign_up" }) => {
      if (payload.mode === "sign_up" && payload.username.trim()) {
        setUsername(payload.username.trim());
      }
      setAuthOpen(false);
    },
    [setUsername]
  );

  const signOutCloud = useCallback(async () => {
    const result = await signOutCloudSession();
    if (!result.ok) {
      console.error("[auth] sign out failed", result.message);
      return false;
    }
    // Session wipe only — local vault / localStorage backup remains intact.
    return true;
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

  const recentActivity = useMemo(
    () => activityLog.slice(0, 5),
    [activityLog]
  );

  const monthlyCloseSummary = useMemo((): MonthlyCloseSummary => {
    const monthAllocations = allocations.filter(
      (a) => a.monthKey === currentMonthKey
    );
    const wealthAllocated = roundMoney(
      monthAllocations.reduce((sum, a) => sum + a.wealth, 0)
    );
    const debtAllocatedMonth = roundMoney(
      monthAllocations.reduce((sum, a) => sum + a.debt, 0)
    );
    const totalIncomeMonth = roundMoney(
      monthAllocations.reduce((sum, a) => sum + a.gross, 0)
    );
    const surplusOrDeficit = roundMoney(
      currentMonthExpenditurePool - currentMonthSpent
    );

    return {
      monthKey: currentMonthKey,
      monthLabel: formatMonthLabel(currentMonthKey),
      totalIncome: totalIncomeMonth,
      totalSpent: currentMonthSpent,
      wealthAllocated,
      debtAllocated: debtAllocatedMonth,
      expenditurePool: currentMonthExpenditurePool,
      expenditureRemaining: currentMonthRemaining,
      surplusOrDeficit,
      alreadyClosed: lastClosedMonthKey === currentMonthKey,
    };
  }, [
    allocations,
    currentMonthKey,
    currentMonthExpenditurePool,
    currentMonthSpent,
    currentMonthRemaining,
    lastClosedMonthKey,
  ]);

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

      // Local path — always mutate vault state (offline-capable).
      setIncomes((prev) => [entry, ...prev]);
      setAllocations((prev) => [event, ...prev]);

      if (split.debtShare > 0) {
        setDebts((prev) => applyDebtAllocation(prev, split.debtShare));
      }

      pushActivity({
        kind: "income",
        title: entry.source,
        subtitle: "Income engine recorded",
        amount: entry.amount,
        streamKind: entry.kind,
      });

      // Cloud path — dual-write when a verified session exists.
      queueCloudWrite((userId) => {
        mutateUpsertIncome({ userId, entry });
      });

      setTributeOpen(false);
      return true;
    },
    [hasActiveDebt, pushActivity, queueCloudWrite, mutateUpsertIncome]
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
        isSettled: false,
      };

      setExpenses((prev) => [entry, ...prev]);
      pushActivity({
        kind: "expense",
        title: entry.name,
        subtitle:
          entry.category === "desire" ? "Desire archived" : "Need archived",
        amount: entry.amount,
      });

      queueCloudWrite((userId) => {
        mutateUpsertExpense({ userId, entry });
      });

      setTributeOpen(false);
      return true;
    },
    [budgetTargets, pushActivity, queueCloudWrite, mutateUpsertExpense]
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
      let removedName: string | null = null;
      let reassignName: string | null = null;

      setBudgetTargets((prev) => {
        const removed = prev.find((t) => t.id === id);
        const canReassign =
          typeof reassignToId === "string" &&
          reassignToId !== id &&
          prev.some((t) => t.id === reassignToId);
        const targetId = canReassign ? reassignToId : null;
        removedName = removed?.categoryName ?? null;
        reassignName = targetId
          ? (prev.find((t) => t.id === targetId)?.categoryName ?? null)
          : null;

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

      if (removedName) {
        pushActivity({
          kind: "budget",
          title: removedName,
          subtitle: reassignName
            ? `Category removed · orphans → ${reassignName}`
            : "Category removed",
        });
      }
    },
    [pushActivity]
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
      pushActivity({
        kind: "budget",
        title: entry.categoryName,
        subtitle: "Budget bucket mapped",
        amount: entry.plannedAmount,
      });
      if (options?.closeModal !== false) {
        setTributeOpen(false);
      }
      return entry.id;
    },
    [pushActivity]
  );

  const toggleExpenseSettled = useCallback(
    (id: string) => {
      let nextSettled: boolean | null = null;
      let name = "";
      let amount = 0;

      setExpenses((prev) => {
        const target = prev.find((e) => e.id === id);
        if (!target) return prev;
        nextSettled = !target.isSettled;
        name = target.name;
        amount = target.amount;
        return prev.map((e) =>
          e.id === id ? { ...e, isSettled: nextSettled! } : e
        );
      });

      if (nextSettled !== null) {
        pushActivity({
          kind: "settle",
          title: name,
          subtitle: nextSettled ? "Marked settled" : "Reopened as pending",
          amount,
        });

        const settled = nextSettled;
        queueCloudWrite((userId) => {
          mutateUpdateExpenseSettled({
            userId,
            expenseId: id,
            isSettled: settled,
          });
        });
      }
    },
    [pushActivity, queueCloudWrite, mutateUpdateExpenseSettled]
  );

  const autoScaleBudgetCaps = useCallback((): boolean => {
    if (budgetTargets.length === 0) return false;
    if (currentMonthExpenditurePool <= 0) return false;
    const scaled = scaleBudgetCapsToPool(
      budgetTargets,
      currentMonthExpenditurePool
    );
    if (!scaled) return false;
    setBudgetTargets(scaled);
    pushActivity({
      kind: "budget",
      title: "Auto-Scale Allocations",
      subtitle: `Caps fitted to ${formatMonthLabel(currentMonthKey)} 70% pool`,
      amount: currentMonthExpenditurePool,
    });

    queueCloudWrite((userId) => {
      mutateUpsertBudgetTargets({
        userId,
        targets: scaled,
        monthKey: currentMonthKey,
      });
    });

    return true;
  }, [
    budgetTargets,
    currentMonthExpenditurePool,
    currentMonthKey,
    pushActivity,
    queueCloudWrite,
    mutateUpsertBudgetTargets,
  ]);

  const closeMonth = useCallback(
    (disposition: SurplusDisposition): boolean => {
      if (lastClosedMonthKey === currentMonthKey) return false;

      const surplus = Math.max(0, expenditureRemaining);
      const closedAt = new Date().toISOString();
      const archive: PeriodArchive = {
        id: generateId(),
        monthKey: currentMonthKey,
        closedAt,
        totalIncome: monthlyCloseSummary.totalIncome,
        totalSpent: monthlyCloseSummary.totalSpent,
        wealthAllocated: monthlyCloseSummary.wealthAllocated,
        debtAllocated: monthlyCloseSummary.debtAllocated,
        expenditurePool: monthlyCloseSummary.expenditurePool,
        expenditureRemaining: monthlyCloseSummary.expenditureRemaining,
        surplusDisposition: disposition,
        surplusAmount: surplus,
      };

      if (surplus > 0) {
        if (disposition === "emergency_shield") {
          setEmergencyShield((prev) => roundMoney(prev + surplus));
        } else {
          const split = splitSurplusToDebtWealth(surplus, hasActiveDebt);
          const event: AllocationEvent = {
            id: generateId(),
            incomeId: `period-close-${currentMonthKey}`,
            date: todayIso(),
            monthKey: currentMonthKey,
            gross: surplus,
            wealth: split.wealth,
            debt: split.debt,
            expenditure: 0,
          };
          setAllocations((prev) => [event, ...prev]);
          if (split.debt > 0) {
            setDebts((prev) => applyDebtAllocation(prev, split.debt));
          }
        }
      }

      setExpenses((prev) =>
        prev.map((e) =>
          monthKeyFromDate(e.date) === currentMonthKey
            ? { ...e, isSettled: true }
            : e
        )
      );
      setPeriodArchives((prev) => [archive, ...prev]);
      setLastClosedMonthKey(currentMonthKey);
      pushActivity({
        kind: "close",
        title: `${monthlyCloseSummary.monthLabel} closed`,
        subtitle:
          disposition === "emergency_shield"
            ? "Surplus tucked into emergency shield"
            : "Surplus directed to Debt/Wealth multiplier",
        amount: surplus,
      });
      setMonthlyCloseOpen(false);
      return true;
    },
    [
      lastClosedMonthKey,
      currentMonthKey,
      expenditureRemaining,
      monthlyCloseSummary,
      hasActiveDebt,
      pushActivity,
    ]
  );

  const clearAllData = useCallback(() => {
    clearPersistedState();
    clearUsername();
    setIncomes([]);
    setExpenses([]);
    setDebts([]);
    setAllocations([]);
    setBudgetTargets([]);
    setActivityLog([]);
    setEmergencyShield(0);
    setPeriodArchives([]);
    setLastClosedMonthKey(null);
    setUsernameState("");
    setTributeOpen(false);
    setTributeMode("income");
    setMonthlyCloseOpen(false);
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
      activityLog,
      emergencyShield,
      periodArchives,
      lastClosedMonthKey,
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
  }, [
    incomes,
    expenses,
    debts,
    allocations,
    budgetTargets,
    username,
    activityLog,
    emergencyShield,
    periodArchives,
    lastClosedMonthKey,
  ]);

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
      activityLog: backup.activityLog ?? [],
      emergencyShield: backup.emergencyShield ?? 0,
      periodArchives: backup.periodArchives ?? [],
      lastClosedMonthKey: backup.lastClosedMonthKey ?? null,
    };

    savePersistedState(next);
    saveUsername(backup.displayName);
    setIncomes(next.incomes);
    setExpenses(next.expenses);
    setDebts(next.debts);
    setAllocations(next.allocations);
    setBudgetTargets(next.budgetTargets);
    setActivityLog(next.activityLog);
    setEmergencyShield(next.emergencyShield);
    setPeriodArchives(next.periodArchives);
    setLastClosedMonthKey(next.lastClosedMonthKey);
    setUsernameState(backup.displayName);
    setTributeOpen(false);
    setTributeMode("income");
    setMonthlyCloseOpen(false);
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
    /** True when a verified Supabase session is active (cloud dual-write armed). */
    isCloudSynced: cloudUserId !== null,
    cloudUserId,
    cloudHydrating,
    authOpen,
    setAuthOpen,
    handleAuthenticated,
    signOutCloud,
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
    monthlyCloseOpen,
    setMonthlyCloseOpen,
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
    recentActivity,
    monthlyCloseSummary,
    emergencyShield,
    lastClosedMonthKey,
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
    toggleExpenseSettled,
    autoScaleBudgetCaps,
    closeMonth,
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
