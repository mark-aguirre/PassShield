'use client';

/**
 * useSettings — application settings hook.
 *
 * Centralises `api.settings.*` IPC calls. Components never call
 * `api.settings.*` directly; they consume these hooks.
 *
 * ## Queries
 * - `useSettings()` — read all persisted settings, merged over defaults.
 *
 * ## Mutations
 * - `useUpdateSettings` — apply a partial settings patch with optimistic
 *                         update: the UI reflects the change immediately and
 *                         rolls back if the IPC call fails.
 *
 * Settings are non-secret and persisted across sessions. They are independent
 * of vault lock state so the settings query is always enabled.
 */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { Settings } from '@PassShield/contracts';
import { api } from '@/lib/api';

// ---------------------------------------------------------------------------
// Query keys
// ---------------------------------------------------------------------------

export const settingsKeys = {
  all: ['settings'] as const,
};

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

/**
 * Read all persisted application settings. Falls back gracefully when the
 * settings store is unavailable on the main process (returns an error state
 * so the component can use its own defaults).
 */
export function useSettings() {
  return useQuery({
    queryKey: settingsKeys.all,
    queryFn: () => api.settings.get(),
  });
}

// ---------------------------------------------------------------------------
// Mutations
// ---------------------------------------------------------------------------

/**
 * Apply a partial settings patch.
 *
 * Uses an optimistic update pattern:
 * 1. The cache is updated immediately with the patch so the UI responds
 *    without waiting for the IPC round-trip.
 * 2. On IPC success the cache is set to the fully merged `Settings` the main
 *    process returns (the authoritative state).
 * 3. On failure the cache is rolled back to the previous value.
 */
export function useUpdateSettings() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (patch: Partial<Settings>) => api.settings.update(patch),

    // Optimistically merge the patch into the cached settings.
    onMutate: async (patch) => {
      // Cancel any in-flight settings queries to prevent them from overwriting
      // the optimistic update.
      await queryClient.cancelQueries({ queryKey: settingsKeys.all });

      // Snapshot the previous value for rollback.
      const previous = queryClient.getQueryData<Settings>(settingsKeys.all);

      // Apply the optimistic patch.
      if (previous !== undefined) {
        queryClient.setQueryData<Settings>(settingsKeys.all, { ...previous, ...patch });
      }

      return { previous };
    },

    // On success, set the authoritative merged settings from the main process.
    onSuccess: (merged) => {
      queryClient.setQueryData<Settings>(settingsKeys.all, merged);
    },

    // On error, roll back to the snapshot captured in onMutate.
    onError: (_error, _patch, context) => {
      if (context?.previous !== undefined) {
        queryClient.setQueryData<Settings>(settingsKeys.all, context.previous);
      }
    },
  });
}
