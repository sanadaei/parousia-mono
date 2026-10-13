import {selectPopulationStart} from './package-settlements.mjs';
import {inspectLandforms} from '../src/core/landform-inspection.mjs';
import {planSettlementNetwork} from '../src/core/settlement-network.mjs';
import {createSphericalProjection,offsetGeographic} from '../src/core/spherical.mjs';
import path from 'node:path';
import { generatePlanet } from '../src/core/planet-generation.mjs';
import { publishPlanet } from './publish-planet.mjs';
import {fileURLToPath} from 'node:url';
import {requireVerificationMemory} from './verification-runtime.mjs';
export function parsePlanetArguments(args){
 const positional=[],options={};
 for(const arg of args){
  if(arg.startsWith('--population=')){options.targetPopulation=Number(arg.slice(13));if(!Number.isSafeInteger(options.targetPopulation)||options.targetPopulation<0||options.targetPopulation>1e10)throw new RangeError('population must be 0..10000000000');}
  else if(arg.startsWith('--sites=')){options.macroSettlementCount=Number(arg.slice(8));if(!Number.isSafeInteger(options.macroSettlementCount)||options.macroSettlementCount<0||options.macroSettlementCount>512)throw new RangeError('sites must be 0..512');}
  else if(arg.startsWith('--settlements=')){options.settlementCount=Number(arg.slice(14));if(!Number.isSafeInteger(options.settlementCount)||options.settlementCount<0||options.settlementCount>32)throw new RangeError('settlements must be 0..32');}
  else if(arg.startsWith('--lake-fill=')){if(options.lakeFillFraction!=null)throw new Error('Duplicate lake fill');options.lakeFillFraction=Number(arg.slice(12));if(!Number.isFinite(options.lakeFillFraction)||options.lakeFillFraction<0||options.lakeFillFraction>1)throw new RangeError('lake-fill must be 0..1');}
  else if(arg.startsWith('--road-crown=')){if(Object.hasOwn(options,'roadCrownSlope'))throw new Error('Duplicate road crown');options.roadCrownSlope=Number(arg.slice(13));if(!Number.isFinite(options.roadCrownSlope)||options.roadCrownSlope<0||options.roadCrownSlope>.1)throw new RangeError('road-crown must be 0..0.1');}
  else if(arg==='--single-street'){if(Object.hasOwn(options,'villageRoads'))throw new Error('Duplicate single-street option');options.villageRoads=false;}
  else if(arg==='--channel-only'){if(Object.hasOwn(options,'riverValleys'))throw new Error('Duplicate channel-only option');options.riverValleys=null;}
  else if(arg.startsWith('--macro-profile=')){if(Object.hasOwn(options,'macroProfile'))throw new Error('Duplicate macro profile');options.macroProfile=arg.slice(16);if(!['legacy','earthlike-l0@1'].includes(options.macroProfile))throw new RangeError('Invalid macro profile');}
  else if(arg.startsWith('--landform-shape=')){if(Object.hasOwn(options,'landformShape'))throw new Error('Duplicate landform shape');options.landformShape=arg.slice(17);if(!['rounded','stratified'].includes(options.landformShape))throw new RangeError('landform-shape must be rounded or stratified');}
  else if(arg.startsWith('--valley-sections=')){if(Object.hasOwn(options,'valleySections'))throw new Error('Duplicate valley sections');options.valleySections=arg.slice(18);if(!['legacy','alluvial'].includes(options.valleySections))throw new RangeError('valley-sections must be legacy or alluvial');}
  else if(arg.startsWith('--river-detail=')){if(Object.hasOwn(options,'riverDetail'))throw new Error('Duplicate river detail');options.riverDetail=arg.slice(15);if(!['major','regional'].includes(options.riverDetail))throw new RangeError('river-detail must be major or regional');}
  else if(arg==='--unpopulated-water'){if(Object.hasOwn(options,'unpopulatedWater'))throw new Error('Duplicate unpopulated-water option');options.unpopulatedWater=true;}
  else if(arg==='--deferred-water'){if(Object.hasOwn(options,'deferredWater'))throw new Error('Duplicate deferred-water option');options.deferredWater=true;}
  else if(arg==='--deferred-population'){if(Object.hasOwn(options,'deferredPopulation'))throw new Error('Duplicate deferred-population option');options.deferredPopulation=true;}
  else if(arg==='--local-tributaries'){if(Object.hasOwn(options,'localTributaries'))throw new Error('Duplicate local-tributaries option');options.localTributaries=true;}
  else if(arg.startsWith('--'))throw new Error(`Unknown option: ${arg}`);else positional.push(arg);
 }
 if(positional.length>2)throw new Error('Usage: generate-planet.mjs [seed] [directory] [--lake-fill=0..1] [--channel-only] [--single-street] [--road-crown=0..0.1]');
 if(options.unpopulatedWater&&!options.deferredWater)throw new Error('unpopulated-water requires deferred-water');
 if(options.deferredWater&&!options.deferredPopulation)throw new Error('deferred-water requires deferred-population');
 return{seed:positional[0]??'planet-1',directory:positional[1]??'examples/planet/generated',...options};
}
export function generatePlanetPackage({seed='planet-1',directory='examples/planet/generated',macroSettlementCount=128,deferredPopulation=false,deferredWater=false,unpopulatedWater=false,macroProfile='earthlike-l0@1',...options}={}){
 requireVerificationMemory();
const world=generatePlanet({seed,macroProfile,valleySections:'alluvial',...options,climatePlanning:true});

world.settlementNetwork=planSettlementNetwork(world.base.toSnapshot(),{count:macroSettlementCount,anchors:world.settlements,population:world.population});
const startingSettlement=deferredPopulation?null:selectPopulationStart(world);if(startingSettlement)world.focus={latDeg:startingSettlement.latDeg,lonDeg:startingSettlement.lonDeg};
const manifest={name:`Planet · ${seed}`,deferredPopulation,deferredWater,unpopulatedWater,...(startingSettlement?{startingSettlement}:{})};
manifest.planetSnapshot='./world.snapshot.json';
manifest.settlements=world.settlements.map(({id,name,latDeg,lonDeg,buildings})=>({id,name,latDeg,lonDeg,buildings}));
manifest.bridges=world.recipes.flatMap(r=>(r.bridgeStructures??[]).map(s=>({id:s.id,settlementId:r.id,name:`${world.settlements.find(p=>p.id===r.id).name}の橋`,
 ...createSphericalProjection(r.projection).toGeographic((s.start.xM+s.end.xM)/2,(s.start.yM+s.end.yM)/2),spanCount:s.spanCount,
 deckAssessment:s.assessment.status,foundationStatus:s.foundationStatus})));
const snapshot=world.base.toSnapshot(),{columns,rows}=snapshot.grid;
manifest.waterBodies=snapshot.references.lakes.map((lake,index)=>{
 const cell=lake.cells.reduce((best,i)=>snapshot.fields.groundElevationM[i]<snapshot.fields.groundElevationM[best]?i:best,lake.cells[0]),latDeg=90-(Math.floor(cell/columns)+.5)*180/rows,lonDeg=(cell%columns+.5)*360/columns;
 const shoreRadiusSamplesM=[];
 for(let ray=0;ray<12;ray++){const theta=ray*Math.PI/6,wet=distance=>{const p=offsetGeographic({latDeg,lonDeg},Math.cos(theta)*distance,Math.sin(theta)*distance,snapshot.frame.radiusM);return world.base.sampleAt(p.latDeg,p.lonDeg).waterSourceIds.includes(lake.id);};let lo=0,hi=1000;
  while(hi<snapshot.frame.radiusM*Math.PI*.9&&wet(hi)){lo=hi;hi*=1.7;}
  hi=Math.min(hi,snapshot.frame.radiusM*Math.PI*.9);for(let k=0;k<16;k++){const mid=(lo+hi)/2;if(wet(mid))lo=mid;else hi=mid;}shoreRadiusSamplesM.push(hi);
 }
 return{id:lake.id,name:`湖 ${index+1}${lake.kind==='terminal-lake'?'（終端湖）':''}`,latDeg,lonDeg,kind:lake.kind,levelElevationM:lake.levelElevationM,depthM:world.base.sampleAt(latDeg,lonDeg).waterDepthM,shoreRadiusSamplesM,viewAltitudeM:Math.max(1500,Math.min(10000000,Math.max(...shoreRadiusSamplesM)*2.5))};
});
for(const pond of snapshot.references.localPonds?.bodies??[])manifest.waterBodies.push({id:pond.id,name:`自然の窪みの池 ${manifest.waterBodies.length+1}（雨季の仮定）`,...pond.wetFocus,kind:pond.kind,levelElevationM:pond.levelElevationM,depthM:world.base.sampleSurfaceAt(pond.wetFocus.latDeg,pond.wetFocus.lonDeg).waterDepthM,viewAltitudeM:500});
manifest.landformInspection=inspectLandforms(world.base);
manifest.generationDiagnostics={...world.diagnostics,plannedSettlements:world.settlementNetwork.sites.length,proposedRoutes:world.settlementNetwork.routes.length};
manifest.settlementNetwork=world.settlementNetwork;
manifest.populationSummary=world.population.totals;
const published=publishPlanet(world,directory,manifest);
return {seed,...world.diagnostics,manifest:path.join(directory,'manifest.json'),worldId:published.canonicalWorldId};
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 try{console.log(JSON.stringify(generatePlanetPackage(parsePlanetArguments(process.argv.slice(2)))));}catch(e){console.error(e.message);process.exitCode=1;}
}
