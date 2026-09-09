'use client';

/**
 * useVault — vault lifecycle hook.
 *
 * Centralises every IPC interaction that touches the vault's lock state:
 * probing existence, reading status, unlocking, locking, creating, and
 * changing the master password. Components never call `api.vault.*` directly;
 * they consume this hook's returned state and operations.
 *
 * ## Queries
 * - `vaultExists`  — whether a vault has been created on this device.
 * - `vaultStatus`  — current lock state + configured auto-lock minutes.
 *
 * ## Mutations
 * - `unlock`               — authenticate and unlock the vault.
 * - `lock`                 — lock the vault immediately.
 * - `create`               — create a new vault (first-run).
 * - `changeMasterPassword` — re-encrypt the vault under a new password.
 *
 * ## Push subscription
 * `useVaultLockListener` — subscribes to `vault.onLocked` push events from
 * the main process (auto-lock timer, system lock) and calls the supplied
 * callback so the app shell can transition to the locked screen.
 *
 * ## Result<T> convention
 * Mutations whose IPC methods return `Result<T>` throw on failure so TanStack
 * Query surfaces the error via `mutation.error` rather than requiring callers
 * to inspect `result.ok` themselves. The thrown message is safe (non-secret)
 * and sourced from the contracts `IpcError.message` field.
 */

import { useEffect } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  ChangeMasterPasswordInput,
  CreateVaultInput,
  ResetPasswordWithKitInput,
} from '@PassShield/contracts';
import { api } from '@/lib/api';

// ---------------------------------------------------------------------------
// Query keys — centralised so invalidation is consistent across the codebase.
// ---------------------------------------------------------------------------

export const vaultKeys = {
  exists: ['vault', 'exists'] as const,
  status: ['vault', 'status'] as const,
};

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

/**
 * Whether a vault has been created on this device.
 * Used by the app shell to decide between the onboarding and unlock screens.
 */
export function useVaultExists() {
  return useQuery({
    queryKey: vaultKeys.exists,
    queryFn: () => api.vault.exists(),
  });
}

/**
 * Current lock state and auto-lock configuration.
 * Disabled (skips fetching) when no vault exists yet.
 */
export function useVaultStatus() {
  return useQuery({
    queryKey: vaultKeys.status,
    queryFn: () => api.vault.status(),
  });
}

// ---------------------------------------------------------------------------
// Mutations
// ---------------------------------------------------------------------------

/** Unlock the vault with the master password. Invalidates vault status on success. */
export function useUnlockVault() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (password: string) => {
      const result = await api.vault.unlock(password);
      if (!result.ok) throw new Error(result.error.message);
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: vaultKeys.status });
    },
  });
}

/** Lock the vault immediately. Invalidates all cached vault/item/category data. */
export function useLockVault() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => api.vault.lock(),
    onSuccess: () => {
      // The vault is now locked; all item and category data is inaccessible.
      // Invalidate everything so queries return empty results rather than stale
      // data if the user unlocks again in the same session.
      void queryClient.invalidateQueries({ queryKey: vaultKeys.status });
      void queryClient.invalidateQueries({ queryKey: ['items'] });
      void queryClient.invalidateQueries({ queryKey: ['categories'] });
    },
  });
}

/** Create a new vault (first-run). Invalidates vault existence + status on success. */
export function useCreateVault() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: CreateVaultInput) => {
      const result = await api.vault.create(input);
      if (!result.ok) throw new Error(result.error.message);
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: vaultKeys.exists });
      void queryClient.invalidateQueries({ queryKey: vaultKeys.status });
    },
  });
}

/**
 * Change the master password. Re-verifies the current password on the main
 * process before re-encrypting the vault; no secret values are held in the
 * hook. Invalidates vault status on success.
 */
export function useChangeMasterPassword() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: ChangeMasterPasswordInput) => {
      const result = await api.vault.changeMasterPassword(input);
      if (!result.ok) throw new Error(result.error.message);
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: vaultKeys.status });
    },
  });
}

// ---------------------------------------------------------------------------
// Emergency kit (forgot-password recovery)
// ---------------------------------------------------------------------------

export const emergencyKitKeys = {
  status: ['vault', 'emergencyKit', 'status'] as const,
};

/**
 * Whether an emergency recovery kit has been set up for the current vault.
 * Safe to call while locked — the main process reads only the non-secret hash
 * column.
 */
export function useEmergencyKitStatus() {
  return useQuery({
    queryKey: emergencyKitKeys.status,
    queryFn: () => api.vault.emergencyKitStatus(),
  });
}

/**
 * Generate a new emergency recovery kit. Requires an unlocked vault.
 * Returns `EmergencyKitResult.plainCode` once — the caller must display it
 * immediately; it cannot be retrieved again. Invalidates the kit status query
 * on success so the UI reflects that a kit now exists.
 */
export function useGenerateEmergencyKit() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      const result = await api.vault.generateEmergencyKit();
      if (!result.ok) throw new Error(result.error.message);
      return result.value; // { plainCode }
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: emergencyKitKeys.status });
    },
  });
}

/**
 * Reset the master password using a previously generated emergency recovery
 * code. Verifies the code, re-encrypts the vault under the new password, and
 * clears the kit hash so the same code cannot be reused.
 * On success the vault transitions to unlocked; vault status is invalidated.
 */
export function useResetPasswordWithKit() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: ResetPasswordWithKitInput) => {
      const result = await api.vault.resetPasswordWithEmergencyKit(input);
      if (!result.ok) throw new Error(result.error.message);
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: vaultKeys.status });
      void queryClient.invalidateQueries({ queryKey: emergencyKitKeys.status });
    },
  });
}

// ---------------------------------------------------------------------------
// Queries — app metadata
// ---------------------------------------------------------------------------

/**
 * The running application version string (e.g. "1.0.3"), sourced from the
 * packaged app via the main process so UI surfaces always reflect the real
 * build. Used by the About pane in Settings. _(Req 14)_
 */
export function useAppVersion() {
  return useQuery({
    queryKey: ['app', 'version'] as const,
    queryFn: () => api.app.version(),
  });
}

// ---------------------------------------------------------------------------
// Push subscription
// ---------------------------------------------------------------------------

/**
 * Subscribe to vault-lock push notifications from the main process.
 *
 * The main process emits `vault:locked` whenever the vault locks without an
 * explicit renderer request — most importantly when the auto-lock inactivity
 * timer elapses or the system locks. This hook:
 *   1. Invalidates the vault status query so `useVaultStatus` reflects the new
 *      locked state.
 *   2. Invalidates all item and category queries so the UI shows empty lists
 *      rather than stale data.
 *   3. Calls the optional `onLocked` callback so the app shell can transition
 *      to the locked screen.
 *
 * Should be mounted once in the app shell; the returned cleanup runs on
 * unmount. (Req 2.4, 3.2)
 */
export function useVaultLockListener(onLocked?: () => void) {
  const queryClient = useQueryClient();

  useEffect(() => {
    const unsubscribe = api.vault.onLocked(() => {
      void queryClient.invalidateQueries({ queryKey: vaultKeys.status });
      void queryClient.invalidateQueries({ queryKey: ['items'] });
      void queryClient.invalidateQueries({ queryKey: ['categories'] });
      onLocked?.();
    });
    return unsubscribe;
  }, [queryClient, onLocked]);
}
