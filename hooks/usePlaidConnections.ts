"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ACCOUNT_ASSOCIATION_QUERY_KEY,
  BALANCE_OBSERVATION_QUERY_KEY,
  PLAID_DESCRIPTOR_QUERY_KEY,
} from "@/hooks/useBalanceObservation";
import {
  FOREGROUND_BALANCE_REFRESH_WINDOW_MS,
  foregroundBalanceRefreshApplied,
  hasUnseenBalanceItem,
  markUnseenBalanceItem,
  newestRealtimeObservedAt,
  noteForegroundBalanceRefreshResult,
  planForegroundBalanceRefresh,
  realtimeFreshnessWakeDelayMs,
} from "@/lib/babylon/foreground-balance-refresh";
import {
  createPlaidLinkTokenOrToast,
  listAccountAssociations,
  listCurrentBalanceObservations,
  listPlaidItems,
  requestForegroundBalanceRefresh,
  requestPlaidObservationSync,
  startPlaidLinkExchange,
} from "@/lib/babylon/plaid-client";
import {
  itemIdsBeyondInitialReadyList,
  startForegroundObservationSync,
} from "@/lib/babylon/plaid-foreground-sync";
import type { PlaidItemPublic } from "@/lib/babylon/plaid-schema";
import { usePlaidLink } from "react-plaid-link";

export const PLAID_ITEMS_QUERY_KEY = ["plaid-items"] as const;

type UsePlaidConnectionsArgs = {
  enabled: boolean;
};

/**
 * Application hook — owns Plaid Link launch, public item listing, and one
 * foreground observation sync after that list is ready.
 * Presentation only renders; secrets stay on the server.
 */
