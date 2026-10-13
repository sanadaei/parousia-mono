import { readFileSync, writeFileSync } from 'node:fs';
import { performance } from 'node:perf_hooks';
import assert from 'node:assert/strict';
import { fromDynamicRegional } from '../dynamic-regional.mjs';
import { restoreTerrain, serializeTerrain } from '../index.mjs';

const [mode, seed, snapshotPath, witnessPath] = process.argv.slice(2), started = performance.now();
if (mode === 'reopen') {
  const terrain = restoreTerrain(readFileSync(snapshotPath, 'utf8')), witnesses = JSON.parse(readFileSync(witnessPath, 'utf8'));
  for (const witness of witnesses) assert.deepEqual(terrain.surfaceFrameAt(witness.xM, witness.yM), witness);
  console.log(JSON.stringify({ worldId: terrain.worldId, comparedFrames: witnesses.length, separateProcess: true,
    durationMs: performance.now() - started, maxRssMiB: process.resourceUsage().maxRSS / 1024 }));
} else if (mode === 'capture') {
  const { generateRegional } = await import('../../MinimalWorld_Modules_0.3_Core/MinimalWorld_Modules_0.3/dynamic-terrain-runtime/index.mjs');
  const source = generateRegional(seed, { w: 96, h: 72, cell: 120 }), generationMs = performance.now() - started;
  const terrain = fromDynamicRegional(source, { verticalDatum: 'dynamic-runtime-unspecified-local-zero',
    interpolation: 'bounded-hermite-c1@1', derivativeStepM: 1 }), witnesses = [];
  let sourceCentersCompared = 0, boundedPatchSamples = 0, derivativeSeamsCompared = 0, maxDerivativeSeamGap = 0;
  for (let y = 0; y < source.h; y++) for (let x = 0; x < source.w; x++) {
    assert.equal(terrain.groundElevationAt((x + 0.5) * source.cell, (y + 0.5) * source.cell), source.elevation[y * source.w + x]);
    sourceCentersCompared++;
  }
  for (let i = 0; i < 2048; i++) {
    const x = (i * 37) % (source.w - 1), y = (i * 17) % (source.h - 1);
    const corners = [source.elevation[y * source.w + x], source.elevation[y * source.w + x + 1],
      source.elevation[(y + 1) * source.w + x], source.elevation[(y + 1) * source.w + x + 1]];
    const z = terrain.groundElevationAt((x + 0.5 + (i % 19) / 19) * source.cell, (y + 0.5 + (i % 23) / 23) * source.cell);
    assert.ok(z >= Math.min(...corners) - 1e-8 && z <= Math.max(...corners) + 1e-8); boundedPatchSamples++;
  }
  const epsilon = 0.001;
  for (const [axis, count, other] of [['x', source.w, source.h * source.cell / 2 + 13], ['y', source.h, source.w * source.cell / 2 + 17]]) {
    for (let i = 0; i < count; i++) {
      const at = offset => axis === 'x' ? terrain.groundElevationAt((i + 0.5) * source.cell + offset, other)
        : terrain.groundElevationAt(other, (i + 0.5) * source.cell + offset);
      const gap = Math.abs((at(0) - at(-epsilon)) / epsilon - (at(epsilon) - at(0)) / epsilon);
      maxDerivativeSeamGap = Math.max(maxDerivativeSeamGap, gap); assert.ok(gap < 1e-4); derivativeSeamsCompared++;
    }
  }
  const x = source.w * source.cell / 2, y = source.h * source.cell / 2;
  const area = { minXM: x - 180, minYM: y - 180, maxXM: x + 180, maxYM: y + 180 };
  const coarse = terrain.sampleWindow({ ...area, spacingM: 60 }), fine = terrain.sampleWindow({ ...area, spacingM: 12 });
  const lookup = new Map(fine.samples.map(p => [`${p.xM},${p.yM}`, p]));
  for (const p of coarse.samples) { assert.deepEqual(p, lookup.get(`${p.xM},${p.yM}`)); witnesses.push(terrain.surfaceFrameAt(p.xM, p.yM)); }
  const left = terrain.sampleWindow({ ...area, maxXM: x, spacingM: 12 }), right = terrain.sampleWindow({ ...area, minXM: x, spacingM: 12 });
  const seam = left.samples.filter(p => p.xM === x); assert.deepEqual(seam, right.samples.filter(p => p.xM === x));
  for (const p of seam) witnesses.push(terrain.surfaceFrameAt(p.xM, p.yM));
  for (let i = 0; i < 64; i++) witnesses.push(terrain.surfaceFrameAt(((i * 97) % 1000) / 1000 * terrain.bounds.maxXM, ((i * 131) % 1000) / 1000 * terrain.bounds.maxYM));
  for (const xM of [0, terrain.bounds.maxXM / 2, terrain.bounds.maxXM]) for (const yM of [0, terrain.bounds.maxYM / 2, terrain.bounds.maxYM]) witnesses.push(terrain.surfaceFrameAt(xM, yM));
  for (const witness of witnesses) {
    assert.ok(Math.abs(Math.hypot(...Object.values(witness.normal)) - 1) < 1e-12);
    assert.equal(witness.hydrologyStatus, 'unresolved'); assert.equal(witness.waterDepthM, null);
  }
  writeFileSync(snapshotPath, serializeTerrain(terrain)); writeFileSync(witnessPath, JSON.stringify(witnesses));
  console.log(JSON.stringify({ seed, worldId: terrain.worldId, generationMs, totalMs: performance.now() - started,
    maxRssMiB: process.resourceUsage().maxRSS / 1024, sourceCentersCompared, boundedPatchSamples, derivativeSeamsCompared,
    maxDerivativeSeamGap, lodComparedPoints: coarse.samples.length, adjacentBoundaryPoints: seam.length,
    persistedFrames: witnesses.length, surfaceWaterStatus: 'unresolved' }));
} else throw new TypeError('Unknown verification mode');
