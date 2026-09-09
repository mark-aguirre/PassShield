/**
 * Renderer ambient types.
 *
 * The narrow `window.PassShield` API surface is declared once, canonically, by
 * `@PassShield/contracts` (see its global augmentation of `Window`). We import
 * that package here so its global declaration is included in the renderer's
 * type program, and intentionally do NOT redeclare `Window.PassShield` to avoid
 * a conflicting duplicate declaration.
 */
import '@PassShield/contracts';

export {};
