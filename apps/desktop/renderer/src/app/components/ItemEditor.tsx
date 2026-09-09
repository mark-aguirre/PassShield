'use client';

/**
 * ItemEditor — create/edit surface for login and secure-note items
 * (Screen 2 "Add Login" and Screen 3 "Edit Vault Item").
 *
 * This is a single self-contained component that covers BOTH the create and
 * edit flows for the two V1 item types:
 *
 *   - Create mode  (no `itemId`): starts from a blank form; the item type can
 *     be switched between Login and Secure Note.
 *   - Edit mode    (`itemId` provided): fetches the existing decrypted item via
 *     `window.PassShield.items.get` and prefills the form.
 *
 * Security / boundary posture:
 *   - The renderer never encrypts anything. It sends the plaintext secret
 *     payload to `items.save`; the main process encrypts secret fields into
 *     `encrypted_payload`, writes plaintext metadata columns, and sets/bumps
 *     `version` + timestamps. _(Req 4.2, 4.3, 4.6, 5.2)_
 *   - All mutating operations (`items.save`, `items.trash`) require an unlocked
 *     vault. When the vault is locked the main process returns a `locked`
 *     error; this component surfaces it and does NOT close, so the parent can
 *     route back to unlock. _(Req 4.5, 20.4)_
 *   - Password input is masked by default with an explicit reveal toggle, and
 *     copies route through the main-process clipboard handler. _(Req 9.1, 9.3)_
 *
 * Trash / restore / permanent-delete (Req 20):
 *   - This editor implements the **Move to Trash** action (soft delete) in edit
 *     mode via `items.trash(id)`, then invokes `onTrashed`/`onClose`. _(Req 20.1)_
 *   - Restore (`items.restore`) and permanent delete (`items.delete`) are IPC
 *     paths that belong to a dedicated Trash view rather than the editor. To
 *     keep those paths exercisable from this task without duplicating a full
 *     trash UI, they are exported as the small helpers {@link restoreItem} and
 *     {@link permanentlyDeleteItem}. A future Trash view can call them directly.
 *     _(Req 20.2, 20.3)_
 *
 * Coordination note: this component owns only itself. Wiring it into
 * `VaultLayout`'s New Item / Edit actions is handled separately.
 *
 * _(Req 4.1, 4.2, 4.3, 4.4, 4.5, 4.6, 5.1, 5.2, 5.3, 20.1, 20.2, 20.3, 20.4)_
 */

import { useEffect, useState } from 'react';
import type {
  GeneratorOptions,
  ItemType,
  NoteAttachment,
  SaveItemInput,
} from '@PassShield/contracts';
import {
  ArrowLeft,
  Bold,
  Code,
  Copy,
  Eye,
  EyeOff,
  Heading,
  ImagePlus,
  Italic,
  KeyRound,
  Link as LinkIcon,
  List,
  ListOrdered,
  Paperclip,
  Quote,
  RefreshCw,
  SquareArrowOutUpRight,
  Trash2,
  X,
} from 'lucide-react';

import { Markdown } from '@/app/components/Markdown';
import { useNoteComposer } from '@/app/hooks/useNoteComposer';
import { formatBytes } from '@/lib/attachment';
import { api } from '@/lib/api';
import { useCategories } from '@/hooks/useCategories';
import { useItemDetail } from '@/hooks/useItems';
import { useSaveItem, useTrashItem } from '@/hooks/useItems';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

/**
 * Props for {@link ItemEditor}.
 */
export interface ItemEditorProps {
  /**
   * The id of the item being edited. `undefined`/`null` puts the editor in
   * create mode (blank form). A string puts it in edit mode and triggers a
   * fetch + prefill.
   */
  itemId?: string | null;
  /**
   * The item type to start with in create mode. Defaults to `'login'`. Ignored
   * in edit mode, where the fetched item's type is authoritative.
   */
  initialType?: ItemType;
  /**
   * The parent note id to attach a newly created item to, making it a
   * sub-page. Only meaningful in create mode; in edit mode the item's own
   * stored parent is authoritative. Defaults to `null` (a top-level item).
   */
  parentId?: string | null;
  /** Invoked with the saved item id after a successful create/update. */
  onSaved?: (id: string) => void;
  /** Invoked with the item id after it is moved to trash. */
  onTrashed?: (id: string) => void;
  /** Invoked when the user cancels/closes the editor without saving. */
  onClose?: () => void;
}

