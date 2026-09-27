"use client";

import { useCallback } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  AccountAssociationPublic,
  BalanceObservationPublic,
} from "@/lib/babylon/balance-observation";
import {
  associatePlaidFinancialAccount,
  listAccountAssociations,
  listCurrentBalanceObservations,
  listPlaidAccounts,
  removePlaidFinancialAccountAssociation,
} from "@/lib/babylon/plaid-client";
import type { PlaidAccountPublic } from "@/lib/babylon/plaid-schema";

export const BALANCE_OBSERVATION_QUERY_KEY = ["plaid-balance-observations"] as const;
export const PLAID_DESCRIPTOR_QUERY_KEY = ["plaid-balance-accounts"] as const;
export const ACCOUNT_ASSOCIATION_QUERY_KEY = ["plaid-account-associations"] as const;

/**
 * Owner-scoped balance observations and steward account links.
 * Refresh follows the existing foreground sync. This hook does not poll.
 */
export function useBalanceObservation(enabled: boolean): {
  plaidAccounts: PlaidAccountPublic[];
  observations: BalanceObservationPublic[];
  associations: AccountAssociationPublic[];
  settled: boolean;
  associate: (financialAccountId: string, plaidAccountId: string) => Promise<boolean>;
  removeAssociation: (financialAccountId: string) => Promise<boolean>;
} {
  const queryClient = useQueryClient();
  const accountsQuery = useQuery({
    queryKey: PLAID_DESCRIPTOR_QUERY_KEY,
    queryFn: listPlaidAccounts,
    enabled,
    staleTime: 60_000,
  });
  const observationsQuery = useQuery({
    queryKey: BALANCE_OBSERVATION_QUERY_KEY,
    queryFn: listCurrentBalanceObservations,
    enabled,
    staleTime: 60_000,
  });
  const associationsQuery = useQuery({
    queryKey: ACCOUNT_ASSOCIATION_QUERY_KEY,
    queryFn: listAccountAssociations,
    enabled,
    staleTime: 60_000,
  });

  const associate = useCallback(
    async (financialAccountId: string, plaidAccountId: string) => {
      const result = await associatePlaidFinancialAccount(
        financialAccountId,
        plaidAccountId
      );
      const ok = result?.status === "associated" || result?.status === "unchanged";
      if (ok) {
        await queryClient.invalidateQueries({ queryKey: ACCOUNT_ASSOCIATION_QUERY_KEY });
      }
      return ok;
    },
    [queryClient]
  );

  const removeAssociation = useCallback(
    async (financialAccountId: string) => {
      const result = await removePlaidFinancialAccountAssociation(financialAccountId);
      const ok = result?.status === "removed" || result?.status === "absent";
      if (ok) {
        await queryClient.invalidateQueries({ queryKey: ACCOUNT_ASSOCIATION_QUERY_KEY });
      }
      return ok;
    },
    [queryClient]
  );

  return {
    plaidAccounts: accountsQuery.data ?? [],
    observations: observationsQuery.data ?? [],
    associations: associationsQuery.data ?? [],
    settled:
      accountsQuery.isFetched &&
      observationsQuery.isFetched &&
      associationsQuery.isFetched,
    associate,
    removeAssociation,
  };
}
