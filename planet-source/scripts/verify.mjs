import { TEST_FILES } from './test-files.mjs';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { runVerification as run, requireVerificationMemory, sha256File, writeVerificationReport } from './verification-runtime.mjs';
import assert from 'node:assert/strict';

const root = fileURLToPath(new URL('../', import.meta.url));
const output = resolve(root, 'examples');
mkdirSync(output, { recursive: true });
const sourceRoot = resolve(root, '../MinimalWorld_Modules_0.3_Core/MinimalWorld_Modules_0.3/dynamic-terrain-runtime');
const provenance = JSON.parse(readFileSync(resolve(sourceRoot, 'PROVENANCE.json'), 'utf8'));
function sourceHashes() {
  return provenance.files.map(entry => ({ file: entry.file, expectedSha256: entry.sha256,
    observedSha256: sha256File(resolve(sourceRoot, entry.file)) }));
}
const before = sourceHashes();
for (const entry of before) assert.equal(entry.observedSha256, entry.expectedSha256);



const freeMemoryBeforeMiB = requireVerificationMemory();
const unitOutput = run(['--test', ...TEST_FILES]);
const testCount = Number(unitOutput.match(/# tests (\d+)/)?.[1]);
const passCount = Number(unitOutput.match(/# pass (\d+)/)?.[1]);
assert.ok(testCount > 0 && testCount === passCount);
writeFileSync(resolve(output, 'unit-tests.log'), unitOutput);
const snapshotPath = resolve(output, 'world-a.snapshot.json');
const witnessPath = resolve(output, 'world-a.witnesses.json');
const worker = resolve(root, 'scripts/verification-worker.mjs');
const generated = JSON.parse(run([worker, 'capture', snapshotPath, witnessPath]));
const reopened = JSON.parse(run([worker, 'reopen', snapshotPath, witnessPath]));
assert.equal(reopened.worldId, generated.worldId);
const after = sourceHashes();
assert.deepEqual(before, after);
const report = {
  schema: 'minimal-world-terrain-verification@1', taskDateJST: '2026-10-08',
  measuredAtUTC: new Date().toISOString(), node: process.version,
  limits: { childHeapMiB: 256, timeoutPerChildMs: 30_000, workersConcurrent: 1 },
  freeMemoryBeforeMiB, unitTests: { tests: testCount, pass: passCount },
  realRegionalInput: generated, reopened,
  sourceFilesUnchanged: true, sourceHashes: after,
  evidenceFiles: ['world-a.snapshot.json', 'world-a.witnesses.json', 'unit-tests.log'],
  unverified: [
    'Derived river/lake/ocean water surfaces and depths for legacy input',
    'Global projection and cross-macro-cell refinement',
    'Generated meter-scale detail',
    'Building/road grounding and collision',
    'Rendered zoom/pan and visual acceptance',
    'All seeds, solver resolutions and full legacy module suites',
  ],
};
writeVerificationReport(resolve(output, 'verification.json'), report);
console.log(JSON.stringify(report, null, 2));
