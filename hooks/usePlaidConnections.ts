"use client";

import { useCallback, useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ACCOUNT_ASSOCIATION_QUERY_KEY,
  BALANCE_OBSERVATION_QUERY_KEY,
  PLAID_DESCRIPTOR_QUERY_KEY,
} from "@/hooks/useBalanceObservation";
import {
  foregroundBalanceRefreshApplied,
  hasUnseenBalanceItem,
  markUnseenBalanceItem,
  noteForegroundBalanceRefreshResult,
  planForegroundBalanceRefresh,
} from "@/lib/babylon/foreground-balance-refresh";
import {
  createPlaidLinkTokenOrToast,
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
    staleTime: 60_000,
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
    [enabled, queryClient]
  );

  useEffect(() => {
    recordVisibleBalances(false);
    const onVisibility = () => {
      if (document.visibilityState !== "visible") return;
      recordVisibleBalances(false);
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, [recordVisibleBalances]);

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
