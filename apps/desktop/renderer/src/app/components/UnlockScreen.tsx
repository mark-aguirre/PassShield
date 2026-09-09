'use client';

import { useId, useState, type FormEvent } from 'react';
import { ShieldCheck } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useUnlockVault } from '@/hooks/useVault';

/**
 * Props for {@link UnlockScreen}.
 */
export interface UnlockScreenProps {
  /**
   * Invoked after the vault is successfully unlocked. The parent uses this to
   * transition to the vault view and reflect the unlocked state in the UI.
   * _(Req 2.2, 2.6)_
   */
  onUnlocked: () => void;
}

/** Generic, non-revealing message shown on any unlock failure. _(Req 2.3)_ */
const UNLOCK_ERROR_MESSAGE = 'Unable to unlock. Check your master password.';

/**
 * Master-password entry screen shown when a vault already exists.
 *
 * On submit it asks the main process to unlock the vault through the
 * `useUnlockVault` mutation. A successful result triggers
 * {@link UnlockScreenProps.onUnlocked}; any failure surfaces a single generic
 * message and reveals nothing about the vault or the reason for failure.
 * _(Req 2.1, 2.2, 2.3, 2.6)_
 */
export function UnlockScreen({ onUnlocked }: UnlockScreenProps) {
  const passwordFieldId = useId();
  const errorMessageId = useId();

  const [password, setPassword] = useState('');
  const unlock = useUnlockVault();

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (unlock.isPending) return;

    // Clear the previous error state before a new attempt.
    unlock.reset();

    try {
      await unlock.mutateAsync(password);
      // Do not retain the master password in component state after use.
      setPassword('');
      onUnlocked();
    } catch {
      // Error is captured in unlock.error — no local state needed.
    }
  }

  const isSubmitting = unlock.isPending;
  // Always show a generic message regardless of the actual failure reason so
  // nothing about the vault or the password is revealed. (Req 2.3)
  const error = unlock.isError ? UNLOCK_ERROR_MESSAGE : null;

  return (
    <main className="flex min-h-screen items-center justify-center bg-sidebar p-6">
      <section
        className="w-full max-w-sm rounded-2xl border border-border bg-card p-8 shadow-2xl"
        aria-labelledby={`${passwordFieldId}-heading`}
      >
        <header className="mb-6 flex flex-col items-center gap-3 text-center">
          <span className="flex size-12 items-center justify-center rounded-2xl bg-primary text-primary-foreground shadow-sm">
            <ShieldCheck className="size-6" />
          </span>
          <h1 id={`${passwordFieldId}-heading`} className="text-2xl font-bold text-foreground">
            Unlock passShield
          </h1>
          <p className="text-sm text-muted-foreground">
            Enter your master password to unlock your vault.
          </p>
        </header>

        <form onSubmit={handleSubmit} noValidate className="flex flex-col gap-3">
          <div className="flex flex-col gap-2">
            <Label htmlFor={passwordFieldId}>Master password</Label>
            <Input
              id={passwordFieldId}
              name="masterPassword"
              type="password"
              autoComplete="current-password"
              autoFocus
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              disabled={isSubmitting}
              aria-invalid={error !== null}
              aria-describedby={error ? errorMessageId : undefined}
            />
          </div>

          {error && (
            <p
              id={errorMessageId}
              role="alert"
              className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive"
            >
              {error}
            </p>
          )}

          <Button type="submit" className="mt-1 w-full" disabled={isSubmitting}>
            {isSubmitting ? 'Unlocking...' : 'Unlock'}
          </Button>
        </form>
      </section>
    </main>
  );
}

export default UnlockScreen;
