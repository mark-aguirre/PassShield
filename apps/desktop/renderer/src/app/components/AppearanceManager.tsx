'use client';

/**
 * AppearanceManager — applies the persisted Theme and Accent color to the whole
 * app on startup, independent of whether the Settings surface is ever opened.
 *
 * Rendered once near the root (see layout.tsx). It fetches the saved settings
 * via the narrow IPC surface and hands the appearance fields to
 * {@link applyAppearance}, which toggles the dark design tokens and overrides
 * the accent-derived CSS variables. It renders nothing.
 *
 * The Settings UI additionally calls `applyAppearance` on every change so edits
 * are reflected instantly; this component covers the initial load and keeps the
 * OS-preference listener armed for the 'system' theme.
 */

import { useEffect } from 'react';
import { applyAppearance } from '@/lib/appearance';

export function AppearanceManager() {
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const settings = await window.passShield.settings.get();
        if (!cancelled) {
          applyAppearance({ theme: settings.theme, accentColor: settings.accentColor });
        }
      } catch {
        // Settings store unavailable — leave the default (light) appearance.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return null;
}

export default AppearanceManager;
