'use client';

/**
 * VaultLayout — the three-pane container for the Main Vault Dashboard (Screen 1).
 *
 * It composes the shared chrome (top bar + sidebar) around a content area that
 * holds three panes: the sidebar navigation (left), the item list (middle), and
 * the item detail (right). This component OWNS the shared "vault view state"
 * (see `./vault-view-state`) — the active scope selection and the currently
 * selected item id — and publishes it through `VaultViewContext` so the item
 * list pane (Task 9.2) and the item detail pane (Task 9.3) can consume it
 * without knowing about each other.
 *
 * The middle pane renders `./ItemList` (Task 9.2) and the right pane renders
 * `./ItemDetail` (Task 9.3); this layout wires each to the shared view state.
 *
 * _(Req 16.1, 16.2, 16.3, 16.4, 16.5, 17.1)_
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import type { ItemType } from '@passshield/contracts';
import { PanelRightClose, PanelRightOpen } from 'lucide-react';
import { Button } from '@/components/ui/button';
import ItemEditor from '../ItemEditor';
import SettingsView from '../SettingsView';
import CategoryManagement from './CategoryManagement';
import FavoritesView from './FavoritesView';
import ItemDetail from './ItemDetail';
import ItemList from './ItemList';
import PasswordGenerator from './PasswordGenerator';
import SearchResults from './SearchResults';
import Sidebar from './Sidebar';
import TopBar from './TopBar';
import {
  DEFAULT_SCOPE,
  SCOPE_LABELS,
  VaultViewContext,
  type VaultScopeSelection,
  type VaultViewState,
} from './vault-view-state';

/**
 * Local editor-overlay state. `null` means the editor is closed; otherwise it
 * carries whether we're creating (with an initial item type) or editing an
 * existing item (by id).
 */
type EditorState =
  | { mode: 'create'; initialType: ItemType; parentId?: string | null }
  | { mode: 'edit'; itemId: string }
  | null;

/**
 * How often, at most, to forward a non-secret activity ping to the main
 * process while the user is active. The main-process Auto-Lock Manager only
 * needs to know the user is active; sending at most one ping per interval keeps
 * a flood of mousemove/keydown events cheap. (Req 3.1)
 */
const ACTIVITY_PING_INTERVAL_MS = 5_000;

/** localStorage key for persisting the item-list pane's collapsed state. */
const LIST_COLLAPSED_KEY = 'passshield.layout.listCollapsed';

/**
 * Reads a persisted boolean flag from localStorage, defaulting to `false` when
 * unavailable (SSR / disabled storage) or unset. Kept tiny and synchronous so
 * it can seed `useState` lazily without a flash of the wrong layout.
 */
function readPersistedFlag(key: string): boolean {
  if (typeof window === 'undefined') {
    return false;
  }
  try {
    return window.localStorage.getItem(key) === 'true';
  } catch {
    return false;
  }
}

/** Persists a boolean flag, swallowing storage failures (e.g. private mode). */
function writePersistedFlag(key: string, value: boolean): void {
  if (typeof window === 'undefined') {
    return;
  }
  try {
    window.localStorage.setItem(key, value ? 'true' : 'false');
  } catch {
    // Persistence is a convenience; ignore quota / access errors.
  }
}

/** Props for {@link VaultLayout}. */
export interface VaultLayoutProps {
  /**
   * Locks the vault and transitions the app shell back to the locked screen.
   * The shell passes this so the top bar's lock control can hand control back
   * after `vault.lock()` completes. _(Req 16.3)_
   */
  onLock: () => void;
}

