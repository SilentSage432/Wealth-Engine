"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState, type ReactNode } from "react";

const STALE_TIME_MS = 1000 * 60 * 5;
const GC_TIME_MS = 1000 * 60 * 30;

function createBabylonQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: STALE_TIME_MS,
        gcTime: GC_TIME_MS,
        refetchOnWindowFocus: false,
        retry: 1,
      },
      mutations: {
        retry: 0,
      },
    },
  });
}

/**
 * App Router provider shell — owns the TanStack Query cache for Path A
 * server-state streams without touching Babylon engine ownership.
 */
export function Providers({ children }: { children: ReactNode }) {
  const [queryClient] = useState(createBabylonQueryClient);

  return (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
}
