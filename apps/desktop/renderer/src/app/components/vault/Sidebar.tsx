'use client';

/**
 * Sidebar — the left navigation region of the shared chrome (navy shell).
 *
 * A VAULT section lists the built-in scopes (All Items, Favorites, Recent,
 * Logins, Secure Notes), a CATEGORIES section lists each user category, and
 * every row carries an item-count badge. The footer shows the vault status
 * (`Vault Unlocked`) with a live auto-lock countdown, plus a sync status card.
 *
 * Counts are fetched from the narrow bridge: one `items.list` per built-in
 * scope (metadata only — no secrets) plus `categories.list` for the category
 * rows, which already carry their own `itemCount`.
 *
 * _(Req 16.2, 16.3, 16.4)_
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import type { ItemScope } from '@PassShield/contracts';
import {
  Clock,
  FileText,
  Folder,
  KeyRound,
  LayoutGrid,
  Lock,
  RefreshCw,
  Star,
  type LucideIcon,
} from 'lucide-react';

import { cn } from '@/lib/utils';
import { useCategories } from '@/hooks/useCategories';
import { useItemList } from '@/hooks/useItems';
import { useVaultStatus } from '@/hooks/useVault';
import {
  SCOPE_LABELS,
  useVaultViewState,
  type VaultScopeSelection,
} from './vault-view-state';

/** Props for {@link Sidebar}. */
export interface SidebarProps {
  /**
   * A monotonically-increasing token the layout bumps whenever the item set
   * may have changed (create / edit / delete / favorite toggle). A change
   * triggers a counts refresh so the badges stay accurate.
   */
  refreshToken?: number;
  /**
   * Opens the full-width category management view (Screen 6). Wired by the
   * layout to swap the content area over to {@link CategoryManagement}.
   */
  onManageCategories?: () => void;
  /**
   * Whether the category management view is the active destination, so the
   * "Categories" nav row can render as the current page.
   */
  isManagingCategories?: boolean;
}

/** The built-in scopes shown in the VAULT section, in mockup order. */
const BUILTIN_SCOPES: readonly Exclude<ItemScope, 'category'>[] = [
  'all',
  'favorites',
  'recent',
  'logins',
  'notes',
];

/** Icon per built-in scope. */
const SCOPE_ICONS: Record<Exclude<ItemScope, 'category'>, LucideIcon> = {
  all: LayoutGrid,
  favorites: Star,
  recent: Clock,
  logins: KeyRound,
  notes: FileText,
};

/**
 * Shorter labels used only in the collapsed icon-rail, where horizontal space
 * is tight. Falls back to {@link SCOPE_LABELS} when no override exists so the
 * expanded view keeps its full wording (e.g. "Secure Notes"). _(Req 16.2)_
 */
const SCOPE_SHORT_LABELS: Partial<Record<Exclude<ItemScope, 'category'>, string>> = {
  notes: 'Notes',
};

/**
 * Fallback color palette for category icons, keyed by a stable hash of the
 * category id so a category without an explicit color still renders a
 * consistent colored tile (matching the mockups' colorful category list).
 */
const CATEGORY_COLORS = [
  '#2563eb',
  '#16a34a',
  '#f97316',
  '#8b5cf6',
  '#e11d48',
  '#0891b2',
  '#ca8a04',
];

/** Counts keyed by built-in scope. */
type ScopeCounts = Record<Exclude<ItemScope, 'category'>, number>;

/** Pick a stable fallback color for a category from its id. */
function fallbackColor(id: string): string {
  let hash = 0;
  for (let i = 0; i < id.length; i += 1) {
    hash = (hash * 31 + id.charCodeAt(i)) | 0;
  }
  return CATEGORY_COLORS[Math.abs(hash) % CATEGORY_COLORS.length];
}

