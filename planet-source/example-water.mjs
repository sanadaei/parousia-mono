import { writeFileSync } from 'node:fs';
import { serializeTerrain } from './index.mjs';
import { lakeOceanFixture } from './fixtures/water-scenarios.mjs';

const terrain = lakeOceanFixture();
if (process.argv[2]) writeFileSync(process.argv[2], serializeTerrain(terrain), { flag: 'wx' });
console.log(JSON.stringify({
  inputKind: 'explicit-lake-ocean-fixture',
  interpretation: 'static-game-channel-fit; not-calibrated-flow-simulation',
  worldId: terrain.worldId,
  lakeInlet: terrain.sampleAt(300, 500), lake: terrain.sampleAt(400, 500),
  lakeOutlet: terrain.sampleAt(500, 500), oceanMouth: terrain.sampleAt(960, 500),
  ocean: terrain.sampleAt(980, 500), highLakeBank: terrain.sampleAt(400, 640),
}, null, 2));
