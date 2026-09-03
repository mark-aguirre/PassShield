import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import './globals.css';
import AppearanceManager from './components/AppearanceManager';

export const metadata: Metadata = {
  title: 'passShield',
  description: 'A local-first desktop password manager.',
};

/**
 * Root layout for the passShield renderer. Wraps every route with the base
 * document structure and global styles.
 */
export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        {/* Applies the saved Theme + Accent color app-wide on startup. */}
        <AppearanceManager />
        {children}
      </body>
    </html>
  );
}
