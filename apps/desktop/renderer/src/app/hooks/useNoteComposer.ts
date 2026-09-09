'use client';

/**
 * useNoteComposer — encapsulates the "compose a secure note like an email"
 * concern for the item editor: inline image embedding, file attachments, and
 * caret-aware markdown insertion, plus the Write/Preview toggle.
 *
 * This hook owns only the transient UI state around composing note media
 * (in-flight flags, per-surface error messages, the textarea/file-input refs,
 * and the preview toggle). It deliberately does NOT own the note's `content`
 * or `attachments` — those live in the editor's form model. The hook mutates
 * them through the small callback surface passed in {@link NoteComposerCallbacks},
 * so the form remains the single source of truth and the hook stays reusable.
 *
 * All work happens in the renderer: images/files are encoded to data URLs or
 * Base64 in-memory (see `@/lib/image` and `@/lib/attachment`); nothing is
 * written to disk and no network requests are made. The encoded bytes travel
 * inside the note payload, which the main process encrypts. _(Req 5.1)_
 */

import { useCallback, useRef, useState } from 'react';
import type { NoteAttachment } from '@PassShield/contracts';

import { imageBlobToEmbeddable } from '@/lib/image';
import { fileToAttachment } from '@/lib/attachment';

/**
 * The narrow write-surface the composer needs into the editor's form model.
 * Each callback is expected to apply a functional update so concurrent edits
 * compose correctly.
 */
export interface NoteComposerCallbacks {
  /** Transform the current note `content` (used for caret-aware inserts). */
  mutateContent: (updater: (content: string) => string) => void;
  /** Append newly-encoded attachments to the note. */
  appendAttachments: (added: NoteAttachment[]) => void;
  /** Remove the attachment at `index`. */
  removeAttachmentAt: (index: number) => void;
}

/** State and handlers returned by {@link useNoteComposer}. */
export interface NoteComposer {
  /** Whether the rendered markdown Preview is shown instead of the textarea. */
  notePreview: boolean;
  /** Toggle between the raw "Write" textarea and the rendered "Preview". */
  setNotePreview: (preview: boolean) => void;
  /** True while a pasted/selected image is being encoded and embedded. */
  embeddingImage: boolean;
  /** Image-specific error, kept separate from the save-level form error. */
  noteImageError: string | null;
  /** True while chosen files are being encoded into attachments. */
  attachingFile: boolean;
  /** Attachment-specific error (the first failure in a multi-file select). */
  attachmentError: string | null;
  /** Ref for the note content textarea (drives caret-aware inserts). */
  noteContentRef: React.RefObject<HTMLTextAreaElement | null>;
  /** Ref for the hidden image file input. */
  noteImageInputRef: React.RefObject<HTMLInputElement | null>;
  /** Ref for the hidden attachment file input. */
  noteAttachmentInputRef: React.RefObject<HTMLInputElement | null>;
  /**
   * Wrap the current selection with `before`/`after` markers (e.g. `**` for
   * bold), inserting `placeholder` when there is no selection.
   */
  wrapSelection: (before: string, after: string, placeholder: string) => void;
  /**
   * Prefix every line touched by the selection. `makePrefix` receives the line
   * index so ordered lists can number sequentially.
   */
  prefixSelectedLines: (makePrefix: (lineIndex: number) => string) => void;
  /** Insert a markdown link at the selection, selecting the URL portion. */
  insertLink: () => void;
  /** Paste handler for the textarea; embeds clipboard images inline. */
  handleNotePaste: (event: React.ClipboardEvent<HTMLTextAreaElement>) => void;
  /** Change handler for the hidden image input. */
  handleNoteImageFile: (event: React.ChangeEvent<HTMLInputElement>) => void;
  /** Change handler for the hidden attachment input. */
  handleNoteAttachmentFiles: (event: React.ChangeEvent<HTMLInputElement>) => void;
  /** Remove a previously added attachment by index. */
  removeAttachment: (index: number) => void;
}

/**
 * Manages note image/attachment composition state and handlers.
 *
 * @param callbacks - Write-surface into the editor's form (content + attachments).
 * @returns Composer state, refs, and event handlers to wire into the note editor.
 *
 * @example
 * ```tsx
 * const composer = useNoteComposer({
 *   mutateContent: (fn) => setForm((p) => ({ ...p, content: fn(p.content) })),
 *   appendAttachments: (added) =>
 *     setForm((p) => ({ ...p, attachments: [...p.attachments, ...added] })),
 *   removeAttachmentAt: (i) =>
 *     setForm((p) => ({ ...p, attachments: p.attachments.filter((_, idx) => idx !== i) })),
 * });
 * ```
 */
