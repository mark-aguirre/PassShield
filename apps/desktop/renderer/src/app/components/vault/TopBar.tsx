'use client';

/**
 * TopBar — the persistent top region of the shared chrome.
 *
 * Layout mirrors the mockups: the PassShield wordmark on the left over the
 * navy shell, a centered global search box with a Ctrl+K affordance, and a
 * right-hand action cluster with a `+ New Item` split button (dropdown for
 * Login / Secure Note), a lock control, and a settings control. Native window
 * controls belong to the OS shell and are not drawn here.
 *
 * The search box focuses on Ctrl+K via a document-level keydown listener so the
 * shortcut works regardless of where focus currently sits. _(Req 16.1, 16.5)_
 */

import { useCallback, useEffect, useRef } from 'react';
import type { ItemType } from '@PassShield/contracts';
import { ChevronDown, Lock, Plus, Search, Settings } from 'lucide-react';

import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

/**
 * Props for {@link TopBar}. Actions are delivered as callbacks so the top bar
 * stays presentational; the owning `VaultLayout` decides what each does.
 */
export interface TopBarProps {
  /** Current global-search query text (owned by the layout). */
  searchQuery: string;
  /** Notifies the layout the query changed. _(Req 6.1)_ */
  onSearchChange: (query: string) => void;
  /**
   * Invoked when the user picks an item type from the New Item split button.
   * _(Req 16.1)_
   */
  onNewItem: (itemType: ItemType) => void;
  /** Locks the vault immediately (calls `vault.lock`, then returns). _(Req 16.3)_ */
  onLock: () => void;
  /** Opens settings. _(Req 16.1)_ */
  onOpenSettings: () => void;
}

/**
 * The item types offered by the New Item split button's dropdown, in the order
 * the mockup lists them.
 */
const NEW_ITEM_OPTIONS: ReadonlyArray<{ type: ItemType; label: string }> = [
  { type: 'login', label: 'Login' },
  { type: 'note', label: 'Secure Note' },
];

export function TopBar({
  searchQuery,
  onSearchChange,
  onNewItem,
  onLock,
  onOpenSettings,
}: TopBarProps) {
  const searchInputRef = useRef<HTMLInputElement>(null);

  // Ctrl+K (and Cmd+K on macOS) focuses the global search box from anywhere.
  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      const isSearchShortcut =
        (event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k';
      if (isSearchShortcut) {
        event.preventDefault();
        searchInputRef.current?.focus();
        searchInputRef.current?.select();
      }
    }
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, []);

  const handleNewItemPick = useCallback(
    (itemType: ItemType) => onNewItem(itemType),
    [onNewItem],
  );

  return (
    <header className="flex h-16 items-center gap-4 bg-sidebar px-4 text-sidebar-foreground">
      <div className="flex min-w-[200px] items-center gap-2">
        <img
          src="./logo.png"
          alt="PassShield logo"
          className="size-9 rounded-xl object-contain shadow-sm"
        />

        <span className="text-lg font-bold tracking-tight">
          Pass<span className="text-primary">Shield</span>
        </span>
      </div>

      <div className="relative mx-auto flex w-full max-w-xl items-center" role="search">
        <Search className="pointer-events-none absolute left-3 size-4 text-sidebar-muted" />
        <input
          ref={searchInputRef}
          type="search"
          className="h-10 w-full rounded-xl border border-sidebar-border bg-sidebar-accent/60 pr-16 pl-9 text-sm text-sidebar-foreground outline-none transition-colors placeholder:text-sidebar-muted focus-visible:border-primary focus-visible:ring-[3px] focus-visible:ring-primary/30"
          placeholder="Search vault..."
          aria-label="Search vault"
          aria-keyshortcuts="Control+K"
          value={searchQuery}
          onChange={(event) => onSearchChange(event.target.value)}
        />
        <kbd className="pointer-events-none absolute right-3 rounded border border-sidebar-border bg-sidebar px-1.5 py-0.5 text-[11px] font-medium text-sidebar-muted">
          Ctrl + K
        </kbd>
      </div>

      <div className="flex min-w-[200px] items-center justify-end gap-2">
        <div className="flex overflow-hidden rounded-lg">
          <Button
            type="button"
            className="rounded-r-none"
            onClick={() => handleNewItemPick('login')}
          >
            <Plus className="size-4" />
            New Item
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                type="button"
                aria-label="Choose item type"
                className="rounded-l-none border-l border-primary-foreground/25 px-2"
              >
                <ChevronDown className="size-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              {NEW_ITEM_OPTIONS.map((option) => (
                <DropdownMenuItem
                  key={option.type}
                  onSelect={() => handleNewItemPick(option.type)}
                >
                  {option.label}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>

        <Button
          type="button"
          variant="ghost"
          size="icon"
          onClick={onLock}
          aria-label="Lock vault"
          title="Lock vault"
          className="border border-sidebar-border text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-foreground"
        >
          <Lock className="size-4" />
        </Button>

        <Button
          type="button"
          variant="ghost"
          size="icon"
          onClick={onOpenSettings}
          aria-label="Settings"
          title="Settings"
          className="border border-sidebar-border text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-foreground"
        >
          <Settings className="size-4" />
        </Button>
      </div>
    </header>
  );
}

export default TopBar;
