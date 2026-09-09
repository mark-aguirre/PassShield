/**
 * Shared TanStack Query client for the PassShield renderer.
 *
 * Configuration is tuned for a local Electron IPC data source:
 *
 * - `staleTime: 30_000`          Data from the local vault process is fresh
 *                                 for 30 s; no background refetch during that
 *                                 window. Avoids redundant IPC round-trips on
 *                                 re-renders.
 *
 * - `gcTime: 5 * 60_000`         Keep unused query results in cache for 5 min
 *                                 so returning to a view feels instant.
 *
 * - `retry: false`               IPC calls either succeed or produce a typed
 *                                 Result error. Retrying a `locked` or `auth`
 *                                 error automatically is wrong and confusing.
 *
 * - `refetchOnWindowFocus: false` Electron window focus is not a reliable
 *                                 signal that IPC data is stale.
 *
 * One shared instance is created here and used by `Providers` to seed the
 * `QueryClientProvider`. All query invalidation (after mutations, after vault
 * lock/unlock) uses this same instance.
 */

import { QueryClient } from '@tanstack/react-query';

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      gcTime: 5 * 60_000,
      retry: false,
      refetchOnWindowFocus: false,
    },
    mutations: {
      // Mutations never retry automatically; errors surface to the caller.
      retry: false,
    },
  },
});
