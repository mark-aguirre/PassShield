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

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { CategoryWithCount, ItemScope } from '@passshield/contracts';
import {
  ChevronRight,
  Clock,
  FileText,
  Folder,
  KeyRound,
  LayoutGrid,
  Lock,
  PanelLeftClose,
  PanelLeftOpen,
  RefreshCw,
  Star,
  type LucideIcon,
} from 'lucide-react';

import { cn } from '@/lib/utils';
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
  /**
   * When `true` the sidebar renders as a narrow icon-only rail: section
   * headings, row labels, count badges, and footer captions are hidden and
   * each row is reduced to its icon (with a native tooltip). _(Req 16.2)_
   */
  collapsed?: boolean;
  /** Toggles the collapsed icon-rail state. Wired by the layout. */
  onToggleCollapsed?: () => void;
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

const EMPTY_COUNTS: ScopeCounts = {
  all: 0,
  favorites: 0,
  recent: 0,
  logins: 0,
  notes: 0,
};

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
  collapsed = false,
  onToggleCollapsed,
}: SidebarProps) {
  const { selection, setSelection } = useVaultViewState();

  const [counts, setCounts] = useState<ScopeCounts>(EMPTY_COUNTS);
  const [categories, setCategories] = useState<CategoryWithCount[]>([]);
  const [autoLockMinutes, setAutoLockMinutes] = useState<number | null>(null);

  // --- Counts + categories -------------------------------------------------
  useEffect(() => {
    let cancelled = false;

    async function loadCounts() {
      try {
        const [all, favorites, recent, logins, notes, cats] = await Promise.all([
          window.passShield.items.list({ scope: 'all' }),
          window.passShield.items.list({ scope: 'favorites' }),
          window.passShield.items.list({ scope: 'recent' }),
          window.passShield.items.list({ scope: 'logins' }),
          window.passShield.items.list({ scope: 'notes' }),
          window.passShield.categories.list(),
        ]);
        if (cancelled) return;
        setCounts({
          all: all.length,
          favorites: favorites.length,
          recent: recent.length,
          logins: logins.length,
          notes: notes.length,
        });
        setCategories(cats);
      } catch {
        // Counts are non-critical chrome; leave prior values on failure.
      }
    }

    void loadCounts();
    return () => {
      cancelled = true;
    };
  }, [refreshToken]);

  // --- Auto-lock configuration ---------------------------------------------
  useEffect(() => {
    let cancelled = false;
    async function loadStatus() {
      try {
        const status = await window.passShield.vault.status();
        if (!cancelled) {
          setAutoLockMinutes(status.autoLockMinutes);
        }
      } catch {
        // Leave the countdown hidden if status is unavailable.
      }
    }
    void loadStatus();
    return () => {
      cancelled = true;
    };
  }, []);

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
      className={cn(
        'flex h-full flex-col gap-5 overflow-y-auto bg-sidebar py-4 text-sidebar-foreground transition-[width] duration-200 ease-in-out',
        collapsed ? 'w-16 px-2' : 'w-64 px-3',
      )}
      aria-label="Vault navigation"
    >
      {/* Collapse / expand toggle. Sits above the nav groups so it stays
          reachable in both states. */}
      <div className={cn('flex', collapsed ? 'justify-center' : 'justify-end')}>
        <button
          type="button"
          onClick={() => onToggleCollapsed?.()}
          aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          aria-pressed={collapsed}
          title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          className="flex size-8 items-center justify-center rounded-lg text-sidebar-foreground/80 transition-colors hover:bg-sidebar-accent hover:text-sidebar-foreground"
        >
          {collapsed ? (
            <PanelLeftOpen className="size-[18px]" />
          ) : (
            <PanelLeftClose className="size-[18px]" />
          )}
        </button>
      </div>

      <div className="flex flex-col gap-1">
        {!collapsed && <SectionHeading>Vault</SectionHeading>}
        <ul className="flex flex-col gap-0.5">
          {BUILTIN_SCOPES.map((scope) => {
            const Icon = SCOPE_ICONS[scope];
            const active = !isManagingCategories && isActiveScope(scope);
            return (
              <li key={scope}>
                <NavRow
                  active={active}
                  collapsed={collapsed}
                  onClick={() => handleSelectScope({ scope, categoryId: null })}
                  icon={<Icon className="size-[18px]" />}
                  label={SCOPE_LABELS[scope]}
                  count={counts[scope]}
                />
              </li>
            );
          })}
          {/* Full-width category management destination (Screen 6). */}
          <li>
            <button
              type="button"
              aria-current={isManagingCategories ? 'page' : undefined}
              onClick={() => onManageCategories?.()}
              title={collapsed ? 'Categories' : undefined}
              className={cn(
                'flex w-full items-center rounded-lg py-2 text-sm transition-colors',
                collapsed ? 'justify-center px-0' : 'gap-3 px-2.5',
                isManagingCategories
                  ? 'bg-primary text-primary-foreground font-medium'
                  : 'text-sidebar-foreground/90 hover:bg-sidebar-accent',
              )}
            >
              <span className="flex w-5 shrink-0 items-center justify-center">
                <Folder className="size-[18px]" />
              </span>
              {!collapsed && (
                <>
                  <span className="flex-1 text-left">Categories</span>
                  <ChevronRight className="size-4 shrink-0 opacity-70" />
                </>
              )}
            </button>
          </li>
        </ul>
      </div>

      <div className="flex flex-col gap-1">
        {!collapsed && <SectionHeading>Categories</SectionHeading>}
        {categories.length === 0 ? (
          !collapsed && <p className="px-2 text-xs text-sidebar-muted">No categories yet</p>
        ) : (
          <ul className="flex flex-col gap-0.5">
            {categories.map((category) => {
              const color = category.color ?? fallbackColor(category.id);
              const active = !isManagingCategories && isActiveScope('category', category.id);
              return (
                <li key={category.id}>
                  <NavRow
                    active={active}
                    collapsed={collapsed}
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
        )}
      </div>

      <SidebarFooter autoLockMinutes={autoLockMinutes} collapsed={collapsed} />
    </nav>
  );
}

export default Sidebar;

/** Uppercase section label used above each nav group. */
function SectionHeading({ children }: { children: React.ReactNode }) {
  return (
    <h2 className="px-2 pb-1 text-[11px] font-semibold tracking-[0.08em] text-sidebar-muted uppercase">
      {children}
    </h2>
  );
}

/** A single navigation row: icon, label, and a count badge. */
function NavRow({
  active,
  onClick,
  icon,
  label,
  count,
  collapsed = false,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
  count: number;
  collapsed?: boolean;
}) {
  return (
    <button
      type="button"
      aria-current={active ? 'page' : undefined}
      aria-label={collapsed ? `${label}, ${count} items` : undefined}
      title={collapsed ? `${label} (${count})` : undefined}
      onClick={onClick}
      className={cn(
        'flex w-full items-center rounded-lg py-2 text-sm transition-colors',
        collapsed ? 'justify-center px-0' : 'gap-3 px-2.5',
        active
          ? 'bg-primary text-primary-foreground font-medium'
          : 'text-sidebar-foreground/90 hover:bg-sidebar-accent',
      )}
    >
      <span className="flex w-5 shrink-0 items-center justify-center">{icon}</span>
      {!collapsed && (
        <>
          <span className="flex-1 truncate text-left">{label}</span>
          <span
            className={cn(
              'shrink-0 text-xs tabular-nums',
              active ? 'text-primary-foreground/80' : 'text-sidebar-muted',
            )}
            aria-label={`${count} items`}
          >
            {count}
          </span>
        </>
      )}
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
function SidebarFooter({
  autoLockMinutes,
  collapsed = false,
}: {
  autoLockMinutes: number | null;
  collapsed?: boolean;
}) {
  const totalSeconds = useMemo(
    () => (autoLockMinutes != null && autoLockMinutes > 0 ? autoLockMinutes * 60 : null),
    [autoLockMinutes],
  );

  const [remaining, setRemaining] = useState<number | null>(totalSeconds);
  const remainingRef = useRef<number | null>(totalSeconds);
  remainingRef.current = remaining;

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

  if (collapsed) {
    return (
      <div className="mt-auto flex flex-col items-center gap-2 pt-2">
        <span
          className="flex size-8 items-center justify-center rounded-lg bg-success/15 text-success"
          title={lockCaption}
          aria-label={lockCaption}
        >
          <Lock className="size-4" />
        </span>
        <span
          className="flex size-8 items-center justify-center rounded-lg bg-success/15 text-success"
          title="Synced — last sync: just now"
          aria-label="Synced — last sync: just now"
        >
          <RefreshCw className="size-4" />
        </span>
      </div>
    );
  }

  return (
    <div className="mt-auto flex flex-col gap-2 pt-2">
      <div className="flex items-center gap-3 rounded-xl bg-sidebar-accent/70 px-3 py-2.5">
        <span className="flex size-8 items-center justify-center rounded-lg bg-success/15 text-success">
          <Lock className="size-4" />
        </span>
        <div className="flex min-w-0 flex-col">
          <span className="text-sm font-medium">Vault Unlocked</span>
          {remaining != null && (
            <span className="text-xs tabular-nums text-sidebar-muted">
              Auto-lock in {formatCountdown(remaining)}
            </span>
          )}
        </div>
      </div>

      <div className="flex items-center gap-3 rounded-xl bg-sidebar-accent/70 px-3 py-2.5">
        <span className="flex size-8 items-center justify-center rounded-lg bg-success/15 text-success">
          <RefreshCw className="size-4" />
        </span>
        <div className="flex min-w-0 flex-col">
          <span className="text-sm font-medium">Synced</span>
          <span className="text-xs text-sidebar-muted">Last sync: just now</span>
        </div>
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
