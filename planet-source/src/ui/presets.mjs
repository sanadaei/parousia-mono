// Preset scenes for the visualizer: repository sample snapshots (fetched
// relative to this module) and a synthetic demo built in-process with the core.

import { createTerrainAdapter, SMOOTH_TERRAIN_SCHEMA } from '../core/index.mjs';
import { connectSurfaceWater } from '../core/surface-water.mjs';
import { UI_SCENE_SCHEMA } from './scene.mjs';

/**
 * Paths are relative to the package root. `size` is a rough download hint.
 * Optional `layers` (a DEFAULT_LAYERS patch) and `viewIndex` (water chart) are applied on load.
 */
export const PRESETS = Object.freeze([
  { id: 'demo', label: 'Demo valley: river, lake, sea, bridges, pads', builtin: true, size: 'generated',
    description: 'Synthetic C1 terrain with a solved channel network, two bridged roads, a cut/fill road and building pads.' },
  { id: 'four-junction-states', label: 'Fixture: road junctions in four states',
    path: 'examples/audit-0.3.4/0.3.5/four-statuses.scene.json', size: '14 KB',
    description: 'Explicit flat-road fixture: matched, clearance met, insufficient clearance and collision.' },
  { id: 'lake-ocean', label: 'Fixture: lake → river → ocean', path: 'examples/surface-water/lake-ocean-fixture.snapshot.json', size: '8 KB' },
  { id: 'concave', label: 'Fixture: concave U-shaped lake', path: 'examples/surface-water/concave-body-fixture.snapshot.json', size: '3 KB' },
  { id: 'combined-surface', label: 'Fixture: river + surface water-level grid', path: 'examples/surface-water/combined-surface-fixture.snapshot.json', size: '9 KB' },
  { id: 'combined-groundwater', label: 'Fixture: river + groundwater grid', path: 'examples/surface-water/combined-groundwater-fixture.snapshot.json', size: '9 KB' },
  { id: 'world-a-c1', label: 'World A (C1, modeled rivers, 7 roads)', path: 'examples/audit-0.3.3/0.3.4/world-a-c1.snapshot.json', size: '0.9 MB' },
  { id: 'world-b-c1', label: 'World B (C1, modeled rivers, roads)', path: 'examples/audit-0.3.3/0.3.4/world-b-c1.snapshot.json', size: '0.9 MB' },
  { id: 'world-a', label: 'World A (bilinear, modeled rivers)', path: 'examples/surface-water/world-a.snapshot.json', size: '0.9 MB' },
  { id: 'world-a-strahler', label: 'World A (Strahler channel sizing)', path: 'examples/surface-water/world-a-strahler.snapshot.json', size: '0.9 MB' },
  { id: 'refinement-a', label: 'Refinement A (C1, no hydrology)', path: 'examples/refinement/world-a.snapshot.json', size: '0.6 MB' },
  { id: 'terrain-v1', label: 'Legacy terrain@1 (unresolved water)', path: 'fixtures/terrain-v1.snapshot.json', size: '0.2 MB' },
  { id: 'bowl-lake', label: 'Global water chart: explicit bowl lake', path: 'examples/global-water/0.3.3/explicit-bowl-lake.snapshot.json', size: '66 KB' },
  { id: 'global-date-line', label: 'Global water chart: date line', path: 'examples/global-water/0.3.3/audit-a-date-line.snapshot.json', size: '66 KB' },
  { id: 'global-multi', label: 'Global multi-chart world (4 charts)', path: 'examples/audit-0.3.3/0.3.4/audit-a.snapshot.json', size: '0.2 MB' },
  { id: 'global-drainage', label: 'Global Drainage & Multi-Chart', path: 'examples/audit-0.3.3/0.3.4/audit-a.snapshot.json', size: '0.2 MB',
    layers: Object.freeze({ drainage: true, contours: true, bounds: true }), viewIndex: 2,
    description: 'Four explicit water charts on one sphere: basin catchments, flow arrows and sinks from the source drainage, with chart boxes, tags and seam markers.' },
  { id: 'projected-north-pole', label: 'Projected grid export: north pole', path: 'examples/audit-0.3.2/audit-a-north-pole.snapshot.json', size: '0.6 MB' },
]);

/** URL of a preset file, resolved against this module (works under the static server). */
export const presetUrl = preset => new URL(`../../${preset.path}`, import.meta.url);

/** Fetch (or build) a preset as JSON-compatible input for `loadScene`. */
export async function fetchPreset(id) {
  const preset = PRESETS.find(p => p.id === id);
  if (!preset) throw new RangeError(`Unknown preset ${id}`);
  if (preset.builtin) return { preset, input: buildDemoScene() };
  const response = await fetch(presetUrl(preset));
  if (!response.ok) throw new Error(`Failed to fetch ${preset.path}: HTTP ${response.status}`);
  return { preset, input: await response.text() };
}

// ---------- Synthetic demo ----------

const smooth = t => t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t);
const valleyX = y => 760 + 70 * Math.sin(y / 230);

/** Demo ground: north-rising plain, meandering valley, hills, a lake basin and a southern sea. */
export function demoHeight(x, y) {
  let z = 40 + 0.045 * y;
  z -= 14 * Math.exp(-(((x - valleyX(y)) / 110) ** 2));
  z += 34 * Math.exp(-((x - 1280) ** 2 + (y - 760) ** 2) / (2 * 170 ** 2));
  z += 18 * Math.exp(-((x - 300) ** 2 + (y - 360) ** 2) / (2 * 140 ** 2));
  z -= 16 * Math.max(0, 1 - Math.hypot(x - 780, y - 560) / 130) ** 1.5;
  z -= 46 * (1 - smooth(y / 170));
  return z;
}

