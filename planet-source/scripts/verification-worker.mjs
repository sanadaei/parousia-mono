import { readFileSync, writeFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import { fromDynamicRegional } from '../dynamic-regional.mjs';
import { serializeTerrain, restoreTerrain } from '../index.mjs';

const [mode, snapshotPath, witnessPath] = process.argv.slice(2);
const started = performance.now();
if (mode === 'capture') {
  const { generateRegional, sampleRegionalElevation } = await import('../../MinimalWorld_Modules_0.3_Core/MinimalWorld_Modules_0.3/dynamic-terrain-runtime/index.mjs');
  const world = generateRegional('world-a', { w: 64, h: 48, cell: 180 });
  const generationMs = performance.now() - started;
  const terrain = fromDynamicRegional(world, { verticalDatum: 'dynamic-runtime-unspecified-local-zero' });
  const area = { minXM: 1800, minYM: 1800, maxXM: 2880, maxYM: 2880 };
  const coarse = terrain.sampleWindow({ ...area, spacingM: 180 });
  const fine = terrain.sampleWindow({ ...area, spacingM: 60 });
  const fineIndex = new Map(fine.samples.map(p => [`${p.xM},${p.yM}`, p]));
  for (const p of coarse.samples) assert.deepEqual(p, fineIndex.get(`${p.xM},${p.yM}`));
  const left = terrain.sampleWindow({ ...area, maxXM: 2340, spacingM: 60 });
  const right = terrain.sampleWindow({ ...area, minXM: 2340, spacingM: 60 });
  const shared = left.samples.filter(p => p.xM === 2340);
  assert.deepEqual(shared, right.samples.filter(p => p.xM === 2340));

  const refs = terrain.toSnapshot().references;
  assert.deepEqual(refs.settlements.map(s => s.id), world.settlements.map(s => s.id));
  assert.deepEqual(refs.roads.map(r => r.id), world.roads.map(r => r.id));
  assert.deepEqual(refs.riverGraph.nodes.map(n => n.id), world.riverGraph.nodes.map(n => n.id));
  assert.deepEqual(refs.riverGraph.edges.map(e => e.id), world.riverGraph.edges.map(e => e.id));
  for (const p of coarse.samples) {
    assert.ok(Math.abs(p.groundElevationM - sampleRegionalElevation(world, p.xM, p.yM)) < 1e-9);
  }

  let wilderness;
  for (let y = 1; y < world.h - 1 && !wilderness; y++) for (let x = 1; x < world.w - 1; x++) {
    const p = { xM: (x + 0.5) * world.cell, yM: (y + 0.5) * world.cell };
    const minDistance = Math.min(...refs.settlements.map(s => Math.hypot(p.xM - s.xM, p.yM - s.yM)));
    if (minDistance > 720) { wilderness = { ...p, minSettlementDistanceM: minDistance }; break; }
  }
  assert.ok(wilderness, 'Need a real point outside settlement-centered micro patches');
  const wildernessSample = terrain.sampleAt(wilderness.xM, wilderness.yM);
  assert.equal(wildernessSample.hydrologyStatus, 'unresolved');
  assert.equal(wildernessSample.waterDepthM, null);
  const river = refs.riverGraph.edges[0]?.points[0];
  assert.ok(river, 'Real-input test must include a non-empty source river graph');
  const riverSample = terrain.sampleAt(river.xM, river.yM);
  assert.equal(riverSample.hydrologyStatus, 'unresolved');

  const points = [[0, 0], [world.widthMeters, world.heightMeters],
    [1254.125, 2941.75], [wilderness.xM, wilderness.yM], [river.xM, river.yM],
    ...coarse.samples.map(p => [p.xM, p.yM])];
  const witnesses = points.map(([x, y]) => terrain.sampleAt(x, y));
  writeFileSync(snapshotPath, serializeTerrain(terrain));
  writeFileSync(witnessPath, JSON.stringify(witnesses));
  console.log(JSON.stringify({
    worldId: terrain.worldId, seed: world.seed,
    canonicalGrid: { columns: world.w, rows: world.h, cellSizeM: world.cell },
    extentM: [world.widthMeters, world.heightMeters],
    generationMs, totalMs: performance.now() - started,
    maxRssMiB: process.resourceUsage().maxRSS / 1024,
    lodComparedPoints: coarse.samples.length, sharedBoundaryPoints: shared.length,
    originalSamplerComparedPoints: coarse.samples.length,
    preservedReferenceCounts: { settlements: refs.settlements.length, roads: refs.roads.length,
      riverNodes: refs.riverGraph.nodes.length, riverEdges: refs.riverGraph.edges.length },
    wilderness: { ...wilderness, groundElevationM: wildernessSample.groundElevationM },
    riverWitness: { xM: river.xM, yM: river.yM, hydrologyStatus: riverSample.hydrologyStatus,
      waterDepthM: riverSample.waterDepthM },
    persistedWitnessCount: witnesses.length,
  }));
} else if (mode === 'reopen') {
  const terrain = restoreTerrain(readFileSync(snapshotPath, 'utf8'));
  const witnesses = JSON.parse(readFileSync(witnessPath, 'utf8'));
  for (const expected of witnesses) assert.deepEqual(terrain.sampleAt(expected.xM, expected.yM), expected);
  console.log(JSON.stringify({ worldId: terrain.worldId, comparedPoints: witnesses.length,
    separateProcess: true, durationMs: performance.now() - started,
    maxRssMiB: process.resourceUsage().maxRSS / 1024 }));
} else {
  throw new Error('Expected capture or reopen mode');
}
