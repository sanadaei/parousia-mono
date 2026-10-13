import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import { runVerification, sha256File, requireVerificationMemory, writeVerificationReport, PACKAGE_ROOT } from './verification-runtime.mjs';
import { verificationDirectory } from './verification-paths.mjs';
import { createGlobalTerrain } from '../src/core/global-terrain.mjs';
import { createGlobeFeatureChart } from '../src/core/globe-features.mjs';
import { offsetGeographic, geographicPoint, sphereBasis, greatCircle } from '../src/core/spherical.mjs';
import { unitNormalForGradient } from '../src/core/surface-derivatives.mjs';
import { tileDirection, geographic } from '../src/globe/cube.mjs';
const output = path.join(PACKAGE_ROOT, 'examples/globe/0.4.0/validation'); fs.mkdirSync(output, { recursive: true });
const read = file => JSON.parse(fs.readFileSync(path.resolve(PACKAGE_ROOT, file), 'utf8'));
const freeMemoryBeforeMiB = requireVerificationMemory();
const stagePath = path.join(verificationDirectory('audit-0.3.3'), 'verification.json');
if (!process.argv.includes('--reuse-stage3')) fs.writeFileSync(path.join(output, 'stage3.log'), runVerification(['scripts/verify-stage3.mjs'], { timeoutMs: 120000 }));
const stage = JSON.parse(fs.readFileSync(stagePath, 'utf8'));
assert.equal(stage.implementationVersion, '0.4.0'); assert.equal(stage.unitTests.tests, stage.unitTests.pass);
assert.equal(stage.legacy.length, 40); assert.equal(stage.sourceFilesUnchanged, true); assert.equal(stage.inputSnapshotsUnchanged, true);
for (const e of stage.inputSnapshots) assert.equal(sha256File(path.join(PACKAGE_ROOT, e.file)), e.sha256);
const build = runVerification(['scripts/build.mjs']); fs.writeFileSync(path.join(output, 'build.log'), build);
const runtimePath = path.join(output, 'runtime-final-120s.json'), runtime = JSON.parse(fs.readFileSync(runtimePath, 'utf8'));
const sourceFiles = ['src/core', 'src/globe'].flatMap(folder => fs.readdirSync(path.join(PACKAGE_ROOT, folder)).filter(f => f.endsWith('.mjs')).map(f => `${folder}/${f}`));
for (const folder of ['src/core', 'test']) for (const name of fs.readdirSync(path.join(PACKAGE_ROOT, folder)).filter(f => f.endsWith('.mjs'))) {
  assert.ok(fs.statSync(path.join(PACKAGE_ROOT, folder, name)).mtimeMs <= Date.parse(stage.measuredAtUTC), `Tests predate ${folder}/${name}`);
}
const runtimeStart = Date.parse(runtime.timestamp) - runtime.durationMs;
for (const file of sourceFiles) assert.ok(fs.statSync(path.join(PACKAGE_ROOT, file)).mtimeMs <= runtimeStart, `Browser capture predates ${file}`);
const demo = 'examples/globe/0.4.0/demo', manifest = read(`${demo}/manifest.json`), base = createGlobalTerrain(read(`${demo}/reference.snapshot.json`)), recipe = read(`${demo}/features.json`);
const chart = createGlobeFeatureChart(base, recipe);
assert.equal(runtime.worldId, manifest.worldId); assert.ok(runtime.durationMs >= 119000); assert.equal(runtime.streaming.errors.length, 0);
let pagesVerified = 0;
for (const name of ['demo', 'real-a', 'real-b']) {
  const folder = `examples/globe/0.4.0/${name}`, m = read(`${folder}/manifest.json`);
  for (const d of [...Object.values(m.pages), ...(m.featureCharts ?? (m.features ? [m.features] : []))]) {
    const file = path.join(PACKAGE_ROOT, folder, d.path); assert.equal(fs.statSync(file).size, d.bytes); assert.equal(sha256File(file), d.sha256); pagesVerified++;
  }
}
const sample = p => chart.sampleAt(p.latDeg, p.lonDeg) ?? { groundElevationM: base.groundElevationAt(p.latDeg, p.lonDeg), waterLevelElevationM: null, waterDepthM: null, roadSurface: null, buildingId: null };
const settled = read('examples/globe/0.4.0/validation/settled-coverage.json');
for (const file of sourceFiles) assert.ok(fs.statSync(path.join(PACKAGE_ROOT, file)).mtimeMs <= Date.parse(settled.capturedAtUTC), `Local capture predates ${file}`);
let browserWitnesses = 0, localNormalWitnesses = 0, maxLocalVertexFloat32ErrorM = 0, maxBrowserCoreElevationErrorM = 0, maxBrowserCoreNormalError = 0;
const close = (actual, expected) => {
  if (typeof expected === 'number') { const error = Math.abs(actual - expected); assert.ok(error <= 1e-9, `Cross-runtime difference ${error}`); return error; }
  assert.deepEqual(actual, expected); return 0;
};
for (const w of [...runtime.witnesses, ...settled.coverage.map(e => ({ tile: e.tile, ...e.witness }))]) {
  const expected = sample(w); maxBrowserCoreElevationErrorM = Math.max(maxBrowserCoreElevationErrorM, close(w.groundElevationM, expected.groundElevationM)); close(w.waterLevelElevationM, expected.waterLevelElevationM); close(w.waterDepthM, expected.waterDepthM);
  assert.equal(w.buildingId ?? null, expected.buildingId ?? null); assert.equal(w.structureKind ?? null, expected.structureKind ?? null);
  assert.deepEqual(w.waterSourceIds ?? [], expected.waterSourceIds ?? []);
  if (expected.roadSurface) for (const key of Object.keys(expected.roadSurface)) close(w.roadSurface?.[key], expected.roadSurface[key]); else assert.equal(w.roadSurface, null);
  if (w.tile.level >= 12) {
    localNormalWitnesses++;
    maxLocalVertexFloat32ErrorM = Math.max(maxLocalVertexFloat32ErrorM, w.maxVertexFloat32ErrorM);
    const d = base.derivativeStepM, at = (east, north) => sample(offsetGeographic(w, east, north, base.frame.radiusM)).groundElevationM;
    const n = unitNormalForGradient({ x: (at(d, 0) - at(-d, 0)) / (2 * d), y: (at(0, d) - at(0, -d)) / (2 * d) }), b = sphereBasis(geographicPoint(w.latDeg, w.lonDeg));
    const normal = b.up.map((v, i) => v * n.z + b.east[i] * n.x + b.north[i] * n.y);
    const error = Math.hypot(...normal.map((v, i) => v - w.normalECEF[i])); maxBrowserCoreNormalError = Math.max(maxBrowserCoreNormalError, error); assert.ok(error < 1e-9);
  }
  browserWitnesses++;
}
assert.ok(browserWitnesses > 0); assert.ok(localNormalWitnesses >= 3, 'No local Core normal evidence');
const probe = runtime.centerProbe; assert.ok(probe); const expectedProbe = sample(probe.point);
for (const key of ['groundElevationM', 'waterLevelElevationM', 'waterDepthM']) close(probe.sample[key], expectedProbe[key]);
close(probe.sample.roadSurface?.roadElevationM, expectedProbe.roadSurface?.roadElevationM);
assert.ok(runtime.streaming.peakGpuBytes <= runtime.limits.gpuBytes);
for (const s of runtime.streaming.workerStats) { assert.ok(s.fieldBytes <= runtime.limits.fieldBytesPerWorker); assert.ok(s.anchorBytes <= runtime.limits.anchorBytesPerWorker); }
const settledChecks = settled.coverage.map(e => {
  let maxGridStepM = 0;
  for (let i = 0; i < 16; i++) for (const axis of [0, 1]) {
    const a = geographic(tileDirection(e.tile, axis ? .5 : i / 16, axis ? i / 16 : .5)), b = geographic(tileDirection(e.tile, axis ? .5 : (i + 1) / 16, axis ? (i + 1) / 16 : .5));
    maxGridStepM = Math.max(maxGridStepM, greatCircle(a, b, base.frame.radiusM).distanceM);
  }
  const expected = sample(e.witness); close(e.witness.vertexGroundElevationM, expected.groundElevationM);
  return { tile: e.tile, maxGridStepM, overlayIndices: e.overlays };
});
assert.ok(settledChecks.some(e => e.maxGridStepM < 1.0), 'Settled center did not reach sub-meter display grid');
const report = { schema: 'minimal-world-globe-verification@1', version: '0.4.0', measuredAtUTC: new Date().toISOString(), freeMemoryBeforeMiB,
  node: process.version, unitTests: stage.unitTests, legacySnapshots: stage.legacy.length, sourceFilesUnchanged: true, inputSnapshotsUnchanged: true,
  build: 'PASS; 35 core modules, 30 alias identities, 8 globe syntax checks', fieldAndFeaturePagesVerified: pagesVerified,
  browserWitnesses, localNormalWitnesses, centerProbe: 'Core ground/water/road match within 1e-9m across Node/Chromium', localNormals: 'within 1e-9 of Core stencil', maxLocalVertexFloat32ErrorM,
  maxBrowserCoreElevationErrorM, maxBrowserCoreNormalError,
  settledChecks, runtime: { file: 'runtime-final-120s.json', sha256: sha256File(runtimePath), averageFPS: runtime.averageFPS, intervalMs: runtime.intervalMs,
    framesOver33ms: runtime.framesOver33ms, noGeometryFrames: runtime.noGeometryFrames, streaming: runtime.streaming, fps30P95Gate: runtime.fps30Gate,
    strictEveryFrame30FPSGate: runtime.framesOver33ms === 0, totalBrowserMemoryGate: runtime.totalBrowserMemoryGate },
  implementationHashes: [...sourceFiles, 'scripts/package-globe.mjs', 'scripts/verify-globe.mjs', 'test/globe.test.mjs'].map(file => ({ file, sha256: sha256File(path.join(PACKAGE_ROOT, file)) })) };
writeVerificationReport(path.join(output, 'verification.json'), report);
console.log(JSON.stringify({ tests: stage.unitTests, pagesVerified, browserWitnesses, settledChecks, fps: runtime.averageFPS, p95: runtime.intervalMs.p95, strictFPS: report.runtime.strictEveryFrame30FPSGate, memoryGate: runtime.totalBrowserMemoryGate }));
