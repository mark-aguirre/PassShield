/**
 * Appearance application: turns the persisted `theme` and `accentColor`
 * settings into real, visible changes on the document.
 *
 * The Settings UI persists these values, but they only affect the product once
 * something applies them to the DOM. This module is that bridge:
 *   - Theme ('light' | 'dark' | 'system') toggles the `.dark` class on
 *     <html>, which drives the dark design tokens defined in globals.css.
 *     'system' follows the OS preference and updates live when it changes.
 *   - Accent color overrides the accent-derived CSS custom properties
 *     (--primary, --ring, and their sidebar counterparts) so buttons, links,
 *     focus rings and active states repaint immediately.
 *
 * It is safe to call `applyAppearance` repeatedly; it is idempotent and keeps a
 * single OS-preference listener alive for the lifetime of the window.
 */

import type { ThemePreference } from '@passshield/contracts';

/** The subset of settings that affect appearance. */
export interface Appearance {
  theme: ThemePreference;
  accentColor: string;
}

const SYSTEM_DARK_QUERY = '(prefers-color-scheme: dark)';

/** Last applied appearance, so the OS-preference listener can re-resolve. */
let currentTheme: ThemePreference = 'system';
let systemListenerAttached = false;

/** Whether the resolved theme should be dark for the given preference. */
function resolvesToDark(theme: ThemePreference): boolean {
  if (theme === 'dark') return true;
  if (theme === 'light') return false;
  // 'system' — follow the OS. Guard for non-browser/SSR contexts.
  return typeof window !== 'undefined' && window.matchMedia(SYSTEM_DARK_QUERY).matches;
}

/**
 * Pick a readable foreground (near-black or near-white) for text/icons drawn
 * on top of the accent color, using WCAG relative luminance. Keeps primary
 * buttons legible regardless of the accent the user chooses.
 */
function readableForeground(hex: string): string {
  const normalized = hex.trim().replace('#', '');
  const full =
    normalized.length === 3
      ? normalized
          .split('')
          .map((c) => c + c)
          .join('')
      : normalized;
  if (full.length !== 6 || /[^0-9a-fA-F]/.test(full)) {
    // Unparseable accent — default to white, matching the design's default.
    return 'oklch(0.99 0 0)';
  }
  const toLinear = (channel: number) => {
    const s = channel / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  const r = toLinear(parseInt(full.slice(0, 2), 16));
  const g = toLinear(parseInt(full.slice(2, 4), 16));
  const b = toLinear(parseInt(full.slice(4, 6), 16));
  const luminance = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  // Bright accents get dark text; dark accents get light text.
  return luminance > 0.45 ? 'oklch(0.21 0.03 258)' : 'oklch(0.99 0 0)';
}

/**
 * Apply the given appearance to the document root. Idempotent; also (re)arms a
 * single listener so a 'system' theme tracks OS changes live.
 */
export function applyAppearance(appearance: Appearance): void {
  if (typeof document === 'undefined') return;

  currentTheme = appearance.theme;
  const root = document.documentElement;

  root.classList.toggle('dark', resolvesToDark(appearance.theme));

  const accent = appearance.accentColor;
  const foreground = readableForeground(accent);
  // Accent-derived tokens consumed by shadcn/ui and Tailwind color utilities.
  root.style.setProperty('--primary', accent);
  root.style.setProperty('--primary-foreground', foreground);
  root.style.setProperty('--ring', accent);
  root.style.setProperty('--sidebar-primary', accent);
  root.style.setProperty('--sidebar-primary-foreground', foreground);
  root.style.setProperty('--sidebar-ring', accent);

  ensureSystemListener();
}

/** Attach (once) an OS-preference listener so 'system' theme updates live. */
function ensureSystemListener(): void {
  if (systemListenerAttached || typeof window === 'undefined' || !window.matchMedia) return;
  const media = window.matchMedia(SYSTEM_DARK_QUERY);
  media.addEventListener('change', (event) => {
    if (currentTheme === 'system') {
      document.documentElement.classList.toggle('dark', event.matches);
    }
  });
  systemListenerAttached = true;
}
