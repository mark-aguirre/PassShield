/**
 * Brand-icon resolution for vault item rows.
 *
 * Vault list rows carry only non-secret {@link ItemSummary} metadata — notably
 * *no* URL/website (that lives in the encrypted payload). To still show a real,
 * recognizable logo (GitHub, Gmail, AWS, ...) we derive the brand from the
 * item's display title, entirely offline. Icons come from the locally bundled
 * `simple-icons` package (pure SVG path data, no network), plus a small set of
 * inline SVGs for brands simple-icons omits for trademark reasons (AWS,
 * Microsoft, Azure, ...).
 *
 * Resolution order for a title:
 *   1. Curated alias map (keyword/substring -> brand) — handles "AWS
 *      (Production)", "Microsoft 365", "Office", "Azure Portal", etc.
 *   2. Direct simple-icons lookup by the normalized title slug.
 *   3. No match -> caller falls back to the per-type glyph (key / note).
 *
 * A resolved brand is described by {@link BrandIcon}: a single SVG `path` (24x24
 * viewBox, matching simple-icons) and an official brand `hex` color.
 */
import * as simpleIcons from 'simple-icons';

/** A resolved brand logo: a 24x24 SVG path and its official brand color. */
export interface BrandIcon {
  /** Stable identifier for the resolved brand (React `key`, testing). */
  key: string;
  /** Human-readable brand title, used as accessible label. */
  title: string;
  /** SVG path `d` attribute drawn in a `0 0 24 24` viewBox. */
  path: string;
  /** Official brand color as a hex string without leading `#`. */
  hex: string;
}

/** Shape of a single simple-icons entry we consume. */
interface SimpleIcon {
  title: string;
  slug: string;
  hex: string;
  path: string;
}

/**
 * Inline SVG paths for common brands that `simple-icons` does not ship (removed
 * for trademark reasons) but which users very commonly store. Paths use the
 * same `0 0 24 24` viewBox as simple-icons so they render identically.
 */
