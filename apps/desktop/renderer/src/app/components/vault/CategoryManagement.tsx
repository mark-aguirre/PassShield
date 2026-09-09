'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import type { CategoryWithCount, SaveCategoryInput } from '@passshield/contracts';
import {
  Briefcase,
  Code2,
  CreditCard,
  Folder,
  Info,
  LayoutGrid,
  List,
  Pencil,
  Plane,
  Plus,
  ShoppingCart,
  Trash2,
  User,
  type LucideIcon,
} from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { cn } from '@/lib/utils';
import { useCategories, useDeleteCategory, useSaveCategory } from '@/hooks/useCategories';

/**
 * Props for {@link CategoryManagement}.
 *
 * Renders Screen 6 (Category Management) as a full-width content view:
 * create/edit/delete categories with names, descriptions, icons, and colors,
 * showing each category's active item count. Talks to the vault only through
 * the narrow `window.passShield.categories.*` IPC surface and never touches
 * secrets. _(Req 7.1, 7.2, 7.3, 21.1-21.4)_
 */
export interface CategoryManagementProps {
  /** Called after a successful save or delete so parents can refresh counts. */
  onChanged?: () => void;
}

/** Sortable dimensions exposed by the header. _(Req 21.4)_ */
type CategorySort = 'nameAsc' | 'nameDesc' | 'itemCountDesc' | 'itemCountAsc';

/** View presentation for the category collection. _(Req 21.4)_ */
type CategoryView = 'list' | 'grid';

const SORT_OPTIONS: ReadonlyArray<{ value: CategorySort; label: string }> = [
  { value: 'nameAsc', label: 'Name (A-Z)' },
  { value: 'nameDesc', label: 'Name (Z-A)' },
  { value: 'itemCountDesc', label: 'Items (most first)' },
  { value: 'itemCountAsc', label: 'Items (fewest first)' },
];

/**
 * Named icon options offered in the editor, each mapped to a lucide glyph so
 * categories render the crisp colored tiles shown in the mockup rather than
 * emoji. The stored value is the key; unknown/legacy values fall back to a
 * folder glyph. _(Req 21.2)_
 */
const ICON_LIBRARY: Record<string, LucideIcon> = {
  code: Code2,
  user: User,
  briefcase: Briefcase,
  card: CreditCard,
  cart: ShoppingCart,
  plane: Plane,
  folder: Folder,
  grid: LayoutGrid,
};

const ICON_OPTIONS: ReadonlyArray<{ value: string; label: string }> = [
  { value: 'folder', label: 'Folder' },
  { value: 'code', label: 'Code' },
  { value: 'user', label: 'Person' },
  { value: 'briefcase', label: 'Briefcase' },
  { value: 'card', label: 'Card' },
  { value: 'cart', label: 'Shopping' },
  { value: 'plane', label: 'Travel' },
  { value: 'grid', label: 'Grid' },
];

const DEFAULT_COLOR = '#2563eb';

/** Resolve a stored icon key to a lucide component, defaulting to Folder. */
function iconFor(key: string | null): LucideIcon {
  if (key && key in ICON_LIBRARY) {
    return ICON_LIBRARY[key];
  }
  return Folder;
}

/** Editing state: creating a new category or editing an existing one. */
interface EditorState {
  id?: string;
  name: string;
  description: string;
  icon: string;
  color: string;
}

const EMPTY_EDITOR: EditorState = {
  id: undefined,
  name: '',
  description: '',
  icon: ICON_OPTIONS[0].value,
  color: DEFAULT_COLOR,
};

function editorFromCategory(category: CategoryWithCount): EditorState {
  return {
    id: category.id,
    name: category.name,
    description: category.description ?? '',
    icon: category.icon ?? ICON_OPTIONS[0].value,
    color: category.color ?? DEFAULT_COLOR,
  };
}

