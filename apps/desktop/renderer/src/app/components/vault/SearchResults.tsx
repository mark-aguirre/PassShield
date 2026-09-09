'use client';

import { useMemo, useState } from 'react';
import type { ItemSort, ItemType } from '@PassShield/contracts';
import {
  ChevronLeft,
  ChevronRight,
  LayoutGrid,
  List,
  ListFilter,
} from 'lucide-react';

import { ItemIcon } from '@/app/components/vault/ItemIcon';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { cn } from '@/lib/utils';
import { useCategories } from '@/hooks/useCategories';
import { useItemList, useItemSearch } from '@/hooks/useItems';

/** Props for {@link SearchResults}. */
export interface SearchResultsProps {
  /** The current search query. Empty/whitespace falls back to the full list. _(Req 6.3)_ */
  query: string;
  /** Invoked when the user opens a result. Receives the item id. */
  onOpenItem: (id: string) => void;
}

/** Sort options. Relevance is the default for search. _(Req 17.2)_ */
const SORT_OPTIONS: ReadonlyArray<{ value: ItemSort; label: string }> = [
  { value: 'relevance', label: 'Relevance' },
  { value: 'titleAsc', label: 'Title (A-Z)' },
];

type ViewMode = 'list' | 'grid';

const PAGE_SIZE = 20;

const ITEM_TYPE_LABEL: Record<ItemType, string> = {
  login: 'Login',
  note: 'Secure Note',
};

/** Format an ISO 8601 timestamp as a short, locale-aware date. */
function formatUpdated(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    return '—';
  }
  return date.toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

/**
 * Full-content search results view: a header (title, result count, sort
 * control, list/grid toggle), category filter chips, and a paginated,
 * metadata-only set of results.
 *
 * Results are fetched via {@link useItemSearch} (non-empty query) or
 * {@link useItemList} (empty query). Categories come from {@link useCategories}.
 * _(Req 6.1, 6.2, 6.3, 6.4, 17.2, 17.3, 17.4)_
 */
