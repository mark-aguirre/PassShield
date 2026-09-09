'use client';

/**
 * ForgotPasswordScreen — emergency kit password reset flow.
 *
 * Shown when the user clicks "Forgot master password?" on the unlock screen.
 * Collects the emergency recovery code and a new master password, then calls
 * `vault.resetPasswordWithEmergencyKit` on the main process to verify the code
 * and re-encrypt the vault.
 *
 * Security posture:
 * - No secret is stored in component state beyond the transient form inputs.
 * - On any error a generic message is shown; the code is never echoed back in
 *   error text so it is not leaked via screen-sharing or logs.
 * - On success the parent (`page.tsx`) transitions to the unlocked view.
 * - Dashes and mixed case in the recovery code are accepted; the crypto layer
 *   normalises them before verification.
 */

import { useId, useState, type FormEvent } from 'react';
import { ArrowLeft, ShieldAlert } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useResetPasswordWithKit } from '@/hooks/useVault';

export interface ForgotPasswordScreenProps {
  /**
   * Invoked after the vault has been successfully re-encrypted and unlocked
   * with the new master password. The parent shell uses this to transition to
   * the unlocked vault view.
   */
  onRecovered: () => void;
  /**
   * Invoked when the user clicks "Back to unlock". The parent shell navigates
   * back to the UnlockScreen.
   */
  onBack: () => void;
}

export default function ForgotPasswordScreen({ onRecovered, onBack }: ForgotPasswordScreenProps) {
  const recoveryCodeId = useId();
  const newPasswordId = useId();
  const confirmPasswordId = useId();
  const errorId = useId();

  const [recoveryCode, setRecoveryCode] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [clientError, setClientError] = useState<string | null>(null);

  const resetMutation = useResetPasswordWithKit();
  const isSubmitting = resetMutation.isPending;
  const serverError = resetMutation.error?.message ?? null;
  const error = clientError ?? serverError;

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (isSubmitting) return;

    setClientError(null);
    resetMutation.reset();

    if (!recoveryCode.trim()) {
      setClientError('Enter your emergency recovery code.');
      return;
    }
    if (!newPassword) {
      setClientError('Enter a new master password.');
      return;
    }
    if (newPassword !== confirmPassword) {
      setClientError('The new passwords do not match.');
      return;
    }

    try {
      await resetMutation.mutateAsync({
        recoveryCode: recoveryCode.trim(),
        newPassword,
        confirmPassword,
      });
      // Clear sensitive fields from component state before handing control
      // back to the parent.
      setRecoveryCode('');
      setNewPassword('');
      setConfirmPassword('');
      onRecovered();
    } catch {
      // Error surfaced via resetMutation.error above.
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-sidebar p-6">
      <section
        className="w-full max-w-md rounded-2xl border border-border bg-card p-8 shadow-2xl"
        aria-labelledby="recovery-heading"
      >
        <header className="mb-6 flex flex-col items-center gap-3 text-center">
          <span className="flex size-12 items-center justify-center rounded-2xl bg-warning/20 text-warning shadow-sm">
            <ShieldAlert className="size-6" />
          </span>
          <h1 id="recovery-heading" className="text-2xl font-bold text-foreground">
            Recover your vault
          </h1>
          <p className="text-sm leading-relaxed text-muted-foreground">
            Enter the emergency recovery code from your kit and choose a new master password. Your
            vault will be re-encrypted with the new password.
          </p>
        </header>

        <form onSubmit={handleSubmit} noValidate className="flex flex-col gap-4">
          {/* Recovery code */}
          <div className="flex flex-col gap-2">
            <Label htmlFor={recoveryCodeId}>Recovery code</Label>
            <Input
              id={recoveryCodeId}
              type="text"
              autoComplete="off"
              autoFocus
              spellCheck={false}
              placeholder="XXXXXX-XXXXXX-XXXXXX-XXXXXX-XXXXXXXX"
              value={recoveryCode}
              onChange={(e) => setRecoveryCode(e.target.value)}
              disabled={isSubmitting}
              className="font-mono tracking-wider"
              aria-describedby={error ? errorId : undefined}
            />
          </div>

          {/* New password */}
          <div className="flex flex-col gap-2">
            <Label htmlFor={newPasswordId}>New master password</Label>
            <Input
              id={newPasswordId}
              type="password"
              autoComplete="new-password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              disabled={isSubmitting}
            />
          </div>

          {/* Confirm new password */}
          <div className="flex flex-col gap-2">
            <Label htmlFor={confirmPasswordId}>Confirm new password</Label>
            <Input
              id={confirmPasswordId}
              type="password"
              autoComplete="new-password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              disabled={isSubmitting}
              aria-invalid={
                confirmPassword.length > 0 && confirmPassword !== newPassword ? true : undefined
              }
            />
          </div>

          {/* Error message */}
          {error && (
            <p
              id={errorId}
              role="alert"
              className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive"
            >
              {error}
            </p>
          )}

          <Button type="submit" className="mt-1 w-full" disabled={isSubmitting}>
            {isSubmitting ? 'Resetting password…' : 'Reset master password'}
          </Button>
        </form>

        {/* Back link */}
        <div className="mt-5 flex justify-center">
          <button
            type="button"
            onClick={onBack}
            disabled={isSubmitting}
            className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors disabled:pointer-events-none"
          >
            <ArrowLeft className="size-3.5" />
            Back to unlock
          </button>
        </div>
      </section>
    </main>
  );
}