/**
 * Full-width category management surface (Screen 6): a page header with an
 * "Add Category" action, a toolbar (search, count, sort, list/grid toggle), a
 * table/grid of categories with item counts and edit/delete actions, an inline
 * create/edit form, and an informational banner. _(Req 7.1, 7.2, 7.3, 21.1-21.4)_
 *
 * TanStack Query invalidation handles refreshing item/category counts after
 * mutations — no explicit `onChanged` callback is needed.
 */
export function CategoryManagement() {
  const { data: categories = [], isPending: isLoading, isError } = useCategories();
  const saveCategory = useSaveCategory();
  const deleteCategory = useDeleteCategory();

  const [query, setQuery] = useState('');
  const [sort, setSort] = useState<CategorySort>('nameAsc');
  const [view, setView] = useState<CategoryView>('list');

  const [editor, setEditor] = useState<EditorState | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const visibleCategories = useMemo(() => {
    const trimmed = query.trim().toLowerCase();
    const filtered = trimmed
      ? categories.filter((category) => category.name.toLowerCase().includes(trimmed))
      : categories.slice();

    filtered.sort((a, b) => {
      switch (sort) {
        case 'nameDesc':
          return b.name.localeCompare(a.name);
        case 'itemCountDesc':
          return b.itemCount - a.itemCount || a.name.localeCompare(b.name);
        case 'itemCountAsc':
          return a.itemCount - b.itemCount || a.name.localeCompare(b.name);
        case 'nameAsc':
        default:
          return a.name.localeCompare(b.name);
      }
    });
    return filtered;
  }, [categories, query, sort]);

  function openCreate() {
    setFormError(null);
    setEditor({ ...EMPTY_EDITOR });
  }

  function openEdit(category: CategoryWithCount) {
    setFormError(null);
    setEditor(editorFromCategory(category));
  }

  function closeEditor() {
    setEditor(null);
    setFormError(null);
  }

  async function handleSave(event: React.FormEvent) {
    event.preventDefault();
    if (editor === null) return;

    const name = editor.name.trim();
    if (name.length === 0) {
      setFormError('Name is required.');
      return;
    }

    const input: SaveCategoryInput = {
      id: editor.id,
      name,
      description: editor.description.trim() === '' ? null : editor.description.trim(),
      icon: editor.icon.trim() === '' ? null : editor.icon.trim(),
      color: editor.color.trim() === '' ? null : editor.color.trim(),
    };

    setFormError(null);
    try {
      await saveCategory.mutateAsync(input);
      closeEditor();
    } catch (error) {
      setFormError(error instanceof Error ? error.message : 'Unable to save category.');
    }
  }

  async function handleDelete(category: CategoryWithCount) {
    const itemNote =
      category.itemCount > 0
        ? ` Its ${category.itemCount} item${category.itemCount === 1 ? '' : 's'} will become uncategorized.`
        : '';
    const confirmed = window.confirm(`Delete the category "${category.name}"?${itemNote}`);
    if (!confirmed) return;

    setDeleteError(null);
    try {
      await deleteCategory.mutateAsync(category.id);
      if (editor?.id === category.id) closeEditor();
    } catch (error) {
      setDeleteError(error instanceof Error ? error.message : 'Unable to delete category.');
    }
  }

  return (
    <section className="flex h-full min-w-0 flex-col overflow-y-auto bg-background" aria-label="Categories">
      {/* Page header. */}
      <div className="flex items-start justify-between gap-4 px-8 pt-8 pb-4">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Categories</h1>
          <p className="mt-1 text-sm text-muted-foreground">Organize your items with categories.</p>
        </div>
        <Button type="button" onClick={openCreate}>
          <Plus className="size-4" />
          Add Category
        </Button>
      </div>

      {/* Toolbar: search, count, sort, view toggle. */}
      <div className="flex flex-wrap items-center justify-between gap-3 px-8 pb-4">
        <div className="relative w-full max-w-xs">
          <Input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search categories..."
            aria-label="Search categories"
          />
        </div>
        <div className="flex items-center gap-3">
          <span className="text-sm text-muted-foreground">
            {categories.length} {categories.length === 1 ? 'Category' : 'Categories'}
          </span>
          <Select value={sort} onValueChange={(value) => setSort(value as CategorySort)}>
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
          <div className="flex overflow-hidden rounded-md border border-border" role="group" aria-label="View">
            <button
              type="button"
              onClick={() => setView('list')}
              aria-pressed={view === 'list'}
              title="List view"
              className={cn(
                'flex size-8 items-center justify-center',
                view === 'list' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-accent',
              )}
            >
              <List className="size-4" />
            </button>
            <button
              type="button"
              onClick={() => setView('grid')}
              aria-pressed={view === 'grid'}
              title="Grid view"
              className={cn(
                'flex size-8 items-center justify-center',
                view === 'grid' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-accent',
              )}
            >
              <LayoutGrid className="size-4" />
            </button>
          </div>
        </div>
      </div>

      {/* Inline create/edit form. */}
      {editor !== null && (
        <form
          className="mx-8 mb-4 flex flex-col gap-4 rounded-xl border border-border bg-card p-5 shadow-sm"
          onSubmit={handleSave}
          aria-label={editor.id ? 'Edit category' : 'Add category'}
        >
          <div className="grid grid-cols-1 gap-4 md:grid-cols-[1fr_auto_auto]">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="category-name">Name *</Label>
              <Input
                id="category-name"
                type="text"
                value={editor.name}
                onChange={(event) => setEditor({ ...editor, name: event.target.value })}
                autoFocus
                required
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="category-icon">Icon</Label>
              <Select
                value={editor.icon}
                onValueChange={(value) => setEditor({ ...editor, icon: value })}
              >
                <SelectTrigger id="category-icon" className="min-w-36">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {ICON_OPTIONS.map((option) => {
                    const Icon = iconFor(option.value);
                    return (
                      <SelectItem key={option.value} value={option.value}>
                        <Icon className="size-4" />
                        {option.label}
                      </SelectItem>
                    );
                  })}
                </SelectContent>
              </Select>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="category-color">Color</Label>
              <input
                id="category-color"
                type="color"
                value={editor.color}
                onChange={(event) => setEditor({ ...editor, color: event.target.value })}
                aria-label="Category color"
                className="h-9 w-14 cursor-pointer rounded-md border border-input bg-card p-0.5"
              />
            </div>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="category-description">Description</Label>
            <Input
              id="category-description"
              type="text"
              placeholder="What kind of items belong here?"
              value={editor.description}
              onChange={(event) => setEditor({ ...editor, description: event.target.value })}
            />
          </div>

          {formError && (
            <p role="alert" className="text-sm text-destructive">
              {formError}
            </p>
          )}

          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={closeEditor} disabled={saveCategory.isPending}>
              Cancel
            </Button>
            <Button type="submit" disabled={saveCategory.isPending}>
              {saveCategory.isPending ? 'Saving...' : editor.id ? 'Save Changes' : 'Create Category'}
            </Button>
          </div>
        </form>
      )}

      {deleteError && (
        <p role="alert" className="mx-8 mb-2 text-sm text-destructive">
          {deleteError}
        </p>
      )}

      {/* Category collection. */}
      <div className="flex-1 px-8">
        {isLoading && categories.length === 0 ? (
          <p className="py-4 text-sm text-muted-foreground">Loading...</p>
        ) : visibleCategories.length === 0 ? (
          <p className="py-4 text-sm text-muted-foreground">
            {categories.length === 0 ? 'No categories yet.' : 'No categories match your search.'}
          </p>
        ) : view === 'grid' ? (
          <ul
            className="grid grid-cols-[repeat(auto-fill,minmax(240px,1fr))] gap-3"
            role="list"
          >
            {visibleCategories.map((category) => {
              const Icon = iconFor(category.icon);
              const color = category.color ?? DEFAULT_COLOR;
              return (
                <li
                  key={category.id}
                  className="group flex flex-col gap-3 rounded-xl border border-border bg-card p-4 shadow-sm"
                >
                  <div className="flex items-center justify-between">
                    <span
                      className="flex size-10 items-center justify-center rounded-lg text-white"
                      style={{ backgroundColor: color }}
                      aria-hidden
                    >
                      <Icon className="size-5" />
                    </span>
                    <span className="text-sm text-muted-foreground">
                      {category.itemCount} {category.itemCount === 1 ? 'item' : 'items'}
                    </span>
                  </div>
                  <div className="flex min-w-0 flex-col">
                    <span className="truncate text-sm font-semibold text-foreground">
                      {category.name}
                    </span>
                    {category.description && (
                      <span className="truncate text-xs text-muted-foreground">
                        {category.description}
                      </span>
                    )}
                  </div>
                  <div className="flex justify-end gap-1">
                    <RowAction kind="edit" label={`Edit ${category.name}`} onClick={() => openEdit(category)} />
                    <RowAction kind="delete" label={`Delete ${category.name}`} onClick={() => handleDelete(category)} />
                  </div>
                </li>
              );
            })}
          </ul>
        ) : (
          <div className="overflow-hidden rounded-xl border border-border bg-card shadow-sm">
            {/* Column headers */}
            <div className="grid grid-cols-[1fr_100px_120px] items-center gap-4 border-b border-border px-5 py-3 text-xs font-medium text-muted-foreground">
              <span>Name</span>
              <span className="text-center">Items</span>
              <span className="text-center">Actions</span>
            </div>
            <ul role="list">
              {visibleCategories.map((category, index) => {
                const Icon = iconFor(category.icon);
                const color = category.color ?? DEFAULT_COLOR;
                return (
                  <li
                    key={category.id}
                    className={cn(
                      'grid grid-cols-[1fr_100px_120px] items-center gap-4 px-5 py-3 transition-colors hover:bg-muted/50',
                      index !== visibleCategories.length - 1 && 'border-b border-border',
                    )}
                  >
                    <div className="flex min-w-0 items-center gap-3">
                      <span
                        className="flex size-10 shrink-0 items-center justify-center rounded-lg text-white"
                        style={{ backgroundColor: color }}
                        aria-hidden
                      >
                        <Icon className="size-5" />
                      </span>
                      <span className="flex min-w-0 items-baseline gap-2">
                        <span className="shrink-0 text-sm font-semibold text-foreground">
                          {category.name}
                        </span>
                        {category.description && (
                          <span className="truncate text-sm text-muted-foreground">
                            {category.description}
                          </span>
                        )}
                      </span>
                    </div>
                    <span className="text-center text-sm text-foreground">{category.itemCount}</span>
                    <span className="flex justify-center gap-1.5">
                      <RowAction kind="edit" label={`Edit ${category.name}`} onClick={() => openEdit(category)} />
                      <RowAction kind="delete" label={`Delete ${category.name}`} onClick={() => handleDelete(category)} />
                    </span>
                  </li>
                );
              })}
            </ul>
          </div>
        )}
      </div>

      {/* Informational banner. */}
      <div className="mx-8 my-6 flex items-start gap-3 rounded-xl border border-primary/20 bg-primary/5 p-4">
        <Info className="mt-0.5 size-5 shrink-0 text-primary" />
        <div className="flex flex-col">
          <span className="text-sm font-medium text-foreground">
            Categories help you keep your vault organized.
          </span>
          <span className="text-sm text-muted-foreground">
            You can assign or change categories while creating or editing items.
          </span>
        </div>
      </div>
    </section>
  );
}

export default CategoryManagement;

/** An edit or delete icon button used in both list rows and grid cards. */
function RowAction({
  kind,
  label,
  onClick,
}: {
  kind: 'edit' | 'delete';
  label: string;
  onClick: () => void;
}) {
  const isDelete = kind === 'delete';
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={isDelete ? 'Delete' : 'Edit'}
      className={cn(
        'flex size-8 items-center justify-center rounded-md border border-border transition-colors',
        isDelete
          ? 'text-destructive hover:bg-destructive/10'
          : 'text-muted-foreground hover:bg-accent hover:text-foreground',
      )}
    >
      {isDelete ? <Trash2 className="size-4" /> : <Pencil className="size-4" />}
    </button>
  );
}
