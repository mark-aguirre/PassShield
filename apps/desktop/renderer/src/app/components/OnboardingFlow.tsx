'use client';

/**
 * OnboardingFlow — first-run vault creation.
 *
 * Shown by the app shell when `window.passShield.vault.exists()` reports no
 * vault. Collects a vault name, master password + confirmation, and a storage
 * mode (V1 offers only "local", which is the default). On submit it rejects a
 * confirmation mismatch inline without creating anything, otherwise it calls
 * `vault.create(...)`. No network / cloud registration is performed. _(Req 1.5)_
 *
 * On success the vault is created and unlocked, so the shell is asked to move
 * to the `unlocked` view.
 *
 * _(Req 1.1, 1.2, 1.3, 1.5, 1.6, 1.7)_
 */

import { useId, useState, type FormEvent } from 'react';
import type { CreateVaultInput, StorageMode } from '@passshield/contracts';
import { ShieldCheck } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import type { ViewTransition } from '../view-state';

interface OnboardingFlowProps {
  /** Invoked by the shell-provided transition after a vault is created. */
  onCreated: ViewTransition;
}

/** V1 storage-mode options. Only "local" is available; it is the default. _(Req 1.7)_ */
const STORAGE_MODES: ReadonlyArray<{ value: StorageMode; label: string; hint: string }> = [
  {
    value: 'local',
    label: 'Keep my vault on this device',
    hint: 'Your vault stays on this computer. No account or network connection required.',
  },
];

export default function OnboardingFlow({ onCreated }: OnboardingFlowProps) {
  const [name, setName] = useState('');
  const [masterPassword, setMasterPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [storageMode, setStorageMode] = useState<StorageMode>('local');

  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const nameId = useId();
  const passwordId = useId();
  const confirmId = useId();
  const errorId = useId();

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting) {
      return;
    }
    setError(null);

    const trimmedName = name.trim();
    if (trimmedName.length === 0) {
      setError('Enter a name for your vault.');
      return;
    }
    if (masterPassword.length === 0) {
      setError('Set a master password.');
      return;
    }
    // Reject on mismatch without creating a vault. _(Req 1.6)_
    if (masterPassword !== confirmPassword) {
      setError('Passwords do not match. Please re-enter your confirmation.');
      return;
    }

    const input: CreateVaultInput = {
      name: trimmedName,
      masterPassword,
      confirmPassword,
      storageMode,
    };

    setSubmitting(true);
    try {
      const result = await window.passShield.vault.create(input);
      if (!result.ok) {
        setError(result.error.message);
        return;
      }
      // Vault created (and unlocked by the main process). Hand back to shell.
      onCreated('unlocked');
    } catch {
      setError('Could not create the vault. Please try again.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-sidebar p-6">
      <section
        className="w-full max-w-md rounded-2xl border border-border bg-card p-8 shadow-2xl"
        aria-labelledby="onboarding-heading"
      >
        <header className="mb-6 flex flex-col items-center gap-3 text-center">
          <span className="flex size-12 items-center justify-center rounded-2xl bg-primary text-primary-foreground shadow-sm">
            <ShieldCheck className="size-6" />
          </span>
          <h1 id="onboarding-heading" className="text-2xl font-bold text-foreground">
            Create your vault
          </h1>
          <p className="text-sm leading-relaxed text-muted-foreground">
            passShield stores your credentials locally, protected by a master password. There
            is no account to create and nothing is sent over the network.
          </p>
        </header>

        <form className="flex flex-col gap-4" onSubmit={handleSubmit} noValidate>
          <div className="flex flex-col gap-2">
            <Label htmlFor={nameId}>Vault name</Label>
            <Input
              id={nameId}
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              autoComplete="off"
              autoFocus
              disabled={submitting}
              placeholder="My Vault"
            />
          </div>

          <div className="flex flex-col gap-2">
            <Label htmlFor={passwordId}>Master password</Label>
            <Input
              id={passwordId}
              type="password"
              value={masterPassword}
              onChange={(e) => setMasterPassword(e.target.value)}
              autoComplete="new-password"
              disabled={submitting}
            />
          </div>

          <div className="flex flex-col gap-2">
            <Label htmlFor={confirmId}>Confirm master password</Label>
            <Input
              id={confirmId}
              type="password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              autoComplete="new-password"
              disabled={submitting}
              aria-invalid={error != null && masterPassword !== confirmPassword}
            />
          </div>

          <fieldset className="flex flex-col gap-2 border-0 p-0" disabled={submitting}>
            <legend className="mb-1 text-sm font-medium text-foreground">Storage mode</legend>
            {STORAGE_MODES.map((mode) => (
              <label
                key={mode.value}
                className="flex cursor-pointer items-start gap-3 rounded-lg border border-border p-3 transition-colors has-[:checked]:border-primary has-[:checked]:bg-primary/5"
              >
                <input
                  type="radio"
                  name="storageMode"
                  value={mode.value}
                  checked={storageMode === mode.value}
                  onChange={() => setStorageMode(mode.value)}
                  className="mt-0.5 accent-[var(--primary)]"
                />
                <span className="flex flex-col gap-0.5">
                  <span className="text-sm font-medium text-foreground">{mode.label}</span>
                  <span className="text-xs leading-relaxed text-muted-foreground">
                    {mode.hint}
                  </span>
                </span>
              </label>
            ))}
          </fieldset>

          {error != null && (
            <p
              id={errorId}
              className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive"
              role="alert"
            >
              {error}
            </p>
          )}

          <Button
            type="submit"
            className="mt-2 w-full"
            disabled={submitting}
            aria-describedby={error != null ? errorId : undefined}
          >
            {submitting ? 'Creating vault...' : 'Create vault'}
          </Button>
        </form>
      </section>
    </main>
  );
}
