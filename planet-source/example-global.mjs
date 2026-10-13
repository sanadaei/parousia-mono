import { writeFileSync } from 'node:fs';
import { globalFixture, detailBands } from './fixtures/global-scenarios.mjs';
import { createProjectedTerrainView } from './global-terrain.mjs';
const global = globalFixture({ bands: detailBands });
const region = createProjectedTerrainView(global, { centerLatDeg: 14, centerLonDeg: 179.99 });
const sample = region.surfaceFrameAt(3000, 1000);
console.log(JSON.stringify({ worldId: global.worldId, regionId: region.regionId, frame: region.frame, sample }, null, 2));
if (process.argv[2]) writeFileSync(process.argv[2], JSON.stringify(region.toSnapshot()), { flag: 'wx' });
