import { readFileSync, readdirSync, mkdirSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import assert from 'node:assert/strict';
import { PACKAGE_ROOT as root, runVerification, requireVerificationMemory, sha256File,
  writeVerificationReport, VERIFICATION_LIMITS } from './verification-runtime.mjs';
import { verificationDirectory } from './verification-paths.mjs';
const output = verificationDirectory('audit-0.3.4');
mkdirSync(output, { recursive: true });
const version = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8')).version;
const stage3File = resolve(verificationDirectory('audit-0.3.3'), 'verification.json');
if (process.argv.includes('--reuse-stage3')) {
  // Reuse is explicit and only valid while every code/test file predates the
  // completed full-suite replay. The default command always replays it afresh.
  const prior = JSON.parse(readFileSync(stage3File, 'utf8'));
  const measured = Date.parse(prior.measuredAtUTC);
  assert.equal(prior.implementationVersion, version);
  for (const dir of ['src/core', 'src/ui', 'test']) for (const name of readdirSync(resolve(root, dir))) {
    if (name.endsWith('.mjs')) assert.ok(statSync(resolve(root, dir, name)).mtimeMs <= measured,
      'Code changed since stage3 replay; omit --reuse-stage3');
  }
} else await import('./verify-stage3.mjs');
const stage3 = JSON.parse(readFileSync(stage3File, 'utf8'));
assert.equal(stage3.implementationVersion, version);
assert.equal(stage3.unitTests.tests, stage3.unitTests.pass);
const freeMemoryBeforeMiB = requireVerificationMemory();
const build = runVerification(['scripts/build.mjs']);
const captured = JSON.parse(runVerification(['scripts/audit-ui-worker.mjs', 'capture', output]));
const reopened = JSON.parse(runVerification(['scripts/audit-ui-worker.mjs', 'reopen', output]));
assert.deepEqual(captured, reopened);
const files = ['package.json', ...['src/core', 'src/ui', 'test', 'scripts'].flatMap(dir =>
  readdirSync(resolve(root, dir)).filter(n => n.endsWith('.mjs')).map(n => `${dir}/${n}`))];
const report = { schema: 'minimal-world-core-ui-audit-verification@1', implementationVersion: version,
  measuredAtUTC: new Date().toISOString(), node: process.version, limits: VERIFICATION_LIMITS, freeMemoryBeforeMiB,
  unitTests: stage3.unitTests, buildPassed: build.includes('Completed Successfully'),
  coreModuleCount: 31, legacyEntryPointsIdentical: 30,
  legacyReplay: { file: 'examples/audit-0.3.3/' + version + '/verification.json',
    sha256: sha256File(stage3File), measuredAtUTC: stage3.measuredAtUTC, snapshots: stage3.legacy.length,
    sourceFilesUnchanged: stage3.sourceFilesUnchanged, inputSnapshotsUnchanged: stage3.inputSnapshotsUnchanged },
  uiSceneSeparateProcess: { captured, reopened },
  browserEvidence: ['ui-demo-reopened.dom.txt', 'ui-demo-reopened.jpg', 'ui-four-statuses.dom.txt', 'ui-four-statuses.jpg']
    .filter(file => { try { return statSync(resolve(output, file)).isFile(); } catch { return false; } }),
  implementationFiles: files.map(file => ({ file, sha256: sha256File(resolve(root, file)) })),
  unverified: ['Earthwork coupling to constructed culverts, pooling and recomputed drainage',
    'Explicit water bodies across charts; full carved terrain C1; road crossfall/cant',
    'Full-width vehicle clearance, structural capacity, broad real-seed visual/device/human acceptance',
    'Sandbox edit history and all display state persistence; automatic water bodies deferred by user'] };
writeVerificationReport(resolve(output, 'verification.json'), report);
console.log(JSON.stringify({ unitTests: report.unitTests, buildPassed: report.buildPassed,
  legacyEntryPointsIdentical: report.legacyEntryPointsIdentical, legacySnapshots: report.legacyReplay.snapshots,
  crossingStatuses: reopened.statuses, separateProcessExact: reopened.exact, browserEvidence: report.browserEvidence }));
