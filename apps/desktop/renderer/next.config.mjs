/** @type {import('next').NextConfig} */

/**
 * Next.js configuration for the passShield renderer.
 *
 * The renderer is packaged inside Electron and loaded from the local
 * filesystem in production, so we use static export (`output: 'export'`)
 * and relative asset paths. There is no Next.js server at runtime; the
 * Electron main process loads the exported `out/index.html`. Images are
 * unoptimized because the Next.js image optimizer requires a server.
 */
const nextConfig = {
  output: 'export',
  distDir: '.next',
  images: {
    unoptimized: true,
  },
  // Relative asset paths so file:// loading in Electron resolves correctly.
  assetPrefix: './',
  trailingSlash: true,
};

export default nextConfig;
