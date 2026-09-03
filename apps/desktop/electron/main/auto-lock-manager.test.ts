import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import { AutoLockManager } from './auto-lock-manager.js';

/**
 * Unit tests for the Auto-Lock Manager.
 *
 * The manager is a pure timer wrapper with no Electron dependency, so these
 * tests drive it with Vitest fake timers and assert the inactivity/lock and
 * ping-reset behavior required by Requirement 3 (auto-lock on inactivity,
 * reset on activity, disable/enable, and timeout changes applied live).
 */
describe('AutoLockManager', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('locks the vault after the inactivity timeout elapses (Req 3.2)', () => {
    const onLock = vi.fn();
    const manager = new AutoLockManager({ timeoutMinutes: 1, onLock });

    manager.start();
    expect(onLock).not.toHaveBeenCalled();

    // Just before the timeout: still unlocked.
    vi.advanceTimersByTime(60_000 - 1);
    expect(onLock).not.toHaveBeenCalled();

    // At the timeout: locks exactly once.
    vi.advanceTimersByTime(1);
    expect(onLock).toHaveBeenCalledTimes(1);
  });

  it('resets the inactivity timer on ping (Req 3.1)', () => {
    const onLock = vi.fn();
    const manager = new AutoLockManager({ timeoutMinutes: 1, onLock });

    manager.start();
    // Activity at 30s resets the timer; the original deadline passes without a lock.
    vi.advanceTimersByTime(30_000);
    manager.ping();
    vi.advanceTimersByTime(30_000);
    expect(onLock).not.toHaveBeenCalled();

    // A full minute after the ping, it locks.
    vi.advanceTimersByTime(30_000);
    expect(onLock).toHaveBeenCalledTimes(1);
  });

  it('tolerates a flood of pings and still locks after the last one (Req 3.1)', () => {
    const onLock = vi.fn();
    const manager = new AutoLockManager({ timeoutMinutes: 1, onLock });

    manager.start();
    for (let i = 0; i < 1000; i += 1) {
      manager.ping();
    }
    vi.advanceTimersByTime(60_000);
    expect(onLock).toHaveBeenCalledTimes(1);
  });

  it('does not lock while auto-lock is disabled (timeout <= 0) (Req 3.4)', () => {
    const onLock = vi.fn();
    const manager = new AutoLockManager({ timeoutMinutes: 0, onLock });

    manager.start();
    expect(manager.isEnabled()).toBe(false);
    vi.advanceTimersByTime(60 * 60_000);
    expect(onLock).not.toHaveBeenCalled();

    // Pings are cheap no-ops while disabled.
    manager.ping();
    vi.advanceTimersByTime(60 * 60_000);
    expect(onLock).not.toHaveBeenCalled();
  });

  it('applies a new timeout immediately while running (Req 3.4)', () => {
    const onLock = vi.fn();
    const manager = new AutoLockManager({ timeoutMinutes: 10, onLock });

    manager.start();
    // Shorten the timeout; the change reschedules from now.
    manager.setTimeoutMinutes(1);
    vi.advanceTimersByTime(60_000);
    expect(onLock).toHaveBeenCalledTimes(1);
  });

  it('disabling via setTimeoutMinutes cancels a pending lock (Req 3.4)', () => {
    const onLock = vi.fn();
    const manager = new AutoLockManager({ timeoutMinutes: 1, onLock });

    manager.start();
    vi.advanceTimersByTime(30_000);
    manager.setTimeoutMinutes(0);
    vi.advanceTimersByTime(60 * 60_000);
    expect(onLock).not.toHaveBeenCalled();
  });

  it('stop() cancels any pending lock and ignores later pings', () => {
    const onLock = vi.fn();
    const manager = new AutoLockManager({ timeoutMinutes: 1, onLock });

    manager.start();
    manager.stop();
    manager.ping();
    vi.advanceTimersByTime(60 * 60_000);
    expect(onLock).not.toHaveBeenCalled();
  });

  it('reports the configured timeout via getTimeoutMinutes (Req 2.6, 3.4)', () => {
    const manager = new AutoLockManager({ timeoutMinutes: 15, onLock: vi.fn() });
    expect(manager.getTimeoutMinutes()).toBe(15);
    manager.setTimeoutMinutes(30);
    expect(manager.getTimeoutMinutes()).toBe(30);
  });
});
