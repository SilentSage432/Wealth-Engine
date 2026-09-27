"use client";

import { useCallback, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  deriveBalanceObservationLoad,
  sameBalanceObservationEvidence,
  type BalanceEvidenceRead,
  type BalanceObservationEvidence,
  type BalanceObservationLoad,
} from "@/lib/babylon/balance-evidence-load";
import type { AccountAssociationPublic, BalanceObservationPublic } from "@/lib/babylon/balance-observation";
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

function evidenceRead<T>(query: {
  isError: boolean;
  isSuccess: boolean;
  data: T | undefined;
}): BalanceEvidenceRead<T> {
  if (query.isError) return { status: "error" };
  if (query.isSuccess && query.data !== undefined) {
    return { status: "success", data: query.data };
  }
  return { status: "pending" };
}

/**
 * Owner-scoped balance observations and steward account links.
 * Refresh follows the existing foreground sync. This hook does not poll.
 * The last successful evidence lives in component state for this session only.
 */
export function useBalanceObservation(enabled: boolean): {
  load: BalanceObservationLoad;
  associate: (financialAccountId: string, plaidAccountId: string) => Promise<boolean>;
  removeAssociation: (financialAccountId: string) => Promise<boolean>;
} {
  const queryClient = useQueryClient();
  const [retained, setRetained] = useState<BalanceObservationEvidence | null>(null);
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

  const derived = deriveBalanceObservationLoad({
    enabled,
    accounts: evidenceRead<readonly PlaidAccountPublic[]>(accountsQuery),
    observations: evidenceRead<readonly BalanceObservationPublic[]>(observationsQuery),
    associations: evidenceRead<readonly AccountAssociationPublic[]>(associationsQuery),
    retained,
  });
  if (!sameBalanceObservationEvidence(derived.retained, retained)) {
    setRetained(derived.retained);
  }

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
    load: derived.load,
    associate,
    removeAssociation,
  };
}
