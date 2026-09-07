'use client';

/**
 * Item detail pane (Screen 1, right pane) for the three-pane vault dashboard.
 *
 * Given a selected item id, this pane fetches the fully decrypted item through
 * the narrow `window.passShield.items.get` IPC surface and renders its fields.
 * It is the only place secret values surface, and only for the explicitly
 * selected item.
 *
 * Security posture (Req 9):
 *   - Passwords render *concealed* (dots) by default; plaintext is shown only
 *     after an explicit user reveal action, and only for the current item.
 *     _(Req 9.1, 9.2)_
 *   - Copy actions route secret values through the main process
 *     (`clipboard.copySecret`) so the clear timer is enforced there, not in the
 *     renderer. _(Req 9.3, 9.4)_
 *   - When the id prop changes we re-fetch and reset the reveal toggle, so a
 *     revealed value never leaks across item selections.
 *
 * _(Req 9.1, 9.2)_
 */

import { useEffect, useState } from 'react';
import type {
  CategoryWithCount,
  ItemDetail as ItemDetailData,
  ItemSummary,
  LoginPayload,
  NotePayload,
} from '@passshield/contracts';
import {
  Check,
  ChevronRight,
  Copy,
  Download,
  Eye,
  EyeOff,
  FileText,
  KeyRound,
  MoreHorizontal,
  Paperclip,
  Pencil,
  Plus,
  SquareArrowOutUpRight,
  Star,
  X,
} from 'lucide-react';

import { Markdown } from '@/app/components/Markdown';
import { attachmentToDataUrl, formatBytes } from '@/lib/attachment';
import { ItemIcon } from '@/app/components/vault/ItemIcon';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import { cn } from '@/lib/utils';

/**
 * A category resolved to its display fields. The item record only stores a
 * `categoryId`; this pane resolves it to the human-readable name (and color)
 * via the category list so it never surfaces a raw id. `null` means the item
 * is uncategorized or its category could not be resolved.
 */
type ResolvedCategory = { name: string; color: string | null } | null;

/** Props for {@link ItemDetail}. */
export interface ItemDetailProps {
  /** The id of the item to display, or `null` for the empty state. */
  itemId: string | null;
  /** Invoked when the user chooses to edit the current item. */
  onEdit?: (id: string) => void;
  /**
   * Invoked to open another item in the detail pane, e.g. when a sub-page is
   * clicked in the "Sub-pages" section.
   */
  onOpenItem?: (id: string) => void;
  /**
   * Invoked to create a new sub-page under the given parent id. When provided,
   * a secure note shows an "Add sub-page" action and its list of sub-pages.
   */
  onAddSubPage?: (parentId: string) => void;
  /**
   * External change signal. Bumped by the parent after create/edit/trash so the
   * sub-pages list re-fetches without unmounting the pane.
   */
  refreshToken?: number;
  /** Invoked when the user closes the detail pane (the `X` control). */
  onClose?: () => void;
}

/** Transient load state for the fetched item detail. */
type LoadState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; item: ItemDetailData };

/** Concealed rendering used for password fields before an explicit reveal. */
const CONCEALED_PASSWORD = '•'.repeat(12);

/** Friendly, non-secret messages for the failure codes `items.get` can return. */
const ERROR_MESSAGES: Record<string, string> = {
  locked: 'Your vault is locked. Unlock it to view this item.',
  not_found: 'This item could not be found. It may have been deleted.',
};

const GENERIC_ERROR_MESSAGE = 'Unable to load this item.';

/**
 * Right-hand detail pane that displays a single decrypted vault item.
 */
