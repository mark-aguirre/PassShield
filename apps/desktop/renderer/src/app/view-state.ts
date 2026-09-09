/**
 * Shared top-level view state for the renderer shell.
 *
 * The app shell (`page.tsx`) decides which top-level screen to render based on
 * whether a vault exists and whether it is locked. This module centralizes that
 * state so screens built in separate tasks (onboarding — Task 8.1, unlock —
 * Task 8.2, the vault layout — Task 9) share one vocabulary and one transition
 * contract rather than each inventing their own.
 *
 * _(Req 1.1, 2.1, 2.6)_
 */

/**
 * The mutually-exclusive top-level screens the shell can show.
 *
 * - `loading`     — initial probe of vault existence / lock status in flight.
 * - `onboarding`  — no vault exists; run the first-run create flow. _(Req 1.1)_
 * - `locked`      — a vault exists but is locked; show the unlock screen. _(Req 2.1)_
 * - `recovery`    — user requested password recovery via emergency kit.
 * - `unlocked`    — the vault is unlocked; show the three-pane vault layout.
 * - `error`       — the initial probe failed (e.g. the bridge was unavailable).
 */
export type AppView = 'loading' | 'onboarding' | 'locked' | 'recovery' | 'unlocked' | 'error';

/**
 * Callback a screen invokes to hand control back to the shell after it changes
 * the underlying vault state (e.g. onboarding finishes creating + unlocking a
 * vault, or the unlock screen authenticates successfully).
 */
export type ViewTransition = (next: AppView) => void;