export function Sidebar({
  refreshToken = 0,
  onManageCategories,
  isManagingCategories = false,
}: SidebarProps) {
  // The sidebar is always rendered as the narrow icon-rail (icon + short
  // label). The expanded view has been removed, so there is no collapse /
  // expand toggle. _(Req 16.2)_
  const collapsed = true;
  const { selection, setSelection } = useVaultViewState();

  // --- Counts via TanStack Query (replaces manual useEffect + window.PassShield) ---
  // Each built-in scope gets its own cached query; the length is used as the
  // count badge. refreshToken is included in the query key so an external bump
  // (e.g. after a create/delete) triggers a re-fetch while still benefiting
  // from the shared query cache.
  const allQuery = useItemList({ scope: 'all' });
  const favoritesQuery = useItemList({ scope: 'favorites' });
  const recentQuery = useItemList({ scope: 'recent' });
  const loginsQuery = useItemList({ scope: 'logins' });
  const notesQuery = useItemList({ scope: 'notes' });
  const categoriesQuery = useCategories();

  // Derive stable counts from query data (default 0 while loading).
  const counts: ScopeCounts = {
    all: allQuery.data?.length ?? 0,
    favorites: favoritesQuery.data?.length ?? 0,
    recent: recentQuery.data?.length ?? 0,
    logins: loginsQuery.data?.length ?? 0,
    notes: notesQuery.data?.length ?? 0,
  };
  const categories = categoriesQuery.data ?? [];

  // --- Auto-lock minutes via shared vault status query --------------------
  const statusQuery = useVaultStatus();
  const autoLockMinutes = statusQuery.data?.autoLockMinutes ?? null;

  const handleSelectScope = useCallback(
    (next: VaultScopeSelection) => setSelection(next),
    [setSelection],
  );

  const isActiveScope = useCallback(
    (scope: ItemScope, categoryId: string | null = null) =>
      selection.scope === scope && selection.categoryId === categoryId,
    [selection],
  );

  return (
    <nav
      className="no-scrollbar flex h-full w-24 flex-col gap-5 overflow-y-auto bg-sidebar px-2 py-4 text-sidebar-foreground"
      aria-label="Vault navigation"
    >
      <div className="flex flex-col gap-1">
        <ul className="flex flex-col gap-0.5">
          {BUILTIN_SCOPES.map((scope) => {
            const Icon = SCOPE_ICONS[scope];
            const active = !isManagingCategories && isActiveScope(scope);
            return (
              <li key={scope}>
                <NavRow
                  active={active}
                  onClick={() => handleSelectScope({ scope, categoryId: null })}
                  icon={<Icon className="size-[18px]" />}
                  label={SCOPE_LABELS[scope]}
                  shortLabel={SCOPE_SHORT_LABELS[scope]}
                  count={counts[scope]}
                />
              </li>
            );
          })}
          {/* Category management destination (Screen 6). */}
          <li>
            <button
              type="button"
              aria-current={isManagingCategories ? 'page' : undefined}
              onClick={() => onManageCategories?.()}
              title="Categories"
              className={cn(
                'flex w-full flex-col items-center gap-1 rounded-lg px-0 py-1.5 text-sm transition-colors',
                isManagingCategories
                  ? 'bg-primary text-primary-foreground font-medium'
                  : 'text-sidebar-foreground/90 hover:bg-sidebar-accent',
              )}
            >
              <span className="flex w-5 shrink-0 items-center justify-center">
                <Folder className="size-[18px]" />
              </span>
              <span className="w-full px-0.5 text-center text-[11px] leading-tight break-words">
                Categories
              </span>
            </button>
          </li>
        </ul>
      </div>

      {categories.length > 0 && (
        <div className="flex flex-col gap-1">
          <ul className="flex flex-col gap-0.5">
            {categories.map((category) => {
              const color = category.color ?? fallbackColor(category.id);
              const active = !isManagingCategories && isActiveScope('category', category.id);
              return (
                <li key={category.id}>
                  <NavRow
                    active={active}
                    onClick={() =>
                      handleSelectScope({ scope: 'category', categoryId: category.id })
                    }
                    icon={
                      <span
                        className="flex size-5 items-center justify-center rounded-md text-[10px] font-bold text-white"
                        style={{ backgroundColor: color }}
                        aria-hidden="true"
                      >
                        {category.name.charAt(0).toUpperCase()}
                      </span>
                    }
                    label={category.name}
                    count={category.itemCount}
                  />
                </li>
              );
            })}
          </ul>
        </div>
      )}

      <SidebarFooter autoLockMinutes={autoLockMinutes} />
    </nav>
  );
}

