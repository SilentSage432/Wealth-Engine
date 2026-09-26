"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  BABYLON_WISDOM,
  DONUT_COLORS,
  GREETING_NAME_FALLBACK,
} from "@/lib/babylon/constants";
import {
  bootstrapCurrentDesktop,
  hydrateCurrentDevice,
} from "@/lib/babylon/cloud-setup";
import { readCloudOwnerId } from "@/lib/babylon/cloud-owner";
import { financialVaultFingerprint } from "@/lib/babylon/cloud-vault";
import {
  clearCloudSyncBaseline,
  readCloudSyncBaseline,
  runCurrentVaultCycle,
  writeCloudSyncBaseline,
  type CloudSyncBaseline,
  type VaultSyncView,
} from "@/lib/babylon/vault-sync";
import { emitVaultToast } from "@/lib/babylon/vault-toast";
import {
  allocateIncome,
  actualSpendTotals,
  applyDebtAllocation,
  buildBudgetVariances,
  buildChartData,
  buildTributeEngineSnapshot,
  computeDesiresPoolRemaining,
  formatMonthLabel,
  livingBudgetRemaining,
  markExpensePaid,
  monthKeyFromDate,
  nextMonthKey,
  primaryHourlyRate,
  resolveSurplusDisposition,
  reverseDebtAllocation,
  msUntilNextLocalMidnight,
  roundMoney,
  scaleBudgetCapsToPool,
  todayIso,
  totalOriginalDebt,
  totalRemainingDebt,
  upcomingNeedsTotal,
} from "@/lib/babylon/engine";
import { DISCREET_STORAGE_KEY } from "@/lib/babylon/discreet";
import {
  normalizeAccountDraft,
  prependAccount,
  replaceAccount,
  sumAccountBalances,
  withoutAccount,
} from "@/lib/babylon/financial-position";
import {
  protectedDesignationError,
  protectedExceedsAvailable,
  totalEmergencyFund,
  totalProtectedMoney,
  totalWealthBuilding,
} from "@/lib/babylon/protected-money";
import { deriveAvailableAfterPlannedNeeds } from "@/lib/babylon/available-after-planned-needs";
import {
  deriveDueAttention,
  deriveMonthCloseAttention,
} from "@/lib/babylon/attention";
import {
  buildRecurringObligation,
  comingUpObligations,
  deleteExpenseOccurrence,
  materializeRecurringObligations,
  replaceExpenseOccurrence,
  replaceRecurringObligation,
} from "@/lib/babylon/recurring-obligations";
import {
  buildLedgerBackup,
  clearPersistedState,
  clearUsername,
  EXPENSE_SEMANTICS_VERSION,
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
  FinancialAccount,
  FinancialAccountInput,
  IncomeEntry,
  IncomeInput,
  MonthlyCloseSummary,
  NavSection,
  PeriodArchive,
  PersistedState,
  RecurringObligation,
  SurplusDisposition,
  TributeMode,
} from "@/types/babylon";

const ACTIVITY_LOG_LIMIT = 40;

