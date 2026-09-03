/**
 * Renderer ambient types.
 *
 * The narrow `window.passShield` API surface is declared once, canonically, by
 * `@passshield/contracts` (see its global augmentation of `Window`). We import
 * that package here so its global declaration is included in the renderer's
 * type program, and intentionally do NOT redeclare `Window.passShield` to avoid
 * a conflicting duplicate declaration.
 */
import '@passshield/contracts';

export {};
