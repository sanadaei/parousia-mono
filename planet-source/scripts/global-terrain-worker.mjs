import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import assert from 'node:assert/strict';
import { fromGeographyLite, createProjectedTerrainView, restoreGlobalTerrain, restoreProjectedTerrainView, serializeGlobalTerrain } from '../global-terrain.mjs';
import { detailBands } from '../fixtures/global-scenarios.mjs';
import { inspectRoadCrossings } from '../road-crossings.mjs';

const traceA = { xM: -6000, yM: -6000 }, traceB = { xM: 6000, yM: 6000 }, traceOptions = { maxStepM: 2000 };
const roadOptions = { roads: [{ id: 'projected-diagonal', points: [traceA, traceB] }], maxStepM: 2000 };

const [mode, seed, snapshotPath, witnessPath] = process.argv.slice(2), started = performance.now();
const sourceHash = source => createHash('sha256').update(JSON.stringify(source)).digest('hex');
if (mode === 'reopen') {
  // This branch imports no geography generator, using only the saved canonical sphere.
  const snapshot = JSON.parse(readFileSync(snapshotPath, 'utf8')), global = restoreGlobalTerrain(snapshot);
  const witnesses = JSON.parse(readFileSync(witnessPath, 'utf8')); let regionalFramesCompared = 0, traceSamplesCompared = 0, roadInspectionsCompared = 0;
  for (const p of witnesses.globalSamples) assert.deepEqual(global.sampleAt(p.latDeg, p.lonDeg), p);
  for (const saved of witnesses.regions) {
    const view = restoreProjectedTerrainView({ ...saved.contract, world: snapshot });
    assert.equal(view.worldId, global.worldId);
    for (const p of saved.frames) { assert.deepEqual(view.surfaceFrameAt(p.xM, p.yM), p); regionalFramesCompared++; }
    if (saved.trace) {
      assert.deepEqual(view.traceSurfaceSegment(traceA, traceB, traceOptions), saved.trace); traceSamplesCompared += saved.trace.samples.length;
      assert.deepEqual(inspectRoadCrossings(view, roadOptions), saved.roadInspection); roadInspectionsCompared++;
    }
  }
  console.log(JSON.stringify({ worldId: global.worldId, globalSamplesCompared: witnesses.globalSamples.length,
    regionalFramesCompared, traceSamplesCompared, roadInspectionsCompared, regionsCompared: witnesses.regions.length, separateProcess: true,
    durationMs: performance.now() - started, maxRssMiB: process.resourceUsage().maxRSS / 1024 }));
} else if (mode === 'capture') {
  const { generateGeography } = await import('../../MinimalWorld_Modules_0.3_Core/MinimalWorld_Modules_0.3/geography-lite/index.mjs');
  const source = generateGeography({ seed, width: 24, height: 12, detailScale: 2 }), generationMs = performance.now() - started;
  const before = sourceHash(source), p = source.physical, w = p.width, h = p.height;
  const global = fromGeographyLite(source, { radiusM: 6371000, sourceVerticalDatum: 'geography-lite-generated-zero',
    verticalDatum: 'geography-lite-generated-zero', detailBands });
  const detailMethod = global.toSnapshot().detail.method;
  let sourceCentersCompared = 0, drainageOutletsCompared = 0, boundedDetailSamples = 0, maxAbsDetailM = 0;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = y * w + x, sample = global.sampleAt(90 - (y + 0.5) / h * 180, (x + 0.5) / w * 360);
    assert.ok(Math.abs(sample.groundElevationM - p.elevationM[i]) < 1e-8); assert.ok(Math.abs(sample.detailElevationM) < 1e-12);
    assert.equal(sample.sourceCellIndex, i); assert.equal(sample.sourceLandMask, p.landMask[i]);
    assert.equal(sample.sourceMacroCellId, source.cells[Math.floor(y / 2) * source.width + Math.floor(x / 2)].id);
    let current = i, steps = 0;
    while (current >= 0 && p.landMask[current]) { current = p.downstream[current]; assert.ok(++steps <= w * h); }
    assert.equal(sample.outletCellIndex, current < 0 ? null : current);
    assert.equal(sample.sourceLakeFillDepthM, p.lakeDepthM[i]); assert.equal(sample.waterDepthM, null);
    sourceCentersCompared++; drainageOutletsCompared++;
  }
  for (let i = 0; i < 2048; i++) {
    const x = (i * 37) % w, y = (i * 17) % (h - 1), tx = (i % 17 + 1) / 18, ty = (i % 19 + 1) / 20;
    const corners = [p.elevationM[y * w + x], p.elevationM[y * w + (x + 1) % w], p.elevationM[(y + 1) * w + x], p.elevationM[(y + 1) * w + (x + 1) % w]];
    const sample = global.sampleAt(90 - (y + 0.5 + ty) / h * 180, (x + 0.5 + tx) / w * 360);
    const constrained = detailMethod === 'bounded-spherical-bands@1'
      ? sample.groundElevationM : sample.baseGroundElevationM;
    assert.ok(constrained >= Math.min(...corners) - 1e-8 && constrained <= Math.max(...corners) + 1e-8);
    assert.ok(Math.abs(sample.detailElevationM) <= 24 + 1e-8); maxAbsDetailM = Math.max(maxAbsDetailM, Math.abs(sample.detailElevationM)); boundedDetailSamples++;
  }
  assert.ok(maxAbsDetailM > 0.01);
  const globalSamples = [];
  for (let i = 0; i < 64; i++) globalSamples.push(global.sampleAt(-89 + ((i * 37) % 178), -180 + ((i * 61) % 360)));
  for (const lat of [-90, -60, 0, 60, 90]) {
    const a = global.sampleAt(lat, -180), b = global.sampleAt(lat, 180); assert.deepEqual(a, b); globalSamples.push(a);
  }
  for (const lat of [-90, 90]) assert.deepEqual(global.sampleAt(lat, 30), global.sampleAt(lat, -123));
  let coast = -1;
  for (let i = 0; i < w * h; i++) if (p.landMask[i] && !p.landMask[Math.floor(i / w) * w + (i % w + 1) % w]) { coast = i; break; }
  assert.ok(coast >= 0);
  const lake = p.lakeDepthM.findIndex(depth => depth > 8), centers = [
    { name: 'macro-boundary-and-date-line', centerLatDeg: 0, centerLonDeg: 180 },
    { name: 'source-longitude-seam', centerLatDeg: 12, centerLonDeg: 0 },
    { name: 'source-coast-site', centerLatDeg: 90 - (Math.floor(coast / w) + 0.5) / h * 180, centerLonDeg: (coast % w + 1) / w * 360 },
    ...(lake >= 0 ? [{ name: 'source-lake-fill-site', centerLatDeg: 90 - (Math.floor(lake / w) + 0.5) / h * 180, centerLonDeg: (lake % w + 0.5) / w * 360 }] : []),
    { name: 'north-pole', centerLatDeg: 90, centerLonDeg: 0 }, { name: 'south-pole', centerLatDeg: -90, centerLonDeg: 0 },
  ];
  const regions = [], regionalReports = []; let maxProjectionRoundTripErrorM = 0;
  for (const center of centers) {
    const view = createProjectedTerrainView(global, { ...center, bounds: { minXM: -6000, minYM: -6000, maxXM: 6000, maxYM: 6000 } });
    const coarse = view.sampleWindow({ ...view.bounds, spacingM: 2000 }), fine = view.sampleWindow({ ...view.bounds, spacingM: 400 });
    const byCoordinate = new Map(fine.samples.map(s => [`${s.xM},${s.yM}`, s]));
    const left = view.sampleWindow({ ...view.bounds, maxXM: 0, spacingM: 400 }), right = view.sampleWindow({ ...view.bounds, minXM: 0, spacingM: 400 });
    const seam = left.samples.filter(s => s.xM === 0); assert.deepEqual(seam, right.samples.filter(s => s.xM === 0));
    const frames = [];
    for (const sample of coarse.samples) {
      assert.deepEqual(sample, byCoordinate.get(`${sample.xM},${sample.yM}`));
      const sphereSample = global.sampleAt(sample.latDeg, sample.lonDeg);
      assert.equal(sample.groundElevationM, sphereSample.groundElevationM); assert.equal(sample.basinId, sphereSample.basinId);
      const local = view.toLocal(sample.latDeg, sample.lonDeg), error = Math.hypot(local.xM - sample.xM, local.yM - sample.yM);
      maxProjectionRoundTripErrorM = Math.max(maxProjectionRoundTripErrorM, error); assert.ok(error < 3e-6);
      frames.push(view.surfaceFrameAt(sample.xM, sample.yM));
    }
    for (const sample of seam) frames.push(view.surfaceFrameAt(sample.xM, sample.yM));
    const contract = view.toSnapshot(); delete contract.world;
    const trace = view.traceSurfaceSegment(traceA, traceB, traceOptions), roadInspection = inspectRoadCrossings(view, roadOptions);
    assert.equal(roadInspection.unresolvedWaterSamples, trace.samples.length); assert.deepEqual(roadInspection.crossings, []);
    for (const sample of trace.samples) { assert.equal(sample.waterDepthM, null); assert.equal(sample.surfaceKind, 'unresolved'); }
    regions.push({ contract, frames, trace, roadInspection }); regionalReports.push({ name: center.name, regionId: view.regionId,
      lodComparedPoints: coarse.samples.length, adjacentBoundaryPoints: seam.length, globalBasinComparedPoints: coarse.samples.length,
      persistedFrames: frames.length, hydrologyStatus: view.hydrologyStatus,
      persistedTraceSamples: trace.samples.length, unresolvedRoadWaterSamples: roadInspection.unresolvedWaterSamples });
  }
  assert.equal(sourceHash(source), before);
  const sourceSeamDiff = Array.from({ length: h }, (_, y) => Math.abs(p.elevationM[y * w] - p.elevationM[y * w + w - 1]));
  writeFileSync(snapshotPath, serializeGlobalTerrain(global)); writeFileSync(witnessPath, JSON.stringify({ globalSamples, regions }));
  console.log(JSON.stringify({ seed, worldId: global.worldId, sourceWorldId: global.sourceWorldId, physicalGrid: [w, h], generationMs,
    totalMs: performance.now() - started, maxRssMiB: process.resourceUsage().maxRSS / 1024, sourceCentersCompared, drainageOutletsCompared,
    boundedDetailSamples, maxAbsDetailM, maxProjectionRoundTripErrorM, globalWitnessCount: globalSamples.length,
    sourceInputUnchanged: true, recordedLakeFillCells: p.lakeDepthM.filter(v => v > 8).length,
    sourceSeamMeanDifferenceM: sourceSeamDiff.reduce((sum, v) => sum + v, 0) / h,
    sourceSeamMaxDifferenceM: Math.max(...sourceSeamDiff), regionalReports }));
} else throw new TypeError('Unknown global verification mode');
