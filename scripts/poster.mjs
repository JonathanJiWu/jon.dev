#!/usr/bin/env node
/**
 * Renders the real scene in a headless browser to make two stills:
 *   src/assets/poster.jpg  shown instantly, and to visitors who don't get the live scene
 *   public/og.jpg          the social-sharing card (1200×630)
 *
 * Re-run after changing how the scene looks:
 *   npm run build && npm run poster
 * Needs Playwright with Chromium: npm i -D playwright && npx playwright install chromium
 */
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const port = 4329;
const basePath = (process.env.BASE_PATH ?? '/jon.dev').replace(/\/$/, '');
const base = `http://localhost:${port}${basePath}/`;

let chromium;
try {
  ({ chromium } = await import('playwright'));
} catch {
  try {
    // A global install (found via NODE_PATH) is only visible to require().
    ({ chromium } = createRequire(import.meta.url)('playwright'));
  } catch {
    console.error('Playwright is required: npm i -D playwright && npx playwright install chromium');
    process.exit(1);
  }
}

// A minimal static server for dist/, mounted at the site's base path.
const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2',
  '.jpg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.xml': 'application/xml',
};
const dist = join(root, 'dist');
const server = createServer(async (req, res) => {
  let path = decodeURIComponent(new URL(req.url ?? '/', 'http://localhost').pathname);
  if (!path.startsWith(`${basePath}/`)) return void res.writeHead(404).end();
  path = path.slice(basePath.length);
  if (path.endsWith('/')) path += 'index.html';
  const file = normalize(join(dist, path));
  if (!file.startsWith(dist)) return void res.writeHead(403).end();
  try {
    const body = await readFile(file);
    res.writeHead(200, { 'content-type': TYPES[extname(file)] ?? 'application/octet-stream' }).end(body);
  } catch {
    res.writeHead(404).end();
  }
});
await new Promise((resolve) => server.listen(port, resolve));

try {
  if (!(await fetch(base)).ok) throw new Error(`Nothing at ${base}: run npm run build first`);

  // Software GL is fine for a still; the site's "no GPU" check is bypassed by ?poster.
  const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });

  async function shoot(width, height, path, overlay) {
    const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 1 });
    await page.goto(`${base}?poster`, { waitUntil: 'load' });
    await page.waitForFunction(() => window.__sceneReady === true, null, { timeout: 120_000 });
    await page.waitForTimeout(1500);
    if (overlay) {
      await page.evaluate(overlay);
      await page.evaluate(() => document.fonts.ready);
      await page.waitForTimeout(300);
    }
    await page.screenshot({ path, type: 'jpeg', quality: 86 });
    await page.close();
    console.log('wrote', path);
  }

  await shoot(1920, 1080, `${root}src/assets/poster.jpg`);

  await shoot(1200, 630, `${root}public/og.jpg`, async () => {
    await Promise.all([document.fonts.load('700 72px B612'), document.fonts.load('400 20px "B612 Mono"')]);
    const card = document.createElement('div');
    card.style.cssText = [
      'position:fixed', 'inset:0', 'z-index:50', 'display:flex', 'flex-direction:column', 'justify-content:flex-end',
      'padding:0 0 64px 64px', 'color:#e9eef5',
      'background:linear-gradient(to right, rgb(5 8 15 / .85), rgb(5 8 15 / .45) 45%, transparent 70%)',
    ].join(';');
    card.innerHTML = `
      <div style="font:400 18px/1 'B612 Mono',monospace;letter-spacing:.16em;color:#67d4ea;margin-bottom:18px">SOFTWARE ENGINEER · REAL-TIME SIMULATION</div>
      <div style="font:700 78px/1 B612,sans-serif;letter-spacing:-.02em">Jonathan Wu</div>
      <div style="font:400 24px/1.4 'IBM Plex Sans Variable',sans-serif;color:#b6c2d1;margin-top:18px;max-width:560px">C++ flight simulation, physics modeling and control systems</div>`;
    document.body.append(card);
  });

  await browser.close();
} finally {
  server.close();
}
