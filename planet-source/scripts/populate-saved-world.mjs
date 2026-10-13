import fs from 'node:fs';import path from 'node:path';import {fileURLToPath} from 'node:url';
import {restorePlanetWorld} from '../src/core/planet-world.mjs';import {publishPlanet} from './publish-planet.mjs';import {requireVerificationMemory} from './verification-runtime.mjs';
export function populateSavedWorld(inputManifest,output){
 requireVerificationMemory();const source=path.resolve(inputManifest),target=path.resolve(output);if(path.dirname(source)===target||fs.existsSync(path.join(target,'manifest.json')))throw new Error('Choose a new output directory; the original world is preserved');
 const metadata=JSON.parse(fs.readFileSync(source)),snapshotPath=path.resolve(path.dirname(source),metadata.planetSnapshot),world=restorePlanetWorld(JSON.parse(fs.readFileSync(snapshotPath)));
 if(!world.population)throw new Error('This world has no population data. Generate a climate/population world first.');
 const result=publishPlanet(world,target,metadata);return{worldId:result.canonicalWorldId,baseWorldId:result.base.worldId,...result.settlementCatalogue.totals,manifest:path.join(target,'manifest.json')};
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){try{if(process.argv.length!==4)throw new Error('Usage: node scripts/populate-saved-world.mjs input/manifest.json new-output-directory');console.log(JSON.stringify(populateSavedWorld(process.argv[2],process.argv[3])));}catch(e){console.error(e);process.exitCode=1;}}
