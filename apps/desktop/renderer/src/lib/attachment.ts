/**
 * Attachment helpers for secure notes.
 *
 * A note is composed like an email message: a subject, a markdown body, and
 * zero or more file attachments. Each attachment's bytes are Base64-encoded
 * (MIME-style) and stored inline in the note payload, which the main process
 * encrypts as part of `encrypted_payload`. Attachments therefore inherit the
 * vault's encryption with no extra storage machinery — the trade-off is that
 * they inflate the encrypted payload, so a per-file size cap is enforced.
 *
 * All work happens in the renderer; nothing is written to disk and no network
 * requests are made.
 */

import type { NoteAttachment } from '@passshield/contracts';

/**
 * Largest single attachment allowed, in bytes (~5 MB of decoded file data).
 * Base64 inflates this by ~33%, and the whole note payload is JSON-serialized
 * then AEAD-encrypted, so this keeps a single note from ballooning.
 */
export const MAX_ATTACHMENT_BYTES = 5 * 1024 * 1024;

/** Fallback MIME type when the browser reports none for a picked file. */
const DEFAULT_MIME_TYPE = 'application/octet-stream';

/** Result of attempting to turn a picked file into a note attachment. */
export type AttachmentResult =
  | { ok: true; attachment: NoteAttachment }
  | { ok: false; error: string };

/**
 * Encode a picked {@link File} into a {@link NoteAttachment} with Base64 data,
 * enforcing {@link MAX_ATTACHMENT_BYTES}. The returned `data` is the raw Base64
 * payload without the `data:<mime>;base64,` prefix.
 *
 * @param file - The file chosen through a file input or drop.
 */
export async function fileToAttachment(file: File): Promise<AttachmentResult> {
  if (file.size > MAX_ATTACHMENT_BYTES) {
    return {
      ok: false,
      error: `"${file.name}" is too large to attach (max ${formatBytes(MAX_ATTACHMENT_BYTES)}).`,
    };
  }

  let dataUrl: string;
  try {
    dataUrl = await readFileAsDataUrl(file);
  } catch {
    return { ok: false, error: `Could not read "${file.name}".` };
  }

  const base64 = stripDataUrlPrefix(dataUrl);
  if (base64 === null) {
    return { ok: false, error: `Could not read "${file.name}".` };
  }

  return {
    ok: true,
    attachment: {
      filename: sanitizeFilename(file.name),
      mimeType: file.type || DEFAULT_MIME_TYPE,
      size: file.size,
      data: base64,
    },
  };
}

/**
 * Rebuild a `data:` URL from an attachment so it can be downloaded via an
 * anchor element (`<a href={dataUrl} download={filename}>`).
 */
export function attachmentToDataUrl(attachment: NoteAttachment): string {
  const mime = attachment.mimeType || DEFAULT_MIME_TYPE;
  return `data:${mime};base64,${attachment.data}`;
}

/** Format a byte count as a short human-readable string (e.g. `1.4 MB`). */
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) {
    return '—';
  }
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  const units = ['KB', 'MB', 'GB'];
  let value = bytes / 1024;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }
  const rounded = value >= 10 ? Math.round(value) : Math.round(value * 10) / 10;
  return `${rounded} ${units[unitIndex]}`;
}

/** Read a file as a base64 `data:` URL. */
function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error('read failed'));
    reader.readAsDataURL(file);
  });
}

/**
 * Strip the `data:<mime>;base64,` prefix from a data URL, returning just the
 * Base64 payload. Returns `null` if the string is not a base64 data URL.
 */
function stripDataUrlPrefix(dataUrl: string): string | null {
  const marker = ';base64,';
  const index = dataUrl.indexOf(marker);
  if (!dataUrl.startsWith('data:') || index === -1) {
    return null;
  }
  return dataUrl.slice(index + marker.length);
}

/**
 * Produce a safe, single-line file name: collapse whitespace and strip path
 * separators and control characters so it is a plain leaf name.
 */
function sanitizeFilename(name: string): string {
  const leaf = name.split(/[\\/]/).pop() ?? name;
  const cleaned = leaf.replace(/[\r\n\t]+/g, ' ').replace(/\s+/g, ' ').trim();
  return cleaned.length > 0 ? cleaned : 'attachment';
}
