import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import './globals.css';
import Providers from './components/Providers';

export const metadata: Metadata = {
  title: 'PassShield',
  description: 'A local-first desktop password manager.',
};

/**
 * Root layout for the PassShield renderer. Wraps every route with the base
 * document structure and global styles, and seeds the TanStack Query client
 * via {@link Providers}.
 */
export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