/** Sensible default generator options for the in-editor "Generate Password". */
const DEFAULT_GENERATOR_OPTIONS: GeneratorOptions = {
  length: 20,
  upper: true,
  lower: true,
  numbers: true,
  symbols: true,
  excludeSimilar: true,
  avoidAmbiguous: false,
  ensureEveryType: true,
  minNumbers: 1,
  minSymbols: 1,
};

/** Friendly, non-secret messages for the failure codes save/trash can return. */
const ERROR_MESSAGES: Record<string, string> = {
  locked: 'Your vault is locked. Unlock it to save changes.',
  validation: 'Some fields are invalid. Check the form and try again.',
  not_found: 'This item could not be found. It may have been deleted.',
};

/** Fallback message for any other or unexpected failure. */
const GENERIC_ERROR_MESSAGE = 'Something went wrong. Please try again.';


/**
 * The editable form model. Both item types share the metadata fields; the
 * type-specific secret fields are all kept here and only the relevant subset is
 * serialized into the payload on save.
 */
interface FormState {
  itemType: ItemType;
  title: string;
  categoryId: string | null;
  isFavorite: boolean;
  /** Parent note id when this item is a sub-page, else null (top-level). */
  parentId: string | null;
  // Login payload fields
  username: string;
  password: string;
  website: string;
  loginNotes: string;
  // Note payload fields (composed like an email: subject + body + attachments)
  subject: string;
  content: string;
  attachments: NoteAttachment[];
}

/** Builds a blank form for create mode. */
function blankForm(itemType: ItemType, parentId: string | null = null): FormState {
  return {
    itemType,
    title: '',
    categoryId: null,
    isFavorite: false,
    parentId,
    username: '',
    password: '',
    website: '',
    loginNotes: '',
    subject: '',
    content: '',
    attachments: [],
  };
}

/**
 * Create/edit editor for login and secure-note items. Handles fetching +
 * prefill in edit mode, validation, save, and (edit mode only) move-to-trash.
 */