export function usePlaidConnections({ enabled }: UsePlaidConnectionsArgs) {
  const queryClient = useQueryClient();
  const [linkToken, setLinkToken] = useState<string | null>(null);
  const [pendingOpen, setPendingOpen] = useState(false);
  const [launching, setLaunching] = useState(false);

  const itemsQuery = useQuery({
    queryKey: PLAID_ITEMS_QUERY_KEY,
    queryFn: listPlaidItems,
    enabled,
    staleTime: FOREGROUND_BALANCE_REFRESH_WINDOW_MS,
  });
  const observationsQuery = useQuery({
    queryKey: BALANCE_OBSERVATION_QUERY_KEY,
    queryFn: listCurrentBalanceObservations,
    enabled,
    staleTime: FOREGROUND_BALANCE_REFRESH_WINDOW_MS,
  });
  const associationsQuery = useQuery({
    queryKey: ACCOUNT_ASSOCIATION_QUERY_KEY,
    queryFn: listAccountAssociations,
    enabled,
    staleTime: FOREGROUND_BALANCE_REFRESH_WINDOW_MS,
  });

  const onSuccess = useCallback(
    async (
      publicToken: string | null,
      metadata: { institution?: { name?: string | null } | null }
    ) => {
      if (!publicToken) {
        setLinkToken(null);
        setPendingOpen(false);
        setLaunching(false);
        return;
      }
      const institutionName = metadata.institution?.name ?? undefined;
      const item = await startPlaidLinkExchange(publicToken, institutionName);
      if (item) {
        await queryClient.invalidateQueries({ queryKey: PLAID_ITEMS_QUERY_KEY });
      }
      setLinkToken(null);
      setPendingOpen(false);
      setLaunching(false);
    },
    [queryClient]
  );

  const { open, ready } = usePlaidLink({
    token: linkToken,
    onSuccess,
    onExit: () => {
      setPendingOpen(false);
      setLaunching(false);
      setLinkToken(null);
    },
  });

  useEffect(() => {
    if (!pendingOpen || !ready || !linkToken) return;
    open();
    setPendingOpen(false);
  }, [pendingOpen, ready, linkToken, open]);

  const launchLink = useCallback(async () => {
    if (launching) return;
    setLaunching(true);
    try {
      const token = await createPlaidLinkTokenOrToast();
      if (!token) {
        setLaunching(false);
        return;
      }
      setLinkToken(token);
      setPendingOpen(true);
    } catch {
      setLaunching(false);
    }
  }, [launching]);

  const items: PlaidItemPublic[] = itemsQuery.data ?? [];
  const itemsReady = itemsQuery.isSuccess && !itemsQuery.isFetching;

  const recordVisibleBalances = useCallback(
    (ignoreRecentSuccess: boolean) => {
      const visible =
        typeof document !== "undefined" && document.visibilityState === "visible";
      const decision = planForegroundBalanceRefresh({
        authenticated: enabled,
        visible,
        now: Date.now(),
        ignoreRecentSuccess,
        realTimeObservedAt: newestRealtimeObservedAt(observationsQuery.data),
      });
      if (decision.action !== "request") return;
      void requestForegroundBalanceRefresh().then((summary) => {
        const applied = foregroundBalanceRefreshApplied(summary);
        noteForegroundBalanceRefreshResult({
          ticket: decision.ticket,
          applied,
          now: Date.now(),
        });
        if (applied) {
          void queryClient.invalidateQueries({ queryKey: BALANCE_OBSERVATION_QUERY_KEY });
          void queryClient.invalidateQueries({ queryKey: PLAID_DESCRIPTOR_QUERY_KEY });
          void queryClient.invalidateQueries({ queryKey: ACCOUNT_ASSOCIATION_QUERY_KEY });
        }
        if (hasUnseenBalanceItem()) recordVisibleBalances(true);
      });
    },
    [enabled, observationsQuery.data, queryClient]
  );

  useEffect(() => {
    recordVisibleBalances(false);
    const onPresence = () => {
      if (document.visibilityState !== "visible") return;
      recordVisibleBalances(false);
    };
    document.addEventListener("visibilitychange", onPresence);
    window.addEventListener("focus", onPresence);
    return () => {
      document.removeEventListener("visibilitychange", onPresence);
      window.removeEventListener("focus", onPresence);
    };
  }, [recordVisibleBalances]);

  const realtimeObservedAt = newestRealtimeObservedAt(observationsQuery.data);
  useEffect(() => {
    const delay = realtimeFreshnessWakeDelayMs({
      now: Date.now(),
      realTimeObservedAt: realtimeObservedAt,
    });
    if (delay === null) return;
    const wake = window.setTimeout(() => {
      recordVisibleBalances(false);
    }, delay);
    return () => window.clearTimeout(wake);
  }, [realtimeObservedAt, recordVisibleBalances]);

  const knownAssociationIds = useRef<string[] | null>(null);
  useEffect(() => {
    if (!associationsQuery.isSuccess || !associationsQuery.data) return;
    const ids = associationsQuery.data.map((association) => association.id).sort();
    const previous = knownAssociationIds.current;
    knownAssociationIds.current = ids;
    if (previous === null) return;
    const added = ids.some((id) => !previous.includes(id));
    if (added) recordVisibleBalances(true);
  }, [associationsQuery.data, associationsQuery.isSuccess, recordVisibleBalances]);

  useEffect(() => {
    const due = startForegroundObservationSync({
      authenticated: enabled,
      itemsReady,
      itemIds: (itemsQuery.data ?? []).map((item) => item.id),
      request: (itemRowId) => {
        void requestPlaidObservationSync(itemRowId).then((ok) => {
          if (!ok) return;
          void queryClient.invalidateQueries({ queryKey: BALANCE_OBSERVATION_QUERY_KEY });
          void queryClient.invalidateQueries({ queryKey: PLAID_DESCRIPTOR_QUERY_KEY });
          void queryClient.invalidateQueries({ queryKey: ACCOUNT_ASSOCIATION_QUERY_KEY });
        });
      },
    });
    const beyond = itemIdsBeyondInitialReadyList({
      authenticated: enabled,
      itemsReady,
      dueItemIds: due,
    });
    if (beyond.length === 0) return;
    markUnseenBalanceItem();
    recordVisibleBalances(true);
  }, [enabled, itemsQuery.data, itemsReady, queryClient, recordVisibleBalances]);

  return {
    items,
    connectedCount: items.length,
    isLoading: itemsQuery.isLoading,
    launching,
    ready,
    refresh: () => itemsQuery.refetch(),
    launchLink,
  };
}
