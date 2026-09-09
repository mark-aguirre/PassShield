'use client';

/**
 * AppearanceManager — applies the persisted Theme and Accent color to the whole
 * app on startup, independent of whether the Settings surface is ever opened.
 *
 * Rendered once near the root (see layout.tsx). It reads the saved settings
 * via `useSettings` (TanStack Query / api.settings.get) and hands the
 * appearance fields to {@link applyAppearance}, which toggles the dark design
 * tokens and overrides the accent-derived CSS variables. It renders nothing.
 *
 * The Settings UI additionally calls `applyAppearance` on every change so edits
 * are reflected instantly; this component covers the initial load and keeps the
 * OS-preference listener armed for the 'system' theme.
 */

import { useEffect } from 'react';
import { applyAppearance } from '@/lib/appearance';
import { useSettings } from '@/hooks/useSettings';

export function AppearanceManager() {
  const { data: settings } = useSettings();

  useEffect(() => {
    if (settings) {
      applyAppearance({ theme: settings.theme, accentColor: settings.accentColor });
    }
  }, [settings]);

  return null;
}

export default AppearanceManager;
