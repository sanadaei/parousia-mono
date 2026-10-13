import { readFileSync, writeFileSync } from 'node:fs';
import { performance } from 'node:perf_hooks';
import assert from 'node:assert/strict';
import { restoreGlobalTerrain, restoreProjectedTerrainView, createProjectedTerrainView, serializeGlobalTerrain } from '../global-terrain.mjs';
import { connectGlobalSurfaceWater } from '../global-water.mjs';
import { inspectRoadCrossings } from '../road-crossings.mjs';
import { sphericalBowlFixture } from '../fixtures/global-water-scenarios.mjs';

const [mode, sourcePath, site, snapshotPath, witnessPath] = process.argv.slice(2), started = performance.now();
const sites = { 'date-line': [0, 180], 'source-seam': [12, 0], 'north-pole': [90, 0], 'south-pole': [-90, 0] };
const bounds = { minXM: -6000, minYM: -6000, maxXM: 6000, maxYM: 6000 };
const traceA = { xM: -1000, yM: 300 }, traceB = { xM: 1000, yM: 300 }, traceOptions = { maxStepM: 3000 };
const roadOptions = { roads: [{ id: 'explicit-river-crossing', points: [traceA, traceB] }], ...traceOptions };
const near = (a, b, epsilon = 1e-7) => assert.ok(Math.abs(a - b) <= epsilon, `${a} != ${b}`);
if (mode === 'reopen') {
  // No geography generator is imported: only canonical snapshots are opened.
  const snapshot = JSON.parse(readFileSync(snapshotPath, 'utf8')), world = restoreGlobalTerrain(snapshot);
  const saved = JSON.parse(readFileSync(witnessPath, 'utf8')); let framesCompared = 0, traceSamplesCompared = 0;
  for (const sample of saved.globalSamples) assert.deepEqual(world.sampleAt(sample.latDeg, sample.lonDeg), sample);
  for (const region of saved.regions) {
    const view = restoreProjectedTerrainView({ ...region.contract, world: snapshot });
    for (const frame of region.frames) { assert.deepEqual(view.surfaceFrameAt(frame.xM, frame.yM), frame); framesCompared++; }
    if (region.trace) {
      assert.deepEqual(view.traceSurfaceSegment(traceA, traceB, traceOptions), region.trace);
      assert.deepEqual(inspectRoadCrossings(view, roadOptions), region.roadInspection); traceSamplesCompared += region.trace.samples.length;
    }
  }
  console.log(JSON.stringify({ worldId: world.worldId, separateProcess: true, globalSamplesCompared: saved.globalSamples.length,
    framesCompared, traceSamplesCompared, roadInspectionsCompared: saved.regions.filter(r => r.roadInspection).length,
    durationMs: performance.now() - started, maxRssMiB: process.resourceUsage().maxRSS / 1024 }));
} else if (mode === 'capture-body') {
  const { base, ...options } = sphericalBowlFixture(), before = serializeGlobalTerrain(base);
  const world = connectGlobalSurfaceWater(base, options), view = createProjectedTerrainView(world, options);
  const globalSamples = [], frames = [];
  for (let i = 0; i <= 100; i++) for (const sign of [-1, 1]) {
    const x = sign * i * 50, sample = view.sampleAt(x, 0);
    near(sample.waterDepthM, Math.max(0, 50 - sample.groundElevationM));
    assert.equal(sample.groundElevationM, base.groundElevationAt(sample.latDeg, sample.lonDeg));
    frames.push(view.surfaceFrameAt(x, 0)); globalSamples.push(world.sampleAt(sample.latDeg, sample.lonDeg));
  }
  assert.ok(frames.some(p => p.waterDepthM > 0)); assert.ok(frames.some(p => p.waterDepthM === 0));
  let lo = 0, hi = 5000;
  for (let i = 0; i < 45; i++) { const x = (lo + hi) / 2; if (view.groundElevationAt(x, 0) < 50) lo = x; else hi = x; }
  assert.ok(view.sampleAt(lo - .001, 0).waterDepthM > 0); assert.equal(view.sampleAt(hi + .001, 0).waterDepthM, 0);
  const contract = view.toSnapshot(); delete contract.world;
  assert.equal(serializeGlobalTerrain(base), before);
  writeFileSync(snapshotPath, serializeGlobalTerrain(world)); writeFileSync(witnessPath, JSON.stringify({ globalSamples, regions: [{ contract, frames }] }));
  console.log(JSON.stringify({ site: 'explicit-bowl-lake', syntheticInput: true, worldId: world.worldId, baseWorldId: base.worldId,
    centerlineSamples: 0, persistedFrames: frames.length, persistedGlobalSamples: globalSamples.length,
    centerIncisionUpperBoundM: world.toSnapshot().waterChart.centerIncisionUpperBoundM,
    waterBodyCount: 1, shoreBracketWidthM: hi - lo, maxCenterIncisionLimitM: 5, baseSnapshotUnchanged: true,
    durationMs: performance.now() - started, maxRssMiB: process.resourceUsage().maxRSS / 1024 }));
} else if (mode === 'capture') {
  const base = restoreGlobalTerrain(readFileSync(sourcePath, 'utf8')), before = serializeGlobalTerrain(base);
  const [centerLatDeg, centerLonDeg] = sites[site];
  const nodes = [{ id: 'source-a', xM: -600, yM: -1800 }, { id: 'source-b', xM: 600, yM: -1800 },
    { id: 'join', xM: 0, yM: -600 }, { id: 'out', xM: 0, yM: 1800 }];
  const edge = (id, from, to) => ({ id, from: nodes[from].id, to: nodes[to].id,
    sourceRiverIds: [`explicit:${id}`], points: [nodes[from], nodes[to]] });
  const world = connectGlobalSurfaceWater(base, { centerLatDeg, centerLonDeg, bounds,
    verticalDatum: base.frame.verticalDatum, riverGraph: { nodes, edges: [edge('a', 0, 2), edge('b', 1, 2), edge('joined', 2, 3)] },
    groundBoundsStepM: 5, maxCenterIncisionM: 5 });
  const view = createProjectedTerrainView(world, { centerLatDeg, centerLonDeg, bounds });
  const chart = world.toSnapshot().waterChart, model = chart.model;
  let centerlineSamples = 0, maxDepthErrorM = 0, basinComparisons = 0;
  const frames = [], globalSamples = [];
  for (const edge of model.edges) {
    let previousLevel = Infinity;
    for (let i = 1; i < edge.points.length - 1; i++) {
      const a = edge.points[i], b = edge.points[i + 1];
      for (const t of [0, .5]) {
        const x = a.xM * (1 - t) + b.xM * t, y = a.yM * (1 - t) + b.yM * t;
        const sample = view.sampleAt(x, y); assert.ok(sample.waterDepthM > 0);
        assert.ok(sample.waterLevelElevationM <= previousLevel + 1e-7); previousLevel = sample.waterLevelElevationM;
        const error = Math.abs(sample.waterSurfaceElevationM - sample.groundElevationM - sample.waterDepthM);
        maxDepthErrorM = Math.max(maxDepthErrorM, error); near(error, 0);
        assert.equal(sample.basinId, base.sampleAt(sample.latDeg, sample.lonDeg).basinId); basinComparisons++; centerlineSamples++;
      }
    }
    const mid = edge.points[Math.floor(edge.points.length / 2)]; frames.push(view.surfaceFrameAt(mid.xM, mid.yM));
  }
  const join = model.nodes.find(n => n.id === 'join');
  for (const edge of model.edges) {
    const point = edge.from === 'join' ? edge.points[0] : edge.to === 'join' ? edge.points.at(-1) : null;
    if (point) near(point.waterLevelElevationM, join.waterLevelElevationM, 0);
  }
  const coarse = view.sampleWindow({ ...bounds, spacingM: 2000 }), fine = new Map(view.sampleWindow({ ...bounds, spacingM: 400 }).samples.map(p => [`${p.xM},${p.yM}`, p]));
  for (const p of coarse.samples) { assert.deepEqual(p, fine.get(`${p.xM},${p.yM}`)); frames.push(view.surfaceFrameAt(p.xM, p.yM)); }
  const left = view.sampleWindow({ ...bounds, maxXM: 0, spacingM: 400 }), right = view.sampleWindow({ ...bounds, minXM: 0, spacingM: 400 });
  const seam = left.samples.filter(p => p.xM === 0); assert.deepEqual(seam, right.samples.filter(p => p.xM === 0));
  for (const p of seam) frames.push(view.surfaceFrameAt(p.xM, p.yM));
  for (const frame of frames) { near(Math.hypot(...Object.values(frame.normal)), 1); globalSamples.push(world.sampleAt(frame.latDeg, frame.lonDeg)); }
  const otherCenter = view.toGeographic(300, 300), other = createProjectedTerrainView(world, { centerLatDeg: otherCenter.latDeg, centerLonDeg: otherCenter.lonDeg, bounds });
  const otherFrames = []; let maxAlternateProjectionErrorM = 0;
  for (const y of [-400, 0, 400, 1000]) {
    const sample = view.sampleAt(0, y), xy = other.toLocal(sample.latDeg, sample.lonDeg), otherSample = other.sampleAt(xy.xM, xy.yM);
    maxAlternateProjectionErrorM = Math.max(maxAlternateProjectionErrorM, Math.abs(sample.groundElevationM - otherSample.groundElevationM));
    near(sample.groundElevationM, otherSample.groundElevationM); near(sample.waterDepthM, otherSample.waterDepthM);
    assert.equal(sample.basinId, otherSample.basinId); assert.equal(sample.worldId, otherSample.worldId);
    otherFrames.push(other.surfaceFrameAt(xy.xM, xy.yM));
  }
  const trace = view.traceSurfaceSegment(traceA, traceB, traceOptions), roadInspection = inspectRoadCrossings(view, roadOptions);
  assert.equal(roadInspection.crossings.length, 1); assert.equal(roadInspection.unresolvedWaterSamples ?? 0, 0);
  for (const x of [-5900, 5900, -6001, 6001]) {
    const p = view.toGeographic(x, 0), sample = world.sampleAt(p.latDeg, p.lonDeg);
    assert.equal(sample.groundElevationM, base.groundElevationAt(p.latDeg, p.lonDeg));
    if (Math.abs(x) > 6000) assert.equal(sample.waterDepthM, null); else assert.equal(sample.waterDepthM, 0);
    globalSamples.push(sample);
  }
  const regions = [ [view, frames, trace, roadInspection], [other, otherFrames] ].map(([v, f, trace, roadInspection]) => {
    const contract = v.toSnapshot(); delete contract.world; return { contract, frames: f, ...(trace ? { trace, roadInspection } : {}) };
  });
  assert.equal(serializeGlobalTerrain(base), before);
  writeFileSync(snapshotPath, serializeGlobalTerrain(world)); writeFileSync(witnessPath, JSON.stringify({ globalSamples, regions }));
  console.log(JSON.stringify({ site, worldId: world.worldId, baseWorldId: base.worldId, sourceWorldId: base.sourceWorldId,
    centerlineSamples, basinComparisons, confluencesCompared: 1, maxDepthErrorM, profileRiseViolations: 0,
    lodComparedPoints: coarse.samples.length, adjacentBoundaryPoints: seam.length, persistedFrames: frames.length + otherFrames.length,
    maxAlternateProjectionErrorM, maxCenterIncisionM: model.diagnostics.maxCenterIncisionM,
    centerIncisionUpperBoundM: chart.centerIncisionUpperBoundM, maxCenterIncisionLimitM: chart.maxCenterIncisionM,
    groundAnalysis: chart.groundAnalysis, persistedGlobalSamples: globalSamples.length, persistedTraceSamples: trace.samples.length,
    roadCrossings: roadInspection.crossings.length, baseSnapshotUnchanged: true,
    durationMs: performance.now() - started, maxRssMiB: process.resourceUsage().maxRSS / 1024 }));
} else throw new TypeError('Unknown global water verification mode');