const CUSTOM_ICONS: Record<string, BrandIcon> = {
  aws: {
    key: 'aws',
    title: 'Amazon Web Services',
    hex: 'FF9900',
    // Stylized "aws" smile wordmark approximation.
    path: 'M6.76 10.02c0 .26.03.47.08.62.06.16.14.33.25.52.04.06.05.12.05.17 0 .07-.04.14-.13.21l-.44.29a.34.34 0 0 1-.18.06c-.07 0-.14-.03-.21-.1a2.17 2.17 0 0 1-.25-.33 5.3 5.3 0 0 1-.22-.42c-.55.65-1.24.97-2.07.97-.59 0-1.06-.17-1.4-.5-.35-.34-.52-.79-.52-1.35 0-.6.21-1.08.64-1.45.42-.36 1-.55 1.72-.55.24 0 .48.02.74.06.26.03.53.09.81.15v-.5c0-.53-.11-.9-.33-1.11-.22-.22-.6-.32-1.13-.32-.24 0-.49.03-.75.09-.25.06-.5.13-.74.22a1.96 1.96 0 0 1-.24.09.42.42 0 0 1-.11.02c-.1 0-.15-.07-.15-.22v-.34c0-.11.01-.2.05-.25a.53.53 0 0 1 .2-.15c.24-.12.53-.23.87-.31.34-.09.7-.13 1.08-.13.82 0 1.42.19 1.81.56.38.37.57.94.57 1.7v2.24zm-2.86 1.07c.23 0 .47-.04.72-.13.25-.08.47-.24.66-.45.11-.13.2-.28.24-.45.05-.17.07-.37.07-.61v-.29a5.9 5.9 0 0 0-.65-.12 5.3 5.3 0 0 0-.66-.04c-.47 0-.82.09-1.05.28-.23.19-.34.46-.34.81 0 .33.08.58.26.75.17.17.42.25.75.25zm5.66.76c-.13 0-.21-.02-.27-.07-.06-.04-.11-.14-.15-.27L7.15 5.5a1.2 1.2 0 0 1-.06-.28c0-.11.05-.17.16-.17h.68c.14 0 .23.02.28.07.06.04.1.14.14.27l1.19 4.69 1.1-4.69c.03-.13.08-.23.13-.27a.48.48 0 0 1 .29-.07h.56c.14 0 .23.02.29.07.05.04.1.14.13.27l1.11 4.75 1.23-4.75c.04-.13.09-.23.14-.27a.47.47 0 0 1 .28-.07h.65c.11 0 .17.06.17.17 0 .03 0 .07-.02.11-.01.04-.02.1-.05.18l-1.72 5.51c-.04.13-.09.23-.15.27a.47.47 0 0 1-.27.07h-.6c-.14 0-.23-.02-.29-.07-.06-.05-.1-.14-.13-.28l-1.09-4.57-1.08 4.56c-.03.14-.07.23-.13.28-.06.05-.16.07-.29.07zm9.06.18c-.36 0-.72-.04-1.06-.12-.34-.08-.61-.17-.79-.27a.5.5 0 0 1-.21-.19.48.48 0 0 1-.04-.19v-.35c0-.15.05-.22.16-.22.04 0 .09.01.13.02.05.02.11.04.19.07.26.11.54.2.84.26.3.06.6.09.9.09.48 0 .85-.08 1.11-.25.26-.17.39-.41.39-.72a.65.65 0 0 0-.18-.47c-.12-.12-.35-.24-.68-.35l-.98-.3c-.49-.16-.85-.39-1.08-.69-.23-.3-.35-.63-.35-.98 0-.28.06-.53.18-.75.12-.21.28-.4.48-.55.2-.15.43-.27.7-.35.27-.08.55-.11.85-.11.15 0 .3.01.45.03.15.02.29.05.43.08.13.03.25.07.36.11.11.04.2.08.26.12.09.05.15.1.19.16a.34.34 0 0 1 .06.21v.32c0 .15-.05.23-.16.23a.72.72 0 0 1-.27-.08 3.2 3.2 0 0 0-1.36-.28c-.44 0-.78.07-1.02.22-.24.14-.36.36-.36.66 0 .19.07.36.2.48.14.13.39.25.75.37l.96.3c.48.16.83.37 1.04.65.21.27.31.59.31.94 0 .29-.06.55-.18.78-.12.23-.29.43-.5.59-.21.17-.47.29-.77.38-.31.09-.64.14-.99.14z',
  },
  microsoft: {
    key: 'microsoft',
    title: 'Microsoft',
    hex: 'F25022',
    // Four-square Microsoft logo (single path, filled per-quadrant color is
    // approximated by the brand's signature orange; the shape is recognizable).
    path: 'M2 2h9.2v9.2H2V2zm10.8 0H22v9.2h-9.2V2zM2 12.8h9.2V22H2v-9.2zm10.8 0H22V22h-9.2v-9.2z',
  },
  azure: {
    key: 'azure',
    title: 'Microsoft Azure',
    hex: '0078D4',
    path: 'M13.05 4.24l-4.71 12.9h3.32L8.9 21.76l9.4-11.32h-3.66l3.38-6.2H13.05zM7.45 6.02L2 17.14h4.02l1.7-4.9 3.2 3.6-5.9 1.3h9.13L11.4 9.55 7.45 6.02z',
  },
};

/**
 * Alias table mapping a lowercase keyword to a resolver. When an item title
 * *contains* one of these keywords (whole-word-ish), we use the mapped brand.
 * Order matters: more specific keys should precede generic ones. The value is
 * either a simple-icons slug (looked up dynamically) or a custom-icon key.
 */
