"use client";

import { useCallback, useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  createPlaidLinkTokenOrToast,
  listPlaidItems,
  startPlaidLinkExchange,
} from "@/lib/babylon/plaid-client";
import type { PlaidItemPublic } from "@/lib/babylon/plaid-schema";
import { usePlaidLink } from "react-plaid-link";

export const PLAID_ITEMS_QUERY_KEY = ["plaid-items"] as const;

type UsePlaidConnectionsArgs = {
  enabled: boolean;
};

/**
 * Application hook — owns Plaid Link launch + public item listing.
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
