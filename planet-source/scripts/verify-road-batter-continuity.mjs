import fs from 'node:fs';
import assert from 'node:assert/strict';
import {restorePlanetWorld} from '../src/core/planet-world.mjs';
import {createGlobeFeatureChart} from '../src/core/globe-features.mjs';
import {createSphericalProjection} from '../src/core/spherical.mjs';
import {requireVerificationMemory} from './verification-runtime.mjs';
requireVerificationMemory();
// Immutable @15 fixture reproduces the actual failure; it is never migrated.
const file='examples/planet/generated/worlds/cc3eb0a52265be3d8270dd81fa22f817a3f0e22783e1a6de9efa16f758f6c41f/world.snapshot.json';
const originalBytes=fs.readFileSync(file),world=restorePlanetWorld(originalBytes.toString()),recipe=world.recipes.find(r=>r.id==='settlement:2640'),
 projection=createSphericalProjection(recipe.projection),point=projection.toLocal(30.92776972753063,-132.1505118707324);
const charts=[['legacy',createGlobeFeatureChart(world.base,recipe)],['blended',createGlobeFeatureChart(world.base,{...recipe,roadEarthworkOptions:{blendPolicy:'squared-odds@1'}})]];
const results=[];
for(const [policy,chart] of charts){
 let center=point,span=.2;const levels=[];
 for(let depth=0;depth<5;depth++){
  const n=32,step=span/n,samples=[];let worst=null;
  for(let y=0;y<=n;y++){samples[y]=[];for(let x=0;x<=n;x++)samples[y][x]=chart.metricTerrain.groundElevationAt(center.xM-span/2+x*step,center.yM-span/2+y*step);}
  for(let y=0;y<=n;y++)for(let x=0;x<=n;x++)for(const[dx,dy]of[[1,0],[0,1]])if(x+dx<=n&&y+dy<=n){const jumpM=Math.abs(samples[y][x]-samples[y+dy][x+dx]);if(!worst||jumpM>worst.jumpM)worst={jumpM,stepM:step,ratio:jumpM/step,xM:center.xM-span/2+(x+dx/2)*step,yM:center.yM-span/2+(y+dy/2)*step};}
  levels.push(worst);center=worst;span=step*4;
 }
 results.push({policy,levels});
}
assert.ok(results[0].levels.at(-1).jumpM>.08);
assert.ok(results[1].levels.at(-1).jumpM<1e-6);
const a=charts[0][1],b=charts[1][1];let carriagewayProbes=0,maximumCarriagewayChangeM=0;
for(const r of recipe.roadCenterlineProfiles)for(const s of r.samples){const p=projection.toGeographic(s.xM,s.yM),old=a.sampleAt(p.latDeg,p.lonDeg),fresh=b.sampleAt(p.latDeg,p.lonDeg);assert.deepEqual(fresh.roadSurface,old.roadSurface);
 if(old.roadSurface?.structureKind!=='bridge-deck'){maximumCarriagewayChangeM=Math.max(maximumCarriagewayChangeM,Math.abs(old.groundElevationM-fresh.groundElevationM));carriagewayProbes++;}}
assert.ok(maximumCarriagewayChangeM<1e-9);assert.ok(fs.readFileSync(file).equals(originalBytes));
const report={schema:'road-batter-continuity@1',sourceWorldId:world.worldId,createdAt:new Date().toISOString(),input:{latDeg:30.92776972753063,lonDeg:-132.1505118707324,spanM:.2,grid:32,refinementLevels:5},results,carriagewayProbes,maximumCarriagewayChangeM,
 scope:'Actual immutable @15 world before and after explicitly selecting the new batter policy; finite local continuity probes, not proof for conflicting overlapping carriageways or every road bend.'};
fs.writeFileSync('examples/planet/verification/road-batter-continuity.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report));
