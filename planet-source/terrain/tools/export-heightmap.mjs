// Engine-facing heightmap export of an already-written scene (see export-scene.mjs).
// usage: node terrain/tools/export-heightmap.mjs [sceneName=planet-1-N512-mountain]
//
// Output per level (terrain/out/):
//   hm-<scene>-<level>.png   16-bit grayscale, linear between the level's min/max height
//   hm-<scene>-<level>.json  terrain-heightmap@1 metadata (decode: minH + value * heightScale)
//   col-<scene>-<level>.png  8-bit RGB colour (alpha dropped)

import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { outDir } from './ladder.mjs';
import { writePng, writePng16 } from './png.mjs';

export const HEIGHTMAP_FORMAT = 'terrain-heightmap@1';

const scene = process.argv[2] ?? 'planet-1-N512-mountain';
const meta = JSON.parse(readFileSync(join(outDir, `scene-${scene}.json`), 'utf8'));
const bin = readFileSync(join(outDir, `scene-${scene}.bin`));

for (const L of meta.levels) {
  const n = L.res * L.res;
  const h = new Float32Array(bin.buffer.slice(bin.byteOffset + L.height.offset, bin.byteOffset + L.height.offset + n * 4));
  const rgba = bin.subarray(L.color.offset, L.color.offset + n * 4);
  let minH = Infinity, maxH = -Infinity;
  for (let c = 0; c < n; c++) { if (h[c] < minH) minH = h[c]; if (h[c] > maxH) maxH = h[c]; }
  const span = maxH - minH || 1, u16 = new Uint16Array(n), rgb = new Uint8Array(n * 3);
  for (let c = 0; c < n; c++) {
    u16[c] = Math.round((h[c] - minH) / span * 65535);
    rgb[c * 3] = rgba[c * 4]; rgb[c * 3 + 1] = rgba[c * 4 + 1]; rgb[c * 3 + 2] = rgba[c * 4 + 2];
  }
  const heightScale = span / 65535, base = `${scene}-${L.name}`;
  writePng16(join(outDir, `hm-${base}.png`), L.res, L.res, u16);
  writePng(join(outDir, `col-${base}.png`), L.res, L.res, rgb);
  writeFileSync(join(outDir, `hm-${base}.json`), JSON.stringify({
    format: HEIGHTMAP_FORMAT, scene, level: L.name, res: L.res, dx: L.dx, sizeM: L.sizeM, origin: L.origin, minH, maxH, heightScale, rows: 'north-to-south',
    note: 'height_m = minH + value * heightScale; origin = level centre in metres (x east, y north) in the scene tangent frame',
  }, null, 1));
  console.log(`${L.name}: ${L.res}x${L.res} min ${minH.toFixed(2)} m, max ${maxH.toFixed(2)} m, step ${(heightScale * 1000).toFixed(3)} mm`);
}
