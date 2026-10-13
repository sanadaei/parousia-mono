import fs from 'node:fs';import path from 'node:path';import {fileURLToPath} from 'node:url';
import {restorePlanetWorld} from '../src/core/planet-world.mjs';
import {planVillageEconomy} from '../src/core/village-economy.mjs';
import {publishPlanet} from './publish-planet.mjs';
import {createSphericalProjection} from '../src/core/spherical.mjs';
import {requireVerificationMemory} from './verification-runtime.mjs';
/** New explicit world version; never overwrite the input package. */
export function applyVillageProfile(inputDirectory,outputDirectory,settlementId,profile){
 requireVerificationMemory();if(path.resolve(inputDirectory)===path.resolve(outputDirectory))throw new Error('Use a distinct output package; retain the original world');
 const manifest=JSON.parse(fs.readFileSync(path.join(inputDirectory,'manifest.json'),'utf8')),world=restorePlanetWorld(JSON.parse(fs.readFileSync(path.resolve(inputDirectory,manifest.planetSnapshot),'utf8'))),recipe=world.recipes.find(r=>r.id===settlementId);
 if(!recipe)throw new RangeError('Unknown settlement');const projection=createSphericalProjection(recipe.projection),sample=(x,y)=>{const p=projection.toGeographic(x,y);return world.sampleAt(p.latDeg,p.lonDeg);};
 const updated=planVillageEconomy(recipe,{profile,groundAt:(x,y)=>sample(x,y).groundElevationM,waterAt:sample}),next={...world,recipes:world.recipes.map(r=>r.id===settlementId?updated:r)};
 const result=publishPlanet(next,outputDirectory,manifest);return {worldId:result.canonicalWorldId,settlementId,plan:updated.settlementPlan,manifest:path.join(outputDirectory,'manifest.json')};
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const [input,output,id,file]=process.argv.slice(2);if(!file){console.error('Usage: node scripts/plan-village-economy.mjs INPUT OUTPUT SETTLEMENT_ID PROFILE.json');process.exitCode=1;}else try{console.log(JSON.stringify(applyVillageProfile(input,output,id,JSON.parse(fs.readFileSync(file,'utf8')))));}catch(e){console.error(e.stack);process.exitCode=1;}
}