export function ItemEditor({
  itemId,
  initialType = 'login',
  parentId = null,
  onSaved,
  onTrashed,
  onClose,
}: ItemEditorProps) {
  const isEditMode = typeof itemId === 'string' && itemId.length > 0;

  const [form, setForm] = useState<FormState>(() => blankForm(initialType, parentId));
  const [passwordRevealed, setPasswordRevealed] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [titleTouched, setTitleTouched] = useState(false);
  // Track whether we've already seeded the form from the fetched item so we
  // only populate once per itemId (not on every re-render after initial load).
  const [seededId, setSeededId] = useState<string | null>(null);

  // Category list for the dropdown. Non-critical — dropdown shows none on failure.
  const { data: categories = [] } = useCategories();

  // Mutations
  const saveItemMutation = useSaveItem();
  const trashItemMutation = useTrashItem();

  const saving = saveItemMutation.isPending;
  const trashing = trashItemMutation.isPending;

  // In edit mode, fetch the decrypted item via TanStack Query so the result is
  // cached and shared. The query is disabled when itemId is null/undefined.
  const itemDetailQuery = useItemDetail(isEditMode ? itemId! : null);

  // Derive a load state from the query so the render logic below stays the
  // same shape it had before.
  type LoadState =
    | { status: 'idle' }
    | { status: 'loading' }
    | { status: 'error'; message: string }
    | { status: 'ready' };

  let load: LoadState;
  if (!isEditMode) {
    load = { status: 'ready' };
  } else if (itemDetailQuery.isPending) {
    load = { status: 'loading' };
  } else if (itemDetailQuery.isError) {
    const msg = itemDetailQuery.error instanceof Error
      ? itemDetailQuery.error.message
      : GENERIC_ERROR_MESSAGE;
    load = { status: 'error', message: ERROR_MESSAGES[msg] ?? GENERIC_ERROR_MESSAGE };
  } else {
    load = { status: 'ready' };
  }

  // Seed the form once when the item detail arrives (or when itemId changes).
  useEffect(() => {
    setPasswordRevealed(false);
    setFormError(null);
    setTitleTouched(false);

    if (!isEditMode || itemId == null) {
      setForm(blankForm(initialType, parentId));
      setSeededId(null);
      return;
    }

    // Only seed when we have fresh data and haven't seeded for this itemId yet.
    if (itemDetailQuery.data && seededId !== itemId) {
      const item = itemDetailQuery.data;
      const next = blankForm(item.itemType, item.parentId);
      next.title = item.title;
      next.categoryId = item.categoryId;
      next.isFavorite = item.isFavorite;
      if (item.itemType === 'login') {
        next.username = item.payload.username;
        next.password = item.payload.password;
        next.website = item.payload.website;
        next.loginNotes = item.payload.notes;
      } else {
        next.content = item.payload.content;
        next.subject = item.payload.subject ?? '';
        next.attachments = item.payload.attachments ?? [];
      }
      setForm(next);
      setSeededId(itemId);
    }
  }, [itemId, isEditMode, initialType, parentId, itemDetailQuery.data, seededId]);

  // Note composition (inline images, file attachments, and the Write/Preview
  // toggle) is a self-contained concern owned by this hook. It writes note
  // content and attachments back through the callbacks below, so `form` stays
  // the single source of truth. _(Req 5.1)_
  const noteComposer = useNoteComposer({
    mutateContent: (updater) =>
      setForm((prev) => ({ ...prev, content: updater(prev.content) })),
    appendAttachments: (added) =>
      setForm((prev) => ({ ...prev, attachments: [...prev.attachments, ...added] })),
    removeAttachmentAt: (index) =>
      setForm((prev) => ({
        ...prev,
        attachments: prev.attachments.filter((_, i) => i !== index),
      })),
  });

  const titleInvalid = form.title.trim().length === 0;

  /** Patch helper for controlled form fields. */
  function update<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  /**
   * Builds the discriminated {@link SaveItemInput} from the current form,
   * serializing only the fields relevant to the chosen item type. The main
   * process is responsible for encryption + version/timestamp bumps.
   */
  function buildSaveInput(): SaveItemInput {
    const base = {
      ...(isEditMode && itemId ? { id: itemId } : {}),
      title: form.title.trim(),
      categoryId: form.categoryId,
      isFavorite: form.isFavorite,
      parentId: form.parentId,
    };

    if (form.itemType === 'login') {
      return {
        ...base,
        itemType: 'login',
        payload: {
          username: form.username,
          password: form.password,
          website: form.website,
          notes: form.loginNotes,
        },
      };
    }
    const subject = form.subject.trim();
    return {
      ...base,
      itemType: 'note',
      payload: {
        content: form.content,
        // Only include the newer fields when set, so notes without a subject or
        // attachments serialize to the same shape as before this feature.
        ...(subject.length > 0 ? { subject } : {}),
        ...(form.attachments.length > 0 ? { attachments: form.attachments } : {}),
      },
    };
  }

  /** Validate, then persist via the saveItem mutation. Closes only on success. */
  async function handleSave() {
    setTitleTouched(true);
    if (titleInvalid) {
      setFormError('A title is required.');
      return;
    }

    setFormError(null);
    try {
      const saved = await saveItemMutation.mutateAsync(buildSaveInput());
      onSaved?.(saved.id);
    } catch (error) {
      const msg = error instanceof Error ? error.message : GENERIC_ERROR_MESSAGE;
      setFormError(ERROR_MESSAGES[msg] ?? msg);
    }
  }

  /** Soft-delete the current item (edit mode only), then notify the parent. */
  async function handleTrash() {
    if (!isEditMode || itemId == null) return;

    setFormError(null);
    try {
      await trashItemMutation.mutateAsync(itemId);
      onTrashed?.(itemId);
      onClose?.();
    } catch (error) {
      const msg = error instanceof Error ? error.message : GENERIC_ERROR_MESSAGE;
      setFormError(ERROR_MESSAGES[msg] ?? msg);
    }
  }

  /** Generate a password with the default options and put it in the field. */
  async function handleGeneratePassword() {
    try {
      const result = await api.generator.generate(DEFAULT_GENERATOR_OPTIONS);
      if (result.ok) {
        update('password', result.value.value);
        setPasswordRevealed(true);
      } else {
        setFormError(result.error.message ?? GENERIC_ERROR_MESSAGE);
      }
    } catch {
      setFormError('Unable to generate a password.');
    }
  }

  /** Copy the current password through the main-process clipboard handler. */
  async function handleCopyPassword() {
    if (!form.password) return;
    try {
      await api.clipboard.copySecret(form.password);
    } catch {
      // A failed copy is non-fatal.
    }
  }

  /** Open the current website in the OS browser via the main-process handler. */
  function handleOpenWebsite() {
    if (!form.website) {
      return;
    }
    window.open(form.website, '_blank', 'noopener,noreferrer');
  }

  const heading = isEditMode ? 'Edit Vault Item' : form.itemType === 'login' ? 'Add Login' : 'Add Secure Note';
  const saveLabel = isEditMode ? 'Save Changes' : form.itemType === 'login' ? 'Save Login' : 'Save Note';

  const busy = saving || trashing;

  if (load.status === 'loading') {
    return (
      <section className="flex h-full items-center justify-center p-8" aria-busy="true">
        <p className="text-sm text-muted-foreground">Loading...</p>
      </section>
    );
  }

  if (load.status === 'error') {
    return (
      <section className="flex h-full flex-col gap-4 p-8">
        <div className="flex items-center justify-between">
          <h2 className="text-2xl font-bold text-foreground">{heading}</h2>
          <Button type="button" variant="outline" size="icon" aria-label="Close editor" onClick={() => onClose?.()}>
            <X className="size-4" />
          </Button>
        </div>
        <p role="alert" className="text-sm text-destructive">
          {load.message}
        </p>
      </section>
    );
  }

  return (
    <section className="flex h-full w-full flex-col overflow-y-auto bg-background" aria-label={heading}>
      <div className="flex items-center gap-3 p-8 pb-2">
        <Button
          type="button"
          variant="ghost"
          size="icon"
          aria-label="Back"
          onClick={() => onClose?.()}
        >
          <ArrowLeft className="size-5" />
        </Button>
        <div>
          <h2 className="text-2xl font-bold text-foreground">{heading}</h2>
          <p className="text-sm text-muted-foreground">
            {isEditMode
              ? 'Update the details for this item in your vault.'
              : 'Create a new item in your vault.'}
          </p>
        </div>
      </div>

      <div className="grid flex-1 grid-cols-1 gap-6 px-8 pb-24 lg:grid-cols-[1fr_300px]">
        <form
          id="item-editor-form"
          className="flex flex-col gap-5"
          onSubmit={(event) => {
            event.preventDefault();
            void handleSave();
          }}
          noValidate
        >
          <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
            {/* Item type selector. In edit mode the type is fixed to the loaded
                item; switching type on an existing item is out of scope here. */}
            <div className="flex flex-col gap-2">
              <Label htmlFor="item-type">Item Type</Label>
              <Select
                value={form.itemType}
                disabled={isEditMode}
                onValueChange={(value) => update('itemType', value as ItemType)}
              >
                <SelectTrigger id="item-type" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="login">Login</SelectItem>
                  <SelectItem value="note">Secure Note</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="flex flex-col gap-2">
              <Label htmlFor="item-title">
                Title <span aria-hidden="true">*</span>
              </Label>
              <Input
                id="item-title"
                type="text"
                placeholder="Example: GitHub"
                value={form.title}
                required
                aria-required="true"
                aria-invalid={titleTouched && titleInvalid}
                onBlur={() => setTitleTouched(true)}
                onChange={(event) => update('title', event.target.value)}
              />
              {titleTouched && titleInvalid && (
                <span role="alert" className="text-xs text-destructive">
                  A title is required.
                </span>
              )}
            </div>
          </div>

          <div className="flex flex-col gap-2">
            <Label htmlFor="item-category">Category</Label>
            <Select
              value={form.categoryId ?? '__none__'}
              onValueChange={(value) =>
                update('categoryId', value === '__none__' ? null : value)
              }
            >
              <SelectTrigger id="item-category" className="w-full">
                <SelectValue placeholder="Uncategorized" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__none__">Uncategorized</SelectItem>
                {categories.map((category) => (
                  <SelectItem key={category.id} value={category.id}>
                    {category.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {form.itemType === 'login' ? (
            <>
              <div className="flex flex-col gap-2">
                <Label htmlFor="login-username">Username</Label>
                <Input
                  id="login-username"
                  type="text"
                  autoComplete="off"
                  placeholder="Enter username or email"
                  value={form.username}
                  onChange={(event) => update('username', event.target.value)}
                />
              </div>

              <div className="flex flex-col gap-2">
                <Label htmlFor="login-password">
                  Password <span aria-hidden="true">*</span>
                </Label>
                <div className="flex items-center gap-2">
                  <Input
                    id="login-password"
                    className="flex-1"
                    type={passwordRevealed ? 'text' : 'password'}
                    autoComplete="off"
                    value={form.password}
                    onChange={(event) => update('password', event.target.value)}
                  />
                  <Button
                    type="button"
                    variant="outline"
                    size="icon"
                    aria-pressed={passwordRevealed}
                    aria-label={passwordRevealed ? 'Hide password' : 'Reveal password'}
                    onClick={() => setPasswordRevealed((prev) => !prev)}
                  >
                    {passwordRevealed ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    size="icon"
                    aria-label="Generate password"
                    onClick={() => void handleGeneratePassword()}
                  >
                    <RefreshCw className="size-4" />
                  </Button>
                </div>
              </div>

              <div className="flex flex-col gap-2">
                <Label htmlFor="login-website">
                  Website <span className="font-normal text-muted-foreground">(optional)</span>
                </Label>
                <div className="flex items-center gap-2">
                  <Input
                    id="login-website"
                    className="flex-1"
                    type="url"
                    autoComplete="off"
                    placeholder="https://example.com"
                    value={form.website}
                    onChange={(event) => update('website', event.target.value)}
                  />
                  <Button
                    type="button"
                    variant="outline"
                    size="icon"
                    aria-label="Open website"
                    onClick={handleOpenWebsite}
                    disabled={!form.website}
                  >
                    <SquareArrowOutUpRight className="size-4" />
                  </Button>
                </div>
              </div>

              <div className="flex flex-col gap-2">
                <Label htmlFor="login-notes">
                  Notes <span className="font-normal text-muted-foreground">(optional)</span>
                </Label>
                <Textarea
                  id="login-notes"
                  rows={4}
                  placeholder="Add any additional notes..."
                  value={form.loginNotes}
                  onChange={(event) => update('loginNotes', event.target.value)}
                />
              </div>
            </>
          ) : (
            <>
              <div className="flex flex-col gap-2">
                <Label htmlFor="note-subject">
                  Subject <span className="font-normal text-muted-foreground">(optional)</span>
                </Label>
                <Input
                  id="note-subject"
                  type="text"
                  placeholder="Example: Recovery codes for my bank"
                  value={form.subject}
                  onChange={(event) => update('subject', event.target.value)}
                />
              </div>

              <div className="flex flex-col gap-2">
              <div className="flex items-center justify-between">
                <Label htmlFor="note-content">Content</Label>
                <div className="flex items-center gap-1">
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    onClick={() => noteComposer.noteImageInputRef.current?.click()}
                    disabled={noteComposer.embeddingImage}
                  >
                    <ImagePlus className="size-4" />
                    {noteComposer.embeddingImage ? 'Adding…' : 'Add image'}
                  </Button>
                  <div
                    className="ml-1 flex items-center gap-1"
                    role="group"
                    aria-label="Editor mode"
                  >
                    <Button
                      type="button"
                      size="sm"
                      variant={noteComposer.notePreview ? 'ghost' : 'secondary'}
                      aria-pressed={!noteComposer.notePreview}
                      onClick={() => noteComposer.setNotePreview(false)}
                    >
                      Write
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant={noteComposer.notePreview ? 'secondary' : 'ghost'}
                      aria-pressed={noteComposer.notePreview}
                      onClick={() => noteComposer.setNotePreview(true)}
                      disabled={!form.content}
                    >
                      Preview
                    </Button>
                  </div>
                </div>
              </div>
              <div
                className="flex flex-wrap items-center gap-0.5 rounded-md border border-input bg-muted/30 p-1"
                role="toolbar"
                aria-label="Text formatting"
              >
                <FormatButton
                  label="Bold"
                  icon={<Bold className="size-4" />}
                  disabled={noteComposer.notePreview}
                  onClick={() => noteComposer.wrapSelection('**', '**', 'bold text')}
                />
                <FormatButton
                  label="Italic"
                  icon={<Italic className="size-4" />}
                  disabled={noteComposer.notePreview}
                  onClick={() => noteComposer.wrapSelection('*', '*', 'italic text')}
                />
                <FormatButton
                  label="Inline code"
                  icon={<Code className="size-4" />}
                  disabled={noteComposer.notePreview}
                  onClick={() => noteComposer.wrapSelection('`', '`', 'code')}
                />
                <span className="mx-1 h-5 w-px bg-border" aria-hidden />
                <FormatButton
                  label="Heading"
                  icon={<Heading className="size-4" />}
                  disabled={noteComposer.notePreview}
                  onClick={() => noteComposer.prefixSelectedLines(() => '## ')}
                />
                <FormatButton
                  label="Bulleted list"
                  icon={<List className="size-4" />}
                  disabled={noteComposer.notePreview}
                  onClick={() => noteComposer.prefixSelectedLines(() => '- ')}
                />
                <FormatButton
                  label="Numbered list"
                  icon={<ListOrdered className="size-4" />}
                  disabled={noteComposer.notePreview}
                  onClick={() => noteComposer.prefixSelectedLines((index) => `${index + 1}. `)}
                />
                <FormatButton
                  label="Quote"
                  icon={<Quote className="size-4" />}
                  disabled={noteComposer.notePreview}
                  onClick={() => noteComposer.prefixSelectedLines(() => '> ')}
                />
                <span className="mx-1 h-5 w-px bg-border" aria-hidden />
                <FormatButton
                  label="Link"
                  icon={<LinkIcon className="size-4" />}
                  disabled={noteComposer.notePreview}
                  onClick={noteComposer.insertLink}
                />
              </div>
              {noteComposer.notePreview ? (
                <Markdown
                  source={form.content}
                  className="min-h-[236px] rounded-md border border-input bg-transparent p-3 text-sm leading-relaxed text-foreground"
                />
              ) : (
                <Textarea
                  id="note-content"
                  ref={noteComposer.noteContentRef}
                  rows={10}
                  placeholder="Supports markdown, and you can paste an image directly here."
                  value={form.content}
                  onChange={(event) => update('content', event.target.value)}
                  onPaste={noteComposer.handleNotePaste}
                />
              )}
              <input
                ref={noteComposer.noteImageInputRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={noteComposer.handleNoteImageFile}
              />
              {noteComposer.noteImageError ? (
                <span role="alert" className="text-xs text-destructive">
                  {noteComposer.noteImageError}
                </span>
              ) : (
                <span className="text-xs text-muted-foreground">
                  Markdown formatting is supported. Paste or add an image to embed it inline.
                </span>
              )}
              </div>

              <div className="flex flex-col gap-2">
                <div className="flex items-center justify-between">
                  <Label htmlFor="note-attachments">
                    Attachments{' '}
                    <span className="font-normal text-muted-foreground">(optional)</span>
                  </Label>
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    onClick={() => noteComposer.noteAttachmentInputRef.current?.click()}
                    disabled={noteComposer.attachingFile}
                  >
                    <Paperclip className="size-4" />
                    {noteComposer.attachingFile ? 'Attaching…' : 'Attach file'}
                  </Button>
                </div>
                {form.attachments.length > 0 && (
                  <ul className="flex flex-col gap-2" aria-label="Attached files">
                    {form.attachments.map((attachment, index) => (
                      <li
                        key={`${attachment.filename}-${index}`}
                        className="flex items-center gap-3 rounded-md border border-input bg-muted/40 px-3 py-2"
                      >
                        <Paperclip className="size-4 shrink-0 text-muted-foreground" aria-hidden />
                        <span className="flex min-w-0 flex-col">
                          <span className="truncate text-sm text-foreground">
                            {attachment.filename}
                          </span>
                          <span className="text-xs text-muted-foreground">
                            {formatBytes(attachment.size)}
                          </span>
                        </span>
                        <Button
                          type="button"
                          size="icon"
                          variant="ghost"
                          className="ml-auto shrink-0"
                          aria-label={`Remove ${attachment.filename}`}
                          onClick={() => noteComposer.removeAttachment(index)}
                        >
                          <X className="size-4" />
                        </Button>
                      </li>
                    ))}
                  </ul>
                )}
                <input
                  ref={noteComposer.noteAttachmentInputRef}
                  id="note-attachments"
                  type="file"
                  multiple
                  className="hidden"
                  onChange={noteComposer.handleNoteAttachmentFiles}
                />
                {noteComposer.attachmentError ? (
                  <span role="alert" className="text-xs text-destructive">
                    {noteComposer.attachmentError}
                  </span>
                ) : (
                  <span className="text-xs text-muted-foreground">
                    Files are encrypted with the note. Up to 5 MB each.
                  </span>
                )}
              </div>
            </>
          )}

          {formError && (
            <p role="alert" className="text-sm text-destructive">
              {formError}
            </p>
          )}
        </form>

        {/* Quick Actions + Item Options side panels (Screens 2 & 3). */}
        <aside className="flex flex-col gap-4" aria-label="Actions and options">
          {form.itemType === 'login' && (
            <div className="flex flex-col rounded-xl border border-border bg-card p-4 shadow-sm">
              <span className="mb-2 text-sm font-semibold text-foreground">Quick Actions</span>
              <SidePanelAction
                icon={<RefreshCw className="size-4" />}
                title="Generate Password"
                subtitle="Create a strong, random password"
                onClick={() => void handleGeneratePassword()}
              />
              <SidePanelAction
                icon={<Copy className="size-4" />}
                title="Copy Password"
                subtitle="Copy password to clipboard"
                onClick={() => void handleCopyPassword()}
                disabled={!form.password}
              />
              <SidePanelAction
                icon={<SquareArrowOutUpRight className="size-4" />}
                title="Open Website"
                subtitle="Open the website in your browser"
                onClick={handleOpenWebsite}
                disabled={!form.website}
              />
            </div>
          )}

          <div className="flex flex-col gap-3 rounded-xl border border-border bg-card p-4 shadow-sm">
            <span className="text-sm font-semibold text-foreground">Item Options</span>
            <label className="flex cursor-pointer items-start gap-3">
              <Checkbox
                checked={form.isFavorite}
                onCheckedChange={(v) => update('isFavorite', v === true)}
              />
              <span className="flex flex-col">
                <span className="text-sm font-medium text-foreground">Mark as favorite</span>
                <span className="text-xs text-muted-foreground">Show in favorites</span>
              </span>
            </label>
          </div>
        </aside>
      </div>

      {/* Sticky footer action bar. */}
      <div className="sticky bottom-0 flex items-center justify-end gap-3 border-t border-border bg-background/95 px-8 py-4 backdrop-blur">
        {isEditMode && (
          <Button
            type="button"
            variant="ghost"
            className="mr-auto text-destructive hover:bg-destructive/10 hover:text-destructive"
            onClick={() => void handleTrash()}
            disabled={busy}
          >
            <Trash2 className="size-4" />
            {trashing ? 'Moving...' : 'Move to Trash'}
          </Button>
        )}
        <Button type="button" variant="outline" onClick={() => onClose?.()} disabled={busy}>
          Cancel
        </Button>
        <Button type="submit" form="item-editor-form" disabled={busy}>
          {saving ? 'Saving...' : saveLabel}
        </Button>
      </div>
    </section>
  );
}

/** A Quick Actions row in the editor side panel. */
function SidePanelAction({
  icon,
  title,
  subtitle,
  onClick,
  disabled,
}: {
  icon: React.ReactNode;
  title: string;
  subtitle: string;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="flex items-center gap-3 rounded-lg px-2 py-2.5 text-left transition-colors hover:bg-accent disabled:pointer-events-none disabled:opacity-50"
    >
      <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
        {icon}
      </span>
      <span className="flex min-w-0 flex-col">
        <span className="text-sm font-medium text-foreground">{title}</span>
        <span className="text-xs text-muted-foreground">{subtitle}</span>
      </span>
    </button>
  );
}

/** A single icon button in the note markdown formatting toolbar. */
function FormatButton({
  label,
  icon,
  onClick,
  disabled,
}: {
  label: string;
  icon: React.ReactNode;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <Button
      type="button"
      size="icon"
      variant="ghost"
      className="size-8"
      title={label}
      aria-label={label}
      // Keep focus in the textarea so the current selection isn't lost when the
      // button is pressed.
      onMouseDown={(event) => event.preventDefault()}
      onClick={onClick}
      disabled={disabled}
    >
      {icon}
    </Button>
  );
}

export default ItemEditor;

/**
 * Restore a previously trashed item to its active state. This is the
 * `items.restore` IPC path (Req 20.2). It lives here as an exported helper so a
 * dedicated Trash view (outside this task's scope) can reach it without
 * re-implementing the call; the editor itself does not surface restore because
 * it only ever edits active items.
 *
 * Returns `true` on success, `false` on any failure (e.g. the vault is locked).
 */
export async function restoreItem(id: string): Promise<boolean> {
  try {
    const result = await api.items.restore(id);
    return result.ok;
  } catch {
    return false;
  }
}

export async function permanentlyDeleteItem(id: string): Promise<boolean> {
  try {
    const result = await api.items.delete(id);
    return result.ok;
  } catch {
    return false;
  }
}


