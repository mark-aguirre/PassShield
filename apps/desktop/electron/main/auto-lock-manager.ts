/**
 * Auto-Lock Manager (Electron main process).
 *
 * Tracks an inactivity timer and, when the configured timeout elapses without
 * any user activity, invokes a provided lock callback (wired to
 * `VaultService.lock()`), which drops the in-memory key and cached secrets
 * where practical. (Req 3.1, 3.2, 3.3)
 *
 * Activity is signalled from the renderer as throttled, NON-SECRET activity
 * pings (mouse movement, key presses) forwarded across the narrow IPC surface
 * to {@link AutoLockManager.ping}. A ping simply reschedules the inactivity
 * timer — an O(1) operation — so a flood of pings stays cheap; the renderer is
 * expected to throttle, but this manager also tolerates high-frequency pings.
 * Pings never carry secret material. (Req 3.1)
 *
 * The timeout is expressed in minutes and is persisted as a user setting so it
 * applies across sessions (read on startup and applied via
 * {@link AutoLockManager.setTimeoutMinutes}). A value of `<= 0` disables
 * auto-lock ("never"): the timer is cleared and pings become no-ops until a
 * positive timeout is configured again. (Req 3.4)
 */

/** A callback invoked when the inactivity timeout elapses. */
export type LockCallback = () => void;

/** Options for constructing an {@link AutoLockManager}. */
export interface AutoLockManagerOptions {
  /**
   * Inactivity timeout in minutes. `<= 0` disables auto-lock. This should be
   * seeded from the persisted setting so it applies across sessions. (Req 3.4)
   */
  readonly timeoutMinutes: number;
  /**
   * Called when the inactivity timeout elapses. Wired to `VaultService.lock()`
   * so the vault locks and secrets are cleared where practical. (Req 3.2, 3.3)
   */
  readonly onLock: LockCallback;
  /** Optional non-secret logger for operational events. (Req 13) */
  readonly logger?: { info: (message: string, meta?: Record<string, unknown>) => void };
}

/** Number of milliseconds in one minute. */
const MS_PER_MINUTE = 60_000;

/**
 * Owns the inactivity timer for auto-lock. A single instance is held by the
 * main process for the lifetime of the app.
 */
export class AutoLockManager {
  private readonly onLock: LockCallback;
  private readonly logger?: AutoLockManagerOptions['logger'];

  /** Current inactivity timeout in minutes; `<= 0` means disabled. */
  private timeoutMinutes: number;

  /** True while the timer is actively running (i.e. after {@link start}). */
  private running = false;

  /** The pending inactivity timer handle, or null when none is scheduled. */
  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor(options: AutoLockManagerOptions) {
    this.timeoutMinutes = options.timeoutMinutes;
    this.onLock = options.onLock;
    this.logger = options.logger;
  }

  /**
   * The configured inactivity timeout in minutes. Surfaced so the vault status
   * projection can report the value that is actually in effect. (Req 2.6, 3.4)
   */
  getTimeoutMinutes(): number {
    return this.timeoutMinutes;
  }

  /** Whether auto-lock is enabled (a positive timeout is configured). */
  isEnabled(): boolean {
    return this.timeoutMinutes > 0;
  }

  /**
   * Start (or restart) the inactivity timer using the current timeout. Safe to
   * call more than once; each call reschedules from now. When auto-lock is
   * disabled (`timeoutMinutes <= 0`) this marks the manager running but
   * schedules no timer. (Req 3.1, 3.2)
   */
  start(): void {
    this.running = true;
    this.reschedule();
  }

  /**
   * Stop the manager and clear any pending timer. After this, pings are
   * ignored until {@link start} is called again. Idempotent. Used on manual
   * lock and app exit so a stale timer cannot fire against a locked vault.
   */
  stop(): void {
    this.running = false;
    this.clearTimer();
  }

  /**
   * Reset the inactivity timer in response to non-secret user activity. This
   * is O(1): it clears the pending timer and schedules a fresh one. No-op when
   * the manager is not running or auto-lock is disabled. (Req 3.1)
   */
  ping(): void {
    if (!this.running || !this.isEnabled()) {
      return;
    }
    this.reschedule();
  }

  /**
   * Update the inactivity timeout (minutes) and apply it immediately. A value
   * of `<= 0` disables auto-lock and clears any pending timer. When the
   * manager is running the timer is rescheduled with the new interval so the
   * change takes effect without a restart. Persisted separately by the
   * settings store so it applies across sessions. (Req 3.4)
   */
  setTimeoutMinutes(minutes: number): void {
    this.timeoutMinutes = minutes;
    if (this.running) {
      this.reschedule();
    }
  }

  /**
   * Clear any pending timer and, when running with a positive timeout, schedule
   * a fresh inactivity timer. When disabled or stopped, no timer is scheduled.
   */
  private reschedule(): void {
    this.clearTimer();
    if (!this.running || !this.isEnabled()) {
      return;
    }
    const delayMs = this.timeoutMinutes * MS_PER_MINUTE;
    this.timer = setTimeout(() => {
      this.timer = null;
      // Timeout elapsed without activity: lock the vault, clearing the key and
      // cached secrets where practical. (Req 3.2, 3.3)
      this.logger?.info('vault auto-locked');
      this.onLock();
    }, delayMs);
    // Do not keep the Node/Electron process alive solely for this timer.
    this.timer.unref?.();
  }

  /** Clear the pending inactivity timer, if any. */
  private clearTimer(): void {
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }
}