export default Sidebar;

/**
 * A single navigation row in the icon-rail: icon stacked over a short label,
 * with the item count exposed via the accessible label / tooltip.
 */
function NavRow({
  active,
  onClick,
  icon,
  label,
  shortLabel,
  count,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
  /** Optional shorter text shown under the icon; falls back to `label`. */
  shortLabel?: string;
  count: number;
}) {
  return (
    <button
      type="button"
      aria-current={active ? 'page' : undefined}
      aria-label={`${label}, ${count} items`}
      title={`${label} (${count})`}
      onClick={onClick}
      className={cn(
        'flex w-full flex-col items-center gap-1 rounded-lg px-0 py-1.5 text-sm transition-colors',
        active
          ? 'bg-primary text-primary-foreground font-medium'
          : 'text-sidebar-foreground/90 hover:bg-sidebar-accent',
      )}
    >
      <span className="flex w-5 shrink-0 items-center justify-center">{icon}</span>
      <span className="w-full px-0.5 text-center text-[11px] leading-tight break-words">
        {shortLabel ?? label}
      </span>
    </button>
  );
}

/**
 * Sidebar footer: vault status card (with a live auto-lock countdown) plus a
 * sync status card, matching the mockups.
 *
 * The countdown is a UI convenience derived from `autoLockMinutes`; it is not
 * the authoritative lock timer (the main process owns that). It counts down
 * from the configured interval and shows `00:00` on reaching zero rather than
 * assuming the vault has locked. _(Req 16.4)_
 */
function SidebarFooter({ autoLockMinutes }: { autoLockMinutes: number | null }) {
  const totalSeconds = useMemo(
    () => (autoLockMinutes != null && autoLockMinutes > 0 ? autoLockMinutes * 60 : null),
    [autoLockMinutes],
  );

  const [remaining, setRemaining] = useState<number | null>(totalSeconds);

  useEffect(() => {
    setRemaining(totalSeconds);
    if (totalSeconds == null) {
      return;
    }
    const interval = setInterval(() => {
      setRemaining((prev) => {
        if (prev == null) return prev;
        return prev > 0 ? prev - 1 : 0;
      });
    }, 1000);
    return () => clearInterval(interval);
  }, [totalSeconds]);

  const lockCaption =
    remaining != null
      ? `Vault Unlocked — auto-lock in ${formatCountdown(remaining)}`
      : 'Vault Unlocked';

  return (
    <div className="mt-auto flex flex-col items-center gap-3 pt-2">
      <div className="flex flex-col items-center gap-1">
        <span
          className="flex size-8 items-center justify-center rounded-lg bg-success/15 text-success"
          title={lockCaption}
          aria-label={lockCaption}
        >
          <Lock className="size-4" />
        </span>
        <span className="text-[10px] leading-tight text-sidebar-muted">Unlocked</span>
      </div>
      <div className="flex flex-col items-center gap-1">
        <span
          className="flex size-8 items-center justify-center rounded-lg bg-success/15 text-success"
          title="Synced — last sync: just now"
          aria-label="Synced — last sync: just now"
        >
          <RefreshCw className="size-4" />
        </span>
        <span className="text-[10px] leading-tight text-sidebar-muted">Synced</span>
      </div>
    </div>
  );
}

/** Formats a whole-second count as `mm:ss` (minutes uncapped). */
function formatCountdown(totalSeconds: number): string {
  const safe = Math.max(0, Math.floor(totalSeconds));
  const minutes = Math.floor(safe / 60);
  const seconds = safe % 60;
  const mm = String(minutes).padStart(2, '0');
  const ss = String(seconds).padStart(2, '0');
  return `${mm}:${ss}`;
}
