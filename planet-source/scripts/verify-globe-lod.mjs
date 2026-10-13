import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { PACKAGE_ROOT as root, sha256File, requireVerificationMemory, runVerification, writeVerificationReport } from './verification-runtime.mjs';
import { createGlobalTerrain } from '../src/core/global-terrain.mjs';
import { createGlobeFeatureChart } from '../src/core/globe-features.mjs';
import { offsetGeographic, geographicPoint, sphereBasis, greatCircle } from '../src/core/spherical.mjs';
import { unitNormalForGradient } from '../src/core/surface-derivatives.mjs';
import { tileDirection, geographic } from '../src/globe/cube.mjs';
import { LOD_ERROR_METHOD, LOD_TARGET_PIXELS } from '../src/globe/lod.mjs';
const output = path.resolve(root, process.argv[2] ?? 'examples/globe/lod-quality-2026-10-10');
const read = file => JSON.parse(fs.readFileSync(path.resolve(root, file), 'utf8'));
const digest = file => sha256File(path.resolve(root, file));
const freeMemoryBeforeMiB = requireVerificationMemory();
const runtimeFile = path.join(output, 'runtime-final-120s.json'), settledFile = path.join(output, 'settled-coverage.json');
const runtime = read(runtimeFile), settled = read(settledFile);
const files = ['src/core', 'src/globe', 'src/ui', 'test'].flatMap(dir => fs.readdirSync(path.resolve(root, dir)).filter(n => n.endsWith('.mjs')).map(n => `${dir}/${n}`));
const testsFile = path.join(output, 'unit-tests.log'), testText = fs.readFileSync(testsFile, 'utf8'), testedAt = fs.statSync(testsFile).mtimeMs;
const unitTests = Object.fromEntries(['tests', 'pass', 'fail'].map(k => [k, Number(testText.match(new RegExp(`# ${k} (\\d+)`))?.[1])]));
assert.ok(unitTests.tests > 0 && unitTests.tests === unitTests.pass && unitTests.fail === 0);
for (const file of files) assert.ok(fs.statSync(path.resolve(root, file)).mtimeMs <= testedAt, `Tests predate ${file}`);
const buildFile = path.join(output, 'build.log'), build = fs.readFileSync(buildFile, 'utf8');
assert.match(build, /Build Verification Completed Successfully/);
for (const file of files.filter(f => !f.startsWith('test/'))) assert.ok(fs.statSync(path.resolve(root, file)).mtimeMs <= fs.statSync(buildFile).mtimeMs, `Build predates ${file}`);
const browserStart = Date.parse(runtime.timestamp) - runtime.durationMs;
for (const file of files.filter(f => !f.startsWith('test/'))) {
  const mtime = fs.statSync(path.resolve(root, file)).mtimeMs;
  assert.ok(mtime <= browserStart, `Browser run predates ${file}`);
  assert.ok(mtime <= Date.parse(settled.capturedAtUTC), `Settled capture predates ${file}`);
}
assert.equal(runtime.lodContract.method, LOD_ERROR_METHOD); assert.equal(runtime.lodContract.targetPixels, LOD_TARGET_PIXELS);
assert.ok(runtime.durationMs >= 119000); assert.equal(runtime.noGeometryFrames, 0); assert.deepEqual(runtime.streaming.errors, []);
const demo = 'examples/globe/0.4.0/demo', manifest = read(`${demo}/manifest.json`), base = createGlobalTerrain(read(`${demo}/reference.snapshot.json`));
const chart = createGlobeFeatureChart(base, read(`${demo}/features.json`)); assert.equal(runtime.worldId, manifest.worldId);
const sample = p => chart.sampleAt(p.latDeg, p.lonDeg) ?? { groundElevationM: base.groundElevationAt(p.latDeg, p.lonDeg), waterLevelElevationM: null, waterDepthM: null, roadSurface: null, buildingId: null };
const close = (actual, expected) => {
  if (typeof expected !== 'number') { assert.deepEqual(actual, expected); return 0; }
  assert.ok(typeof actual === 'number'); const error = Math.abs(actual - expected); assert.ok(error <= 1e-9, `Core difference ${error}`); return error;
};
let browserWitnesses = 0, localNormalWitnesses = 0, maxElevationErrorM = 0, maxNormalError = 0;
for (const w of [...runtime.witnesses, ...settled.coverage.map(e => ({ tile: e.tile, ...e.witness }))]) {
  const s = sample(w); maxElevationErrorM = Math.max(maxElevationErrorM, close(w.groundElevationM, s.groundElevationM));
  close(w.waterLevelElevationM, s.waterLevelElevationM); close(w.waterDepthM, s.waterDepthM);
  for (const key of ['buildingId', 'structureKind']) assert.equal(w[key] ?? null, s[key] ?? null);
  assert.deepEqual(w.waterSourceIds ?? [], s.waterSourceIds ?? []);
  if (s.roadSurface) for (const key of Object.keys(s.roadSurface)) close(w.roadSurface?.[key], s.roadSurface[key]); else assert.equal(w.roadSurface, null);
  if (w.tile.level >= 12) {
    const d = base.derivativeStepM, at = (x, y) => sample(offsetGeographic(w, x, y, base.frame.radiusM)).groundElevationM;
    const n = unitNormalForGradient({ x: (at(d, 0) - at(-d, 0)) / (2 * d), y: (at(0, d) - at(0, -d)) / (2 * d) }), b = sphereBasis(geographicPoint(w.latDeg, w.lonDeg));
    const normal = b.up.map((v, i) => v * n.z + b.east[i] * n.x + b.north[i] * n.y);
    const error = Math.hypot(...normal.map((v, i) => v - w.normalECEF[i])); assert.ok(error <= 1e-9); maxNormalError = Math.max(maxNormalError, error); localNormalWitnesses++;
  }
  browserWitnesses++;
}
assert.ok(browserWitnesses > 0 && localNormalWitnesses >= 3);
const probe = runtime.centerProbe; assert.ok(probe); const expectedProbe = sample(probe.point);
for (const key of ['groundElevationM', 'waterLevelElevationM', 'waterDepthM']) close(probe.sample[key], expectedProbe[key]);
close(probe.sample.roadSurface?.roadElevationM, expectedProbe.roadSurface?.roadElevationM);
const settledChecks = settled.coverage.map(e => {
  close(e.witness.vertexGroundElevationM, sample(e.witness).groundElevationM); assert.equal(e.morph, 1); assert.equal(e.geometricError.baseCertified, true);
  let maxGridStepM = 0;
  for (let i = 0; i < 16; i++) for (const axis of [0, 1]) {
    const a = geographic(tileDirection(e.tile, axis ? .5 : i / 16, axis ? i / 16 : .5)), b = geographic(tileDirection(e.tile, axis ? .5 : (i + 1) / 16, axis ? (i + 1) / 16 : .5));
    maxGridStepM = Math.max(maxGridStepM, greatCircle(a, b, base.frame.radiusM).distanceM);
  }
  return { tile: e.tile, maxGridStepM, overlays: e.overlays, geometricError: e.geometricError, morphErrorM: e.morphErrorM };
});
assert.ok(settledChecks.some(e => e.maxGridStepM < 1));
assert.ok(runtime.streaming.peakGpuBytes <= runtime.limits.gpuBytes);
for (const s of runtime.streaming.workerStats) { assert.ok(s.fieldBytes <= runtime.limits.fieldBytesPerWorker); assert.ok(s.anchorBytes <= runtime.limits.anchorBytesPerWorker); }
let pagesVerified = 0;
for (const name of ['demo', 'real-a', 'real-b']) {
  const dir = `examples/globe/0.4.0/${name}`, m = read(`${dir}/manifest.json`);
  for (const p of [...Object.values(m.pages), ...(m.featureCharts ?? (m.features ? [m.features] : []))]) { const file = `${dir}/${p.path}`; assert.equal(fs.statSync(path.resolve(root, file)).size, p.bytes); assert.equal(digest(file), p.sha256); pagesVerified++; }
}
// Core and inputs must still match the independently saved pre-change evidence.
const baseline = read('examples/globe/0.4.0/validation/verification.json');
const coreHashes = baseline.implementationHashes.filter(e => e.file.startsWith('src/core/'));
for (const e of coreHashes) assert.equal(digest(e.file), e.sha256);
const stage = read('examples/audit-0.3.3/0.4.0/verification.json');
for (const e of stage.inputSnapshots) assert.equal(digest(e.file), e.sha256);
for (const e of stage.sourceHashes) { const file = `../MinimalWorld_Modules_0.3_Core/MinimalWorld_Modules_0.3/${e.module}/${e.file}`; assert.equal(digest(file), e.expectedSha256); }
const legacy = [];
for (const e of stage.legacy) {
  const name = path.basename(e.file, '.snapshot.json'), witness = e.file.replace('.snapshot.json', '.witnesses.json');
  const args = e.file.startsWith('examples/global/') ? ['global-terrain-worker.mjs', name] : e.file.startsWith('examples/global-water/') ? ['global-water-worker.mjs', 'unused', name] : e.file.startsWith('examples/surface-water/') || name.startsWith('world-') ? ['surface-water-worker.mjs', name] : ['canonical-export-worker.mjs', 'unused', name.replace(/^audit-[ab]-/, '')];
  const [worker, ...params] = args; const restored = JSON.parse(runVerification([`scripts/${worker}`, 'reopen', ...params, e.file, witness]));
  assert.equal(restored.worldId, e.worldId); legacy.push({ file: e.file, ...restored });
}
assert.equal(legacy.length, 40);
const report = { schema: 'minimal-world-globe-lod-verification@1', measuredAtUTC: new Date().toISOString(), node: process.version, freeMemoryBeforeMiB,
  unitTests, build: 'PASS', coreFilesUnchanged: coreHashes.length, sourceFilesUnchanged: stage.sourceHashes.length, inputSnapshotsUnchanged: stage.inputSnapshots.length,
  pagesVerified, legacy, browserWitnesses, localNormalWitnesses, maxElevationErrorM, maxNormalError, settledChecks,
  runtime: { file: path.basename(runtimeFile), sha256: digest(runtimeFile), averageFPS: runtime.averageFPS, intervalMs: runtime.intervalMs, framesOver33ms: runtime.framesOver33ms,
    noGeometryFrames: runtime.noGeometryFrames, strictEveryFrame30FPSGate: runtime.framesOver33ms === 0, totalBrowserMemoryGate: runtime.totalBrowserMemoryGate, lodQuality: runtime.streaming.lodQuality },
  evidenceHashes: [testsFile, buildFile, settledFile].map(file => ({ file: path.basename(file), sha256: digest(file) })),
  implementationHashes: [...files, 'scripts/verify-globe-lod.mjs'].map(file => ({ file, sha256: digest(file) })),
  remaining: ['Feature/waterline converging error bounds', 'Displayed/morph screen-error acceptance', 'Adjacent 2:1 balancing and stitching', 'Long-duration/device/process-memory/GPU recovery acceptance'] };
writeVerificationReport(path.join(output, 'verification.json'), report);
console.log(JSON.stringify({ unitTests, pagesVerified, legacy: legacy.length, browserWitnesses, localNormalWitnesses, maxElevationErrorM, maxNormalError, settledChecks, runtime: report.runtime }));
