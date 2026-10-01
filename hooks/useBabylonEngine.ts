"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useBalanceObservation } from "@/hooks/useBalanceObservation";
import {
  operationalAccountPosition,
  operationalAccountPositions,
  operationalMoneyAvailable,
} from "@/lib/babylon/balance-evidence-load";
import {
  currentEmergencyFundPosition,
  currentWealthBuildingPosition,
  isFirstPurposeDesignation,
  openingForPurpose,
  residualAfterFirstDesignation,
  withAccountPurpose,
  type FirstDesignationReconcileChoice,
} from "@/lib/babylon/account-purpose";
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
import {
  CONFLICT_REFRESH_INCOMPLETE_COPY,
  logCloudSyncDiagnostic,
  performCloudSyncCheck,
  rememberQueuedCloudCheck,
  shouldLaunchQueuedCloudCheck,
  takeOccupiedCloudCheckQueue,
  type CloudSyncRequestTrigger,
} from "@/lib/babylon/cloud-sync-check";
import {
  financialVaultFingerprint,
  getCloudVault,
} from "@/lib/babylon/cloud-vault";
import {
  confirmPreservedCopyReconciliation,
  logReconciliationDiagnostic,
  previewPreservedCopyReconciliation,
  type ReconciliationDeps,
  type ReconciliationSnapshot,
} from "@/lib/babylon/preserved-copy-reconciliation";
import {
  classifyVaultMonthlyPlans,
  type MonthlyPlanLayer2,
} from "@/lib/babylon/monthly-plan-semantic";
import {
  compareVaultStructure,
  type VaultStructuralDiff,
} from "@/lib/babylon/vault-structural-diff";
import {
  clearCloudSyncBaseline,
  compareAndSwapCurrentVault,
  readCloudSyncBaseline,
  runCurrentVaultCycle,
  writeCloudSyncBaseline,
  type CloudSyncBaseline,
  type VaultSyncView,
} from "@/lib/babylon/vault-sync";
import { finalizeMonthlyPlanOnState } from "@/lib/babylon/monthly-plan";
import { parsePaySchedule } from "@/lib/babylon/pay-schedule";
import { monthCloseActivitySubtitle } from "@/lib/babylon/allocation-execution-copy";
import {
  buildDebtPurposeAttributions,
  completeDebtPositionTransition,
  DEBT_SEMANTICS_LEGACY,
  DEBT_SEMANTICS_POSITION,
  isDebtPositionEpoch,
  needsDebtPositionTransition,
  type DebtPositionDeclaration,
  withoutAttributionsForIncome,
} from "@/lib/babylon/debt-semantics";
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
  withoutAccount,
} from "@/lib/babylon/financial-position";
import {
  deriveDeployablePosition,
  deriveDeployableProtected,
  deriveRestrictedEffectiveTotal,
  withAccountRestrictedAmount,
} from "@/lib/babylon/account-restriction";
import {
  protectedDesignationError,
  protectedOverflowExceeds,
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
  composeEffectiveExpenses,
  occurrenceForStewardAction,
  operatingRecurrenceRange,
} from "@/lib/babylon/effective-expenses";
import {
  buildRecurringObligation,
  comingUpObligations,
  deleteExpenseOccurrence,
  obligationIntervalLabel,
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
  DebtPurposeAttribution,
  DonutSlice,
  ExpenditureBarTone,
  ExpenseEntry,
  ExpenseInput,
  FinancialAccount,
  FinancialAccountInput,
  FinancialAccountPurpose,
  IncomeEntry,
  IncomeInput,
  MonthlyCloseSummary,
  MonthlyPlanCategoryPurpose,
  MonthlyPlanRevision,
  NavSection,
  PaySchedule,
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
  const [monthlyPlans, setMonthlyPlans] = useState<MonthlyPlanRevision[]>([]);
  const [debtSemanticsVersion, setDebtSemanticsVersion] = useState<number>(
    DEBT_SEMANTICS_POSITION
  );
  const [debtPositionEpochAt, setDebtPositionEpochAt] = useState<string | null>(
    null
  );
  const [debtPurposeAttributions, setDebtPurposeAttributions] = useState<
    DebtPurposeAttribution[]
  >([]);
  const [paySchedules, setPaySchedules] = useState<PaySchedule[]>([]);
  /** Profile name input value — may be empty; greeting uses a visual fallback. */
  const [username, setUsernameState] = useState("");
  /** Auth user id when a verified Supabase session is present; null = local-only. */
  const [cloudUserId, setCloudUserId] = useState<string | null>(null);
  const cloudUserIdRef = useRef<string | null>(null);
  const [authOpen, setAuthOpen] = useState(false);
  const [vaultSync, setVaultSync] = useState<VaultSyncView>({ kind: "checking" });
  const vaultSyncRef = useRef<VaultSyncView>({ kind: "checking" });
  vaultSyncRef.current = vaultSync;
  /** UI-only. Not written to the vault, baseline, or backup. */
  const [conflictRefreshNote, setConflictRefreshNote] = useState<string | null>(
    null
  );
  const [syncBaseline, setSyncBaseline] = useState<CloudSyncBaseline | null>(null);
  const [cloudBusy, setCloudBusy] = useState(false);
  const cloudBusyRef = useRef(false);
  const pauseAutoPushRef = useRef(false);
  /**
   * Cycle occupancy (single-flight). Held until runCurrentVaultCycle settles,
   * including after human-facing UI timeout. Not the same as cloudBusy.
   */
  const syncingRef = useRef(false);
  /** Held from a reconciliation preview until confirm settles or the steward cancels. */
  const reconcilingRef = useRef(false);
  const reconciliationSnapshotRef = useRef<ReconciliationSnapshot | null>(null);
  const reconciliationPreviewGenRef = useRef(0);
  /**
   * Local fingerprint when this browser session first showed the conflict.
   * Current-session mutation guard only. Not persisted, and not a match to an
   * exported backup file.
   */
  const conflictLocalFingerprintRef = useRef<string | null>(null);
  const [reconciliationActive, setReconciliationActive] = useState(false);
  /** Trigger waiting for occupancy. Null when nothing is queued. */
  const rerunSyncRef = useRef<CloudSyncRequestTrigger | null>(null);
  /** Monotonic; superseded attempts must not apply React state after UI timeout. */
  const cloudSyncAttemptIdRef = useRef(0);
  /**
   * Why the next owner-ready effect should call requestCloudCheck.
   * Starts as mount. Visibility, online, and other checkEpoch sources
   * overwrite it immediately before they increment checkEpoch.
   */
  const cloudCheckTriggerRef = useRef<CloudSyncRequestTrigger>("mount");
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
    setMonthlyPlans(stored.monthlyPlans);
    setDebtSemanticsVersion(stored.debtSemanticsVersion);
    setDebtPositionEpochAt(stored.debtPositionEpochAt);
    setDebtPurposeAttributions(stored.debtPurposeAttributions);
    setPaySchedules(stored.paySchedules);
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
      monthlyPlans,
      debtSemanticsVersion,
      debtPositionEpochAt,
      debtPurposeAttributions,
      paySchedules,
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
    monthlyPlans,
    debtSemanticsVersion,
    debtPositionEpochAt,
    debtPurposeAttributions,
    paySchedules,
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
      monthlyPlans,
      debtSemanticsVersion,
      debtPositionEpochAt,
      debtPurposeAttributions,
      paySchedules,
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
      monthlyPlans,
      debtSemanticsVersion,
      debtPositionEpochAt,
      debtPurposeAttributions,
      paySchedules,
    ]
  );
  const vaultRef = useRef(vaultSnapshot);
  vaultRef.current = vaultSnapshot;

  useEffect(() => {
    setOwnerUserId(readCloudOwnerId());
    setSyncBaseline(readCloudSyncBaseline());
    setOwnerReady(true);
  }, [ownerEpoch]);

  useEffect(() => {
    if (vaultSync.kind !== "conflict") {
      conflictLocalFingerprintRef.current = null;
      return;
    }
    if (conflictLocalFingerprintRef.current === null) {
      conflictLocalFingerprintRef.current = financialVaultFingerprint(vaultRef.current);
    }
  }, [vaultSync]);

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
    setMonthlyPlans(next.monthlyPlans);
    setDebtSemanticsVersion(next.debtSemanticsVersion);
    setDebtPositionEpochAt(next.debtPositionEpochAt);
    setDebtPurposeAttributions(next.debtPurposeAttributions);
    setPaySchedules(next.paySchedules);
    setUsernameState(next.displayName);
  }, []);

  const requestCloudCheck = useCallback(async (
    trigger: CloudSyncRequestTrigger,
    queuedRerun = false
  ) => {
    const userId = cloudUserIdRef.current;
    if (!userId) {
      setVaultSync({ kind: "signed_out" });
      return;
    }
    // Reconciliation holds the cloud write. Do not queue a check into that CAS.
    if (reconcilingRef.current) return;
    // Single-flight: coalesce Check cloud / online / visibility / auto-push
    // into one queued rerun while occupancy is held (including after UI timeout).
    const occupied = takeOccupiedCloudCheckQueue({
      occupied: syncingRef.current,
      alreadyQueued: rerunSyncRef.current !== null,
      trigger,
      currentKind: vaultSyncRef.current.kind,
      activeAttemptId: cloudSyncAttemptIdRef.current,
    });
    if (occupied.handled) {
      rerunSyncRef.current = rememberQueuedCloudCheck(
        rerunSyncRef.current,
        trigger
      );
      if (occupied.event) {
        logCloudSyncDiagnostic(occupied.event);
      }
      return;
    }
    const previousKind = vaultSyncRef.current.kind;
    const establishedConflict = previousKind === "conflict";
    // A known conflict stays fail-closed. Recheck must not clear auto-push pause.
    if (establishedConflict) {
      pauseAutoPushRef.current = true;
    } else {
      pauseAutoPushRef.current = false;
    }
    syncingRef.current = true;
    cloudBusyRef.current = true;
    setCloudBusy(true);
    setConflictRefreshNote(null);
    const attemptId = ++cloudSyncAttemptIdRef.current;
    try {
      await performCloudSyncCheck(
        {
          attemptId,
          isSuperseded: () => attemptId !== cloudSyncAttemptIdRef.current,
          supersedeInFlightAttempts: () => {
            cloudSyncAttemptIdRef.current += 1;
          },
          readActiveAttemptId: () => cloudSyncAttemptIdRef.current,
          readBaseline: readCloudSyncBaseline,
          readFingerprint: () => financialVaultFingerprint(vaultRef.current),
          runCycle: () => runCurrentVaultCycle(userId, () => vaultRef.current),
          preserveEstablishedConflict: establishedConflict,
          attribution: {
            trigger,
            previousKind,
            queuedRerun,
          },
        },
        {
          userId,
          setVaultSync: (view) => {
            // Publish before React renders so a same-turn rerun sees this kind.
            vaultSyncRef.current = view;
            setConflictRefreshNote(null);
            setVaultSync(view);
          },
          setSyncBaseline,
          setOwnerUserId,
          applyVault,
          onPauseAutoPush: (pause) => {
            pauseAutoPushRef.current = pause;
          },
          onUiTimeout: () => {
            // UI is no longer blocked; cycle occupancy remains until settle.
            cloudBusyRef.current = false;
            setCloudBusy(false);
          },
          onConflictRefreshFailed: () => {
            setConflictRefreshNote(CONFLICT_REFRESH_INCOMPLETE_COPY);
          },
        }
      );
    } finally {
      syncingRef.current = false;
      cloudBusyRef.current = false;
      setCloudBusy(false);
      const queued = rerunSyncRef.current;
      rerunSyncRef.current = null;
      if (
        shouldLaunchQueuedCloudCheck({
          queued,
          vaultKind: vaultSyncRef.current.kind,
        })
      ) {
        void requestCloudCheck("queued_rerun", true);
      }
    }
  }, [applyVault]);

  const confirmCloudCheck = useCallback(() => {
    return requestCloudCheck("manual");
  }, [requestCloudCheck]);

  useEffect(() => {
    if (!hydrated || !ownerReady) return;
    const trigger = cloudCheckTriggerRef.current;
    cloudCheckTriggerRef.current = "mount";
    if (!cloudUserId) {
      setVaultSync({ kind: "signed_out" });
      return;
    }
    if (ownerUserId && ownerUserId !== cloudUserId) {
      setVaultSync({ kind: "owner_mismatch" });
      return;
    }
    void requestCloudCheck(trigger);
  }, [hydrated, ownerReady, cloudUserId, ownerUserId, checkEpoch, requestCloudCheck]);

  useEffect(() => {
    if (!hydrated || !cloudUserId || !syncBaseline || pauseAutoPushRef.current) return;
    if (vaultSyncRef.current.kind === "conflict") return;
    if (financialVaultFingerprint(vaultSnapshot) === syncBaseline.fingerprint) return;
    void requestCloudCheck("auto_push");
  }, [hydrated, cloudUserId, vaultSnapshot, syncBaseline, requestCloudCheck]);

  useEffect(() => {
    const onWake = () => {
      if (document.visibilityState !== "visible") return;
      if (vaultSyncRef.current.kind !== "conflict") {
        pauseAutoPushRef.current = false;
      }
      cloudCheckTriggerRef.current = "visibility";
      setCheckEpoch((value) => value + 1);
    };
    const onOnline = () => {
      if (vaultSyncRef.current.kind !== "conflict") {
        pauseAutoPushRef.current = false;
      }
      cloudCheckTriggerRef.current = "online";
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
        cloudCheckTriggerRef.current = "bootstrap";
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
      cloudCheckTriggerRef.current = "bootstrap";
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
        cloudCheckTriggerRef.current = "hydrate";
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
      cloudCheckTriggerRef.current = "hydrate";
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
    const timer = window.setInterval(() => {
      setWisdomIndex((prev) => (prev + 1) % BABYLON_WISDOM.length);
    }, 8000);
    return () => window.clearInterval(timer);
  }, []);

  const hasActiveDebt = useMemo(
    () => debts.some((d) => d.remainingDebt > 0),
    [debts]
  );

  const debtPositionEpoch = useMemo(
    () => isDebtPositionEpoch(debtSemanticsVersion),
    [debtSemanticsVersion]
  );

  const needsDebtTransition = useMemo(
    () =>
      needsDebtPositionTransition({
        debtSemanticsVersion,
        debts,
      }),
    [debtSemanticsVersion, debts]
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

  const balanceObservation = useBalanceObservation(hydrated && cloudUserId !== null);

  /** Operational Money Available. Declarations until usable evidence exists. */
  const moneyAvailable = useMemo(
    () => operationalMoneyAvailable({ accounts, load: balanceObservation.load }),
    [accounts, balanceObservation.load]
  );

  const effectivePositions = useMemo(
    () =>
      operationalAccountPositions({
        accounts,
        load: balanceObservation.load,
      }),
    [accounts, balanceObservation.load]
  );

  const wealthBuildingPosition = useMemo(
    () => currentWealthBuildingPosition(accounts, effectivePositions),
    [accounts, effectivePositions]
  );

  const emergencyFundPosition = useMemo(
    () => currentEmergencyFundPosition(accounts, effectivePositions),
    [accounts, effectivePositions]
  );

  const protectedMoney = useMemo(
    () =>
      totalProtectedMoney(
        openingWealthBuilding,
        openingEmergencyFund,
        wealthBuildingPosition,
        emergencyFundPosition
      ),
    [
      openingWealthBuilding,
      openingEmergencyFund,
      wealthBuildingPosition,
      emergencyFundPosition,
    ]
  );

  const deployablePosition = useMemo(
    () => deriveDeployablePosition(accounts, effectivePositions),
    [accounts, effectivePositions]
  );

  const deployableProtected = useMemo(
    () =>
      deriveDeployableProtected(
        accounts,
        effectivePositions,
        openingWealthBuilding,
        openingEmergencyFund
      ),
    [
      accounts,
      effectivePositions,
      openingWealthBuilding,
      openingEmergencyFund,
    ]
  );

  const restrictedEffectiveTotal = useMemo(
    () => deriveRestrictedEffectiveTotal(accounts, effectivePositions),
    [accounts, effectivePositions]
  );

  const wealthBuildingTotal = useMemo(
    () => totalWealthBuilding(openingWealthBuilding, goldRetained),
    [openingWealthBuilding, goldRetained]
  );

  const emergencyFundTotal = useMemo(
    () => totalEmergencyFund(openingEmergencyFund, emergencyShield),
    [openingEmergencyFund, emergencyShield]
  );

  const protectedOverAvailable = protectedOverflowExceeds({
    openingWealthBuilding,
    openingEmergencyFund,
    moneyAvailable,
    accounts,
    positions: effectivePositions,
  });

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

  const expenseRead = useMemo(() => {
    const range = operatingRecurrenceRange(recurringObligations, financialToday);
    if (!range) return { status: "invalid" as const, reason: "invalid_range" as const };
    return composeEffectiveExpenses(recurringObligations, expenses, range);
  }, [recurringObligations, expenses, financialToday]);
  const obligationsReadable = expenseRead.status === "ready";
  const obligationExpenses = useMemo(
    () => (expenseRead.status === "ready" ? expenseRead.expenses : []),
    [expenseRead]
  );

  const upcomingNeeds = useMemo(
    () => (obligationsReadable ? upcomingNeedsTotal(obligationExpenses) : 0),
    [obligationsReadable, obligationExpenses]
  );

  const availableAfterPlannedNeeds = useMemo(
    () =>
      deriveAvailableAfterPlannedNeeds({
        deployablePosition,
        deployableProtected,
        upcomingNeeds,
      }),
    [deployablePosition, deployableProtected, upcomingNeeds]
  );

  const comingUp = useMemo(
    () => (obligationsReadable ? comingUpObligations(obligationExpenses) : []),
    [obligationsReadable, obligationExpenses]
  );

  const dueAttention = useMemo(
    () =>
      (obligationsReadable
        ? deriveDueAttention(obligationExpenses, financialToday)
        : []
      ).map((item) => {
        if (!item.recurringObligationId) return item;
        const rule = recurringObligations.find(
          (entry) => entry.id === item.recurringObligationId
        );
        if (!rule?.intervalMonths || rule.intervalMonths === 1) return item;
        return { ...item, intervalMonths: rule.intervalMonths };
      }),
    [obligationsReadable, obligationExpenses, financialToday, recurringObligations]
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
        if (debtPositionEpoch) {
          const attributions = buildDebtPurposeAttributions({
            debts,
            amount: split.debtShare,
            allocationEventId: event.id,
            date: event.date,
            monthKey: event.monthKey,
            createId: generateId,
          });
          if (attributions.length > 0) {
            setDebtPurposeAttributions((prev) => [
              ...attributions,
              ...prev,
            ]);
          }
        } else {
          setDebts((prev) => applyDebtAllocation(prev, split.debtShare));
        }
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
    [hasActiveDebt, debtPositionEpoch, debts, pushActivity]
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

      const requestedInterval =
        typeof input.intervalMonths === "number"
          ? input.intervalMonths
          : input.repeatsMonthly
            ? 1
            : null;
      if (requestedInterval !== null) {
        if (!Number.isInteger(requestedInterval) || requestedInterval < 1) {
          return false;
        }
        if (input.isSettled) return false;
        const rule = buildRecurringObligation(
          {
            name: input.name,
            amount: input.amount,
            category: input.category,
            budgetCategoryId: input.budgetCategoryId,
            firstDueDate: input.dueDate,
            intervalMonths: requestedInterval,
          },
          generateId(),
          todayIso()
        );
        if (!rule) return false;
        setRecurringObligations((prev) => [rule, ...prev]);
        pushActivity({
          kind: "expense",
          title: rule.name,
          subtitle:
            requestedInterval === 1
              ? "Repeats monthly"
              : obligationIntervalLabel(requestedInterval),
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

    const owed = roundMoney(input.totalDebt);
    const entry: DebtEntry = {
      id: generateId(),
      creditor: input.creditor.trim(),
      totalDebt: owed,
      // Post-epoch: enrollment establishes authoritative position immediately.
      // Pre-epoch: same field is still modeled until steward rebase.
      remainingDebt: owed,
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
        const prepared = occurrenceForStewardAction(recurringObligations, prev, id);
        if (!prepared) return prev;
        const target = prepared.expense;
        nextSettled = !target.isSettled;
        name = target.name;
        amount = target.amount;
        return prepared.expenses.map((e) => {
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
    [pushActivity, recurringObligations]
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
            if (debtPositionEpoch) {
              const attributions = buildDebtPurposeAttributions({
                debts,
                amount: resolved.debt,
                allocationEventId: event.id,
                date: event.date,
                monthKey: event.monthKey,
                createId: generateId,
              });
              if (attributions.length > 0) {
                setDebtPurposeAttributions((prev) => [
                  ...attributions,
                  ...prev,
                ]);
              }
            } else {
              setDebts((prev) => applyDebtAllocation(prev, resolved.debt));
            }
          }
        }
      }

      setPeriodArchives((prev) => [archive, ...prev]);
      setLastClosedMonthKey(currentMonthKey);

      const subtitle = monthCloseActivitySubtitle(disposition);

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
      debtPositionEpoch,
      debts,
      pushActivity,
    ]
  );

  const clearAllData = useCallback(() => {
    clearPersistedState();
    clearUsername();
    clearCloudSyncBaseline();
    setSyncBaseline(null);
    pauseAutoPushRef.current = false;
    cloudCheckTriggerRef.current = "clear";
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
    setMonthlyPlans([]);
    setDebtSemanticsVersion(DEBT_SEMANTICS_POSITION);
    setDebtPositionEpochAt(null);
    setDebtPurposeAttributions([]);
    setPaySchedules([]);
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
      monthlyPlans,
      debtSemanticsVersion,
      debtPositionEpochAt,
      debtPurposeAttributions,
      paySchedules,
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
    monthlyPlans,
    debtSemanticsVersion,
    debtPositionEpochAt,
    debtPurposeAttributions,
    paySchedules,
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
      monthlyPlans: backup.monthlyPlans ?? [],
      debtSemanticsVersion:
        backup.debtSemanticsVersion ??
        (backup.debts.length === 0
          ? DEBT_SEMANTICS_POSITION
          : DEBT_SEMANTICS_LEGACY),
      debtPositionEpochAt: backup.debtPositionEpochAt ?? null,
      debtPurposeAttributions: backup.debtPurposeAttributions ?? [],
      paySchedules: backup.paySchedules ?? [],
    };

    applyVault(next);
    pauseAutoPushRef.current = false;
    cloudCheckTriggerRef.current = "import";
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
      const existing = accounts.find((account) => account.id === id);
      if (!existing) return false;
      const next = normalizeAccountDraft(input, id);
      if (!next) return false;
      let preserved = next;
      if (existing.purpose !== undefined) {
        preserved = { ...preserved, purpose: existing.purpose };
      }
      if (
        input.restrictedAmount === undefined &&
        existing.restrictedAmount !== undefined
      ) {
        preserved = {
          ...preserved,
          restrictedAmount: existing.restrictedAmount,
        };
      }
      setAccounts((prev) => replaceAccount(prev, id, preserved) ?? prev);
      return true;
    },
    [accounts]
  );

  const setAccountRestrictedAmount = useCallback(
    (accountId: string, restrictedAmount: number | undefined): boolean => {
      const existing = accounts.find((account) => account.id === accountId);
      if (!existing) return false;
      if (
        restrictedAmount !== undefined &&
        (!Number.isFinite(restrictedAmount) || restrictedAmount < 0)
      ) {
        return false;
      }
      const next = withAccountRestrictedAmount(existing, restrictedAmount);
      setAccounts((prev) => replaceAccount(prev, accountId, next) ?? prev);
      return true;
    },
    [accounts]
  );

  const accountEffectiveBalance = useCallback(
    (account: FinancialAccount): number =>
      operationalAccountPosition({
        account,
        load: balanceObservation.load,
      }).balance,
    [balanceObservation.load]
  );

  const updateProtectedDesignations = useCallback(
    (wealth: number, emergency: number): string | null => {
      const error = protectedDesignationError(
        wealth,
        emergency,
        moneyAvailable,
        wealthBuildingPosition,
        emergencyFundPosition
      );
      if (error) return error;
      setOpeningWealthBuilding(roundMoney(wealth));
      setOpeningEmergencyFund(roundMoney(emergency));
      return null;
    },
    [moneyAvailable, wealthBuildingPosition, emergencyFundPosition]
  );

  type PurposeActionResult =
    | { status: "applied" }
    | {
        status: "needs_reconcile";
        purpose: FinancialAccountPurpose;
        opening: number;
        accountPosition: number;
      }
    | { status: "rejected"; reason: string };

  type PurposeClearResult =
    | { status: "applied" }
    | {
        status: "needs_preserve_choice";
        accountPosition: number;
        purpose: FinancialAccountPurpose;
      }
    | { status: "rejected"; reason: string };

  const setAccountPurpose = useCallback(
    (
      accountId: string,
      purpose: FinancialAccountPurpose,
      reconcile?: FirstDesignationReconcileChoice | "cancel"
    ): PurposeActionResult => {
      const account = accounts.find((row) => row.id === accountId);
      if (!account) {
        return { status: "rejected", reason: "Account not found." };
      }
      if (account.purpose === purpose) {
        return { status: "applied" };
      }

      if (reconcile === "cancel") {
        return { status: "applied" };
      }

      const first = isFirstPurposeDesignation(accounts, accountId, purpose);
      const opening = openingForPurpose(
        purpose,
        openingWealthBuilding,
        openingEmergencyFund
      );
      const position = accountEffectiveBalance(account);

      if (first && opening > 0 && reconcile === undefined) {
        return {
          status: "needs_reconcile",
          purpose,
          opening: roundMoney(opening),
          accountPosition: roundMoney(position),
        };
      }

      let nextOpeningWealth = openingWealthBuilding;
      let nextOpeningEmergency = openingEmergencyFund;
      if (first && opening > 0 && reconcile) {
        const residual = residualAfterFirstDesignation(
          opening,
          position,
          reconcile
        );
        if (purpose === "wealth_building") {
          nextOpeningWealth = residual;
        } else {
          nextOpeningEmergency = residual;
        }
      }

      // When changing purpose away from another purpose, just reassign.
      const nextAccounts = accounts.map((row) =>
        row.id === accountId ? withAccountPurpose(row, purpose) : row
      );
      const nextPositions = operationalAccountPositions({
        accounts: nextAccounts,
        load: balanceObservation.load,
      });
      const nextWealthPos = currentWealthBuildingPosition(
        nextAccounts,
        nextPositions
      );
      const nextEmergencyPos = currentEmergencyFundPosition(
        nextAccounts,
        nextPositions
      );
      const fit = protectedDesignationError(
        nextOpeningWealth,
        nextOpeningEmergency,
        moneyAvailable,
        nextWealthPos,
        nextEmergencyPos
      );
      if (fit) {
        return { status: "rejected", reason: fit };
      }

      setAccounts(nextAccounts);
      setOpeningWealthBuilding(roundMoney(nextOpeningWealth));
      setOpeningEmergencyFund(roundMoney(nextOpeningEmergency));
      return { status: "applied" };
    },
    [
      accounts,
      openingWealthBuilding,
      openingEmergencyFund,
      accountEffectiveBalance,
      balanceObservation.load,
      moneyAvailable,
    ]
  );

  const clearAccountPurpose = useCallback(
    (
      accountId: string,
      preserve?: "allow_drop" | "keep_as_existing" | "cancel"
    ): PurposeClearResult => {
      const account = accounts.find((row) => row.id === accountId);
      if (!account) {
        return { status: "rejected", reason: "Account not found." };
      }
      if (account.purpose === undefined) {
        return { status: "applied" };
      }
      if (preserve === "cancel") {
        return { status: "applied" };
      }

      const purpose = account.purpose;
      const position = accountEffectiveBalance(account);
      if (preserve === undefined && position > 0) {
        return {
          status: "needs_preserve_choice",
          accountPosition: roundMoney(position),
          purpose,
        };
      }

      let nextOpeningWealth = openingWealthBuilding;
      let nextOpeningEmergency = openingEmergencyFund;
      if (preserve === "keep_as_existing") {
        if (purpose === "wealth_building") {
          nextOpeningWealth = roundMoney(openingWealthBuilding + position);
        } else {
          nextOpeningEmergency = roundMoney(openingEmergencyFund + position);
        }
      }

      const nextAccounts = accounts.map((row) =>
        row.id === accountId ? withAccountPurpose(row, undefined) : row
      );
      const nextPositions = operationalAccountPositions({
        accounts: nextAccounts,
        load: balanceObservation.load,
      });
      const nextWealthPos = currentWealthBuildingPosition(
        nextAccounts,
        nextPositions
      );
      const nextEmergencyPos = currentEmergencyFundPosition(
        nextAccounts,
        nextPositions
      );
      const fit = protectedDesignationError(
        nextOpeningWealth,
        nextOpeningEmergency,
        moneyAvailable,
        nextWealthPos,
        nextEmergencyPos
      );
      if (fit) {
        return { status: "rejected", reason: fit };
      }

      setAccounts(nextAccounts);
      setOpeningWealthBuilding(roundMoney(nextOpeningWealth));
      setOpeningEmergencyFund(roundMoney(nextOpeningEmergency));
      return { status: "applied" };
    },
    [
      accounts,
      openingWealthBuilding,
      openingEmergencyFund,
      accountEffectiveBalance,
      balanceObservation.load,
      moneyAvailable,
    ]
  );

  const removeAccount = useCallback(
    (
      id: string,
      preserve?: "allow_drop" | "keep_as_existing" | "cancel"
    ): PurposeClearResult | { status: "applied" } => {
      const account = accounts.find((row) => row.id === id);
      if (!account) {
        return { status: "rejected", reason: "Account not found." };
      }
      if (preserve === "cancel") {
        return { status: "applied" };
      }

      if (account.purpose !== undefined) {
        const purpose = account.purpose;
        const position = accountEffectiveBalance(account);
        if (preserve === undefined && position > 0) {
          return {
            status: "needs_preserve_choice",
            accountPosition: roundMoney(position),
            purpose,
          };
        }

        let nextOpeningWealth = openingWealthBuilding;
        let nextOpeningEmergency = openingEmergencyFund;
        if (preserve === "keep_as_existing") {
          if (purpose === "wealth_building") {
            nextOpeningWealth = roundMoney(openingWealthBuilding + position);
          } else {
            nextOpeningEmergency = roundMoney(openingEmergencyFund + position);
          }
        }

        const nextAccounts = withoutAccount(accounts, id);
        const nextPositions = operationalAccountPositions({
          accounts: nextAccounts,
          load: balanceObservation.load,
        });
        // Money Available will drop by this account — fit check uses next MA.
        const nextMa = operationalMoneyAvailable({
          accounts: nextAccounts,
          load: balanceObservation.load,
        });
        const nextWealthPos = currentWealthBuildingPosition(
          nextAccounts,
          nextPositions
        );
        const nextEmergencyPos = currentEmergencyFundPosition(
          nextAccounts,
          nextPositions
        );
        const fit = protectedDesignationError(
          nextOpeningWealth,
          nextOpeningEmergency,
          nextMa,
          nextWealthPos,
          nextEmergencyPos
        );
        if (fit) {
          return { status: "rejected", reason: fit };
        }
        setAccounts(nextAccounts);
        setOpeningWealthBuilding(roundMoney(nextOpeningWealth));
        setOpeningEmergencyFund(roundMoney(nextOpeningEmergency));
        return { status: "applied" };
      }

      setAccounts((prev) => withoutAccount(prev, id));
      return { status: "applied" };
    },
    [
      accounts,
      openingWealthBuilding,
      openingEmergencyFund,
      accountEffectiveBalance,
      balanceObservation.load,
    ]
  );

  const deleteIncome = useCallback(
    (id: string) => {
      const linkedAllocationIds = allocations
        .filter((a) => a.incomeId === id)
        .map((a) => a.id);

      setIncomes((prev) => {
        const target = prev.find((i) => i.id === id);
        if (target && target.debtShare > 0 && !debtPositionEpoch) {
          setDebts((debtsPrev) =>
            reverseDebtAllocation(debtsPrev, target.debtShare)
          );
        }
        return prev.filter((i) => i.id !== id);
      });
      setAllocations((prev) => prev.filter((a) => a.incomeId !== id));
      if (debtPositionEpoch && linkedAllocationIds.length > 0) {
        setDebtPurposeAttributions((prev) =>
          withoutAttributionsForIncome(prev, linkedAllocationIds)
        );
      }
    },
    [allocations, debtPositionEpoch]
  );

  const recurringRef = useRef(recurringObligations);
  const expensesRef = useRef(expenses);
  recurringRef.current = recurringObligations;
  expensesRef.current = expenses;

  const deleteExpense = useCallback((id: string) => {
    const prepared = occurrenceForStewardAction(
      recurringRef.current,
      expensesRef.current,
      id
    );
    if (!prepared) return;
    const result = deleteExpenseOccurrence(
      recurringRef.current,
      prepared.expenses,
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
        const prepared = occurrenceForStewardAction(recurringRef.current, prev, id);
        if (!prepared) return prev;
        const next = replaceExpenseOccurrence(prepared.expenses, id, patch);
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
        intervalMonths: number;
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
      const cadence = obligationIntervalLabel(patch.intervalMonths);
      pushActivity({
        kind: "expense",
        title: patch.name.trim(),
        subtitle: patch.isActive ? `${cadence} bill updated` : `${cadence} bill stopped`,
        amount: roundMoney(patch.amount),
      });
      return true;
    },
    [budgetTargets, pushActivity, recurringObligations]
  );

  const deleteDebt = useCallback((id: string) => {
    setDebts((prev) => prev.filter((d) => d.id !== id));
    setDebtPurposeAttributions((prev) =>
      prev.filter((row) => row.debtId !== id)
    );
  }, []);

  /**
   * All-or-nothing steward rebase into the debt-position epoch.
   * Incomplete / cancelled drafts never call this — no partial activation.
   */
  const completeDebtPositionRebase = useCallback(
    (declarations: readonly DebtPositionDeclaration[]): string | null => {
      const outcome = completeDebtPositionTransition({
        debts,
        declarations,
        epochAt: new Date().toISOString(),
      });
      if (!outcome.ok) return outcome.reason;
      setDebts(outcome.debts);
      setDebtSemanticsVersion(outcome.debtSemanticsVersion);
      setDebtPositionEpochAt(outcome.debtPositionEpochAt);
      pushActivity({
        kind: "budget",
        title: "Debt position established",
        subtitle:
          "Current amounts owed recorded. Allocations no longer change what you owe.",
      });
      return null;
    },
    [debts, pushActivity]
  );

  const previewAllocation = useCallback(
    (gross: number) => allocateIncome(gross, hasActiveDebt),
    [hasActiveDebt]
  );

  const finalizeMonthlyPlan = useCallback(
    (input: {
      periodKey: string;
      planningBasis: number;
      categories: readonly MonthlyPlanCategoryPurpose[];
    }) => {
      const outcome = finalizeMonthlyPlanOnState(vaultRef.current, {
        id: generateId(),
        periodKey: input.periodKey,
        finalizedAt: new Date().toISOString(),
        planningBasis: input.planningBasis,
        categories: input.categories,
      });
      if (!outcome.ok) return outcome;
      setMonthlyPlans(outcome.state.monthlyPlans);
      return { ok: true as const, revision: outcome.revision };
    },
    []
  );

  const upsertPaySchedule = useCallback((schedule: PaySchedule) => {
    const parsed = parsePaySchedule(schedule);
    if (!parsed) {
      return {
        ok: false as const,
        message: "Expected pay schedule is incomplete.",
      };
    }
    setPaySchedules((prev) => {
      const index = prev.findIndex((row) => row.id === parsed.id);
      if (index < 0) return [...prev, parsed];
      const next = [...prev];
      next[index] = parsed;
      return next;
    });
    return { ok: true as const };
  }, []);

  const removePaySchedule = useCallback((id: string) => {
    setPaySchedules((prev) => prev.filter((row) => row.id !== id));
  }, []);

  /**
   * Read-only structural comparison during sync conflict.
   * Fresh cloud SELECT only. Never CAS, applyVault, or baseline writes.
   */
  const compareConflictCopies = useCallback(async (): Promise<
    | {
        ok: true;
        cloudRevision: number;
        schemaVersion: number;
        baselineRevision: number | null;
        diff: VaultStructuralDiff;
        monthlyPlans: MonthlyPlanLayer2;
      }
    | { ok: false; reason: string }
  > => {
    const userId = cloudUserIdRef.current;
    if (reconcilingRef.current) {
      return { ok: false, reason: "Reconciliation is already running." };
    }
    if (!userId) {
      return { ok: false, reason: "Sign in to compare copies." };
    }
    if (vaultSync.kind !== "conflict") {
      return {
        ok: false,
        reason: "Comparison is available during a sync conflict.",
      };
    }
    const baselineRevision = vaultSync.baselineRevision;
    const read = await getCloudVault(userId);
    if (read.status !== "present") {
      return { ok: false, reason: "Couldn't compare copies right now." };
    }
    const diff = compareVaultStructure(vaultRef.current, read.vaultData);
    const monthlyPlans = classifyVaultMonthlyPlans(
      vaultRef.current,
      read.vaultData
    );
    return {
      ok: true,
      cloudRevision: read.revision,
      schemaVersion: read.schemaVersion,
      baselineRevision,
      diff,
      monthlyPlans,
    };
  }, [vaultSync]);

  const selectNav = useCallback((section: NavSection) => {
    setActiveNav(section);
    setSidebarOpen(false);
  }, []);

  const releasePreservedCopyHold = useCallback(() => {
    if (!reconcilingRef.current) return;
    reconcilingRef.current = false;
    reconciliationSnapshotRef.current = null;
    setReconciliationActive(false);
    if (vaultSyncRef.current.kind === "conflict") {
      pauseAutoPushRef.current = true;
    }
  }, []);

  const preservedCopyDeps = useCallback((): ReconciliationDeps => {
    return {
      sessionUserId: cloudUserIdRef.current,
      readOwner: readCloudOwnerId,
      readSyncKind: () => vaultSyncRef.current.kind,
      readBaseline: readCloudSyncBaseline,
      readLocal: () => vaultRef.current,
      readConflictLocalFingerprint: () => conflictLocalFingerprintRef.current,
      readOccupied: () => {
        if (syncingRef.current || cloudBusyRef.current) return "sync";
        if (reconcilingRef.current) return "reconciliation";
        return "clear";
      },
      reserve: () => {
        if (syncingRef.current || cloudBusyRef.current) return "sync_occupied";
        if (reconcilingRef.current) return "reconciliation_occupied";
        reconcilingRef.current = true;
        pauseAutoPushRef.current = true;
        setReconciliationActive(true);
        return "reserved";
      },
      release: releasePreservedCopyHold,
      readCloud: async () => {
        const userId = cloudUserIdRef.current;
        if (!userId) return { status: "unauthenticated" };
        return getCloudVault(userId);
      },
      pushCloud: (expectedRevision, state) => {
        const userId = cloudUserIdRef.current;
        if (!userId) return Promise.resolve({ status: "unauthenticated" });
        return compareAndSwapCurrentVault(userId, expectedRevision, state);
      },
      applyLocal: (state) => {
        const previous = loadPersistedState();
        try {
          applyVault(state);
          const stored = loadPersistedState();
          if (
            financialVaultFingerprint(stored) !== financialVaultFingerprint(state)
          ) {
            applyVault(previous);
            return false;
          }
          return true;
        } catch {
          try {
            applyVault(previous);
          } catch {
            /* Cloud may already hold the combined copy. Do not mark this device converged. */
          }
          return false;
        }
      },
      writeBaseline: (baseline) => writeCloudSyncBaseline(baseline),
      onConverged: (revision) => {
        const view = { kind: "clean" as const, revision };
        vaultSyncRef.current = view;
        setConflictRefreshNote(null);
        setVaultSync(view);
        setSyncBaseline(readCloudSyncBaseline());
        pauseAutoPushRef.current = false;
      },
      log: logReconciliationDiagnostic,
    };
  }, [applyVault, releasePreservedCopyHold]);

  const previewPreservedCopies = useCallback(async () => {
    const generation = ++reconciliationPreviewGenRef.current;
    const outcome = await previewPreservedCopyReconciliation(preservedCopyDeps());
    if (generation !== reconciliationPreviewGenRef.current) {
      if (outcome.ok) releasePreservedCopyHold();
      return {
        ok: false as const,
        message:
          "Reconciliation is available only while both copies are preserved. Nothing was changed.",
      };
    }
    if (!outcome.ok) {
      return { ok: false as const, message: outcome.message };
    }
    reconciliationSnapshotRef.current = outcome.snapshot;
    return {
      ok: true as const,
      intro: outcome.intro,
      bullets: outcome.bullets,
      closing: outcome.closing,
    };
  }, [preservedCopyDeps, releasePreservedCopyHold]);

  const confirmPreservedCopies = useCallback(async () => {
    const snapshot = reconciliationSnapshotRef.current;
    reconciliationSnapshotRef.current = null;
    if (!snapshot) {
      releasePreservedCopyHold();
      return {
        ok: false as const,
        message:
          "The copies changed after the preview. Nothing was written. Preview again.",
      };
    }
    const outcome = await confirmPreservedCopyReconciliation(
      preservedCopyDeps(),
      snapshot
    );
    if (!outcome.ok) return { ok: false as const, message: outcome.message };
    return { ok: true as const };
  }, [preservedCopyDeps, releasePreservedCopyHold]);

  const cancelPreservedCopies = useCallback(() => {
    reconciliationPreviewGenRef.current += 1;
    releasePreservedCopyHold();
  }, [releasePreservedCopyHold]);

  return {
    hydrated,
    /** True when a Supabase session is present. This is not vault synchronization. */
    isCloudSynced: cloudUserId !== null,
    cloudUserId,
    vaultSync,
    conflictRefreshNote,
    cloudBusy,
    confirmCloudBootstrap,
    confirmCloudHydrate,
    confirmCloudCheck,
    compareConflictCopies,
    reconciliationActive,
    previewPreservedCopies,
    confirmPreservedCopies,
    cancelPreservedCopies,
    authOpen,
    setAuthOpen,
    handleAuthenticated,
    signOutCloud,
    incomes,
    expenses: obligationsReadable ? obligationExpenses : expenses,
    obligationsReadable,
    debts,
    allocations,
    budgetTargets,
    accounts,
    moneyAvailable,
    balanceObservation,
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
    debtPositionEpoch,
    needsDebtTransition,
    debtSemanticsVersion,
    debtPositionEpochAt,
    debtPurposeAttributions,
    completeDebtPositionRebase,
    goldRetained,
    openingWealthBuilding,
    openingEmergencyFund,
    protectedMoney,
    deployablePosition,
    deployableProtected,
    restrictedEffectiveTotal,
    wealthBuildingPosition,
    emergencyFundPosition,
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
    monthlyPlans,
    paySchedules,
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
    setAccountRestrictedAmount,
    removeAccount,
    setAccountPurpose,
    clearAccountPurpose,
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
    finalizeMonthlyPlan,
    upsertPaySchedule,
    removePaySchedule,
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
