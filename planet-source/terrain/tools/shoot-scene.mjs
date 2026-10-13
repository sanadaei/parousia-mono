// Screenshot the 3D preview presets with headless Chromium (Playwright).
// usage: node terrain/tools/shoot-scene.mjs [scene] [presets e.g. 1,2,3] [query extras e.g. exag=1.5]
// Needs `playwright` resolvable from Node (global install is fine). Output: terrain/out/view-<scene>-p<N>.png

import { join } from 'node:path';
import { createRequire } from 'node:module';
import { execSync } from 'node:child_process';
import { serve } from './serve.mjs';
import { outDir } from './ladder.mjs';

const scene = process.argv[2] ?? 'planet-1-N512-mountain';
const presets = (process.argv[3] ?? '1,2,3,4,5,6').split(',').map(Number);
const extra = process.argv[4] ? `&${process.argv[4]}` : '';

async function loadPlaywright() {
  try { return await import('playwright'); } catch {}
  const globalRoot = execSync('npm root -g').toString().trim();
  return createRequire(join(globalRoot, 'noop.js'))('playwright');
}

const { chromium } = await loadPlaywright();
const port = 8790 + Math.floor(Math.random() * 100), server = await serve(port);
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  page.on('console', (m) => { if (m.type() === 'error') console.log('console:', m.text()); });
  for (const p of presets) {
    await page.goto(`http://127.0.0.1:${port}/preview/?scene=${scene}&preset=${p}&ui=0${extra}`);
    await page.waitForFunction(() => window.__frames >= 1 || window.__error, null, { timeout: 120000 });
    const err = await page.evaluate(() => window.__error);
    if (err) throw new Error(err);
    const file = join(outDir, `view-${scene}-p${p}${extra ? '-' + extra.slice(1).replace(/[^\w.=-]+/g, '_') : ''}.png`);
    await page.screenshot({ path: file });
    console.log(file);
  }
} finally {
  await browser.close();
  server.close();
}
