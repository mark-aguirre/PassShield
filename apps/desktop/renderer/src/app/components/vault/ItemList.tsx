'use client';

import { useCallback, useEffect, useState } from 'react';
import type { ItemListFilter, ItemSort, ItemSummary, ItemType } from '@passshield/contracts';
import { ListFilter, Star } from 'lucide-react';

import { cn } from '@/lib/utils';
import { ItemIcon } from '@/app/components/vault/ItemIcon';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

/**
 * Props for {@link ItemList}.
 *
 * The component renders the middle pane of the vault dashboard (Screen 1). It
 * shows only non-secret metadata sourced from {@link ItemSummary} and never
 * touches decrypted secret values. _(Req 6.4, 17.4)_
 */
export interface ItemListProps {
  /** Human-readable title for the current scope, e.g. "All Items". _(Req 17.2)_ */
  scopeTitle: string;
  /**
   * Filter passed to `window.passShield.items.list`. When omitted the list
   * requests the default (all) scope. Changing the filter re-fetches.
   */
  filter?: ItemListFilter;
  /** Currently selected item id, used to highlight the active row. */
  selectedItemId: string | null;
  /** Invoked when the user selects a row. */
  onSelectItem: (id: string) => void;
  /**
   * Optional handler for flipping an item's favorite flag. When provided the
   * star becomes interactive; when absent it renders as a read-only indicator
   * of {@link ItemSummary.isFavorite}. _(Req 7.4)_
   */
  onToggleFavorite?: (id: string, next: boolean) => void;
  /**
   * Bumped by the parent whenever the item set may have changed (e.g. after a
   * favorite toggle) so the list re-fetches its metadata.
   */
  refreshToken?: number;
}

/** Selectable sort options exposed by the list header. _(Req 17.2)_ */
const SORT_OPTIONS: ReadonlyArray<{ value: ItemSort; label: string }> = [
  { value: 'titleAsc', label: 'Title (A-Z)' },
  { value: 'titleDesc', label: 'Title (Z-A)' },
  { value: 'recent', label: 'Recent' },
];

/** Simple, non-secret subtitle derived from the item type. _(Req 17.4)_ */
const ITEM_TYPE_LABEL: Record<ItemType, string> = {
  login: 'Login',
  note: 'Secure Note',
};

/**
 * Middle pane of the vault dashboard: a scope header (title, item count, sort
 * control) and a metadata-only list of items.
 *
 * Items are fetched through the narrow `window.passShield.items.list` IPC
 * surface, which returns {@link ItemSummary} records carrying no secrets. The
 * component owns its own sort state and re-fetches whenever the filter or sort
 * changes. _(Req 6.4, 7.4, 17.2, 17.4)_
 */
export function ItemList({
  scopeTitle,
  filter,
  selectedItemId,
  onSelectItem,
  onToggleFavorite,
  refreshToken,
}: ItemListProps) {
  const [sort, setSort] = useState<ItemSort>('titleAsc');
  const [items, setItems] = useState<ItemSummary[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const scope = filter?.scope;
  const categoryId = filter?.categoryId;

  const loadItems = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const effectiveFilter: ItemListFilter | undefined =
        scope === undefined ? undefined : { scope, categoryId };
      const summaries = await window.passShield.items.list(effectiveFilter, sort);
      setItems(summaries);
    } catch {
      setItems([]);
      setError('Unable to load items.');
    } finally {
      setIsLoading(false);
    }
  }, [scope, categoryId, sort]);

  useEffect(() => {
    void loadItems();
    // `refreshToken` is an intentional trigger: bumping it re-fetches the list
    // after external mutations (e.g. a favorite toggle) even though it is not
    // read inside `loadItems`.
  }, [loadItems, refreshToken]);

  function handleStarClick(item: ItemSummary, event: React.MouseEvent) {
    event.stopPropagation();
    if (onToggleFavorite) {
      onToggleFavorite(item.id, !item.isFavorite);
    }
  }

  const isInteractiveStar = onToggleFavorite !== undefined;

  return (
    <section className="flex h-full min-w-0 flex-col bg-card" aria-label={`${scopeTitle} items`}>
      <header className="flex items-center justify-between gap-3 px-4 py-3">
        <div className="flex min-w-0 flex-col">
          <h2 className="truncate text-lg font-semibold text-foreground">{scopeTitle}</h2>
          <span className="text-xs text-muted-foreground">{items.length} items</span>
        </div>
        <div className="flex items-center gap-1.5">
          <Select value={sort} onValueChange={(value) => setSort(value as ItemSort)}>
            <SelectTrigger size="sm" className="gap-1.5 border-none bg-transparent shadow-none">
              <span className="text-xs text-muted-foreground">Sort:</span>
              <SelectValue />
            </SelectTrigger>
            <SelectContent align="end">
              {SORT_OPTIONS.map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <button
            type="button"
            className="flex size-8 items-center justify-center rounded-md border border-border text-muted-foreground transition-colors hover:bg-accent"
            aria-label="Filter items"
            title="Filter"
          >
            <ListFilter className="size-4" />
          </button>
        </div>
      </header>

      {error && (
        <p role="alert" className="px-4 py-2 text-sm text-destructive">
          {error}
        </p>
      )}

      {isLoading && items.length === 0 ? (
        <p className="p-4 text-sm text-muted-foreground">Loading...</p>
      ) : items.length === 0 ? (
        <p className="p-4 text-sm text-muted-foreground">No items to show.</p>
      ) : (
        <ul className="no-scrollbar flex-1 space-y-1 overflow-y-auto px-2 pb-2" role="list">
          {items.map((item) => {
            const isSelected = item.id === selectedItemId;
            return (
              <li key={item.id}>
                <div
                  role="button"
                  tabIndex={0}
                  aria-current={isSelected}
                  onClick={() => onSelectItem(item.id)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' || event.key === ' ') {
                      event.preventDefault();
                      onSelectItem(item.id);
                    }
                  }}
                  className={cn(
                    'flex w-full cursor-pointer items-center gap-3 rounded-xl px-3 py-2.5 text-left transition-colors',
                    isSelected ? 'bg-accent ring-1 ring-primary/30' : 'hover:bg-muted',
                  )}
                >
                  <ItemIcon title={item.title} itemType={item.itemType} glyphSize={18} />
                  <span className="flex min-w-0 flex-1 flex-col">
                    <span className="truncate text-sm font-medium text-foreground">
                      {item.title}
                    </span>
                    <span className="truncate text-xs text-muted-foreground">
                      {ITEM_TYPE_LABEL[item.itemType]}
                    </span>
                  </span>
                  <button
                    type="button"
                    onClick={(event) => handleStarClick(item, event)}
                    disabled={!isInteractiveStar}
                    aria-pressed={item.isFavorite}
                    aria-label={
                      isInteractiveStar
                        ? item.isFavorite
                          ? `Remove ${item.title} from favorites`
                          : `Add ${item.title} to favorites`
                        : item.isFavorite
                          ? `${item.title} is a favorite`
                          : `${item.title} is not a favorite`
                    }
                    title={item.isFavorite ? 'Favorite' : 'Not a favorite'}
                    className={cn(
                      'shrink-0 rounded p-1',
                      isInteractiveStar ? 'cursor-pointer' : 'cursor-default',
                    )}
                  >
                    <Star
                      className={cn(
                        'size-4',
                        item.isFavorite
                          ? 'fill-amber-400 text-amber-400'
                          : 'text-muted-foreground/50',
                      )}
                    />
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

export default ItemList;
