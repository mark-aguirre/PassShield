'use client';

/**
 * Shared "vault view state" for the three-pane dashboard (Screen 1).
 *
 * `VaultLayout` (Task 9.1) owns this state; the item-list pane (Task 9.2) and
 * the item-detail pane (Task 9.3) consume it. Centralizing the contract here —
 * rather than letting each pane invent its own — keeps the panes decoupled
 * from each other and lets the layout drive selection changes uniformly.
 *
 * The state has two independent axes:
 *   1. The current *scope* — which slice of the vault the item list shows
 *      (all / favorites / recent / logins / notes / a specific category).
 *   2. The currently *selected item* — whose secrets the detail pane displays.
 *
 * _(Req 16.2, 17.1)_
 */

import { createContext, useContext } from 'react';
import type { ItemScope } from '@passshield/contracts';

/**
 * A fully-resolved scope selection. `categoryId` is only meaningful — and
 * required — when `scope === 'category'`; it is `null` for every other scope.
 *
 * Modelled as an object (rather than a bare {@link ItemScope}) so a category
 * selection carries the id needed to build an `items.list` filter without a
 * separate lookup. _(Req 16.2)_
 */
export interface VaultScopeSelection {
  /** Which built-in slice of the vault is active. */
  scope: ItemScope;
  /** The selected category id when `scope === 'category'`, else `null`. */
  categoryId: string | null;
}

/** The default scope shown when the vault first opens: everything. */
export const DEFAULT_SCOPE: VaultScopeSelection = { scope: 'all', categoryId: null };

/**
 * The reactive contract the panes consume. `VaultLayout` provides a concrete
 * implementation via {@link VaultViewContext}; panes read the current values
 * and call the setters to drive cross-pane changes (e.g. the list pane calls
 * {@link selectItem} when a row is clicked, and the detail pane reads
 * {@link selectedItemId}).
 */
export interface VaultViewState {
  /** The active scope selection driving the item list. */
  selection: VaultScopeSelection;
  /** Replace the active scope. Clears the item selection (a new list is shown). */
  setSelection: (next: VaultScopeSelection) => void;

  /** The id of the item whose detail is shown, or `null` when none is selected. */
  selectedItemId: string | null;
  /** Select an item for the detail pane (or clear it with `null`). */
  selectItem: (id: string | null) => void;
}

/**
 * React context carrying the {@link VaultViewState}. `undefined` outside a
 * provider so {@link useVaultViewState} can fail loudly rather than silently
 * handing back stale defaults.
 */
export const VaultViewContext = createContext<VaultViewState | undefined>(undefined);

/**
 * Hook for panes to read and drive the shared vault view state.
 *
 * Must be called inside the `VaultViewContext.Provider` rendered by
 * `VaultLayout`. Throwing on misuse turns an easy wiring mistake into an
 * obvious error instead of a confusing no-op.
 */
export function useVaultViewState(): VaultViewState {
  const ctx = useContext(VaultViewContext);
  if (ctx === undefined) {
    throw new Error('useVaultViewState must be used within a VaultLayout provider.');
  }
  return ctx;
}

/**
 * Human-readable titles for each built-in scope, used by the sidebar nav rows
 * and (by the list pane in Task 9.2) as the list header title. Category scopes
 * resolve their own title from the category record, so no entry exists here.
 * _(Req 16.2)_
 */
export const SCOPE_LABELS: Record<Exclude<ItemScope, 'category'>, string> = {
  all: 'All Items',
  favorites: 'Favorites',
  recent: 'Recent',
  logins: 'Logins',
  notes: 'Secure Notes',
};
