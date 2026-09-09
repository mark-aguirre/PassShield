'use client';

/**
 * App shell / top-level router for the passShield renderer.
 *
 * On mount it probes the main process for vault existence and lock status and
 * chooses which top-level screen to show:
 *   - no vault            -> OnboardingFlow (first-run create).   _(Req 1.1)_
 *   - vault exists, locked -> UnlockScreen.                       _(Req 2.1)_
 *   - vault unlocked       -> VaultLayout (three-pane dashboard).
 *
 * All IPC calls are mediated by the `useVaultExists`, `useVaultStatus`, and
 * `useVaultLockListener` hooks — no `window.passShield` calls appear here.
 * Screens report state changes back through the shared `AppView` transition
 * contract in `./view-state`, keeping routing state owned here.
 */

import { useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { useVaultExists, useVaultLockListener, useVaultStatus } from '@/hooks/useVault';
import OnboardingFlow from './components/OnboardingFlow';
import UnlockScreen from './components/UnlockScreen';
import VaultLayout from './components/vault/VaultLayout';

export default function HomePage() {
  const existsQuery = useVaultExists();
  const statusQuery = useVaultStatus();

  // Redirect to the unlock screen when the main process pushes a lock event —
  // chiefly when the auto-lock inactivity timer elapses. The hook invalidates
  // the vault status query so `statusQuery` reflects the new locked state
  // automatically. (Req 2.4, 3.2)
  useVaultLockListener();

  const retry = useCallback(() => {
    void existsQuery.refetch();
    void statusQuery.refetch();
  }, [existsQuery, statusQuery]);

  // Still loading vault existence or status.
  if (existsQuery.isPending || (existsQuery.data === true && statusQuery.isPending)) {
    return <CenteredMessage title="passShield" detail="Loading your vault..." />;
  }

  // IPC probe failed.
  if (existsQuery.isError || (existsQuery.data === true && statusQuery.isError)) {
    return (
      <CenteredMessage
        title="Something went wrong"
        detail="passShield could not reach the vault service."
        action={{ label: 'Try again', onClick: retry }}
      />
    );
  }

  // No vault on this device yet — run the first-run create flow.
  if (existsQuery.data === false) {
    return (
      <OnboardingFlow
        onCreated={() => {
          void existsQuery.refetch();
          void statusQuery.refetch();
        }}
      />
    );
  }

  // Vault exists but is locked — show the unlock screen.
  if (statusQuery.data?.locked) {
    return (
      <UnlockScreen
        onUnlocked={() => {
          void statusQuery.refetch();
        }}
      />
    );
  }

  // Vault is unlocked — render the three-pane dashboard.
  return (
    <VaultLayout
      onLock={() => {
        void statusQuery.refetch();
      }}
    />
  );
}

/** Simple centered status screen used for loading / error states. */
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
