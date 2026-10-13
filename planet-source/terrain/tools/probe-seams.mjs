// Diagnostic: height jumps of the near field across gully-noise cell boundaries
// versus away from them. A healthy field has ratio ~1.
// usage: node terrain/tools/probe-seams.mjs [planetTag] [site]
import { loadTagged, parseSite, pickCenter, runLadder, LEVELS } from './ladder.mjs';
import { createNearField } from '../src/detail.mjs';

const tag = process.argv[2] ?? 'planet-1-N512', where = parseSite(process.argv.slice(3));
const P = loadTagged(tag);
let sim = null, origin = null;
runLadder(P, { tag, center: pickCenter(P, where), levels: LEVELS.slice(0, 3), onLevel(R, L, k, o) { if (k === 1) { sim = R; origin = o.next; } } });
const near = createNearField(sim, { seed: `${tag}/near` });
const eps = 1e-3;
for (const s of [sim.dx * 0.5 / 8, sim.dx * 0.5 / 16]) { // octave sizes 3 and 4
  let onB = 0, offB = 0, cnt = 0;
  for (let k = 0; k < 4000; k++) {
    const y = origin[1] + (Math.random() - 0.5) * 600, b = Math.round((origin[0] + (Math.random() - 0.5) * 600) / s) * s;
    const jump = (x) => Math.abs(near(x + eps, y, 0).h - near(x - eps, y, 0).h);
    onB += jump(b); offB += jump(b + s * 0.37); cnt++;
  }
  console.log(`cell ${s.toFixed(2)} m: mean |jump| on boundary ${(onB / cnt * 1000).toFixed(2)} mm, off ${(offB / cnt * 1000).toFixed(2)} mm, ratio ${(onB / offB).toFixed(1)}`);
}