export function SearchResults({ query, onOpenItem }: SearchResultsProps) {
  const [sort, setSort] = useState<ItemSort>('relevance');
  const [viewMode, setViewMode] = useState<ViewMode>('list');
  const [activeCategoryId, setActiveCategoryId] = useState<string | null>(null);
  const [page, setPage] = useState(0);

  const trimmedQuery = query.trim();
  const isEmptyQuery = trimmedQuery.length === 0;

  // Categories (for filter chips and badge labels).
  const { data: categories = [] } = useCategories();

  // Results: search when we have a query, fall back to full list when empty.
  const searchQuery = useItemSearch(trimmedQuery, sort);
  const listQuery = useItemList(undefined, sort === 'relevance' ? 'titleAsc' : sort);

  const activeQuery = isEmptyQuery ? listQuery : searchQuery;
  const allResults = activeQuery.data ?? [];
  const isLoading = activeQuery.isPending;
  const isError = activeQuery.isError;

  const categoryNameById = useMemo(() => {
    const map = new Map<string, string>();
    for (const category of categories) {
      map.set(category.id, category.name);
    }
    return map;
  }, [categories]);

  const filteredResults = useMemo(() => {
    if (activeCategoryId === null) return allResults;
    return allResults.filter((item) => item.categoryId === activeCategoryId);
  }, [allResults, activeCategoryId]);

  const total = filteredResults.length;
  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const clampedPage = Math.min(page, pageCount - 1);
  const pageStart = clampedPage * PAGE_SIZE;
  const pageItems = filteredResults.slice(pageStart, pageStart + PAGE_SIZE);
  const shownCount = pageItems.length;

  const resultLabel = isEmptyQuery
    ? `${total} items in your vault`
    : `${total} items found for "${trimmedQuery}"`;

  // Reset to page 0 whenever the query, sort, or category filter changes.
  const stableKey = `${trimmedQuery}|${sort}|${activeCategoryId ?? ''}`;

  function categoryBadge(item: (typeof allResults)[number]) {
    if (item.categoryId === null) return null;
    const name = categoryNameById.get(item.categoryId);
    if (name === undefined) return null;
    return <Badge>{name}</Badge>;
  }

  function renderResultRow(item: (typeof allResults)[number]) {
    return (
      <div className="flex items-center gap-4 rounded-xl border border-border bg-card p-4 shadow-sm transition-colors hover:border-primary/40">
        <ItemIcon title={item.title} itemType={item.itemType} className="size-11" glyphSize={20} />
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <span className="truncate text-sm font-semibold text-foreground">{item.title}</span>
          <span className="truncate text-xs text-muted-foreground">
            {ITEM_TYPE_LABEL[item.itemType]}
          </span>
          <div className="mt-0.5">{categoryBadge(item)}</div>
        </div>
        <div className="hidden shrink-0 flex-col items-end text-xs text-muted-foreground sm:flex">
          <span>Updated</span>
          <span>{formatUpdated(item.updatedAt)}</span>
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => onOpenItem(item.id)}
          aria-label={`Open ${item.title}`}
        >
          Open
        </Button>
      </div>
    );
  }

  function renderResultCard(item: (typeof allResults)[number]) {
    return (
      <div className="flex flex-col gap-3 rounded-xl border border-border bg-card p-4 shadow-sm transition-colors hover:border-primary/40">
        <div className="flex items-center gap-3">
          <ItemIcon title={item.title} itemType={item.itemType} className="size-10" glyphSize={20} />
          <div className="flex min-w-0 flex-col">
            <span className="truncate text-sm font-semibold text-foreground">{item.title}</span>
            <span className="truncate text-xs text-muted-foreground">
              {ITEM_TYPE_LABEL[item.itemType]}
            </span>
          </div>
        </div>
        {categoryBadge(item)}
        <div className="flex items-center justify-between">
          <span className="text-xs text-muted-foreground">
            Updated {formatUpdated(item.updatedAt)}
          </span>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => onOpenItem(item.id)}
            aria-label={`Open ${item.title}`}
          >
            Open
          </Button>
        </div>
      </div>
    );
  }

  return (
    <section
      className="flex h-full min-w-0 flex-col bg-background"
      aria-label="Search results"
      // key forces a page reset when the filter params change
      key={stableKey}
    >
      <header className="flex flex-wrap items-start justify-between gap-3 p-6 pb-4">
        <div className="flex flex-col">
          <h2 className="text-2xl font-bold text-foreground">Search Results</h2>
          <span className="text-sm text-muted-foreground">{resultLabel}</span>
        </div>

        <div className="flex items-center gap-2">
          <Select value={sort} onValueChange={(value) => setSort(value as ItemSort)}>
            <SelectTrigger size="sm" className="gap-1.5">
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

          <Button type="button" variant="outline" size="icon" aria-label="Filter">
            <ListFilter className="size-4" />
          </Button>

          <div
            className="flex overflow-hidden rounded-md border border-border"
            role="group"
            aria-label="View mode"
          >
            <button
              type="button"
              onClick={() => setViewMode('list')}
              aria-pressed={viewMode === 'list'}
              title="List view"
              className={cn(
                'flex size-8 items-center justify-center',
                viewMode === 'list'
                  ? 'bg-primary text-primary-foreground'
                  : 'text-muted-foreground hover:bg-accent',
              )}
            >
              <List className="size-4" />
            </button>
            <button
              type="button"
              onClick={() => setViewMode('grid')}
              aria-pressed={viewMode === 'grid'}
              title="Grid view"
              className={cn(
                'flex size-8 items-center justify-center',
                viewMode === 'grid'
                  ? 'bg-primary text-primary-foreground'
                  : 'text-muted-foreground hover:bg-accent',
              )}
            >
              <LayoutGrid className="size-4" />
            </button>
          </div>
        </div>
      </header>

      {categories.length > 0 && (
        <div
          className="flex flex-wrap gap-2 px-6 pb-4"
          role="group"
          aria-label="Filter by category"
        >
          <FilterChip active={activeCategoryId === null} onClick={() => setActiveCategoryId(null)}>
            All
          </FilterChip>
          {categories.map((category) => (
            <FilterChip
              key={category.id}
              active={activeCategoryId === category.id}
              onClick={() => setActiveCategoryId(category.id)}
            >
              {category.name}
            </FilterChip>
          ))}
        </div>
      )}

      {isError && (
        <p role="alert" className="px-6 py-2 text-sm text-destructive">
          Unable to load search results.
        </p>
      )}

      <div className="min-h-0 flex-1 overflow-y-auto px-6">
        {isLoading && allResults.length === 0 ? (
          <p className="py-4 text-sm text-muted-foreground">Searching...</p>
        ) : total === 0 ? (
          <p className="py-4 text-sm text-muted-foreground">No results to show.</p>
        ) : viewMode === 'grid' ? (
          <div
            className="grid grid-cols-[repeat(auto-fill,minmax(240px,1fr))] gap-3"
            role="list"
          >
            {pageItems.map((item) => (
              <div key={item.id} role="listitem">
                {renderResultCard(item)}
              </div>
            ))}
          </div>
        ) : (
          <ul className="flex flex-col gap-2" role="list">
            {pageItems.map((item) => (
              <li key={item.id}>{renderResultRow(item)}</li>
            ))}
          </ul>
        )}
      </div>

      {total > 0 && (
        <footer className="flex flex-wrap items-center justify-between gap-3 border-t border-border p-4">
          <span className="text-sm text-muted-foreground">
            Showing {shownCount} of {total} results
          </span>
          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="outline"
              size="icon"
              onClick={() => setPage((current) => Math.max(0, current - 1))}
              disabled={clampedPage === 0}
              aria-label="Previous page"
            >
              <ChevronLeft className="size-4" />
            </Button>
            <span className="min-w-8 text-center text-sm font-medium text-foreground">
              {clampedPage + 1}
            </span>
            <Button
              type="button"
              variant="outline"
              size="icon"
              onClick={() => setPage((current) => Math.min(pageCount - 1, current + 1))}
              disabled={clampedPage >= pageCount - 1}
              aria-label="Next page"
            >
              <ChevronRight className="size-4" />
            </Button>
          </div>
        </footer>
      )}
    </section>
  );
}

export default SearchResults;

/** A pill-shaped category filter chip. */
function FilterChip({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        'rounded-full border px-3 py-1 text-xs font-medium transition-colors',
        active
          ? 'border-primary bg-primary text-primary-foreground'
          : 'border-border bg-card text-muted-foreground hover:bg-accent',
      )}
    >
      {children}
    </button>
  );
}
