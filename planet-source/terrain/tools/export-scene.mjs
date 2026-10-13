// Export a nested scene (L1..L4 of the scale ladder) for the 3D preview.
// usage: node terrain/tools/export-scene.mjs [planetTag] [mountain|hills|lat lon]
//
// Output (terrain/out/):
//   scene-<tag>-<site>.json  levels: name, sizeM, res, dx, origin [x east, y north] m in the
//                            shared tangent frame, byte offsets into the .bin
//   scene-<tag>-<site>.bin   per level: f32 surface height (water surface where wet, sea = 0),
//                            then RGBA8 colour (A = 255 on water). Rows run north -> south.

import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { outDir, loadTagged, parseSite, pickCenter, runLadder, colorize } from './ladder.mjs';

export const SCENE_FORMAT = 'terrain-scene@1';

const tag = process.argv[2] ?? 'planet-1-N512';
const where = parseSite(process.argv.slice(3)), { site } = where;
const P = loadTagged(tag);
const t0 = Date.now(), log = (s) => console.log(`${((Date.now() - t0) / 1000).toFixed(1)}s ${s}`);
const center = pickCenter(P, where);
const latDeg = Math.asin(center[1]) * 180 / Math.PI, lonDeg = Math.atan2(center[0], center[2]) * 180 / Math.PI;

const levels = [], chunks = [];
let bytes = 0;
runLadder(P, { tag, center, log, onLevel(R, L, k, { origin }) {
  const { W, H, height: h, fixed, lakeDepth } = R, n = W * H;
  const col = colorize(R, latDeg, { rivers: 'coverage' }), surf = new Float32Array(n), rgba = new Uint8Array(n * 4);
  for (let c = 0; c < n; c++) {
    let s = h[c], wet = false;
    if (fixed[c] && h[c] <= 0) { s = 0; wet = true; } else if (lakeDepth[c] > 0.5) { s = h[c] + lakeDepth[c]; wet = true; } else if (R.water && !Number.isNaN(R.water[c])) { s = R.water[c]; wet = true; }
    surf[c] = s;
    for (let m = 0; m < 3; m++) rgba[c * 4 + m] = Math.max(0, Math.min(255, col[c * 3 + m]));
    rgba[c * 4 + 3] = wet ? 255 : 0;
  }
  levels.push({ name: L.name, sizeM: L.sizeM, res: W, dx: R.dx, origin, height: { offset: bytes, type: 'f32' }, color: { offset: bytes + n * 4, type: 'rgba8' } });
  chunks.push(Buffer.from(surf.buffer), Buffer.from(rgba.buffer));
  bytes += n * 8;
  log(`${L.name}: ${L.sizeM / 1000} km, origin ${origin.map((v) => v.toFixed(0)).join(', ')} m`);
} });

const name = `scene-${tag}-${site}`;
writeFileSync(join(outDir, `${name}.bin`), Buffer.concat(chunks));
writeFileSync(join(outDir, `${name}.json`), JSON.stringify({ format: SCENE_FORMAT, tag, site, latDeg, lonDeg, radiusM: P.radiusM, levels }, null, 1));
log(`${name}.json/.bin (${(bytes / 1048576).toFixed(1)} MiB)`);
