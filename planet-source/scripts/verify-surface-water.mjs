import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { runVerification as run, requireVerificationMemory, sha256File, writeVerificationReport } from './verification-runtime.mjs';
import assert from 'node:assert/strict';
import { TEST_FILES } from './test-files.mjs';
import { verificationDirectory } from './verification-paths.mjs';

const root = fileURLToPath(new URL('../', import.meta.url)), output = verificationDirectory('surface-water');
mkdirSync(output, { recursive: true });
const sourceRoot = resolve(root, '../MinimalWorld_Modules_0.3_Core/MinimalWorld_Modules_0.3/dynamic-terrain-runtime');
const provenance = JSON.parse(readFileSync(resolve(sourceRoot, 'PROVENANCE.json'), 'utf8'));
const hashes = () => provenance.files.map(p => ({ file: p.file, expectedSha256: p.sha256,
  observedSha256: sha256File(resolve(sourceRoot, p.file)) }));
const before = hashes(); for (const p of before) assert.equal(p.expectedSha256, p.observedSha256);

const freeMemoryBeforeMiB = requireVerificationMemory();
const tests = run(['--test', ...TEST_FILES]);
writeFileSync(resolve(output, 'unit-tests.log'), tests);
const count = Number(tests.match(/# tests (\d+)/)?.[1]), pass = Number(tests.match(/# pass (\d+)/)?.[1]);
assert.ok(count > 0 && count === pass);
const cases = [];
for (const seed of ['world-a', 'world-b', 'lake-ocean-fixture', 'concave-body-fixture', 'combined-surface-fixture', 'combined-groundwater-fixture', 'world-a-strahler', 'world-b-strahler', 'world-a-c1', 'world-b-c1']) {
  const snapshot = resolve(output, `${seed}.snapshot.json`), witnesses = resolve(output, `${seed}.witnesses.json`);
  const captured = JSON.parse(run(['scripts/surface-water-worker.mjs', 'capture', seed, snapshot, witnesses]));
  const reopened = JSON.parse(run(['scripts/surface-water-worker.mjs', 'reopen', seed, snapshot, witnesses]));
  assert.equal(captured.worldId, reopened.worldId);
  assert.deepEqual(captured.roadInspection, reopened.roadInspection); cases.push({ ...captured, reopened });
}
const after = hashes(); assert.deepEqual(before, after);
const report = { schema: 'minimal-world-surface-water-verification@1', taskStartedDateJST: '2026-10-08',
  verificationDateJST: new Date(Date.now() + 9 * 3600000).toISOString().slice(0, 10), measuredAtUTC: new Date().toISOString(),
  node: process.version, limits: { childHeapMiB: 256, timeoutPerChildMs: 30000, workersConcurrent: 1 },
  freeMemoryBeforeMiB, unitTests: { tests: count, pass }, cases, sourceFilesUnchanged: true, sourceHashes: after,
  unverified: ['Physical discharge/backwater/seasonal simulation', 'Generated lake/ocean identification for legacy regional input',
    'Removal of D8 direction bias and calibrated incision/widths', 'Global proof is in separate verify:global and verify:global-water reports', 'Building/road grounding, deck approaches and full-width bridge acceptance',
    'Rendered zoom/pan and visual or human acceptance', 'All seeds/resolutions and the full legacy module suites'] };
writeVerificationReport(resolve(output, 'verification.json'), report);
console.log(JSON.stringify({ unitTests: report.unitTests,
  cases: cases.map(c => ({ seed: c.seed, nodes: c.completedRiverNodes, edges: c.completedRiverEdges,
    confluences: c.confluencesTested, centerlineSamples: c.centerlineSamples, profileRiseViolations: c.profileRiseViolations,
    depthViolations: c.depthViolations, bodies: c.waterBodyCount, reopenedPoints: c.reopened.comparedPoints,
    maxCenterIncisionM: c.diagnostics.maxCenterIncisionM, unresolvedTerminals: c.diagnostics.unresolvedTerminalNodeIds.length,
    widthReductions: c.diagnostics.geometryWidthScales.filter(s => s.scale !== 1).length })), sourceFilesUnchanged: true }, null, 2));
