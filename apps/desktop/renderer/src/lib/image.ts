/**
 * Image helpers for embedding pasted/selected images into secure notes.
 *
 * Notes store images inline as `data:image/...;base64,...` URLs inside the
 * markdown `content` string. That content is encrypted as part of the note
 * payload in the main process, so images inherit the vault's encryption with
 * no extra storage machinery. To keep the encrypted payload from ballooning,
 * large images are downscaled and recompressed before embedding.
 *
 * All work happens in the renderer via a `<canvas>`; nothing is written to
 * disk and no network requests are made.
 */

/** Largest edge (px) an embedded image is scaled down to. */
const MAX_EDGE_PX = 1600;

/** Target JPEG/WebP quality when recompressing. */
const RECOMPRESS_QUALITY = 0.82;

/**
 * Hard cap on the resulting data URL length (~ characters). Roughly ~2.7 MB of
 * encoded text; base64 is ~33% larger than the raw bytes, so this is ~2 MB of
 * image data. Anything larger is rejected so a single note stays reasonable.
 */
const MAX_DATA_URL_LENGTH = 2_700_000;

/** MIME types we accept for embedding. */
const ACCEPTED_TYPES = new Set([
  'image/png',
  'image/jpeg',
  'image/gif',
  'image/webp',
  'image/avif',
  'image/bmp',
]);

/** Result of attempting to turn a pasted image into an embeddable data URL. */
export type ImageEmbedResult =
  | { ok: true; dataUrl: string; alt: string }
  | { ok: false; error: string };

/**
 * Convert an image {@link Blob} (e.g. from a paste or file pick) into a
 * size-bounded `data:` URL suitable for embedding in note markdown.
 *
 * Large images are downscaled so their longest edge is at most
 * {@link MAX_EDGE_PX} and recompressed. Animated GIFs are kept as-is (a canvas
 * would flatten them to a single frame) but still subject to the size cap.
 *
 * @param blob - The source image blob.
 * @param fallbackName - A human name used to derive the markdown alt text.
 */
export async function imageBlobToEmbeddable(
  blob: Blob,
  fallbackName = 'image',
): Promise<ImageEmbedResult> {
  if (!ACCEPTED_TYPES.has(blob.type)) {
    return { ok: false, error: `Unsupported image type: ${blob.type || 'unknown'}.` };
  }

  const alt = sanitizeAlt(fallbackName);

  // GIFs may be animated; drawing to a canvas would drop all but one frame.
  // Keep them verbatim and only enforce the size cap.
  if (blob.type === 'image/gif') {
    const dataUrl = await blobToDataUrl(blob);
    if (dataUrl.length > MAX_DATA_URL_LENGTH) {
      return { ok: false, error: 'This image is too large to embed. Try a smaller one.' };
    }
    return { ok: true, dataUrl, alt };
  }

  let bitmap: ImageBitmap | HTMLImageElement;
  try {
    bitmap = await decodeImage(blob);
  } catch {
    return { ok: false, error: 'Could not read this image.' };
  }

  const { width, height } = naturalSize(bitmap);
  if (width === 0 || height === 0) {
    return { ok: false, error: 'Could not read this image.' };
  }

  const scale = Math.min(1, MAX_EDGE_PX / Math.max(width, height));
  const targetW = Math.max(1, Math.round(width * scale));
  const targetH = Math.max(1, Math.round(height * scale));

  const canvas = document.createElement('canvas');
  canvas.width = targetW;
  canvas.height = targetH;
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    return { ok: false, error: 'Could not process this image.' };
  }
  ctx.drawImage(bitmap as CanvasImageSource, 0, 0, targetW, targetH);

  // PNG (lossless) can be huge for photos; prefer WebP/JPEG for photographic
  // content. Try WebP first (good compression, alpha), fall back to JPEG, then
  // PNG if the browser refuses the requested type.
  const encoded =
    tryEncode(canvas, 'image/webp', RECOMPRESS_QUALITY) ??
    tryEncode(canvas, 'image/jpeg', RECOMPRESS_QUALITY) ??
    tryEncode(canvas, 'image/png');

  if (encoded === null) {
    return { ok: false, error: 'Could not process this image.' };
  }

  if (encoded.length > MAX_DATA_URL_LENGTH) {
    return { ok: false, error: 'This image is too large to embed even after resizing.' };
  }

  return { ok: true, dataUrl: encoded, alt };
}

/** Encode a canvas to a data URL for a given type, or null if unsupported. */
function tryEncode(canvas: HTMLCanvasElement, type: string, quality?: number): string | null {
  const url = canvas.toDataURL(type, quality);
  // If the browser can't produce the requested type it falls back to PNG; the
  // returned string then starts with `data:image/png`. Detect that mismatch.
  return url.startsWith(`data:${type}`) ? url : null;
}

/** Decode a blob into something drawable, preferring `createImageBitmap`. */
async function decodeImage(blob: Blob): Promise<ImageBitmap | HTMLImageElement> {
  if (typeof createImageBitmap === 'function') {
    return createImageBitmap(blob);
  }
  const url = URL.createObjectURL(blob);
  try {
    return await loadHtmlImage(url);
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** Load an <img> element from a URL, resolving once decoded. */
function loadHtmlImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('decode failed'));
    img.src = url;
  });
}

/** Read the intrinsic pixel size from either drawable type. */
function naturalSize(source: ImageBitmap | HTMLImageElement): {
  width: number;
  height: number;
} {
  if ('naturalWidth' in source) {
    return { width: source.naturalWidth, height: source.naturalHeight };
  }
  return { width: source.width, height: source.height };
}

/** Read a blob as a base64 data URL. */
function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error('read failed'));
    reader.readAsDataURL(blob);
  });
}

/**
 * Produce a safe, single-line markdown alt text from a file name: strip the
 * extension, collapse whitespace, and remove the `]` `(` `)` characters that
 * would break the `![alt](src)` syntax.
 */
function sanitizeAlt(name: string): string {
  const base = name.replace(/\.[a-z0-9]+$/i, '');
  const cleaned = base.replace(/[\]()\r\n]+/g, ' ').replace(/\s+/g, ' ').trim();
  return cleaned.length > 0 ? cleaned : 'image';
}
