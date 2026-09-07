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
    const color = `#${brand.hex}`;
    return (
      <span
        className={cn('flex size-9 shrink-0 items-center justify-center rounded-lg', className)}
        // Soft tint of the brand color behind the logo. `${color}1a` == 10% alpha.
        style={{ backgroundColor: `${color}1a` }}
        aria-hidden
      >
        <svg
          role="img"
          viewBox="0 0 24 24"
          width={glyphSize}
          height={glyphSize}
          fill={color}
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
