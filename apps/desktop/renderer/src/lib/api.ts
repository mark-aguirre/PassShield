/**
 * Typed renderer API — the single point of contact between the renderer and
 * the Electron main process.
 *
 * `window.PassShield` MUST NOT be referenced anywhere else in the renderer.
 * Every IPC call goes through `api.*` imported from this module.
 *
 * The binding is typed as {@link PassShieldApi} (from `@PassShield/contracts`)
 * so TypeScript catches any drift between the renderer's expectations and the
 * preload's contextBridge surface at compile time. The preload exposes exactly
 * this shape; no generic passthrough exists. (Req 11.1, 11.2, 11.4)
 *
 * @example
 * ```ts
 * import { api } from '@/lib/api';
 *
 * const status = await api.vault.status();
 * const items  = await api.items.list({ scope: 'all' });
 * ```
 */

import type { PassShieldApi } from '@PassShield/contracts';

// Accessed lazily so that module evaluation during Next.js static-export
// pre-rendering (which runs in Node, without `window`) does not throw.
// At Electron runtime, contextBridge.exposeInMainWorld guarantees
// `window.PassShield` is set before any renderer code executes.
export const api: PassShieldApi = new Proxy({} as PassShieldApi, {
  get(_target, prop) {
    return (window.PassShield as unknown as Record<string | symbol, unknown>)[prop];
  },
});