export function useBabylonEngine() {
  const [hydrated, setHydrated] = useState(false);
  const [incomes, setIncomes] = useState<IncomeEntry[]>([]);
  const [expenses, setExpenses] = useState<ExpenseEntry[]>([]);
  const [debts, setDebts] = useState<DebtEntry[]>([]);
  const [allocations, setAllocations] = useState<AllocationEvent[]>([]);
  const [budgetTargets, setBudgetTargets] = useState<BudgetTarget[]>([]);
  const [accounts, setAccounts] = useState<FinancialAccount[]>([]);
  const [activityLog, setActivityLog] = useState<ActivityEvent[]>([]);
  const [emergencyShield, setEmergencyShield] = useState(0);
  const [periodArchives, setPeriodArchives] = useState<PeriodArchive[]>([]);
  const [lastClosedMonthKey, setLastClosedMonthKey] = useState<string | null>(
    null
  );
  const [expenseSemanticsVersion, setExpenseSemanticsVersion] = useState<number>(
    EXPENSE_SEMANTICS_VERSION
  );
  const [openingWealthBuilding, setOpeningWealthBuilding] = useState(0);
  const [openingEmergencyFund, setOpeningEmergencyFund] = useState(0);
  const [recurringObligations, setRecurringObligations] = useState<
    RecurringObligation[]
  >([]);
  /** Profile name input value — may be empty; greeting uses a visual fallback. */
  const [username, setUsernameState] = useState("");
  /** Auth user id when a verified Supabase session is present; null = local-only. */
  const [cloudUserId, setCloudUserId] = useState<string | null>(null);
  const cloudUserIdRef = useRef<string | null>(null);
  const [authOpen, setAuthOpen] = useState(false);
  const [vaultSync, setVaultSync] = useState<VaultSyncView>({ kind: "checking" });
  const [syncBaseline, setSyncBaseline] = useState<CloudSyncBaseline | null>(null);
  const [cloudBusy, setCloudBusy] = useState(false);
  const cloudBusyRef = useRef(false);
  const pauseAutoPushRef = useRef(false);
  const syncingRef = useRef(false);
  const rerunSyncRef = useRef(false);
  const [checkEpoch, setCheckEpoch] = useState(0);
  const [ownerEpoch, setOwnerEpoch] = useState(0);
  const [ownerUserId, setOwnerUserId] = useState<string | null>(null);
  const [ownerReady, setOwnerReady] = useState(false);

  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [activeNav, setActiveNav] = useState<NavSection>("overview");
  const [financialToday, setFinancialToday] = useState(() => todayIso());
  const [wisdomIndex, setWisdomIndex] = useState(0);

  const [tributeOpen, setTributeOpen] = useState(false);
  const [tributeMode, setTributeMode] = useState<TributeMode>("income");
  const [monthlyCloseOpen, setMonthlyCloseOpen] = useState(false);
  const [isDiscreetMode, setIsDiscreetMode] = useState(false);
  const [paycheckPending, setPaycheckPending] = useState<IncomeInput | null>(
    null
  );
  const [paycheckOpen, setPaycheckOpen] = useState(false);

  useEffect(() => {
    cloudUserIdRef.current = cloudUserId;
  }, [cloudUserId]);

  const currentMonthKey = useMemo(
    () => monthKeyFromDate(financialToday),
    [financialToday]
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
    setAccounts(stored.accounts);
    setActivityLog(stored.activityLog);
    setEmergencyShield(stored.emergencyShield);
    setPeriodArchives(stored.periodArchives);
    setLastClosedMonthKey(stored.lastClosedMonthKey);
    setExpenseSemanticsVersion(stored.expenseSemanticsVersion);
    setOpeningWealthBuilding(stored.openingWealthBuilding);
    setOpeningEmergencyFund(stored.openingEmergencyFund);
    setRecurringObligations(stored.recurringObligations);
    setUsernameState(loadUsername(stored.displayName));
    try {
      setIsDiscreetMode(
        window.localStorage.getItem(DISCREET_STORAGE_KEY) === "1"
      );
    } catch {
      setIsDiscreetMode(false);
    }
    setHydrated(true);
  }, []);

  const setDiscreetMode = useCallback((value: boolean) => {
    setIsDiscreetMode(value);
    try {
      window.localStorage.setItem(DISCREET_STORAGE_KEY, value ? "1" : "0");
    } catch {
      /* ignore quota */
    }
  }, []);

  const toggleDiscreetMode = useCallback(() => {
    setDiscreetMode(!isDiscreetMode);
  }, [isDiscreetMode, setDiscreetMode]);

  useEffect(() => {
    const supabase = getSupabaseBrowserClient();
    if (!supabase) {
      setCloudUserId(null);
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
      // Session identity only. Do not upload or download the financial vault here.
      const timer = setTimeout(() => {
        deferredTimers.delete(timer);
        if (!active) return;
        setCloudUserId(session?.user.id ?? null);
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

  useEffect(() => {
    if (!hydrated) return;
    const payload: PersistedState = {
      incomes,
      expenses,
      debts,
      allocations,
      budgetTargets,
      accounts,
      displayName: username,
      activityLog,
      emergencyShield,
      periodArchives,
      lastClosedMonthKey,
      expenseSemanticsVersion,
      openingWealthBuilding,
      openingEmergencyFund,
      recurringObligations,
    };
    savePersistedState(payload);
  }, [
    hydrated,
    incomes,
    expenses,
    debts,
    allocations,
    budgetTargets,
    accounts,
    username,
    activityLog,
    emergencyShield,
    periodArchives,
    lastClosedMonthKey,
    expenseSemanticsVersion,
    openingWealthBuilding,
    openingEmergencyFund,
    recurringObligations,
  ]);

  const vaultSnapshot = useMemo<PersistedState>(
    () => ({
      incomes,
      expenses,
      debts,
      allocations,
      budgetTargets,
      accounts,
      displayName: username,
      activityLog,
      emergencyShield,
      periodArchives,
      lastClosedMonthKey,
      expenseSemanticsVersion,
      openingWealthBuilding,
      openingEmergencyFund,
      recurringObligations,
    }),
    [
      incomes,
      expenses,
      debts,
      allocations,
      budgetTargets,
      accounts,
      username,
      activityLog,
      emergencyShield,
      periodArchives,
      lastClosedMonthKey,
      expenseSemanticsVersion,
      openingWealthBuilding,
      openingEmergencyFund,
      recurringObligations,
    ]
  );
  const vaultRef = useRef(vaultSnapshot);
  vaultRef.current = vaultSnapshot;

  useEffect(() => {
    setOwnerUserId(readCloudOwnerId());
    setSyncBaseline(readCloudSyncBaseline());
    setOwnerReady(true);
  }, [ownerEpoch]);

  const applyVault = useCallback((next: PersistedState) => {
    savePersistedState(next);
    saveUsername(next.displayName);
    setIncomes(next.incomes);
    setExpenses(next.expenses);
    setDebts(next.debts);
    setAllocations(next.allocations);
    setBudgetTargets(next.budgetTargets);
    setAccounts(next.accounts);
    setActivityLog(next.activityLog);
    setEmergencyShield(next.emergencyShield);
    setPeriodArchives(next.periodArchives);
    setLastClosedMonthKey(next.lastClosedMonthKey);
    setExpenseSemanticsVersion(next.expenseSemanticsVersion);
    setOpeningWealthBuilding(next.openingWealthBuilding);
    setOpeningEmergencyFund(next.openingEmergencyFund);
    setRecurringObligations(next.recurringObligations);
    setUsernameState(next.displayName);
  }, []);

  const requestCloudCheck = useCallback(async () => {
    const userId = cloudUserIdRef.current;
    if (!userId) {
      setVaultSync({ kind: "signed_out" });
      return;
    }
    if (syncingRef.current) {
      rerunSyncRef.current = true;
      return;
    }
    pauseAutoPushRef.current = false;
    syncingRef.current = true;
    cloudBusyRef.current = true;
    setCloudBusy(true);
    const baseline = readCloudSyncBaseline();
    const fingerprint = financialVaultFingerprint(vaultRef.current);
    setVaultSync(
      baseline?.pendingRevision
        ? { kind: "checking" }
        : baseline && fingerprint !== baseline.fingerprint
          ? { kind: "syncing", revision: baseline.revision }
          : { kind: "checking" }
    );
    try {
      const outcome = await runCurrentVaultCycle(userId, () => vaultRef.current);
      pauseAutoPushRef.current =
        outcome.view.kind === "offline_pending" ||
        outcome.view.kind === "pending_verification" ||
        outcome.view.kind === "conflict" ||
        outcome.view.kind === "unsupported_schema" ||
        outcome.view.kind === "invalid_vault" ||
        outcome.view.kind === "owner_mismatch" ||
        outcome.view.kind === "unexpected_revision" ||
        outcome.view.kind === "cloud_unavailable";
      setSyncBaseline(outcome.baseline);
      if (outcome.boundOwner) setOwnerUserId(userId);
      if (outcome.appliedLocal) applyVault(outcome.appliedLocal);
      setVaultSync(outcome.view);
    } finally {
      syncingRef.current = false;
      cloudBusyRef.current = false;
      setCloudBusy(false);
      if (rerunSyncRef.current) {
        rerunSyncRef.current = false;
        void requestCloudCheck();
      }
    }
  }, [applyVault]);

  useEffect(() => {
    if (!hydrated || !ownerReady) return;
    if (!cloudUserId) {
      setVaultSync({ kind: "signed_out" });
      return;
    }
    if (ownerUserId && ownerUserId !== cloudUserId) {
      setVaultSync({ kind: "owner_mismatch" });
      return;
    }
    void requestCloudCheck();
  }, [hydrated, ownerReady, cloudUserId, ownerUserId, checkEpoch, requestCloudCheck]);

  useEffect(() => {
    if (!hydrated || !cloudUserId || !syncBaseline || pauseAutoPushRef.current) return;
    if (financialVaultFingerprint(vaultSnapshot) === syncBaseline.fingerprint) return;
    void requestCloudCheck();
  }, [hydrated, cloudUserId, vaultSnapshot, syncBaseline, requestCloudCheck]);

  useEffect(() => {
    const onWake = () => {
      if (document.visibilityState !== "visible") return;
      pauseAutoPushRef.current = false;
      setCheckEpoch((value) => value + 1);
    };
    const onOnline = () => {
      pauseAutoPushRef.current = false;
      setCheckEpoch((value) => value + 1);
    };
    document.addEventListener("visibilitychange", onWake);
    window.addEventListener("online", onOnline);
    return () => {
      document.removeEventListener("visibilitychange", onWake);
      window.removeEventListener("online", onOnline);
    };
  }, []);

  const confirmCloudBootstrap = useCallback(async () => {
    const userId = cloudUserIdRef.current;
    if (!userId || cloudBusyRef.current) return;
    cloudBusyRef.current = true;
    setCloudBusy(true);
    try {
      const snapshot = vaultRef.current;
      const result = await bootstrapCurrentDesktop(snapshot, userId);
      if (!result.ok) {
        emitVaultToast({ tone: "error", message: result.reason, durationMs: 0 });
        setOwnerEpoch((value) => value + 1);
        setCheckEpoch((value) => value + 1);
        return;
      }
      writeCloudSyncBaseline({
        revision: 1,
        fingerprint: financialVaultFingerprint(snapshot),
      });
      setSyncBaseline(readCloudSyncBaseline());
      setOwnerUserId(userId);
      setOwnerEpoch((value) => value + 1);
      setCheckEpoch((value) => value + 1);
      emitVaultToast({
        tone: "success",
        message: "Cloud vault revision 1 is ready. This device was not replaced.",
      });
    } finally {
      cloudBusyRef.current = false;
      setCloudBusy(false);
    }
  }, []);

  const confirmCloudHydrate = useCallback(async () => {
    const userId = cloudUserIdRef.current;
    if (!userId || cloudBusyRef.current) return;
    cloudBusyRef.current = true;
    setCloudBusy(true);
    try {
      const result = await hydrateCurrentDevice(vaultRef.current, userId);
      if (!result.ok) {
        emitVaultToast({ tone: "error", message: result.reason, durationMs: 0 });
        setOwnerEpoch((value) => value + 1);
        setCheckEpoch((value) => value + 1);
        return;
      }
      applyVault(result.state);
      writeCloudSyncBaseline({
        revision: result.revision,
        fingerprint: financialVaultFingerprint(result.state),
      });
      setSyncBaseline(readCloudSyncBaseline());
      setOwnerUserId(userId);
      setOwnerEpoch((value) => value + 1);
      setCheckEpoch((value) => value + 1);
      emitVaultToast({
        tone: "success",
        message: `Cloud vault revision ${result.revision} is on this device.`,
      });
    } finally {
      cloudBusyRef.current = false;
      setCloudBusy(false);
    }
  }, [applyVault]);

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
    let timeoutId = 0;

    const alignToLocalDay = () => {
      const next = todayIso();
      setFinancialToday((prev) => (prev === next ? prev : next));
    };

    const scheduleMidnight = () => {
      timeoutId = window.setTimeout(() => {
        alignToLocalDay();
        scheduleMidnight();
      }, msUntilNextLocalMidnight());
    };

    const onVisible = () => {
      if (document.visibilityState === "visible") alignToLocalDay();
    };

    scheduleMidnight();
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.clearTimeout(timeoutId);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    setExpenses((prev) => {
      const result = materializeRecurringObligations(
        recurringObligations,
        prev,
        financialToday,
        generateId
      );
      return result.created.length === 0 ? prev : result.expenses;
    });
  }, [hydrated, financialToday, recurringObligations]);

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

  /** Sum of manual account balances. Not Living Budget and not safe-to-spend. */
  const moneyAvailable = useMemo(
    () => sumAccountBalances(accounts),
    [accounts]
  );

  const protectedMoney = useMemo(
    () => totalProtectedMoney(openingWealthBuilding, openingEmergencyFund),
    [openingWealthBuilding, openingEmergencyFund]
  );

  const wealthBuildingTotal = useMemo(
    () => totalWealthBuilding(openingWealthBuilding, goldRetained),
    [openingWealthBuilding, goldRetained]
  );

  const emergencyFundTotal = useMemo(
    () => totalEmergencyFund(openingEmergencyFund, emergencyShield),
    [openingEmergencyFund, emergencyShield]
  );

  const protectedOverAvailable = protectedExceedsAvailable(
    openingWealthBuilding,
    openingEmergencyFund,
    moneyAvailable
  );

  const lifetimeActual = useMemo(
    () => actualSpendTotals(expenses),
    [expenses]
  );
  const needSpend = lifetimeActual.need;
  const desireSpend = lifetimeActual.desire;
  const lifetimeSpent = lifetimeActual.total;

  const currentMonthActual = useMemo(
    () => actualSpendTotals(expenses, currentMonthKey),
    [expenses, currentMonthKey]
  );
  const currentMonthNeed = currentMonthActual.need;
  const currentMonthDesire = currentMonthActual.desire;
  const currentMonthSpent = currentMonthActual.total;

  const upcomingNeeds = useMemo(
    () => upcomingNeedsTotal(expenses),
    [expenses]
  );

  const availableAfterPlannedNeeds = useMemo(
    () =>
      deriveAvailableAfterPlannedNeeds({
        moneyAvailable,
        protectedMoney,
        upcomingNeeds,
      }),
    [moneyAvailable, protectedMoney, upcomingNeeds]
  );

  const comingUp = useMemo(() => comingUpObligations(expenses), [expenses]);

  const dueAttention = useMemo(
    () => deriveDueAttention(expenses, financialToday),
    [expenses, financialToday]
  );

  const monthCloseAttention = useMemo(
    () =>
      deriveMonthCloseAttention({
        today: financialToday,
        currentMonthKey,
        lastClosedMonthKey,
      }),
    [financialToday, currentMonthKey, lastClosedMonthKey]
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

  const currentMonthExpenses = useMemo(
    () => expenses.filter((e) => monthKeyFromDate(e.date) === currentMonthKey),
    [expenses, currentMonthKey]
  );

  const currentMonthRemaining = livingBudgetRemaining(
    currentMonthExpenditurePool,
    currentMonthSpent
  );

  /** Golden Triad expenditure card — current calendar month only. */
  const expenditurePool = currentMonthExpenditurePool;
  const totalSpent = currentMonthSpent;
  const expenditureRemaining = currentMonthRemaining;

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
      { name: "Wants", value: currentMonthDesire, color: DONUT_COLORS.desire },
      {
        name: "Remaining",
        value: currentMonthRemaining,
        color: DONUT_COLORS.remaining,
      },
    ].filter((s) => s.value > 0);
  }, [currentMonthNeed, currentMonthDesire, currentMonthRemaining]);

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

      pushActivity({
        kind: "income",
        title: entry.source,
        subtitle: "Income added",
        amount: entry.amount,
        streamKind: entry.kind,
      });

      setTributeOpen(false);
      return true;
    },
    [hasActiveDebt, pushActivity]
  );

  /** Stage income for Paycheck Auto-Splitter review before vault commit. */
  const proposeIncomeSplit = useCallback(
    (input: IncomeInput): boolean => {
      if (
        !input.source.trim() ||
        !Number.isFinite(input.amount) ||
        input.amount <= 0 ||
        !input.kind
      ) {
        return false;
      }
      setPaycheckPending({
        ...input,
        source: input.source.trim(),
        amount: roundMoney(input.amount),
        date: input.date || todayIso(),
      });
      setTributeOpen(false);
      setPaycheckOpen(true);
      return true;
    },
    []
  );

  const cancelPaycheckSplit = useCallback(() => {
    setPaycheckPending(null);
    setPaycheckOpen(false);
  }, []);

  const executePaycheckSplit = useCallback((): boolean => {
    if (!paycheckPending) return false;
    const pending = paycheckPending;
    setPaycheckPending(null);
    setPaycheckOpen(false);
    return addIncome(pending);
  }, [paycheckPending, addIncome]);

  const paycheckPreview = useMemo(() => {
    if (!paycheckPending) return null;
    return allocateIncome(paycheckPending.amount, hasActiveDebt);
  }, [paycheckPending, hasActiveDebt]);

  const addExpense = useCallback(
    (input: ExpenseInput): boolean => {
      if (
        !input.name.trim() ||
        !Number.isFinite(input.amount) ||
        input.amount <= 0 ||
        !input.dueDate ||
        !input.budgetCategoryId.trim() ||
        typeof input.isSettled !== "boolean"
      ) {
        return false;
      }

      const knownTarget = budgetTargets.some(
        (t) => t.id === input.budgetCategoryId
      );
      if (!knownTarget) return false;

      if (input.repeatsMonthly) {
        if (input.isSettled) return false;
        const rule = buildRecurringObligation(
          {
            name: input.name,
            amount: input.amount,
            category: input.category,
            budgetCategoryId: input.budgetCategoryId,
            firstDueDate: input.dueDate,
          },
          generateId(),
          todayIso()
        );
        if (!rule) return false;
        setRecurringObligations((prev) => [rule, ...prev]);
        pushActivity({
          kind: "expense",
          title: rule.name,
          subtitle: "Repeats monthly",
          amount: rule.amount,
        });
        setTributeOpen(false);
        return true;
      }

      const entry: ExpenseEntry = {
        id: generateId(),
        name: input.name.trim(),
        category: input.category,
        amount: roundMoney(input.amount),
        date: input.date || todayIso(),
        dueDate: input.dueDate,
        budgetCategoryId: input.budgetCategoryId,
        isSettled: input.isSettled,
      };

      setExpenses((prev) => [entry, ...prev]);
      pushActivity({
        kind: "expense",
        title: entry.name,
        subtitle: entry.isSettled ? "Expense added" : "Upcoming expense added",
        amount: entry.amount,
      });

      setTributeOpen(false);
      return true;
    },
    [budgetTargets, pushActivity]
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
      interestRate: roundMoney(Math.max(0, input.interestRate ?? 0)),
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
            ? `Expenses moved to ${reassignName}`
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
        subtitle: "Category added",
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
      const paymentDate = todayIso();

      setExpenses((prev) => {
        const target = prev.find((e) => e.id === id);
        if (!target) return prev;
        nextSettled = !target.isSettled;
        name = target.name;
        amount = target.amount;
        return prev.map((e) => {
          if (e.id !== id) return e;
          return nextSettled ? markExpensePaid(e, paymentDate) : { ...e, isSettled: false };
        });
      });

      if (nextSettled !== null) {
        pushActivity({
          kind: "settle",
          title: name,
          subtitle: nextSettled ? "Expense marked paid" : "Reopened as upcoming",
          amount,
        });
      }
    },
    [pushActivity]
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
      subtitle: `Caps fitted to the ${formatMonthLabel(currentMonthKey)} Living Budget`,
      amount: currentMonthExpenditurePool,
    });

    return true;
  }, [
    budgetTargets,
    currentMonthExpenditurePool,
    currentMonthKey,
    pushActivity,
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
        const resolved = resolveSurplusDisposition(
          surplus,
          disposition,
          hasActiveDebt
        );

        if (resolved.shield > 0) {
          setEmergencyShield((prev) => roundMoney(prev + resolved.shield));
        }

        if (resolved.rollover > 0) {
          const rollEvent: AllocationEvent = {
            id: generateId(),
            incomeId: `period-rollover-${currentMonthKey}`,
            date: todayIso(),
            monthKey: nextMonthKey(currentMonthKey),
            gross: resolved.rollover,
            wealth: 0,
            debt: 0,
            expenditure: resolved.rollover,
          };
          setAllocations((prev) => [rollEvent, ...prev]);
        } else if (resolved.wealth > 0 || resolved.debt > 0) {
          const event: AllocationEvent = {
            id: generateId(),
            incomeId: `period-close-${currentMonthKey}`,
            date: todayIso(),
            monthKey: currentMonthKey,
            gross: surplus,
            wealth: resolved.wealth,
            debt: resolved.debt,
            expenditure: 0,
          };
          setAllocations((prev) => [event, ...prev]);
          if (resolved.debt > 0) {
            setDebts((prev) => applyDebtAllocation(prev, resolved.debt));
          }
        }
      }

      setPeriodArchives((prev) => [archive, ...prev]);
      setLastClosedMonthKey(currentMonthKey);

      const subtitle =
        disposition === "emergency_shield"
          ? "Surplus added to Emergency Fund"
          : disposition === "wealth_boost"
            ? "Surplus added to Wealth Building"
            : disposition === "split_50_50"
              ? "Surplus split between Wealth Building and Debt Payoff"
              : disposition === "rollover"
                ? "Surplus rolled into next month's Living Budget"
                : "Surplus split between Wealth Building and Debt Payoff";

      pushActivity({
        kind: "close",
        title: `${monthlyCloseSummary.monthLabel} closed`,
        subtitle,
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
    clearCloudSyncBaseline();
    setSyncBaseline(null);
    pauseAutoPushRef.current = false;
    setCheckEpoch((value) => value + 1);
    setIncomes([]);
    setExpenses([]);
    setDebts([]);
    setAllocations([]);
    setBudgetTargets([]);
    setAccounts([]);
    setActivityLog([]);
    setEmergencyShield(0);
    setPeriodArchives([]);
    setLastClosedMonthKey(null);
    setExpenseSemanticsVersion(EXPENSE_SEMANTICS_VERSION);
    setOpeningWealthBuilding(0);
    setOpeningEmergencyFund(0);
    setRecurringObligations([]);
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
      accounts,
      displayName: username,
      activityLog,
      emergencyShield,
      periodArchives,
      lastClosedMonthKey,
      expenseSemanticsVersion,
      openingWealthBuilding,
      openingEmergencyFund,
      recurringObligations,
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
    accounts,
    username,
    activityLog,
    emergencyShield,
    periodArchives,
    lastClosedMonthKey,
    expenseSemanticsVersion,
    openingWealthBuilding,
    openingEmergencyFund,
    recurringObligations,
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
      accounts: backup.accounts ?? [],
      displayName: backup.displayName,
      activityLog: backup.activityLog ?? [],
      emergencyShield: backup.emergencyShield ?? 0,
      periodArchives: backup.periodArchives ?? [],
      lastClosedMonthKey: backup.lastClosedMonthKey ?? null,
      expenseSemanticsVersion: EXPENSE_SEMANTICS_VERSION,
      openingWealthBuilding: backup.openingWealthBuilding ?? 0,
      openingEmergencyFund: backup.openingEmergencyFund ?? 0,
      recurringObligations: backup.recurringObligations ?? [],
    };

    applyVault(next);
    pauseAutoPushRef.current = false;
    setCheckEpoch((value) => value + 1);
    setTributeOpen(false);
    setTributeMode("income");
    setMonthlyCloseOpen(false);
    setActiveNav("overview");
    return null;
  }, [applyVault]);

  const addAccount = useCallback((input: FinancialAccountInput): boolean => {
    const account = normalizeAccountDraft(input, generateId());
    if (!account) return false;
    setAccounts((prev) => prependAccount(prev, account));
    return true;
  }, []);

  const updateAccount = useCallback(
    (id: string, input: FinancialAccountInput): boolean => {
      const next = normalizeAccountDraft(input, id);
      if (!next) return false;
      if (!accounts.some((account) => account.id === id)) return false;
      setAccounts((prev) => replaceAccount(prev, id, next) ?? prev);
      return true;
    },
    [accounts]
  );

  const removeAccount = useCallback((id: string) => {
    setAccounts((prev) => withoutAccount(prev, id));
  }, []);

  const updateProtectedDesignations = useCallback(
    (wealth: number, emergency: number): string | null => {
      const error = protectedDesignationError(
        wealth,
        emergency,
        moneyAvailable
      );
      if (error) return error;
      setOpeningWealthBuilding(roundMoney(wealth));
      setOpeningEmergencyFund(roundMoney(emergency));
      return null;
    },
    [moneyAvailable]
  );

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

  const recurringRef = useRef(recurringObligations);
  const expensesRef = useRef(expenses);
  recurringRef.current = recurringObligations;
  expensesRef.current = expenses;

  const deleteExpense = useCallback((id: string) => {
    const result = deleteExpenseOccurrence(
      recurringRef.current,
      expensesRef.current,
      id
    );
    if (!result) return;
    recurringRef.current = result.rules;
    expensesRef.current = result.expenses;
    setRecurringObligations(result.rules);
    setExpenses(result.expenses);
  }, []);

  const updateExpenseOccurrence = useCallback(
    (id: string, patch: { amount: number; dueDate: string }): boolean => {
      let ok = false;
      setExpenses((prev) => {
        const next = replaceExpenseOccurrence(prev, id, patch);
        if (!next) return prev;
        ok = true;
        return next;
      });
      return ok;
    },
    []
  );

  const updateRecurringObligation = useCallback(
    (
      id: string,
      patch: {
        name: string;
        amount: number;
        category: "need" | "desire";
        budgetCategoryId: string;
        dueDay: number;
        isActive: boolean;
      }
    ): boolean => {
      const current = recurringObligations.find((rule) => rule.id === id);
      if (!current) return false;
      if (
        patch.budgetCategoryId !== current.budgetCategoryId &&
        !budgetTargets.some((target) => target.id === patch.budgetCategoryId)
      ) {
        return false;
      }
      const next = replaceRecurringObligation(recurringObligations, id, patch);
      if (!next) return false;
      setRecurringObligations(next);
      pushActivity({
        kind: "expense",
        title: patch.name.trim(),
        subtitle: patch.isActive ? "Monthly bill updated" : "Monthly bill stopped",
        amount: roundMoney(patch.amount),
      });
      return true;
    },
    [budgetTargets, pushActivity, recurringObligations]
  );

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
    /** True when a Supabase session is present. This is not vault synchronization. */
    isCloudSynced: cloudUserId !== null,
    cloudUserId,
    vaultSync,
    cloudBusy,
    confirmCloudBootstrap,
    confirmCloudHydrate,
    confirmCloudCheck: requestCloudCheck,
    authOpen,
    setAuthOpen,
    handleAuthenticated,
    signOutCloud,
    incomes,
    expenses,
    debts,
    allocations,
    budgetTargets,
    accounts,
    moneyAvailable,
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
    paycheckOpen,
    paycheckPending,
    paycheckPreview,
    proposeIncomeSplit,
    executePaycheckSplit,
    cancelPaycheckSplit,
    isDiscreetMode,
    setDiscreetMode,
    toggleDiscreetMode,
    hasActiveDebt,
    goldRetained,
    openingWealthBuilding,
    openingEmergencyFund,
    protectedMoney,
    wealthBuildingTotal,
    emergencyFundTotal,
    protectedOverAvailable,
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
    upcomingNeeds,
    availableAfterPlannedNeeds,
    comingUp,
    dueAttention,
    monthCloseAttention,
    recurringObligations,
    desiresPoolRemaining,
    tributeEngines,
    recentActivity,
    monthlyCloseSummary,
    emergencyShield,
    lastClosedMonthKey,
    periodArchives,
    currentMonthKey,
    budgetVariances,
    budgetPlannedTotal,
    budgetActualTotal,
    currentMonthExpenditurePool,
    hourlyLaborRate,
    chartData,
    wealthSpark,
    donutData,
    addAccount,
    updateAccount,
    removeAccount,
    updateProtectedDesignations,
    addIncome,
    addExpense,
    addDebt,
    updateBudgetTarget,
    updateBudgetTargetFull,
    deleteBudgetTarget,
    addBudgetTarget,
    toggleExpenseSettled,
    updateExpenseOccurrence,
    updateRecurringObligation,
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
