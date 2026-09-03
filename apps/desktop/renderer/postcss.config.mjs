/**
 * PostCSS configuration for the passShield renderer.
 *
 * Tailwind CSS v4 ships its own PostCSS plugin (`@tailwindcss/postcss`) which
 * replaces the v3 `tailwindcss` + `autoprefixer` pair. This is the only plugin
 * needed; theme tokens live in `src/app/globals.css` via the `@theme` block.
 */
const config = {
  plugins: {
    '@tailwindcss/postcss': {},
  },
};

export default config;
