import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { runVerification as run, requireVerificationMemory, sha256File, writeVerificationReport } from './verification-runtime.mjs';
import assert from 'node:assert/strict';
import { TEST_FILES } from './test-files.mjs';
import { verificationDirectory } from './verification-paths.mjs';

const root = fileURLToPath(new URL('../', import.meta.url)), output = verificationDirectory('global');
mkdirSync(output, { recursive: true });
const hashes = () => ['geography-lite', 'dynamic-terrain-runtime'].flatMap(module => {
  const sourceRoot = resolve(root, '../MinimalWorld_Modules_0.3_Core/MinimalWorld_Modules_0.3', module);
  const provenance = JSON.parse(readFileSync(resolve(sourceRoot, 'PROVENANCE.json'), 'utf8'));
  return provenance.files.map(p => ({ module, file: p.file, expectedSha256: p.sha256,
    observedSha256: sha256File(resolve(sourceRoot, p.file)) }));
});
const before = hashes(); for (const entry of before) assert.equal(entry.expectedSha256, entry.observedSha256);

const freeMemoryBeforeMiB = requireVerificationMemory();
const tests = run(['--test', ...TEST_FILES]);
writeFileSync(resolve(output, 'unit-tests.log'), tests);
const count = Number(tests.match(/# tests (\d+)/)?.[1]), pass = Number(tests.match(/# pass (\d+)/)?.[1]); assert.ok(count > 0 && count === pass);
const cases = [];
for (const seed of ['audit-a', 'audit-b']) {
  const snapshot = resolve(output, `${seed}.snapshot.json`), witnesses = resolve(output, `${seed}.witnesses.json`);
  const captured = JSON.parse(run(['scripts/global-terrain-worker.mjs', 'capture', seed, snapshot, witnesses]));
  const reopened = JSON.parse(run(['scripts/global-terrain-worker.mjs', 'reopen', seed, snapshot, witnesses]));
  assert.equal(captured.worldId, reopened.worldId); cases.push({ ...captured, reopened });
}
const after = hashes(); assert.deepEqual(before, after);
const report = { schema: 'minimal-world-global-terrain-verification@1',
  verificationDateJST: new Date(Date.now() + 9 * 3600000).toISOString().slice(0, 10), measuredAtUTC: new Date().toISOString(),
  node: process.version, limits: { childHeapMiB: 256, timeoutPerChildMs: 30000, workersConcurrent: 1 },
  freeMemoryBeforeMiB, unitTests: { tests: count, pass }, cases, sourceFilesUnchanged: true, sourceHashes: after,
  unverified: ['Automatic water bodies deferred by user; no generated water surfaces/shoreline constraints',
    'Ellipsoid/geoid transformations or measured fine terrain', 'Correction of large source seam differences and geographic-place centroids',
    'Recomputed drainage after detail, physically calibrated rivers, full global water topology',
    'C1 continuity of carved channels; explicit global-water proof is a separate verify:global-water report', 'Building/road grounding, rendering and human acceptance',
    'All seeds/resolutions and full legacy module suites'] };
writeVerificationReport(resolve(output, 'verification.json'), report);
console.log(JSON.stringify({ unitTests: report.unitTests, cases, sourceFilesUnchanged: true }, null, 2));
