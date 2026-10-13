import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
const root = fileURLToPath(new URL('../', import.meta.url));
const version = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8')).version;
// Preserve the original unversioned evidence used for saved-contract regressions.
export const verificationDirectory = name => resolve(root, 'examples', name, version);
