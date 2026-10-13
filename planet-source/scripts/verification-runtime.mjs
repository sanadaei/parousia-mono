import { spawnSync } from 'node:child_process';
import { freemem } from 'node:os';
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

export const VERIFICATION_LIMITS = Object.freeze({ childHeapMiB: 256,
  timeoutPerChildMs: 30000, workersConcurrent: 1, minimumFreeMemoryMiB: 768 });
export const PACKAGE_ROOT = fileURLToPath(new URL('../', import.meta.url));
export function requireVerificationMemory(availableMiB = freemem() / 1024 / 1024) {
  if (!Number.isFinite(availableMiB) || availableMiB < VERIFICATION_LIMITS.minimumFreeMemoryMiB) {
    throw new Error('Less than 768 MiB free memory; defer verification');
  }
  return availableMiB;
}
export function runVerification(args, { cwd = PACKAGE_ROOT, timeoutMs = VERIFICATION_LIMITS.timeoutPerChildMs } = {}) {
  const r = spawnSync(process.execPath, [`--max-old-space-size=${VERIFICATION_LIMITS.childHeapMiB}`, ...args], {
    cwd, encoding: 'utf8', timeout: timeoutMs, windowsHide: true, maxBuffer: 2 * 1024 * 1024,
  });
  if (r.error || r.status !== 0) {
    throw new Error(`Verification subprocess failed (${args.slice(0, 3).join(' ')}): ${r.error?.message || r.stderr || r.stdout || `Exit ${r.status}`}`);
  }
  return r.stdout;
}
export const sha256File = file => createHash('sha256').update(readFileSync(file)).digest('hex');
export const writeVerificationReport = (file, report) => writeFileSync(file, JSON.stringify(report, null, 2));