export function ItemDetail({
  itemId,
  onEdit,
  onOpenItem,
  onAddSubPage,
  refreshToken,
  onClose,
}: ItemDetailProps) {
  const [load, setLoad] = useState<LoadState>({ status: 'idle' });
  const [passwordRevealed, setPasswordRevealed] = useState(false);
  // Direct sub-pages of the current item (note items only). Metadata only.
  const [children, setChildren] = useState<ItemSummary[]>([]);
  // Category id -> {name, color} so we can show the friendly name, not the id.
  const [categoriesById, setCategoriesById] = useState<
    Map<string, CategoryWithCount>
  >(new Map());

  // Load the category list once so a stored categoryId can be resolved to its
  // display name and color. Non-critical: failure just falls back to showing
  // "Uncategorized". _(Req 7.x)_
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const list = await window.passShield.categories.list();
        if (!cancelled) {
          setCategoriesById(new Map(list.map((category) => [category.id, category])));
        }
      } catch {
        // Leave the map empty; categories render as "Uncategorized".
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    setPasswordRevealed(false);

    if (itemId === null) {
      setLoad({ status: 'idle' });
      return;
    }

    let cancelled = false;
    setLoad({ status: 'loading' });

    (async () => {
      try {
        const result = await window.passShield.items.get(itemId);
        if (cancelled) {
          return;
        }
        if (result.ok) {
          setLoad({ status: 'ready', item: result.value });
        } else {
          setLoad({
            status: 'error',
            message: ERROR_MESSAGES[result.error.code] ?? GENERIC_ERROR_MESSAGE,
          });
        }
      } catch {
        if (!cancelled) {
          setLoad({ status: 'error', message: GENERIC_ERROR_MESSAGE });
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [itemId]);

  // Load the current item's direct sub-pages. Re-fetches when the selected
  // item changes or the parent signals a mutation via `refreshToken`. Failure
  // is non-fatal: the section simply renders no children.
  useEffect(() => {
    if (itemId === null) {
      setChildren([]);
      return;
    }

    let cancelled = false;
    void (async () => {
      try {
        const list = await window.passShield.items.listChildren(itemId);
        if (!cancelled) {
          setChildren(list);
        }
      } catch {
        if (!cancelled) {
          setChildren([]);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [itemId, refreshToken]);

  if (itemId === null || load.status === 'idle') {
    return <EmptyState />;
  }

  if (load.status === 'loading') {
    return (
      <section className="flex h-full items-center justify-center p-8" aria-busy="true">
        <p className="text-sm text-muted-foreground">Loading...</p>
      </section>
    );
  }

  if (load.status === 'error') {
    return (
      <section className="flex h-full flex-col gap-4 p-6">
        <div className="flex items-center justify-between">
          <span className="text-lg font-semibold text-foreground">Item</span>
          <CloseButton onClose={onClose} />
        </div>
        <p role="alert" className="text-sm text-destructive">
          {load.message}
        </p>
      </section>
    );
  }

  const { item } = load;
  // Resolve the stored category id to its display name + color.
  const resolvedCategory: ResolvedCategory = item.categoryId
    ? (() => {
        const category = categoriesById.get(item.categoryId);
        return category ? { name: category.name, color: category.color } : null;
      })()
    : null;

  return (
    <section className="flex h-full flex-col overflow-y-auto" aria-label="Item detail">
      <div className="flex items-start justify-between gap-4 p-6 pb-4">
        <div className="flex min-w-0 items-center gap-4">
          <ItemIcon
            title={item.title}
            itemType={item.itemType}
            className="size-14 rounded-2xl"
            glyphSize={24}
          />
          <div className="flex min-w-0 flex-col gap-1">
            <div className="flex items-center gap-2">
              <h2 className="truncate text-2xl font-bold text-foreground">{item.title}</h2>
              {item.isFavorite && (
                <Star className="size-5 shrink-0 fill-amber-400 text-amber-400" />
              )}
            </div>
            <p className="text-sm text-muted-foreground">
              {item.itemType === 'login' ? 'Login' : 'Secure Note'}
              {resolvedCategory && (
                <>
                  {' • '}
                  <span className="font-medium text-primary">{resolvedCategory.name}</span>
                </>
              )}
            </p>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Button type="button" variant="outline" size="sm" onClick={() => onEdit?.(item.id)}>
            <Pencil className="size-3.5" />
            Edit
          </Button>
          <Button type="button" variant="outline" size="icon" aria-label="More actions">
            <MoreHorizontal className="size-4" />
          </Button>
          <CloseButton onClose={onClose} />
        </div>
      </div>

      <Separator />

      <div className="flex flex-col gap-6 p-6">
        {item.itemType === 'login' ? (
          <LoginFields
            payload={item.payload}
            category={resolvedCategory}
            passwordRevealed={passwordRevealed}
            onToggleReveal={() => setPasswordRevealed((prev) => !prev)}
          />
        ) : (
          <NoteFields payload={item.payload} category={resolvedCategory} />
        )}

        {item.itemType === 'note' && (
          <SubPagesSection
            parentId={item.id}
            children={children}
            onOpenItem={onOpenItem}
            onAddSubPage={onAddSubPage}
          />
        )}
      </div>

      <div className="mt-auto grid grid-cols-2 gap-4 border-t border-border p-6">
        <TimestampBlock label="Created" iso={item.createdAt} />
        <TimestampBlock label="Updated" iso={item.updatedAt} />
      </div>
    </section>
  );
}

export default ItemDetail;

/** Field block for a login item. */
function LoginFields({
  payload,
  category,
  passwordRevealed,
  onToggleReveal,
}: {
  payload: LoginPayload;
  category: ResolvedCategory;
  passwordRevealed: boolean;
  onToggleReveal: () => void;
}) {
  return (
    <>
      <Field label="Username">
        <div className="flex items-center justify-between gap-3">
          <span className="truncate text-sm text-foreground">{payload.username || '—'}</span>
          {payload.username && <CopyButton label="Copy username" value={payload.username} />}
        </div>
      </Field>

      <Field label="Password">
        <div className="flex items-center justify-between gap-3">
          <span
            className={cn(
              'truncate text-sm text-foreground',
              !passwordRevealed && 'font-mono tracking-[0.2em]',
            )}
          >
            {passwordRevealed ? payload.password || '—' : CONCEALED_PASSWORD}
          </span>
          <div className="flex shrink-0 items-center gap-1.5">
            <IconToggle
              pressed={passwordRevealed}
              onClick={onToggleReveal}
              label={passwordRevealed ? 'Hide password' : 'Reveal password'}
            >
              {passwordRevealed ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
            </IconToggle>
            {payload.password && <CopyButton label="Copy password" value={payload.password} />}
          </div>
        </div>
      </Field>

      <Field label="Website">
        {payload.website ? (
          <WebsiteLink url={payload.website} />
        ) : (
          <span className="text-sm text-foreground">—</span>
        )}
      </Field>

      <Field label="Category">
        <CategoryValue category={category} />
      </Field>

      <Field label="Notes">
        <div className="rounded-lg bg-muted/60 p-3 text-sm leading-relaxed whitespace-pre-wrap text-foreground">
          {payload.notes || '—'}
        </div>
      </Field>
    </>
  );
}

/** Field block for a secure note item. */
function NoteFields({
  payload,
  category,
}: {
  payload: NotePayload;
  category: ResolvedCategory;
}) {
  const attachments = payload.attachments ?? [];
  return (
    <>
      <Field label="Category">
        <CategoryValue category={category} />
      </Field>
      {payload.subject && (
        <Field label="Subject">
          <div className="rounded-lg bg-muted/60 p-3 text-sm font-medium text-foreground">
            {payload.subject}
          </div>
        </Field>
      )}
      <Field label="Note">
        {payload.content ? (
          <Markdown
            source={payload.content}
            className="rounded-lg bg-muted/60 p-3 text-sm leading-relaxed text-foreground"
          />
        ) : (
          <div className="rounded-lg bg-muted/60 p-3 text-sm leading-relaxed text-foreground">
            —
          </div>
        )}
      </Field>
      {attachments.length > 0 && (
        <Field label="Attachments">
          <ul className="flex flex-col gap-2">
            {attachments.map((attachment, index) => (
              <li
                key={`${attachment.filename}-${index}`}
                className="flex items-center gap-3 rounded-lg border border-border bg-muted/60 px-3 py-2"
              >
                <Paperclip className="size-4 shrink-0 text-muted-foreground" aria-hidden />
                <span className="flex min-w-0 flex-col">
                  <span className="truncate text-sm text-foreground">{attachment.filename}</span>
                  <span className="text-xs text-muted-foreground">
                    {formatBytes(attachment.size)}
                  </span>
                </span>
                <a
                  href={attachmentToDataUrl(attachment)}
                  download={attachment.filename}
                  className="ml-auto inline-flex size-8 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                  aria-label={`Download ${attachment.filename}`}
                >
                  <Download className="size-4" />
                </a>
              </li>
            ))}
          </ul>
        </Field>
      )}
    </>
  );
}

/**
 * "Sub-pages" section shown on a secure note's detail view. Lists the note's
 * direct child pages and offers an "Add sub-page" action. Selecting a sub-page
 * opens it in the same detail pane, so users can navigate arbitrarily deep.
 * _(Req 5.1)_
 */
function SubPagesSection({
  parentId,
  children,
  onOpenItem,
  onAddSubPage,
}: {
  parentId: string;
  children: ItemSummary[];
  onOpenItem?: (id: string) => void;
  onAddSubPage?: (parentId: string) => void;
}) {
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium text-muted-foreground">
          Sub-pages{children.length > 0 ? ` (${children.length})` : ''}
        </span>
        {onAddSubPage && (
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => onAddSubPage(parentId)}
          >
            <Plus className="size-3.5" />
            Add sub-page
          </Button>
        )}
      </div>

      {children.length === 0 ? (
        <p className="rounded-lg bg-muted/60 p-3 text-sm text-muted-foreground">
          No sub-pages yet.
        </p>
      ) : (
        <ul className="flex flex-col gap-1" role="list">
          {children.map((child) => (
            <li key={child.id}>
              <button
                type="button"
                onClick={() => onOpenItem?.(child.id)}
                className="flex w-full items-center gap-3 rounded-lg border border-border bg-muted/40 px-3 py-2 text-left transition-colors hover:bg-accent"
              >
                <FileText className="size-4 shrink-0 text-muted-foreground" aria-hidden />
                <span className="min-w-0 flex-1 truncate text-sm text-foreground">
                  {child.title}
                </span>
                {child.isFavorite && (
                  <Star className="size-3.5 shrink-0 fill-amber-400 text-amber-400" />
                )}
                <ChevronRight className="size-4 shrink-0 text-muted-foreground" aria-hidden />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/**
 * Renders a resolved category as a colored badge, or an "Uncategorized"
 * placeholder. When the category carries a color, the badge is tinted with it;
 * otherwise it falls back to the default primary-tinted badge.
 */
function CategoryValue({ category }: { category: ResolvedCategory }) {
  if (!category) {
    return <span className="text-sm text-muted-foreground">Uncategorized</span>;
  }
  if (category.color) {
    return (
      <span
        className="inline-flex w-fit items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium"
        style={{
          backgroundColor: `${category.color}1a`, // ~10% alpha tint
          color: category.color,
        }}
      >
        <span
          className="size-2 rounded-full"
          style={{ backgroundColor: category.color }}
          aria-hidden
        />
        {category.name}
      </span>
    );
  }
  return <Badge>{category.name}</Badge>;
}

/** A labelled field: a small caption above its value content. */
function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-2">
      <span className="text-xs font-medium text-muted-foreground">{label}</span>
      {children}
    </div>
  );
}

/**
 * Copies a secret value through the main-process clipboard handler, which owns
 * the clipboard-clear timer. Shows a brief acknowledgement. _(Req 9.3, 9.4)_
 */
function CopyButton({ label, value }: { label: string; value: string }) {
  const [copied, setCopied] = useState(false);

  async function handleCopy() {
    try {
      await window.passShield.clipboard.copySecret(value);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      // A failed copy is non-fatal; leave the icon unchanged.
    }
  }

  return (
    <button
      type="button"
      aria-label={label}
      onClick={handleCopy}
      className="flex size-8 items-center justify-center rounded-md border border-border text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
    >
      {copied ? <Check className="size-4 text-success" /> : <Copy className="size-4" />}
    </button>
  );
}

/** A pressable icon button (reveal/hide). */
function IconToggle({
  pressed,
  onClick,
  label,
  children,
}: {
  pressed: boolean;
  onClick: () => void;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-pressed={pressed}
      aria-label={label}
      onClick={onClick}
      className="flex size-8 items-center justify-center rounded-md border border-border text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
    >
      {children}
    </button>
  );
}

/**
 * Renders a website as a link plus an explicit open-external action, routed to
 * the OS browser through the main-process window-open handler.
 */
function WebsiteLink({ url }: { url: string }) {
  function openExternal() {
    window.open(url, '_blank', 'noopener,noreferrer');
  }

  return (
    <div className="flex items-center justify-between gap-3">
      <a
        href={url}
        className="truncate text-sm text-primary underline-offset-2 hover:underline"
        onClick={(event) => {
          event.preventDefault();
          openExternal();
        }}
      >
        {url}
      </a>
      <button
        type="button"
        aria-label="Open website"
        onClick={openExternal}
        className="flex size-8 shrink-0 items-center justify-center rounded-md border border-border text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
      >
        <SquareArrowOutUpRight className="size-4" />
      </button>
    </div>
  );
}

/** A created/updated timestamp block. */
function TimestampBlock({ label, iso }: { label: string; iso: string }) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-xs font-medium text-muted-foreground">{label}</span>
      <time dateTime={iso} className="text-sm text-foreground">
        {formatTimestamp(iso)}
      </time>
    </div>
  );
}

/** The close (`X`) control shared by the header and error states. */
function CloseButton({ onClose }: { onClose?: () => void }) {
  return (
    <Button
      type="button"
      variant="outline"
      size="icon"
      aria-label="Close item detail"
      onClick={() => onClose?.()}
    >
      <X className="size-4" />
    </Button>
  );
}

/** Placeholder shown when no item is selected. */
function EmptyState() {
  return (
    <section className="flex h-full flex-col items-center justify-center gap-2 p-8 text-center">
      <span className="flex size-12 items-center justify-center rounded-2xl bg-muted text-muted-foreground">
        <KeyRound className="size-6" />
      </span>
      <p className="text-sm text-muted-foreground">Select an item to view its details</p>
    </section>
  );
}

/** Formats an ISO 8601 timestamp for display, tolerating malformed input. */
function formatTimestamp(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    return iso;
  }
  return date.toLocaleString(undefined, {
    year: 'numeric',
    month: 'short',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}
