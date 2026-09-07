'use client';

import type { ItemType } from '@passshield/contracts';
import { FileText, KeyRound } from 'lucide-react';

import { cn } from '@/lib/utils';
import { resolveBrandIcon } from '@/lib/brand-icons';

/** Per-type fallback glyph used when no brand can be resolved from the title. */
const TYPE_GLYPH: Record<ItemType, typeof KeyRound> = {
  login: KeyRound,
  note: FileText,
};

/**
 * Parse a `RRGGBB` / `RGB` hex string (with or without `#`) into 0–255 RGB
 * channels. Returns `null` for anything unparseable.
 */
function parseHex(hex: string): { r: number; g: number; b: number } | null {
  const raw = hex.trim().replace('#', '');
  const full =
    raw.length === 3
      ? raw
          .split('')
          .map((c) => c + c)
          .join('')
      : raw;
  if (full.length !== 6 || /[^0-9a-fA-F]/.test(full)) return null;
  return {
    r: parseInt(full.slice(0, 2), 16),
    g: parseInt(full.slice(2, 4), 16),
    b: parseInt(full.slice(4, 6), 16),
  };
}

/** WCAG relative luminance (0 = black, 1 = white) for an sRGB color. */
function relativeLuminance({ r, g, b }: { r: number; g: number; b: number }): number {
  const toLinear = (channel: number) => {
    const s = channel / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * toLinear(r) + 0.7152 * toLinear(g) + 0.0722 * toLinear(b);
}

/** Format 0–255 channels back to a `#rrggbb` string. */
function toHex({ r, g, b }: { r: number; g: number; b: number }): string {
  const clamp = (n: number) => Math.max(0, Math.min(255, Math.round(n)));
  const hex = (n: number) => clamp(n).toString(16).padStart(2, '0');
  return `#${hex(r)}${hex(g)}${hex(b)}`;
}

/**
 * Produce a dark-theme-safe variant of a brand color. Brands with very dark
 * official colors (GitHub, Apple, X, Notion, ...) become invisible on the dark
 * content surface, so when a color's luminance is low we blend it toward white
 * just enough to stay legible, preserving its hue where one exists. Colors that
 * are already bright enough (Gmail red, AWS orange, ...) pass through unchanged.
 */
function darkModeColor(rgb: { r: number; g: number; b: number }): string {
  const luminance = relativeLuminance(rgb);
  if (luminance >= 0.5) return toHex(rgb);
  // The darker the color, the more it is blended toward white (capped so it
  // never washes out completely and keeps a hint of the original hue).
  const amount = Math.min(0.82, Math.max(0, (0.55 - luminance) / 0.55));
  return toHex({
    r: rgb.r + (255 - rgb.r) * amount,
    g: rgb.g + (255 - rgb.g) * amount,
    b: rgb.b + (255 - rgb.b) * amount,
  });
}

/** Props for {@link ItemIcon}. */
export interface ItemIconProps {
  /** The item's display title; drives brand resolution. */
  title: string;
  /** The item's type; selects the fallback glyph. */
  itemType: ItemType;
  /**
   * Tailwind size class for the outer tile (e.g. `size-9`, `size-11`). Defaults
   * to `size-9` to match the item list rows.
   */
  className?: string;
  /**
   * Pixel size of the inner glyph/logo. Defaults to 18 to match existing rows.
   */
  glyphSize?: number;
}

/**
 * Leading tile for a vault item row. Renders the real brand logo (GitHub,
 * Gmail, AWS, ...) resolved from the item title, drawn in the brand's official
 * color on a soft tint of that color. When the title matches no known brand it
 * falls back to the neutral per-type glyph on a muted tile, preserving the
 * original look for generic items.
 *
 * Brand resolution is fully offline (bundled `simple-icons` + a few inline
 * SVGs); no favicon fetching, so it never leaks which sites are in the vault.
 */
export function ItemIcon({ title, itemType, className, glyphSize = 18 }: ItemIconProps) {
  const brand = resolveBrandIcon(title);

  if (brand) {
    const rgb = parseHex(brand.hex);
    const lightColor = rgb ? toHex(rgb) : `#${brand.hex}`;
    // In dark mode, near-black brand colors would vanish against the dark
    // surface, so use a lightened, legible variant there. CSS selects which
    // pair to use based on the `.dark` class, so it also tracks live theme
    // toggles without re-rendering. `${color}1a`/`2e` are ~10%/~18% alpha tints.
    const darkColor = rgb ? darkModeColor(rgb) : lightColor;
    const brandVars = {
      '--brand-fg-light': lightColor,
      '--brand-bg-light': `${lightColor}1a`,
      '--brand-fg-dark': darkColor,
      '--brand-bg-dark': `${darkColor}2e`,
    } as React.CSSProperties;

    return (
      <span
        className={cn(
          'item-brand-icon flex size-9 shrink-0 items-center justify-center rounded-lg',
          className,
        )}
        style={brandVars}
        aria-hidden
      >
        <svg
          role="img"
          viewBox="0 0 24 24"
          width={glyphSize}
          height={glyphSize}
          xmlns="http://www.w3.org/2000/svg"
        >
          <title>{brand.title}</title>
          <path d={brand.path} />
        </svg>
      </span>
    );
  }

  const Glyph = TYPE_GLYPH[itemType];
  return (
    <span
      className={cn(
        'flex size-9 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground',
        className,
      )}
      aria-hidden
    >
      <Glyph style={{ width: glyphSize, height: glyphSize }} />
    </span>
  );
}

export default ItemIcon;