export function useNoteComposer(callbacks: NoteComposerCallbacks): NoteComposer {
  const { mutateContent, appendAttachments, removeAttachmentAt } = callbacks;

  // Toggle between the raw markdown "Write" textarea and a rendered "Preview".
  const [notePreview, setNotePreview] = useState(false);
  // Feedback while a pasted/selected image is being embedded, and any
  // image-specific error (kept separate from the save-level form error).
  const [embeddingImage, setEmbeddingImage] = useState(false);
  const [noteImageError, setNoteImageError] = useState<string | null>(null);
  // Feedback while a file attachment is being encoded, and any attachment error.
  const [attachingFile, setAttachingFile] = useState(false);
  const [attachmentError, setAttachmentError] = useState<string | null>(null);

  const noteContentRef = useRef<HTMLTextAreaElement>(null);
  const noteImageInputRef = useRef<HTMLInputElement>(null);
  const noteAttachmentInputRef = useRef<HTMLInputElement>(null);

  /**
   * Insert a snippet into the note content at the current caret position (or
   * replace the current selection), then restore the caret after the insert.
   * Falls back to appending when the textarea ref is unavailable.
   */
  const insertIntoNote = useCallback(
    (snippet: string) => {
      const el = noteContentRef.current;
      mutateContent((content) => {
        if (!el) {
          const needsGap = content.length > 0 && !content.endsWith('\n');
          return content + (needsGap ? '\n' : '') + snippet;
        }
        const start = el.selectionStart ?? content.length;
        const end = el.selectionEnd ?? content.length;
        const next = content.slice(0, start) + snippet + content.slice(end);
        // Restore the caret just past the inserted text on the next tick.
        const caret = start + snippet.length;
        requestAnimationFrame(() => {
          el.focus();
          el.setSelectionRange(caret, caret);
        });
        return next;
      });
    },
    [mutateContent],
  );

  /**
   * Core editing primitive for the markdown toolbar. Reads the current
   * selection from the note textarea, hands it to a `transform` that returns
   * the new content plus where the selection should land, applies it to the
   * form, and restores the selection on the next tick. Switches out of Preview
   * so the change is visible in the editable textarea.
   */
  const editNoteSelection = useCallback(
    (
      transform: (ctx: {
        value: string;
        start: number;
        end: number;
        selected: string;
      }) => { value: string; selStart: number; selEnd: number },
    ) => {
      setNotePreview(false);
      const el = noteContentRef.current;
      mutateContent((value) => {
        const start = el?.selectionStart ?? value.length;
        const end = el?.selectionEnd ?? value.length;
        const selected = value.slice(start, end);
        const result = transform({ value, start, end, selected });
        if (el) {
          requestAnimationFrame(() => {
            el.focus();
            el.setSelectionRange(result.selStart, result.selEnd);
          });
        }
        return result.value;
      });
    },
    [mutateContent],
  );

  /**
   * Wrap the current selection with `before`/`after` markers (e.g. `**` for
   * bold). With no selection, inserts `placeholder` between the markers and
   * selects it so the user can type over it.
   */
  const wrapSelection = useCallback(
    (before: string, after: string, placeholder: string) => {
      editNoteSelection(({ value, start, end, selected }) => {
        const text = selected.length > 0 ? selected : placeholder;
        const nextValue = value.slice(0, start) + before + text + after + value.slice(end);
        const selStart = start + before.length;
        return { value: nextValue, selStart, selEnd: selStart + text.length };
      });
    },
    [editNoteSelection],
  );

  /**
   * Prefix every line touched by the selection. `makePrefix` receives the line
   * index so ordered lists can number sequentially; bullets/quotes/headings
   * ignore it and return a constant prefix.
   */
  const prefixSelectedLines = useCallback(
    (makePrefix: (lineIndex: number) => string) => {
      editNoteSelection(({ value, start, end }) => {
        const lineStart = value.lastIndexOf('\n', start - 1) + 1;
        let lineEnd = value.indexOf('\n', end);
        if (lineEnd === -1) {
          lineEnd = value.length;
        }
        const block = value.slice(lineStart, lineEnd);
        const transformed = block
          .split('\n')
          .map((line, index) => makePrefix(index) + line)
          .join('\n');
        const nextValue = value.slice(0, lineStart) + transformed + value.slice(lineEnd);
        return { value: nextValue, selStart: lineStart, selEnd: lineStart + transformed.length };
      });
    },
    [editNoteSelection],
  );

  /**
   * Insert a markdown link. Uses the selection as the link text (or a
   * placeholder) and selects the `https://` URL portion so it can be replaced.
   */
  const insertLink = useCallback(() => {
    editNoteSelection(({ value, start, end, selected }) => {
      const text = selected.length > 0 ? selected : 'link text';
      const url = 'https://';
      const snippet = `[${text}](${url})`;
      const nextValue = value.slice(0, start) + snippet + value.slice(end);
      // Caret lands on the URL: past "[", the text, and "](".
      const selStart = start + 1 + text.length + 2;
      return { value: nextValue, selStart, selEnd: selStart + url.length };
    });
  }, [editNoteSelection]);

  /**
   * Turn an image blob into a size-bounded data URL and insert it as markdown
   * image syntax on its own line. Surfaces a friendly error on failure.
   */
  const embedImageBlob = useCallback(
    async (blob: Blob, name?: string) => {
      setNoteImageError(null);
      setEmbeddingImage(true);
      try {
        const result = await imageBlobToEmbeddable(blob, name ?? 'pasted-image');
        if (!result.ok) {
          setNoteImageError(result.error);
          return;
        }
        // Ensure the image sits on its own line so it renders as a block figure.
        insertIntoNote(`\n![${result.alt}](${result.dataUrl})\n`);
        // Switching off preview keeps the caret usable right after inserting.
        setNotePreview(false);
      } catch {
        setNoteImageError('Could not embed this image.');
      } finally {
        setEmbeddingImage(false);
      }
    },
    [insertIntoNote],
  );

  /**
   * Clipboard paste handler for the note textarea. If the clipboard carries an
   * image, embed it and prevent the default (which would paste nothing useful).
   * Plain-text pastes fall through to the browser's default behaviour.
   */
  const handleNotePaste = useCallback(
    (event: React.ClipboardEvent<HTMLTextAreaElement>) => {
      const items = Array.from(event.clipboardData?.items ?? []);
      const imageItem = items.find(
        (it) => it.kind === 'file' && it.type.startsWith('image/'),
      );
      if (!imageItem) {
        return; // let normal text paste happen
      }
      const file = imageItem.getAsFile();
      if (!file) {
        return;
      }
      event.preventDefault();
      void embedImageBlob(file, file.name);
    },
    [embedImageBlob],
  );

  /** Handle an image chosen through the hidden file input. */
  const handleNoteImageFile = useCallback(
    (event: React.ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0];
      // Reset the input so selecting the same file again re-triggers change.
      event.target.value = '';
      if (file) {
        void embedImageBlob(file, file.name);
      }
    },
    [embedImageBlob],
  );

  /**
   * Encode one or more chosen files into Base64 attachments and append them to
   * the note. Each file is size-capped and encoded independently so one oversize
   * file does not block the rest; the first failure is surfaced as an error.
   */
  const attachFiles = useCallback(
    async (files: File[]) => {
      if (files.length === 0) {
        return;
      }
      setAttachmentError(null);
      setAttachingFile(true);
      try {
        const encoded: NoteAttachment[] = [];
        let firstError: string | null = null;
        for (const file of files) {
          const result = await fileToAttachment(file);
          if (result.ok) {
            encoded.push(result.attachment);
          } else if (firstError === null) {
            firstError = result.error;
          }
        }
        if (encoded.length > 0) {
          appendAttachments(encoded);
        }
        if (firstError !== null) {
          setAttachmentError(firstError);
        }
      } finally {
        setAttachingFile(false);
      }
    },
    [appendAttachments],
  );

  /** Handle files chosen through the hidden attachment file input. */
  const handleNoteAttachmentFiles = useCallback(
    (event: React.ChangeEvent<HTMLInputElement>) => {
      const files = Array.from(event.target.files ?? []);
      // Reset the input so selecting the same file again re-triggers change.
      event.target.value = '';
      void attachFiles(files);
    },
    [attachFiles],
  );

  /** Remove a previously added attachment by index. */
  const removeAttachment = useCallback(
    (index: number) => {
      removeAttachmentAt(index);
    },
    [removeAttachmentAt],
  );

  return {
    notePreview,
    setNotePreview,
    embeddingImage,
    noteImageError,
    attachingFile,
    attachmentError,
    noteContentRef,
    noteImageInputRef,
    noteAttachmentInputRef,
    wrapSelection,
    prefixSelectedLines,
    insertLink,
    handleNotePaste,
    handleNoteImageFile,
    handleNoteAttachmentFiles,
    removeAttachment,
  };
}
