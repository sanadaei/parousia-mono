import { readFileSync, writeFileSync } from 'node:fs';
import { performance } from 'node:perf_hooks';
import assert from 'node:assert/strict';
import { fromDynamicRegionalWater } from '../dynamic-regional.mjs';
import { serializeTerrain, restoreTerrain } from '../index.mjs';
import { lakeOceanFixture, concaveBodyFixture, combinedWaterFixture } from '../fixtures/water-scenarios.mjs';
import { inspectRoadCrossings } from '../road-crossings.mjs';

function roadInspection(terrain, seed) {
  const roads = seed.endsWith('fixture') ? [{ id: 'fixture-road',
    points: [{ xM: 100, yM: 500 }, { xM: 900, yM: 500 }] }]
    : terrain.toSnapshot().references.roads;
  return inspectRoadCrossings(terrain, { roads, maxStepM: 10 });
}

const [mode, seed, snapshotPath, witnessPath] = process.argv.slice(2);
const started = performance.now();
if (mode === 'reopen') {
  const terrain = restoreTerrain(readFileSync(snapshotPath, 'utf8'));
  const saved = JSON.parse(readFileSync(witnessPath, 'utf8')), witnesses = Array.isArray(saved) ? saved : saved.samples;
  const frames = Array.isArray(saved) ? [] : saved.frames;
  for (const p of witnesses) assert.deepEqual(terrain.sampleAt(p.xM, p.yM), p);
  for (const p of frames) assert.deepEqual(terrain.surfaceFrameAt(p.xM, p.yM), p);
  console.log(JSON.stringify({ worldId: terrain.worldId, comparedPoints: witnesses.length, comparedFrames: frames.length, separateProcess: true,
    durationMs: performance.now() - started, maxRssMiB: process.resourceUsage().maxRSS / 1024,
    roadInspection: roadInspection(terrain, seed) }));
} else if (mode === 'capture') {
  let terrain, source = null, generationMs = null;
  if (seed === 'lake-ocean-fixture') terrain = lakeOceanFixture();
  else if (seed === 'concave-body-fixture') terrain = concaveBodyFixture();
  else if (seed === 'combined-surface-fixture') terrain = combinedWaterFixture('surface');
  else if (seed === 'combined-groundwater-fixture') terrain = combinedWaterFixture('groundwater');
  else {
    const { generateRegional } = await import('../../MinimalWorld_Modules_0.3_Core/MinimalWorld_Modules_0.3/dynamic-terrain-runtime/index.mjs');
    source = generateRegional(seed.replace(/-c1$/, '').replace(/-strahler$/, ''), { w: 96, h: 72, cell: 120 });
    generationMs = performance.now() - started;
    terrain = fromDynamicRegionalWater(source, { verticalDatum: 'dynamic-runtime-unspecified-local-zero',
      ...(seed.endsWith('-c1') ? { interpolation: 'bounded-hermite-c1@1' } : {}),
      ...(seed.endsWith('-strahler') ? { channelSizing: { mode: 'strahler' } } : {}) });
  }
  const model = terrain.toSnapshot().hydrology, nodes = new Map(model.nodes.map(n => [n.id, n]));
  const incoming = new Map(), witnesses = [];
  let centerlineSamples = 0, profileRiseViolations = 0, depthViolations = 0, basinComparedPoints = 0;
  for (const e of model.edges) {
    incoming.set(e.to, (incoming.get(e.to) ?? 0) + 1);
    assert.equal(e.points[0].waterLevelElevationM, nodes.get(e.from).waterLevelElevationM);
    assert.equal(e.points.at(-1).waterLevelElevationM, nodes.get(e.to).waterLevelElevationM);
    let previous = Infinity;
    for (let i = 1; i < e.points.length; i++) for (let j = 0; j <= 3; j++) {
      const a = e.points[i - 1], b = e.points[i], t = j / 3;
      const p = terrain.sampleAt(a.xM * (1 - t) + b.xM * t, a.yM * (1 - t) + b.yM * t);
      centerlineSamples++;
      if (p.waterSurfaceElevationM > previous + 1e-7) profileRiseViolations++;
      previous = p.waterSurfaceElevationM;
      if (!(p.waterDepthM > 0) || Math.abs(p.waterDepthM - (p.waterSurfaceElevationM - p.groundElevationM)) > 1e-7) depthViolations++;
      let expectedLevel = a.waterLevelElevationM * (1 - t) + b.waterLevelElevationM * t;
      if (seed === 'combined-surface-fixture') expectedLevel = Math.max(expectedLevel, 101);
      assert.ok(Math.abs(p.waterSurfaceElevationM - expectedLevel) < 1e-6);
      if (source) {
        const x = Math.min(source.w - 1, Math.floor(p.xM / source.cell)), y = Math.min(source.h - 1, Math.floor(p.yM / source.cell));
        const index = y * source.w + x;
        assert.equal(p.basinIndex, source.watersheds.basin[index]);
        assert.equal(p.outletCellIndex, source.watersheds.outlet[index]); basinComparedPoints++;
      }
      if (centerlineSamples % 30 === 0) witnesses.push(p);
    }
  }
  assert.equal(profileRiseViolations, 0); assert.equal(depthViolations, 0);
  const joins = model.nodes.filter(n => (incoming.get(n.id) ?? 0) > 1);
  for (const n of joins) {
    const p = terrain.sampleAt(n.xM, n.yM);
    assert.ok(Math.abs(p.waterSurfaceElevationM - n.waterLevelElevationM) < 1e-6); witnesses.push(p);
  }
  let openBoundarySamples = 0;
  for (const n of model.nodes.filter(n => n.kind === 'regional-boundary')) {
    const b = terrain.bounds, atX = n.xM === b.minXM || n.xM === b.maxXM, atY = n.yM === b.minYM || n.yM === b.maxYM;
    // Inspect the actual clipped opening on the region perimeter. The plane
    // normal to a diagonal channel crosses outside the finite region.
    const locations = atX && atY ? [[n.xM, n.yM],
      [n.xM + (n.xM === b.minXM ? .9 : -.9), n.yM], [n.xM, n.yM + (n.yM === b.minYM ? .9 : -.9)]]
      : [-.9, 0, .9].map(offset => atX ? [n.xM, Math.max(b.minYM, Math.min(b.maxYM, n.yM + offset))]
        : [Math.max(b.minXM, Math.min(b.maxXM, n.xM + offset)), n.yM]);
    for (const [xM, yM] of locations) {
      const point = terrain.sampleAt(xM, yM);
      assert.ok(point.waterDepthM > 0); openBoundarySamples++; witnesses.push(point);
    }
  }
  if (source) {
    assert.ok(centerlineSamples > 500 && joins.length > 0, 'Real input must exercise rivers and confluences');
    for (const n of source.riverGraph.nodes) assert.ok(nodes.has(n.id));
    for (const e of source.riverGraph.edges) assert.ok(model.edges.some(m => m.sourceEdgeId === e.id));
    assert.equal(model.diagnostics.isolatedNodeIds.length, 0);
    assert.equal(model.diagnostics.unresolvedTerminalNodeIds.length, 0);
  }
  let channelSizingEvidence = null;
  if (seed.endsWith('-strahler')) {
    let sourceOrderComparedEdges = 0;
    for (const e of model.edges) {
      const original = source.riverGraph.edges.find(original => original.id === e.sourceEdgeId);
      assert.equal(e.sourceStrahlerOrder, original?.strahlerOrder ?? null);
      if (original) sourceOrderComparedEdges++;
      const incident = model.edges.filter(upstream => upstream.to === e.from);
      assert.ok(incident.every(upstream => upstream.strahlerOrder <= e.strahlerOrder));
      assert.ok(e.points.every(p => p.halfWidthM <= model.channelSizing.maxHalfWidthM
        && p.bankWidthM <= model.channelSizing.maxBankWidthM && p.depthM <= model.channelSizing.maxDepthM));
    }
    const points = model.edges.flatMap(e => e.points), range = key => [Math.min(...points.map(p => p[key])), Math.max(...points.map(p => p[key]))];
    channelSizingEvidence = { sourceOrderComparedEdges, effectiveOrders: [...new Set(model.edges.map(e => e.strahlerOrder))].sort((a, b) => a - b),
      actualHalfWidthRangeM: range('halfWidthM'), actualBankWidthRangeM: range('bankWidthM'), depthRangeM: range('depthM'), settings: model.channelSizing };
    assert.ok(channelSizingEvidence.actualHalfWidthRangeM[1] > channelSizingEvidence.actualHalfWidthRangeM[0]);
  }
  const anchor = model.edges.flatMap(e => e.points).find(p => p.xM > 40 && p.xM < terrain.bounds.maxXM - 40 && p.yM > 40 && p.yM < terrain.bounds.maxYM - 40)
    ?? { xM: 200, yM: 500 };
  const x = Math.round(anchor.xM / 10) * 10, y = Math.round(anchor.yM / 10) * 10;
  const area = { minXM: x - 30, minYM: y - 30, maxXM: x + 30, maxYM: y + 30 };
  const coarse = terrain.sampleWindow({ ...area, spacingM: 10 }), fine = terrain.sampleWindow({ ...area, spacingM: 2 });
  const fineIndex = new Map(fine.samples.map(p => [`${p.xM},${p.yM}`, p]));
  for (const p of coarse.samples) assert.deepEqual(p, fineIndex.get(`${p.xM},${p.yM}`));
  const left = terrain.sampleWindow({ ...area, maxXM: x, spacingM: 2 }), right = terrain.sampleWindow({ ...area, minXM: x, spacingM: 2 });
  const seam = left.samples.filter(p => p.xM === x);
  assert.deepEqual(seam, right.samples.filter(p => p.xM === x));
  witnesses.push(...coarse.samples);
  if (seed === 'lake-ocean-fixture') {
    for (const [xM, yM, expected] of [[400, 500, 140], [980, 500, 0]]) {
      const p = terrain.sampleAt(xM, yM); assert.equal(p.waterSurfaceElevationM, expected); witnesses.push(p);
    }
  }
  if (seed === 'concave-body-fixture') {
    for (const [xM, expected] of [[200, 90], [500, null], [800, 90]]) {
      const p = terrain.sampleAt(xM, 500); assert.equal(p.waterSurfaceElevationM, expected); witnesses.push(p);
    }
  }
  if (seed.startsWith('combined-')) {
    const p = terrain.sampleAt(100, 500); witnesses.push(p);
    if (seed === 'combined-surface-fixture') assert.equal(p.waterDepthM, 1);
    else { assert.equal(p.waterDepthM, 0); assert.equal(p.groundwaterLevelElevationM, 101); }
  }
  const inspectedRoads = roadInspection(terrain, seed);
  const frames = seed.endsWith('-c1') ? coarse.samples.map(p => terrain.surfaceFrameAt(p.xM, p.yM)) : [];
  writeFileSync(snapshotPath, serializeTerrain(terrain));
  writeFileSync(witnessPath, JSON.stringify(frames.length ? { samples: witnesses, frames } : witnesses));
  console.log(JSON.stringify({ seed, inputKind: source ? 'real-generated-regional' : 'explicit-lake-ocean-fixture',
    worldId: terrain.worldId, interpolation: terrain.toSnapshot().interpolation ?? 'bilinear@1', generationMs, totalMs: performance.now() - started,
    maxRssMiB: process.resourceUsage().maxRSS / 1024,
    sourceRiverNodes: source?.riverGraph.nodes.length ?? null, sourceRiverEdges: source?.riverGraph.edges.length ?? null,
    completedRiverNodes: model.nodes.length, completedRiverEdges: model.edges.length,
    confluencesTested: joins.length, centerlineSamples, profileRiseViolations, depthViolations, basinComparedPoints,
    waterBodyCount: model.bodies.length, bodyAnchors: model.nodes.filter(n => n.bodyId).map(n => ({ id: n.id, bodyId: n.bodyId, waterLevelElevationM: n.waterLevelElevationM })),
    lodComparedPoints: coarse.samples.length, adjacentBoundaryPoints: seam.length,
    diagnostics: model.diagnostics, persistedWitnessCount: witnesses.length, persistedFrameCount: frames.length,
    openBoundarySamples, channelSizingEvidence, roadInspection: inspectedRoads }));
} else throw new TypeError('Unknown verification mode');
