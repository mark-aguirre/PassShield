'use client';

import type { ItemType } from '@passshield/contracts';
import { Star } from 'lucide-react';

import { cn } from '@/lib/utils';
import { ItemIcon } from '@/app/components/vault/ItemIcon';
import { useItemList } from '@/hooks/useItems';

/**
 * Props for {@link FavoritesView}.
 *
 * Renders the favorites surface required by Req 7.4: a list of items the user
 * has flagged as favorites, showing only non-secret metadata from
 * {@link ItemSummary}. _(Req 7.4)_
 */
export interface FavoritesViewProps {
  /** Currently selected item id, used to highlight the active row. */
  selectedItemId?: string | null;
  /** Invoked when the user opens a favorite item. */
  onOpenItem: (id: string) => void;
}

/** Simple, non-secret subtitle derived from the item type. _(Req 7.4)_ */
const ITEM_TYPE_LABEL: Record<ItemType, string> = {
  login: 'Login',
  note: 'Secure Note',
};

/**
 * Favorites list: fetches favorite items via {@link useItemList} and renders
 * each as a metadata-only row (icon, title, type subtitle). No secret values
 * are shown. _(Req 7.4)_
 */
export function FavoritesView({ selectedItemId = null, onOpenItem }: FavoritesViewProps) {
  const { data: items = [], isPending, isError } = useItemList({ scope: 'favorites' });

  return (
    <section className="flex h-full min-w-0 flex-col bg-card" aria-label="Favorites">
      <header className="flex items-center justify-between gap-3 px-4 py-3">
        <div className="flex min-w-0 flex-col">
          <h2 className="text-lg font-semibold text-foreground">Favorites</h2>
          <span className="text-xs text-muted-foreground">{items.length} items</span>
        </div>
      </header>

      {isError && (
        <p role="alert" className="px-4 py-2 text-sm text-destructive">
          Unable to load favorites.
        </p>
      )}

      {isPending && items.length === 0 ? (
        <p className="p-4 text-sm text-muted-foreground">Loading...</p>
      ) : items.length === 0 ? (
        <p className="p-4 text-sm text-muted-foreground">No favorites yet.</p>
      ) : (
        <ul className="flex-1 space-y-1 overflow-y-auto px-2 pb-2" role="list">
          {items.map((item) => {
            const isSelected = item.id === selectedItemId;
            return (
              <li key={item.id}>
                <div
                  role="button"
                  tabIndex={0}
                  aria-current={isSelected}
                  onClick={() => onOpenItem(item.id)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' || event.key === ' ') {
                      event.preventDefault();
                      onOpenItem(item.id);
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
                  <Star className="size-4 shrink-0 fill-amber-400 text-amber-400" aria-hidden />
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

export default FavoritesView;