const box = (minX, minY, maxX, maxY) => [{ xM: minX, yM: minY }, { xM: maxX, yM: minY }, { xM: maxX, yM: maxY }, { xM: minX, yM: maxY }];
const octagon = (cx, cy, r) => Array.from({ length: 8 }, (_, i) => ({ xM: cx + r * Math.cos((i + 0.5) * Math.PI / 4), yM: cy + r * Math.sin((i + 0.5) * Math.PI / 4) }));

/** Build the demo as a `minimal-world-ui-scene@1` bundle (terrain snapshot + roads + pads). */
export function buildDemoScene() {
  const columns = 64, rows = 48, cellSizeM = 25, groundElevationM = [];
  for (let j = 0; j < rows; j++) for (let i = 0; i < columns; i++) groundElevationM.push(demoHeight((i + 0.5) * cellSizeM, (j + 0.5) * cellSizeM));
  const base = createTerrainAdapter({
    schema: SMOOTH_TERRAIN_SCHEMA, interpolation: 'bounded-hermite-c1@1', seed: 'ui-demo-valley', revision: 'ui-demo@1',
    frame: { kind: 'planar-metric', originXM: 0, originYM: 0, verticalDatum: 'ui-demo-sea-level' },
    grid: { columns, rows, cellSizeM, sampleLocation: 'cell-center' }, derivativeStepM: 1,
    fields: { groundElevationM, waterLevelElevationM: null }, references: {},
  });
  const node = (id, yM, extra = {}) => ({ id, xM: valleyX(yM), yM, ...extra });
  const source = node('source', 1130), bend = node('bend', 900), inlet = node('inlet', 640, { bodyId: 'lake' });
  const outlet = node('outlet', 480, { bodyId: 'lake' }), lower = node('lower', 300), mouth = node('mouth', 60, { bodyId: 'sea' });
  const tributaryHead = { id: 'trib-head', xM: 1120, yM: 1080 };
  const edge = (id, a, b, mid = []) => ({ id, from: a.id, to: b.id, points: [a, ...mid, b].map(p => ({ xM: p.xM, yM: p.yM })) });
  const wiggle = (a, b, n = 6) => Array.from({ length: n - 1 }, (_, k) => node(`${a.id}-${k}`, a.yM + (b.yM - a.yM) * (k + 1) / n));
  const terrain = connectSurfaceWater(base, {
    riverGraph: {
      nodes: [source, bend, inlet, outlet, lower, mouth, tributaryHead],
      edges: [edge('upper-river', source, bend, wiggle(source, bend)), edge('tributary', tributaryHead, bend, [{ xM: 980, yM: 1000 }]),
        edge('middle-river', bend, inlet, wiggle(bend, inlet)), edge('outflow', outlet, lower, wiggle(outlet, lower, 4)),
        edge('lower-river', lower, mouth, wiggle(lower, mouth, 5))],
    },
    waterBodies: [
      { id: 'lake', kind: 'lake', waterLevelElevationM: demoLakeLevel(), polygon: octagon(780, 560, 120) },
      { id: 'sea', kind: 'ocean', waterLevelElevationM: 0, polygon: box(0, 0, 1600, 75) },
    ],
  });
  const roads = [
    { id: 'valley-road', halfWidthM: 3.5, points: [{ xM: 40, yM: 800 }, { xM: 420, yM: 830 }, { xM: 1000, yM: 790 }, { xM: 1560, yM: 830 }] },
    { id: 'hill-road', halfWidthM: 3, points: [{ xM: 1000, yM: 1180 }, { xM: 1230, yM: 900 }, { xM: 1300, yM: 600 }, { xM: 1560, yM: 420 }] },
    { id: 'coast-road', halfWidthM: 3, points: [{ xM: 120, yM: 240 }, { xM: 600, yM: 250 }, { xM: 1100, yM: 235 }, { xM: 1500, yM: 260 }] },
  ];
  const pads = [];
  for (let k = 0; k < 6; k++) {
    pads.push({ id: `house-${k + 1}`, kind: 'house', xM: 250 + (k % 3) * 46, yM: 900 + Math.floor(k / 3) * 42, widthM: 22, depthM: 16, rotationDeg: 4 });
  }
  pads.push({ id: 'warehouse', kind: 'warehouse', xM: 1150, yM: 330, widthM: 60, depthM: 34, rotationDeg: -8 });
  pads.push({ id: 'chapel', kind: 'civic', xM: 470, yM: 1000, widthM: 26, depthM: 40, rotationDeg: 15 });
  return {
    schema: UI_SCENE_SCHEMA, label: 'Demo valley',
    terrain: terrain.toSnapshot(), roads, buildingPads: pads,
    settlements: [{ id: 'hamlet', kind: 'village', xM: 296, yM: 921 }, { id: 'harbour', kind: 'port', xM: 1150, yM: 300 }],
  };
}

/** Lake level just below the lowest ground on a ring outside the polygon (its spill sill). */
function demoLakeLevel() {
  let rim = Infinity;
  for (let k = 0; k < 128; k++) for (const r of [122, 128, 134, 140]) {
    const a = k / 128 * 2 * Math.PI;
    rim = Math.min(rim, demoHeight(780 + r * Math.cos(a), 560 + r * Math.sin(a)));
  }
  return Math.floor((rim - 0.4) * 100) / 100;
}