export function VaultLayout({ onLock }: VaultLayoutProps) {
  // --- Shared vault view state (owned here) --------------------------------
  const [selection, setSelectionState] = useState<VaultScopeSelection>(DEFAULT_SCOPE);
  const [selectedItemId, setSelectedItemId] = useState<string | null>(null);

  // The full-width category management view (Screen 6), opened from the
  // Sidebar's dedicated "Categories" nav entry. _(Req 21.x)_
  const [manageCategories, setManageCategories] = useState(false);

  // Changing scope shows a new list, so any prior item selection is cleared.
  // It also leaves the full-width category management view (Screen 6) since the
  // user is navigating to a specific scope/category.
  const setSelection = useCallback((next: VaultScopeSelection) => {
    setSelectionState(next);
    setSelectedItemId(null);
    setManageCategories(false);
  }, []);

  const selectItem = useCallback((id: string | null) => {
    setSelectedItemId(id);
  }, []);

  const viewState = useMemo<VaultViewState>(
    () => ({ selection, setSelection, selectedItemId, selectItem }),
    [selection, setSelection, selectedItemId, selectItem],
  );

  // --- Auto-lock activity pings --------------------------------------------
  // While the vault view is mounted the vault is unlocked, so we notify the
  // main process of non-secret user activity (mouse movement / key presses) so
  // its Auto-Lock Manager can reset the inactivity timer. Pings are throttled
  // to at most one per ACTIVITY_PING_INTERVAL_MS and carry no payload. This is
  // the only side effect added here; it never touches secret values. (Req 3.1)
  useEffect(() => {
    let lastPingAt = 0;

    const handleActivity = () => {
      const now = Date.now();
      if (now - lastPingAt < ACTIVITY_PING_INTERVAL_MS) {
        return;
      }
      lastPingAt = now;
      window.passShield.activity.ping();
    };

    window.addEventListener('mousemove', handleActivity, { passive: true });
    window.addEventListener('keydown', handleActivity);

    return () => {
      window.removeEventListener('mousemove', handleActivity);
      window.removeEventListener('keydown', handleActivity);
    };
  }, []);

  // --- Chrome-owned local state --------------------------------------------
  const [searchQuery, setSearchQuery] = useState('');

  // Bumped whenever the item set may have changed so the sidebar (and any
  // count-bearing panes) refresh. Create/edit/delete flows call the setter.
  const [refreshToken, setRefreshToken] = useState(0);
  const bumpRefreshToken = useCallback(() => setRefreshToken((token) => token + 1), []);

  // The create/edit item overlay. `null` = closed. _(Req 4, 5)_
  const [editor, setEditor] = useState<EditorState>(null);

  // The password generator overlay. Reachable via a "Generate Password" action
  // in the middle-pane header (shown for all scopes). _(Req 8)_
  const [showGenerator, setShowGenerator] = useState(false);

  // The settings overlay. Opened from the top bar's settings control. _(Req 14)_
  const [showSettings, setShowSettings] = useState(false);

  // --- Collapsible panels --------------------------------------------------
  // The left nav (icon rail) and the middle item-list pane can each be
  // collapsed to reclaim horizontal space. Both states persist across
  // sessions via localStorage. _(Req 16.2)_
  const [listCollapsed, setListCollapsed] = useState(() =>
    readPersistedFlag(LIST_COLLAPSED_KEY),
  );

  const toggleListCollapsed = useCallback(() => {
    setListCollapsed((prev) => {
      const next = !prev;
      writePersistedFlag(LIST_COLLAPSED_KEY, next);
      return next;
    });
  }, []);

  const handleLock = useCallback(async () => {
    try {
      await window.passShield.vault.lock();
    } finally {
      // Always return to the locked screen even if the lock call throws; the
      // shell will re-probe status on the way back.
      onLock();
    }
  }, [onLock]);

  const handleNewItem = useCallback((itemType: ItemType) => {
    setEditor({ mode: 'create', initialType: itemType });
  }, []);

  const handleEditItem = useCallback((id: string) => {
    setEditor({ mode: 'edit', itemId: id });
  }, []);

  // Open the editor to create a new secure note nested under `parentId`. The
  // created item becomes a sub-page of the note whose detail is open. _(Req 5.1)_
  const handleAddSubPage = useCallback((parentId: string) => {
    setEditor({ mode: 'create', initialType: 'note', parentId });
  }, []);

  // Toggle an item's favorite flag. The list pane carries only non-secret
  // metadata, so we fetch the full (decrypted) item, flip `isFavorite`, and
  // persist through the existing `items.save` surface (the only mutating item
  // API). On success we bump the refresh token so the list, sidebar counts,
  // and Favorites scope re-fetch. _(Req 7.4)_
  const handleToggleFavorite = useCallback(
    async (id: string, next: boolean) => {
      try {
        const detail = await window.passShield.items.get(id);
        if (!detail.ok) {
          return;
        }
        const item = detail.value;
        const saveInput =
          item.itemType === 'login'
            ? {
                id: item.id,
                itemType: 'login' as const,
                title: item.title,
                categoryId: item.categoryId,
                isFavorite: next,
                payload: item.payload,
              }
            : {
                id: item.id,
                itemType: 'note' as const,
                title: item.title,
                categoryId: item.categoryId,
                isFavorite: next,
                payload: item.payload,
              };
        const result = await window.passShield.items.save(saveInput);
        if (result.ok) {
          bumpRefreshToken();
        }
      } catch {
        // Swallow: a failed toggle leaves the star in its prior state; the
        // refresh token is not bumped so no stale UI is shown.
      }
    },
    [bumpRefreshToken],
  );

  const handleEditorSaved = useCallback(
    (savedId: string) => {
      setEditor(null);
      bumpRefreshToken();
      selectItem(savedId);
    },
    [bumpRefreshToken, selectItem],
  );

  const handleEditorTrashed = useCallback(() => {
    setEditor(null);
    bumpRefreshToken();
    selectItem(null);
  }, [bumpRefreshToken, selectItem]);

  const handleEditorClose = useCallback(() => {
    setEditor(null);
  }, []);

  const handleOpenSettings = useCallback(() => {
    setShowSettings(true);
  }, []);

  const handleGeneratorSaveAsCustom = useCallback((value: string) => {
    // TODO(Task 16): prefill the new login's password with `value`. ItemEditor
    // has no password-prefill prop yet, so for now we just open create mode.
    void value;
    setShowGenerator(false);
    setEditor({ mode: 'create', initialType: 'login' });
  }, []);

  const handleGeneratorClose = useCallback(() => {
    setShowGenerator(false);
  }, []);

  const isSearching = searchQuery.trim().length > 0;
  const isFavoritesScope = selection.scope === 'favorites';

  return (
    <VaultViewContext.Provider value={viewState}>
      <div className="flex h-screen min-h-0 flex-col bg-sidebar text-foreground">
        <TopBar
          searchQuery={searchQuery}
          onSearchChange={setSearchQuery}
          onNewItem={handleNewItem}
          onLock={() => void handleLock()}
          onOpenSettings={handleOpenSettings}
        />

        <div className="flex min-h-0 flex-1">
          <Sidebar
            refreshToken={refreshToken}
            isManagingCategories={manageCategories}
            onManageCategories={() => {
              setManageCategories(true);
              setSearchQuery('');
            }}
          />

          {/* The light content surface. In the mockups it is a rounded panel
              floating over the navy shell. */}
          <div className="flex min-h-0 min-w-0 flex-1 overflow-hidden rounded-tl-2xl bg-background">
            {isSearching ? (
              // A non-empty query takes over the whole content area. Clearing it
              // restores the normal two-pane view. _(Req 6.1, 6.2)_
              <section
                className="min-h-0 min-w-0 flex-1 overflow-auto"
                aria-label="Search results"
              >
                <SearchResults
                  query={searchQuery}
                  onOpenItem={(id) => {
                    setSearchQuery('');
                    selectItem(id);
                  }}
                />
              </section>
            ) : manageCategories ? (
              // Full-width category management (Screen 6) takes over the whole
              // content area, like search results. _(Req 21.x)_
              <section
                className="min-h-0 min-w-0 flex-1 overflow-auto"
                aria-label="Category management"
              >
                <CategoryManagement onChanged={bumpRefreshToken} />
              </section>
            ) : (
              <>
                {!listCollapsed && (
                  <section
                    className="flex min-h-0 w-[380px] shrink-0 flex-col border-r border-border"
                    aria-label="Item list"
                  >
                    <div className="flex items-center justify-between gap-2 border-b border-border px-4 py-2">
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        onClick={toggleListCollapsed}
                        aria-label="Collapse item list"
                        title="Collapse item list"
                      >
                        <PanelRightOpen className="size-4" />
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => setShowGenerator(true)}
                      >
                        Generate Password
                      </Button>
                    </div>

                    {isFavoritesScope ? (
                      <FavoritesView selectedItemId={selectedItemId} onOpenItem={selectItem} />
                    ) : (
                      <ItemList
                        scopeTitle={
                          selection.scope === 'category'
                            ? 'Category'
                            : SCOPE_LABELS[selection.scope]
                        }
                        filter={{
                          scope: selection.scope,
                          categoryId: selection.categoryId ?? undefined,
                        }}
                        selectedItemId={selectedItemId}
                        onSelectItem={(id) => selectItem(id)}
                        onToggleFavorite={handleToggleFavorite}
                        refreshToken={refreshToken}
                      />
                    )}
                  </section>
                )}

                <section
                  className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden"
                  aria-label="Item detail"
                >
                  {listCollapsed && (
                    <div className="flex items-center gap-2 border-b border-border px-4 py-2">
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        onClick={toggleListCollapsed}
                        aria-label="Show item list"
                        title="Show item list"
                      >
                        <PanelRightClose className="size-4" />
                      </Button>
                    </div>
                  )}
                  <div className="min-h-0 flex-1 overflow-auto">
                    <ItemDetail
                      itemId={selectedItemId}
                      onEdit={handleEditItem}
                      onOpenItem={selectItem}
                      onAddSubPage={handleAddSubPage}
                      refreshToken={refreshToken}
                      onClose={() => selectItem(null)}
                    />
                  </div>
                </section>
              </>
            )}
          </div>
        </div>

        {editor && (
          <Overlay>
            <ItemEditor
              itemId={editor.mode === 'edit' ? editor.itemId : null}
              initialType={editor.mode === 'create' ? editor.initialType : undefined}
              parentId={editor.mode === 'create' ? (editor.parentId ?? null) : null}
              onSaved={handleEditorSaved}
              onTrashed={handleEditorTrashed}
              onClose={handleEditorClose}
            />
          </Overlay>
        )}

        {showGenerator && (
          <Overlay>
            <PasswordGenerator
              onSaveAsCustom={handleGeneratorSaveAsCustom}
              onClose={handleGeneratorClose}
            />
          </Overlay>
        )}

        {showSettings && (
          <Overlay>
            <SettingsView onClose={() => setShowSettings(false)} />
          </Overlay>
        )}
      </div>
    </VaultViewContext.Provider>
  );
}

/**
 * Full-window overlay hosting a modal surface (item editor, password
 * generator, settings). Renders a light content panel over a dimmed backdrop.
 */
function Overlay({ children }: { children: React.ReactNode }) {
  return (
    <div
      className="fixed inset-0 z-20 flex overflow-auto bg-slate-950/50"
      role="dialog"
      aria-modal="true"
    >
      <div className="flex min-h-0 min-w-0 flex-1 bg-background">{children}</div>
    </div>
  );
}

export default VaultLayout;
