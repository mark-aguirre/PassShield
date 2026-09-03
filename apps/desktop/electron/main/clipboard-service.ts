/**
 * Clipboard Service (Electron main process).
 *
 * Owns the safe copy-a-secret flow required by the design's "Reveal and
 * Clipboard Safety" section. Copies always route through the main process so
 * the renderer never drives the OS clipboard directly, and every copied secret
 * is scheduled to be cleared after a configurable interval. (Req 9.3, 9.4)
 *
 * Security posture:
 * - The copied value is a secret. It is held only transiently to power the
 *   best-effort clear comparison and is NEVER logged, echoed, or serialized.
 *   (Req 13.1)
 * - Clearing is best-effort: when the timer fires we clear the clipboard only
 *   if it still contains exactly the value we wrote. If the user copied
 *   something else in the meantime we leave their clipboard untouched rather
 *   than wiping unrelated data. (Req 9.4)
 * - On lock (manual, auto, or app exit) the vault calls {@link clearNow} so any
 *   pending secret is removed from the clipboard immediately and the pending
 *   timer is cancelled. (Req 9.5)
 *
 * The Electron `clipboard` module is injected so the service is unit-testable
 * without a running Electron environment. The main entry supplies the real
 * `clipboard` module.
 */

/**
 * The minimal slice of Electron's `clipboard` module this service needs.
 * Declared locally so the service can be constructed with the real module or a
 * lightweight test double.
 *
 * Electron's top-level clipboard API is promise-based (`readText`/`writeText`
 * resolve rather than return synchronously), so the methods are typed as
 * possibly-async. The service tolerates both synchronous and promise-returning
 * doubles via {@link resolveMaybe}, which keeps tests simple. (Req 9.3, 9.4)
 */
export interface ClipboardLike {
  /** Read the clipboard's current text content. */
  readText(): string | Promise<string>;
  /** Write text to the clipboard. */
  writeText(text: string): void | Promise<void>;
  /** Clear the clipboard contents. */
  clear(): void | Promise<void>;
}

/** Normalise a possibly-async clipboard result into a promise. */
async function resolveMaybe<T>(value: T | Promise<T>): Promise<T> {
  return await value;
}

/**
 * The timer primitives this service depends on. Injected so tests can drive
 * time deterministically; defaults to the global `setTimeout`/`clearTimeout`.
 */
export interface TimerLike {
  setTimeout(handler: () => void, timeoutMs: number): unknown;
  clearTimeout(handle: unknown): void;
}

/** Default clipboard-clear interval (seconds) when none is configured. (Req 9.4) */
export const DEFAULT_CLIPBOARD_CLEAR_SECONDS = 45;

/** Options for constructing a {@link ClipboardService}. */
export interface ClipboardServiceOptions {
  /** The Electron `clipboard` module (or a compatible double in tests). */
  readonly clipboard: ClipboardLike;
  /**
   * Clipboard-clear interval in seconds. When omitted the
   * {@link DEFAULT_CLIPBOARD_CLEAR_SECONDS} default is used. A non-positive
   * value disables the auto-clear timer (the copy still happens). (Req 9.4)
   */
  readonly clearSeconds?: number;
  /** Optional timer primitives; defaults to the global timers. */
  readonly timers?: TimerLike;
  /** Optional non-secret logger for operational events. (Req 13) */
  readonly logger?: { info: (message: string, meta?: Record<string, unknown>) => void };
}

/**
 * Routes secret copies through the main process and clears them from the
 * clipboard after the configured interval. A single instance is held by the
 * main process for the app's lifetime.
 */
export class ClipboardService {
  private readonly clipboard: ClipboardLike;
  private readonly timers: TimerLike;
  private readonly logger?: ClipboardServiceOptions['logger'];

  /** Clear interval in seconds; <= 0 disables the auto-clear timer. */
  private clearSeconds: number;

  /** The pending clear timer handle, or null when none is scheduled. */
  private pendingTimer: unknown = null;

  /**
   * The last value we wrote to the clipboard. Held transiently only to power
   * the best-effort clear comparison; dropped as soon as the clear runs or the
   * clipboard is cleared. NEVER logged. (Req 13.1)
   */
  private lastWritten: string | null = null;

  constructor(options: ClipboardServiceOptions) {
    this.clipboard = options.clipboard;
    this.timers = options.timers ?? {
      setTimeout: (handler, timeoutMs) => setTimeout(handler, timeoutMs),
      clearTimeout: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
    };
    this.logger = options.logger;
    this.clearSeconds = options.clearSeconds ?? DEFAULT_CLIPBOARD_CLEAR_SECONDS;
  }

  /**
   * Update the clipboard-clear interval (seconds). Applies to copies made after
   * this call; a value <= 0 disables the auto-clear timer. Sourced from the
   * persisted `clipboardClearSeconds` setting. (Req 9.4)
   */
  setClearSeconds(seconds: number): void {
    this.clearSeconds = seconds;
  }

  /**
   * Copy a secret to the clipboard and (re)start the clear timer. Any pending
   * clear from a prior copy is cancelled and replaced so only the most recent
   * copy governs the countdown. The value is never logged. (Req 9.3, 9.4, 13.1)
   */
  copySecret(value: string): void {
    // Replace any prior pending clear so the newest copy owns the timer.
    this.cancelPendingTimer();

    this.lastWritten = value;
    // Write is fire-and-forget: the contract returns void. Swallow OS errors so
    // a clipboard failure never surfaces the secret. (Req 13.1)
    void resolveMaybe(this.clipboard.writeText(value)).catch(() => undefined);
    this.logger?.info('clipboard secret copied');

    if (this.clearSeconds <= 0) {
      // Auto-clear disabled; the value stays until the user overwrites it.
      return;
    }

    const timeoutMs = this.clearSeconds * 1000;
    this.pendingTimer = this.timers.setTimeout(() => {
      this.pendingTimer = null;
      void this.clearIfUnchanged();
    }, timeoutMs);
  }

  /**
   * Clear the clipboard immediately and cancel any pending timer. Used on vault
   * lock (manual, auto, or app exit) so a revealed/copied secret does not linger
   * after the vault is secured. Unlike the timed clear this is unconditional:
   * on lock we prioritise removing the secret over preserving whatever is on the
   * clipboard. Idempotent. (Req 9.5)
   */
  clearNow(): void {
    this.cancelPendingTimer();
    if (this.lastWritten === null) {
      // We have not copied anything (or already cleared); nothing to do.
      return;
    }
    this.lastWritten = null;
    // Fire-and-forget clear; swallow OS errors and never log the secret. (Req 13.1)
    void resolveMaybe(this.clipboard.clear()).catch(() => undefined);
    this.logger?.info('clipboard cleared on lock');
  }

  /**
   * Best-effort timed clear: wipe the clipboard only if it still holds exactly
   * the value we last wrote, so a value the user copied afterward is preserved.
   * (Req 9.4)
   */
  private async clearIfUnchanged(): Promise<void> {
    const expected = this.lastWritten;
    if (expected === null) {
      return;
    }
    this.lastWritten = null;
    try {
      const current = await resolveMaybe(this.clipboard.readText());
      if (current === expected) {
        await resolveMaybe(this.clipboard.clear());
        this.logger?.info('clipboard cleared on timeout');
      }
    } catch {
      // Degrade gracefully on OS clipboard errors; never log the secret. (Req 13.1)
    }
  }

  /** Cancel any scheduled clear timer without touching the clipboard. */
  private cancelPendingTimer(): void {
    if (this.pendingTimer !== null) {
      this.timers.clearTimeout(this.pendingTimer);
      this.pendingTimer = null;
    }
  }
}
