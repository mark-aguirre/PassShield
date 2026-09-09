'use client';

/**
 * useCategories — category data and mutation hooks.
 *
 * Centralises every `api.categories.*` IPC call. Components never call
 * `api.categories.*` directly; they consume these hooks.
 *
 * ## Queries
 * - `useCategories()` — list all categories with item counts.
 *
 * ## Mutations
 * - `useSaveCategory`   — create or update a category.
 * - `useDeleteCategory` — delete a category (main process safely clears item
 *                         assignments before deletion).
 *
 * Both mutations invalidate `['categories']` AND `['items']` on success
 * because category changes affect item counts and potentially item filtering
 * results in the list views.
 */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { SaveCategoryInput } from '@passshield/contracts';
import { api } from '@/lib/api';

// ---------------------------------------------------------------------------
// Query keys
// ---------------------------------------------------------------------------

export const categoryKeys = {
  all: ['categories'] as const,
  list: () => [...categoryKeys.all, 'list'] as const,
};

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

/**
 * List all categories with their active item counts.
 * Returns an empty array when the vault is locked.
 */
export function useCategories() {
  return useQuery({
    queryKey: categoryKeys.list(),
    queryFn: () => api.categories.list(),
  });
}

// ---------------------------------------------------------------------------
// Mutations
// ---------------------------------------------------------------------------

/** Invalidation helper — categories and items (item counts / filter results). */
function useInvalidateCategoryData() {
  const queryClient = useQueryClient();
  return () => {
    void queryClient.invalidateQueries({ queryKey: categoryKeys.all });
    void queryClient.invalidateQueries({ queryKey: ['items'] });
  };
}

/** Create or update a category. Invalidates category and item queries on success. */
export function useSaveCategory() {
  const invalidate = useInvalidateCategoryData();
  return useMutation({
    mutationFn: async (input: SaveCategoryInput) => {
      const result = await api.categories.save(input);
      if (!result.ok) throw new Error(result.error.message);
      return result.value;
    },
    onSuccess: invalidate,
  });
}

/**
 * Delete a category. The main process clears the category assignment on all
 * items that referenced it before removing the category row, so no items are
 * orphaned. Invalidates category and item queries on success.
 */
export function useDeleteCategory() {
  const invalidate = useInvalidateCategoryData();
  return useMutation({
    mutationFn: async (id: string) => {
      const result = await api.categories.delete(id);
      if (!result.ok) throw new Error(result.error.message);
    },
    onSuccess: invalidate,
  });
}
