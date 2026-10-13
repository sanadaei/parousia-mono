import { TEST_FILES } from './test-files.mjs';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { runVerification as run, requireVerificationMemory, sha256File, writeVerificationReport } from './verification-runtime.mjs';
import assert from 'node:assert/strict';

const root = fileURLToPath(new URL('../', import.meta.url)), output = resolve(root, 'examples/refinement');
mkdirSync(output, { recursive: true });
const sourceRoot = resolve(root, '../MinimalWorld_Modules_0.3_Core/MinimalWorld_Modules_0.3/dynamic-terrain-runtime');
const provenance = JSON.parse(readFileSync(resolve(sourceRoot, 'PROVENANCE.json'), 'utf8'));
const hashes = () => provenance.files.map(p => ({ file: p.file, expectedSha256: p.sha256,
  observedSha256: sha256File(resolve(sourceRoot, p.file)) }));
const before = hashes(); for (const entry of before) assert.equal(entry.expectedSha256, entry.observedSha256);

const freeMemoryBeforeMiB = requireVerificationMemory();
const tests = run(['--test', ...TEST_FILES]);
writeFileSync(resolve(output, 'unit-tests.log'), tests);
const count = Number(tests.match(/# tests (\d+)/)?.[1]), pass = Number(tests.match(/# pass (\d+)/)?.[1]); assert.ok(count > 0 && count === pass);
const cases = [];
for (const seed of ['world-a', 'world-b']) {
  const snapshot = resolve(output, `${seed}.snapshot.json`), witnesses = resolve(output, `${seed}.witnesses.json`);
  const captured = JSON.parse(run(['scripts/refinement-worker.mjs', 'capture', seed, snapshot, witnesses]));
  const reopened = JSON.parse(run(['scripts/refinement-worker.mjs', 'reopen', seed, snapshot, witnesses]));
  assert.equal(captured.worldId, reopened.worldId); cases.push({ ...captured, reopened });
}
const after = hashes(); assert.deepEqual(before, after);
const report = { schema: 'minimal-world-field-refinement-verification@1',
  verificationDateJST: new Date(Date.now() + 9 * 3600000).toISOString().slice(0, 10), measuredAtUTC: new Date().toISOString(),
  node: process.version, limits: { childHeapMiB: 256, timeoutPerChildMs: 30000, workersConcurrent: 1 },
  freeMemoryBeforeMiB, unitTests: { tests: count, pass }, cases, sourceFilesUnchanged: true, sourceHashes: after,
  unverified: ['C1 field combined with carved channels/surface water', 'C2 continuity and physical curvature calibration',
    'Automatic lakes/oceans and terminal-lake formation deferred by user', 'Global projection, cross-region stitching and new fine-scale relief',
    'D8 centerline smoothing and calibrated channel incision/discharge', 'Grounding, rendered interaction and human acceptance'] };
writeVerificationReport(resolve(output, 'verification.json'), report);
console.log(JSON.stringify({ unitTests: report.unitTests, cases, sourceFilesUnchanged: true }, null, 2));
