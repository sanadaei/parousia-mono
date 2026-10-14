// Screenshot any preview page with headless Chromium (Playwright).
// usage: node terrain/tools/shoot-page.mjs out.png 'preview/gallery.html?cat=vegetation' [width height]
// Waits for window.__frames >= 1 (or window.__error). Needs `playwright` resolvable from Node (global is fine).

import { createRequire } from 'node:module';
import { execSync } from 'node:child_process';
import { join } from 'node:path';
import { serve } from './serve.mjs';

const [out, path, w = 1280, h = 720] = process.argv.slice(2);
async function loadPlaywright() {
  try { return await import('playwright'); } catch {}
  return createRequire(join(execSync('npm root -g').toString().trim(), 'noop.js'))('playwright');
}
const { chromium } = await loadPlaywright();
const port = 8790 + Math.floor(Math.random() * 100), server = await serve(port);
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
try {
  const page = await browser.newPage({ viewport: { width: +w, height: +h } });
  page.on('console', (m) => { if (m.type() === 'error') console.log('console:', m.text()); });
  await page.goto(`http://127.0.0.1:${port}/${path}`);
  await page.waitForFunction(() => window.__frames >= 1 || window.__error, null, { timeout: 180000 });
  const err = await page.evaluate(() => window.__error); if (err) throw new Error(err);
  await page.screenshot({ path: out }); console.log(out);
} finally { await browser.close(); server.close(); }