const ALIASES: ReadonlyArray<{ keyword: string; slug?: string; custom?: string }> = [
  // Custom (trademark-restricted in simple-icons).
  { keyword: 'aws', custom: 'aws' },
  { keyword: 'amazon web services', custom: 'aws' },
  { keyword: 'azure', custom: 'azure' },
  { keyword: 'microsoft 365', custom: 'microsoft' },
  { keyword: 'office 365', custom: 'microsoft' },
  { keyword: 'microsoft', custom: 'microsoft' },
  { keyword: 'office', custom: 'microsoft' },
  { keyword: 'outlook', custom: 'microsoft' },
  { keyword: 'onedrive', custom: 'microsoft' },
  { keyword: 'm365', custom: 'microsoft' },
  // Google family.
  { keyword: 'gmail', slug: 'gmail' },
  { keyword: 'google', slug: 'google' },
  { keyword: 'youtube', slug: 'youtube' },
  // Dev / hosting.
  { keyword: 'github', slug: 'github' },
  { keyword: 'gitlab', slug: 'gitlab' },
  { keyword: 'bitbucket', slug: 'bitbucket' },
  { keyword: 'docker', slug: 'docker' },
  { keyword: 'vercel', slug: 'vercel' },
  { keyword: 'netlify', slug: 'netlify' },
  { keyword: 'cloudflare', slug: 'cloudflare' },
  { keyword: 'digitalocean', slug: 'digitalocean' },
  { keyword: 'digital ocean', slug: 'digitalocean' },
  { keyword: 'npm', slug: 'npm' },
  { keyword: 'wordpress', slug: 'wordpress' },
  // Atlassian / productivity.
  { keyword: 'jira', slug: 'jira' },
  { keyword: 'confluence', slug: 'confluence' },
  { keyword: 'trello', slug: 'trello' },
  { keyword: 'atlassian', slug: 'atlassian' },
  { keyword: 'notion', slug: 'notion' },
  { keyword: 'asana', slug: 'asana' },
  { keyword: 'figma', slug: 'figma' },
  { keyword: 'zoom', slug: 'zoom' },
  { keyword: 'dropbox', slug: 'dropbox' },
  // Social.
  { keyword: 'facebook', slug: 'facebook' },
  { keyword: 'instagram', slug: 'instagram' },
  { keyword: 'reddit', slug: 'reddit' },
  { keyword: 'discord', slug: 'discord' },
  { keyword: 'spotify', slug: 'spotify' },
  { keyword: 'twitter', slug: 'x' },
  // Finance.
  { keyword: 'stripe', slug: 'stripe' },
  { keyword: 'paypal', slug: 'paypal' },
  // Data stores.
  { keyword: 'mongodb', slug: 'mongodb' },
  { keyword: 'mongo', slug: 'mongodb' },
  { keyword: 'postgres', slug: 'postgresql' },
  { keyword: 'postgresql', slug: 'postgresql' },
  { keyword: 'mysql', slug: 'mysql' },
  { keyword: 'redis', slug: 'redis' },
  // Apple.
  { keyword: 'apple', slug: 'apple' },
  { keyword: 'icloud', slug: 'apple' },
];

/**
 * The `simple-icons` module exports every icon as a named binding of the form
 * `si<PascalCaseSlug>` (e.g. `siGithub`). Cast once so we can index it by slug.
 */
const ICON_EXPORTS = simpleIcons as unknown as Record<string, SimpleIcon | undefined>;

/** Convert a simple-icons slug to its `si<Pascal>` export name. */
function slugToExportName(slug: string): string {
  return 'si' + slug.charAt(0).toUpperCase() + slug.slice(1);
}

/** Look up a simple-icons entry by slug and adapt it to {@link BrandIcon}. */
function fromSimpleIcons(slug: string): BrandIcon | null {
  const icon = ICON_EXPORTS[slugToExportName(slug)];
  if (!icon) return null;
  return { key: icon.slug, title: icon.title, path: icon.path, hex: icon.hex };
}

/** Normalize a title into a candidate simple-icons slug (letters + digits). */
function titleToSlug(title: string): string {
  return title
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '');
}

const cache = new Map<string, BrandIcon | null>();

/**
 * Resolve a brand icon for a vault item title. Returns `null` when no brand
 * matches, in which case callers should fall back to the per-type glyph.
 *
 * Results are memoized per title so repeated renders stay cheap.
 */
export function resolveBrandIcon(title: string | null | undefined): BrandIcon | null {
  if (!title) return null;
  const key = title.trim().toLowerCase();
  if (!key) return null;

  const cached = cache.get(key);
  if (cached !== undefined) return cached;

  let result: BrandIcon | null = null;

  // 1. Curated alias substring match.
  for (const alias of ALIASES) {
    if (key.includes(alias.keyword)) {
      if (alias.custom) {
        result = CUSTOM_ICONS[alias.custom] ?? null;
      } else if (alias.slug) {
        result = fromSimpleIcons(alias.slug);
      }
      if (result) break;
    }
  }

  // 2. Direct simple-icons slug lookup from the normalized title.
  if (!result) {
    const slug = titleToSlug(key);
    if (slug) result = fromSimpleIcons(slug);
  }

  cache.set(key, result);
  return result;
}
