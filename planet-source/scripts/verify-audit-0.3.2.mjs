import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { runVerification as run, requireVerificationMemory, sha256File, writeVerificationReport } from './verification-runtime.mjs';
import assert from 'node:assert/strict';
import { TEST_FILES } from './test-files.mjs';
import { verificationDirectory } from './verification-paths.mjs';
const root = fileURLToPath(new URL('../', import.meta.url)), output = verificationDirectory('audit-0.3.2');
const implementationVersion = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8')).version;
mkdirSync(output, { recursive: true });
const digest = path => sha256File(path);
const hashes = () => ['geography-lite', 'dynamic-terrain-runtime'].flatMap(module => {
  const sourceRoot = resolve(root, '../MinimalWorld_Modules_0.3_Core/MinimalWorld_Modules_0.3', module);
  return JSON.parse(readFileSync(resolve(sourceRoot, 'PROVENANCE.json'), 'utf8')).files.map(p => ({ module,
    file: p.file, expectedSha256: p.sha256, observedSha256: digest(resolve(sourceRoot, p.file)) }));
});
const before = hashes(); for (const entry of before) assert.equal(entry.expectedSha256, entry.observedSha256);
const seedNames = ['audit-a', 'audit-b'], sites = ['date-line', 'source-seam', 'north-pole', 'south-pole'];
const oldGlobalNames = [...seedNames.flatMap(seed => sites.map(site => `${seed}-${site}`)), 'explicit-bowl-lake'];
const oldFiniteNames = ['world-a', 'world-b', 'lake-ocean-fixture', 'concave-body-fixture', 'combined-surface-fixture',
  'combined-groundwater-fixture', 'world-a-strahler', 'world-b-strahler', 'world-a-c1', 'world-b-c1'];
const inputs = [...seedNames.map(seed => `examples/global/${seed}.snapshot.json`),
  ...oldGlobalNames.map(name => `examples/global-water/${name}.snapshot.json`),
  ...oldFiniteNames.map(name => `examples/surface-water/${name}.snapshot.json`)].map(file => ({ file, sha256: digest(resolve(root, file)) }));

