import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

/**
 * Merge Tailwind class names, resolving conflicts sensibly.
 *
 * `clsx` handles conditional/array/object class inputs; `tailwind-merge` then
 * dedupes conflicting Tailwind utilities so the last one wins (e.g. combining
 * a base `p-2` with an override `p-4` yields `p-4`). This is the standard
 * shadcn/ui helper every generated component depends on.
 */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
