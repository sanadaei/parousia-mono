import { createTerrainAdapter, TERRAIN_SCHEMA } from '../index.mjs';
import { connectSurfaceWater } from '../surface-water.mjs';

export function baseTerrain(height = (x, y) => 200 - 0.1 * y) {
  const groundElevationM = [];
  for (let y = 0; y < 20; y++) for (let x = 0; x < 20; x++) groundElevationM.push(height((x + 0.5) * 50, (y + 0.5) * 50));
  return createTerrainAdapter({ schema: TERRAIN_SCHEMA, seed: 'water-fixture', revision: 'fixture@1',
    frame: { kind: 'planar-metric', originXM: 0, originYM: 0, verticalDatum: 'fixture-zero' },
    grid: { columns: 20, rows: 20, cellSizeM: 50 },
    fields: { groundElevationM, waterLevelElevationM: null } });
}
export const node = (id, xM, yM) => ({ id, xM, yM });
export function edge(id, a, b) { return { id, from: a.id, to: b.id, points: [a, b] }; }
export function box(minX, minY, maxX, maxY) { return [{ xM: minX, yM: minY }, { xM: maxX, yM: minY }, { xM: maxX, yM: maxY }, { xM: minX, yM: maxY }]; }
export function confluenceFixture() {
  const a = node('a', 150, 150), b = node('b', 350, 150), c = node('join', 250, 350), d = node('out', 250, 700);
  return connectSurfaceWater(baseTerrain(), { riverGraph: { nodes: [a, b, c, d], edges: [edge('a-c', a, c), edge('b-c', b, c), edge('c-d', c, d)] } });
}
export function lakeOceanFixture() {
  const base = baseTerrain((x, y) => {
    const level = x <= 550 ? 150 + (550 - x) * 0.08 : 150 - (x - 550) * 0.4;
    return level - 50 * Math.max(0, 1 - Math.max(Math.abs(x - 400), Math.abs(y - 500)) / 100);
  });
  const a = node('upstream', 100, 500), b = node('inlet', 300, 500), c = node('outlet', 500, 500), d = node('mouth', 960, 500);
  b.bodyId = 'lake-1'; c.bodyId = 'lake-1'; d.bodyId = 'ocean-1';
  const lake = { id: 'lake-1', kind: 'lake', waterLevelElevationM: 140, polygon: box(250, 350, 550, 650) };
  const ocean = { id: 'ocean-1', kind: 'ocean', waterLevelElevationM: 0, polygon: box(925, 0, 1000, 1000) };
  return connectSurfaceWater(base, { riverGraph: { nodes: [a, b, c, d], edges: [edge('inflow', a, b), edge('outflow', c, d)] }, waterBodies: [lake, ocean] });
}

export const concaveEnvelope = [
  [100, 100], [900, 100], [900, 900], [700, 900],
  [700, 300], [300, 300], [300, 900], [100, 900],
].map(([xM, yM]) => ({ xM, yM }));

export function concaveBodyFixture() {
  // Three depressions, but the middle one is outside the U-shaped search region.
  const base = baseTerrain((x, y) => 100 - 30 * Math.max(0,
    ...[200, 500, 800].map(c => 1 - Math.hypot(x - c, y - 500) / 75)));
  return connectSurfaceWater(base, { waterBodies: [{ id: 'u-lake', kind: 'lake',
    waterLevelElevationM: 90, polygon: concaveEnvelope }] });
}

export function combinedWaterFixture(role = 'surface') {
  const input = baseTerrain(() => 100).toSnapshot(); delete input.worldId;
  input.fields.waterLevelElevationM = Array(400).fill(101);
  const a = node('a', 500, 100), b = node('b', 500, 900);
  return connectSurfaceWater(createTerrainAdapter(input), {
    riverGraph: { nodes: [a, b], edges: [edge('river', a, b)] }, waterLevelRole: role,
  });
}