const freeMemoryBeforeMiB = requireVerificationMemory();
const tests = run(['--test', ...TEST_FILES]); writeFileSync(resolve(output, 'unit-tests.log'), tests);
const count = Number(tests.match(/# tests (\d+)/)?.[1]), pass = Number(tests.match(/# pass (\d+)/)?.[1]); assert.ok(count > 0 && count === pass);
const oldGlobalWater = [];
for (const name of oldGlobalNames) {
  oldGlobalWater.push({ name, ...JSON.parse(run(['scripts/global-water-worker.mjs', 'reopen', 'unused', 'unused',
    `examples/global-water/${name}.snapshot.json`, `examples/global-water/${name}.witnesses.json`])) });
}
console.log(`Old global water: ${oldGlobalWater.length} snapshots and exact witnesses preserved`);
const oldGlobalBase = seedNames.map(seed => ({ seed, ...JSON.parse(run(['scripts/global-terrain-worker.mjs', 'reopen', seed,
  `examples/global/${seed}.snapshot.json`, `examples/global/${seed}.witnesses.json`])) }));
const oldFiniteWater = oldFiniteNames.map(name => ({ name, ...JSON.parse(run(['scripts/surface-water-worker.mjs', 'reopen', name,
  `examples/surface-water/${name}.snapshot.json`, `examples/surface-water/${name}.witnesses.json`])) }));
console.log(`Old finite water: ${oldFiniteWater.length} snapshots and exact witnesses preserved`);
const exports = [];
for (const seed of seedNames) for (const site of sites) {
  const name = `${seed}-${site}`, snapshot = resolve(output, `${name}.snapshot.json`), witnesses = resolve(output, `${name}.witnesses.json`);
  const captured = JSON.parse(run(['scripts/canonical-export-worker.mjs', 'capture', `examples/global/${seed}.snapshot.json`, site, snapshot, witnesses]));
  const reopened = JSON.parse(run(['scripts/canonical-export-worker.mjs', 'reopen', 'unused', site, snapshot, witnesses]));
  assert.equal(captured.worldId, reopened.worldId); exports.push({ seed, ...captured, reopened });
  console.log(`${name}: ${captured.centersCompared} canonical centers, ${captured.waterLevelRole}, ${reopened.framesCompared} reopened frames`);
}
const repairedDrainage = [];
for (const seed of ['world-a-c1', 'world-b-c1']) {
  const snapshot = resolve(output, `${seed}.snapshot.json`), witnesses = resolve(output, `${seed}.witnesses.json`);
  const captured = JSON.parse(run(['scripts/surface-water-worker.mjs', 'capture', seed, snapshot, witnesses]));
  const reopened = JSON.parse(run(['scripts/surface-water-worker.mjs', 'reopen', seed, snapshot, witnesses]));
  assert.equal(captured.worldId, reopened.worldId);
  const saved = JSON.parse(readFileSync(snapshot, 'utf8'));
  const directions = saved.hydrology.nodes.filter(n => n.kind === 'regional-boundary').map(n => ({ id: n.id, ...n.boundaryDirection }));
  const original = JSON.parse(readFileSync(resolve(root, `examples/surface-water/${seed}.snapshot.json`), 'utf8'));
  assert.deepEqual(saved.hydrology.nodes.map(n => n.id), original.hydrology.nodes.map(n => n.id));
  const movedOutlets = saved.hydrology.nodes.filter(n => n.kind === 'regional-boundary' && original.hydrology.nodes.some(p => p.id === n.id && (p.xM !== n.xM || p.yM !== n.yM))).length;
  repairedDrainage.push({ ...captured, directions, movedOutlets, reopened });
  console.log(`${seed}: ${movedOutlets} outlets continued along incoming flow, ${captured.centerlineSamples} river probes`);
}
const after = hashes(); assert.deepEqual(before, after); for (const input of inputs) assert.equal(digest(resolve(root, input.file)), input.sha256);
const report = { schema: 'minimal-world-audit-0.3.2-verification@1', implementationVersion,
  verificationDateJST: new Date(Date.now() + 9 * 3600000).toISOString().slice(0, 10), measuredAtUTC: new Date().toISOString(), node: process.version,
  limits: { childHeapMiB: 256, timeoutPerChildMs: 30000, workersConcurrent: 1 }, freeMemoryBeforeMiB,
  unitTests: { tests: count, pass }, oldGlobalWater, oldGlobalBase, oldFiniteWater, exports, repairedDrainage,
  sourceFilesUnchanged: true, sourceHashes: after, inputSnapshotsUnchanged: true, inputSnapshots: inputs,
  unverified: ['Automatic water bodies deferred by user', 'Global groundwater/static-level charts and recomputed drainage',
    'Removal of grid-line/polar detail omission; C1 continuity of carved ground',
    'Multiple global water charts, hole/multi-ring water bodies and physically calibrated flow',
    'Full-width roads, bridge approaches, building grounding, rendering and human acceptance',
    'Maximum input-scale performance, all seeds/resolutions and full legacy module suites'] };
writeVerificationReport(resolve(output, 'verification.json'), report);
console.log(JSON.stringify({ unitTests: report.unitTests, exportCases: exports.length, exportCenters: exports.reduce((s, c) => s + c.centersCompared, 0),
  exportFramesReopened: exports.reduce((s, c) => s + c.reopened.framesCompared, 0), oldGlobalWaterFramesReopened: oldGlobalWater.reduce((s, c) => s + c.framesCompared, 0),
  movedOutlets: repairedDrainage.reduce((s, c) => s + c.movedOutlets, 0), sourceFilesUnchanged: true, inputSnapshotsUnchanged: true }));
