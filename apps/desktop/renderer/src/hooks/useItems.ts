'use client';

/**
 * useItems — item data and mutation hooks.
 *
 * Centralises every `api.items.*` IPC call. Components never call
 * `api.items.*` directly; they consume these hooks.
 *
 * ## Queries
 * - `useItemList(filter?, sort?)`     — list metadata (no secrets) for a scope.
 * - `useItemDetail(id)`               — fetch a single decrypted item for display.
 * - `useItemChildren(parentId, sort?)` — list direct sub-pages of a note.
 * - `useItemSearch(query, sort?)`     — search over plaintext metadata.
 *
 * ## Mutations
 * - `useSaveItem`       — create or update an item.
 * - `useTrashItem`      — soft-delete (move to trash).
 * - `useRestoreItem`    — restore from trash.
 * - `useDeleteItem`     — permanently delete.
 * - `useToggleFavorite` — flip `isFavorite` (fetches detail, mutates, saves).
 *
 * ## Result<T> convention
 * All mutations throw on `result.ok === false` so errors surface via
 * `mutation.error` rather than requiring callers to inspect `result.ok`.
 */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { ItemListFilter, ItemSort, SaveItemInput } from '@passshield/contracts';
import { api } from '@/lib/api';

// ---------------------------------------------------------------------------
// Query keys
// ---------------------------------------------------------------------------

export const itemKeys = {
  all: ['items'] as const,
  lists: () => [...itemKeys.all, 'list'] as const,
  list: (filter?: ItemListFilter, sort?: ItemSort) =>
    [...itemKeys.lists(), { filter, sort }] as const,
  details: () => [...itemKeys.all, 'detail'] as const,
  detail: (id: string) => [...itemKeys.details(), id] as const,
  children: (parentId: string) => [...itemKeys.all, 'children', parentId] as const,
  search: (query: string, sort?: ItemSort) => [...itemKeys.all, 'search', query, sort] as const,
};

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

/**
 * List item metadata for a scope/sort. Returns non-secret {@link ItemSummary}
 * records. Returns an empty array when the vault is locked (the main process
 * returns an empty list for locked state).
 */
export function useItemList(filter?: ItemListFilter, sort?: ItemSort) {
  return useQuery({
    queryKey: itemKeys.list(filter, sort),
    queryFn: () => api.items.list(filter, sort),
  });
}

/**
 * Fetch a single decrypted item for display. This is the only path that
 * exposes secret values, and only for an explicitly selected item. The query
 * is disabled when `id` is null so no IPC call fires until an item is selected.
 */
export function useItemDetail(id: string | null) {
  return useQuery({
    queryKey: itemKeys.detail(id ?? ''),
    queryFn: async () => {
      const result = await api.items.get(id!);
      if (!result.ok) throw new Error(result.error.message);
      return result.value;
    },
    enabled: id !== null,
  });
}

/**
 * List direct sub-pages (children) of a note. Returns non-secret summaries.
 * Disabled when `parentId` is null.
 */
export function useItemChildren(parentId: string | null, sort?: ItemSort) {
  return useQuery({
    queryKey: itemKeys.children(parentId ?? ''),
    queryFn: () => api.items.listChildren(parentId!, sort),
    enabled: parentId !== null,
  });
}

/**
 * Search over plaintext metadata. Falls back to an empty array on a locked
 * vault. The query is disabled when the trimmed query is empty so callers can
 * keep this hook mounted and toggle it by passing an empty string.
 */
export function useItemSearch(query: string, sort?: ItemSort) {
  const trimmed = query.trim();
  return useQuery({
    queryKey: itemKeys.search(trimmed, sort),
    queryFn: () => api.items.search(trimmed, sort),
    enabled: trimmed.length > 0,
  });
}

// ---------------------------------------------------------------------------
// Mutations
// ---------------------------------------------------------------------------

/** Invalidation helper — all item queries. */
function useInvalidateItems() {
  const queryClient = useQueryClient();
  return () => void queryClient.invalidateQueries({ queryKey: itemKeys.all });
}

/** Create or update an item. Invalidates all item queries on success. */
export function useSaveItem() {
  const invalidate = useInvalidateItems();
  return useMutation({
    mutationFn: async (input: SaveItemInput) => {
      const result = await api.items.save(input);
      if (!result.ok) throw new Error(result.error.message);
      return result.value;
    },
    onSuccess: invalidate,
  });
}

/** Soft-delete an item (move to trash). Invalidates all item queries on success. */
export function useTrashItem() {
  const invalidate = useInvalidateItems();
  return useMutation({
    mutationFn: async (id: string) => {
      const result = await api.items.trash(id);
      if (!result.ok) throw new Error(result.error.message);
    },
    onSuccess: invalidate,
  });
}

/** Restore a trashed item. Invalidates all item queries on success. */
export function useRestoreItem() {
  const invalidate = useInvalidateItems();
  return useMutation({
    mutationFn: async (id: string) => {
      const result = await api.items.restore(id);
      if (!result.ok) throw new Error(result.error.message);
    },
    onSuccess: invalidate,
  });
}

/** Permanently delete an item. Invalidates all item queries on success. */
export function useDeleteItem() {
  const invalidate = useInvalidateItems();
  return useMutation({
    mutationFn: async (id: string) => {
      const result = await api.items.delete(id);
      if (!result.ok) throw new Error(result.error.message);
    },
    onSuccess: invalidate,
  });
}

/**
 * Toggle an item's `isFavorite` flag.
 *
 * The item list only carries non-secret metadata, so toggling requires:
 *   1. Fetching the full decrypted item (the payload must round-trip through
 *      `items.save` unchanged).
 *   2. Flipping `isFavorite` and re-saving.
 *
 * The mutation accepts `{ id, isFavorite }` so the caller does not need to
 * manage intermediate state. Invalidates all item queries on success.
 */
export function useToggleFavorite() {
  const invalidate = useInvalidateItems();
  return useMutation({
    mutationFn: async ({ id, isFavorite }: { id: string; isFavorite: boolean }) => {
      const detailResult = await api.items.get(id);
      if (!detailResult.ok) throw new Error(detailResult.error.message);

      const item = detailResult.value;
      const saveInput: SaveItemInput =
        item.itemType === 'login'
          ? {
              id: item.id,
              itemType: 'login',
              title: item.title,
              categoryId: item.categoryId,
              isFavorite,
              payload: item.payload,
              parentId: item.parentId,
            }
          : {
              id: item.id,
              itemType: 'note',
              title: item.title,
              categoryId: item.categoryId,
              isFavorite,
              payload: item.payload,
              parentId: item.parentId,
            };

      const saveResult = await api.items.save(saveInput);
      if (!saveResult.ok) throw new Error(saveResult.error.message);
    },
    onSuccess: invalidate,
  });
}
