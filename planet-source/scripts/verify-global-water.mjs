import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { runVerification as run, requireVerificationMemory, sha256File, writeVerificationReport } from './verification-runtime.mjs';
import assert from 'node:assert/strict';
import { TEST_FILES } from './test-files.mjs';
import { verificationDirectory } from './verification-paths.mjs';

const root = fileURLToPath(new URL('../', import.meta.url)), output = verificationDirectory('global-water');
mkdirSync(output, { recursive: true });
const digest = path => sha256File(path);
const hashes = () => ['geography-lite', 'dynamic-terrain-runtime'].flatMap(module => {
  const sourceRoot = resolve(root, '../MinimalWorld_Modules_0.3_Core/MinimalWorld_Modules_0.3', module);
  return JSON.parse(readFileSync(resolve(sourceRoot, 'PROVENANCE.json'), 'utf8')).files.map(p => ({ module,
    file: p.file, expectedSha256: p.sha256, observedSha256: digest(resolve(sourceRoot, p.file)) }));
});
const before = hashes(); for (const entry of before) assert.equal(entry.expectedSha256, entry.observedSha256);
const sourceInputs = ['audit-a', 'audit-b'].map(seed => ({ seed, file: `examples/global/${seed}.snapshot.json`,
  sha256: digest(resolve(root, `examples/global/${seed}.snapshot.json`)) }));

const freeMemoryBeforeMiB = requireVerificationMemory();
const tests = run(['--test', ...TEST_FILES]);
writeFileSync(resolve(output, 'unit-tests.log'), tests);
const count = Number(tests.match(/# tests (\d+)/)?.[1]), pass = Number(tests.match(/# pass (\d+)/)?.[1]);
assert.ok(count > 0 && count === pass);
const cases = [];
for (const input of sourceInputs) for (const site of ['date-line', 'source-seam', 'north-pole', 'south-pole']) {
  const name = `${input.seed}-${site}`, snapshot = resolve(output, `${name}.snapshot.json`), witnesses = resolve(output, `${name}.witnesses.json`);
  const captured = JSON.parse(run(['scripts/global-water-worker.mjs', 'capture', resolve(root, input.file), site, snapshot, witnesses]));
  const reopened = JSON.parse(run(['scripts/global-water-worker.mjs', 'reopen', resolve(root, input.file), site, snapshot, witnesses]));
  assert.equal(captured.worldId, reopened.worldId); cases.push({ seed: input.seed, ...captured, reopened });
  console.log(`${name}: ${captured.centerlineSamples} river probes, ${reopened.framesCompared} reopened frames, incision bound ${captured.centerIncisionUpperBoundM.toFixed(6)}m`);
}
{
  const name = 'explicit-bowl-lake', snapshot = resolve(output, `${name}.snapshot.json`), witnesses = resolve(output, `${name}.witnesses.json`);
  const captured = JSON.parse(run(['scripts/global-water-worker.mjs', 'capture-body', 'synthetic-fixture', name, snapshot, witnesses]));
  const reopened = JSON.parse(run(['scripts/global-water-worker.mjs', 'reopen', 'synthetic-fixture', name, snapshot, witnesses]));
  assert.equal(captured.worldId, reopened.worldId); cases.push({ seed: name, ...captured, reopened });
  console.log(`${name}: explicit synthetic lake, ${reopened.framesCompared} reopened frames`);
}
const after = hashes(); assert.deepEqual(before, after);
for (const input of sourceInputs) assert.equal(digest(resolve(root, input.file)), input.sha256);
const report = { schema: 'minimal-world-global-water-verification@1',
  verificationDateJST: new Date(Date.now() + 9 * 3600000).toISOString().slice(0, 10), measuredAtUTC: new Date().toISOString(),
  node: process.version, limits: { childHeapMiB: 256, timeoutPerChildMs: 30000, workersConcurrent: 1 },
  freeMemoryBeforeMiB, unitTests: { tests: count, pass }, cases, sourceInputs, sourceSnapshotsUnchanged: true,
  sourceFilesUnchanged: true, sourceHashes: after,
  scope: 'Each case is an independent single explicit water chart over the same saved sphere; the fixture river is caller-defined.',
  unverified: ['Automatic lake/ocean/terminal water creation deferred by user',
    'Multiple simultaneous charts and a physically calibrated global drainage/discharge network',
    'C1 continuity of carved channel ground and corrected source seam/place centroids',
    'Analytic mesh crossing events for a different projection (bounded probes only)',
    'Full-width road/bridge and building grounding; rendering, save/reopen UI and human acceptance',
    'All seeds/resolutions and full legacy module suites'] };
writeVerificationReport(resolve(output, 'verification.json'), report);
console.log(JSON.stringify({ unitTests: report.unitTests, cases: cases.length,
  reopenedFrames: cases.reduce((sum, c) => sum + c.reopened.framesCompared, 0),
  centerlineSamples: cases.reduce((sum, c) => sum + c.centerlineSamples, 0), sourceFilesUnchanged: true, sourceSnapshotsUnchanged: true }));
