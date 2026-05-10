/**
 * PostCSS config for Tailwind v4.
 * Tailwind v4 ships its own PostCSS plugin (@tailwindcss/postcss) and no
 * longer requires autoprefixer in the postcss chain (it's bundled).
 */
const config = {
  plugins: {
    "@tailwindcss/postcss": {},
  },
};

export default config;
