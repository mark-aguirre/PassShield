'use client';

/**
 * Client-side providers for the passShield renderer.
 *
 * Wraps the application tree with the TanStack Query `QueryClientProvider` so
 * `useQuery` and `useMutation` are available throughout the renderer. The
 * shared {@link queryClient} instance (configured with Electron-appropriate
 * defaults) is imported from `@/lib/query-client`.
 *
 * `layout.tsx` is a Server Component in Next.js, so the provider wrapper must
 * live in its own `'use client'` file — it cannot be inlined into the layout.
 */

import type { ReactNode } from 'react';
import { QueryClientProvider } from '@tanstack/react-query';
import { queryClient } from '@/lib/query-client';
import AppearanceManager from './AppearanceManager';

export default function Providers({ children }: { children: ReactNode }) {
  return (
    <QueryClientProvider client={queryClient}>
      <AppearanceManager />
      {children}
    </QueryClientProvider>
  );
}
