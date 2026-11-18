// @ts-check
import { defineConfig } from 'astro/config';
import sitemap from '@astrojs/sitemap';

/**
 * Where the site is served from.
 *
 * In CI, the deploy workflow passes SITE_URL / BASE_PATH from `actions/configure-pages`,
 * so renaming the repo, moving to `<user>.github.io`, or adding a custom domain needs
 * no code change here. Locally we mirror the current production URL so `npm run build
 * && npm run preview` behaves exactly like the deployed site.
 */
const fromPages = Boolean(process.env.SITE_URL);
const site = fromPages ? process.env.SITE_URL : 'https://jonathanjiwu.github.io';
const base = fromPages ? process.env.BASE_PATH || '/' : '/jon.dev';

export default defineConfig({
  site,
  base,
  integrations: [sitemap()],
  build: {
    // Small pages: inline tiny stylesheets to save a round trip on first paint.
    inlineStylesheets: 'auto',
  },
  vite: {
    build: {
      // three.js lands in its own lazily-loaded chunk (~150 KB gz); don't warn about it.
      chunkSizeWarningLimit: 800,
    },
  },
});
