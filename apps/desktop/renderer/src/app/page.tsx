'use client';

/**
 * App shell / top-level router for the passShield renderer.
 *
 * On mount it probes the main process for vault existence and lock status and
 * chooses which top-level screen to show:
 *   - no vault            -> OnboardingFlow (first-run create).   _(Req 1.1)_
 *   - vault exists, locked -> UnlockScreen (Task 8.2).            _(Req 2.1)_
 *   - vault unlocked       -> VaultLayout (Task 9, three-pane dashboard).
 *
 * Screens report state changes back through the shared `AppView` transition
 * contract in `./view-state`, keeping routing state owned here.
 */

import { useCallback, useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import OnboardingFlow from './components/OnboardingFlow';
import UnlockScreen from './components/UnlockScreen';
import VaultLayout from './components/vault/VaultLayout';
import type { AppView } from './view-state';

export default function HomePage() {
  const [view, setView] = useState<AppView>('loading');

  const goTo = useCallback((next: AppView) => {
    setView(next);
  }, []);

  const probe = useCallback(async () => {
    setView('loading');
    try {
      const exists = await window.passShield.vault.exists();
      if (!exists) {
        setView('onboarding');
        return;
      }
      const status = await window.passShield.vault.status();
      setView(status.locked ? 'locked' : 'unlocked');
    } catch {
      setView('error');
    }
  }, []);

  useEffect(() => {
    void probe();
  }, [probe]);

  switch (view) {
    case 'loading':
      return <CenteredMessage title="passShield" detail="Loading your vault..." />;

    case 'onboarding':
      return <OnboardingFlow onCreated={goTo} />;

    case 'locked':
      return <UnlockScreen onUnlocked={() => goTo('unlocked')} />;

    case 'unlocked':
      // Three-pane vault layout (Task 9). The lock control transitions the
      // shell back to the locked screen once the vault is locked.
      return <VaultLayout onLock={() => goTo('locked')} />;

    case 'error':
    default:
      return (
        <CenteredMessage
          title="Something went wrong"
          detail="passShield could not reach the vault service."
          action={{ label: 'Try again', onClick: () => void probe() }}
        />
      );
  }
}

/** Simple centered status screen used for loading / unlocked / error states. */
function CenteredMessage({
  title,
  detail,
  action,
}: {
  title: string;
  detail: string;
  action?: { label: string; onClick: () => void };
}) {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-3 bg-sidebar p-6 text-center text-sidebar-foreground">
      <h1 className="text-2xl font-bold">{title}</h1>
      <p className="text-sm text-sidebar-muted">{detail}</p>
      {action && (
        <Button type="button" onClick={action.onClick} className="mt-2">
          {action.label}
        </Button>
      )}
    </main>
  );
}
