import { TEST_FILES } from './test-files.mjs';
import { runVerification, requireVerificationMemory } from './verification-runtime.mjs';
requireVerificationMemory();
// Slow CPU-only cloud hosts can exceed three minutes for the full sequential
// suite. Keep the same single worker / 256 MiB heap and a finite ten-minute cap.
process.stdout.write(runVerification(['--test', '--test-concurrency=1', ...TEST_FILES], { timeoutMs: 600000 }));
