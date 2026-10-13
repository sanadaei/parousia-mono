import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {pathToFileURL,fileURLToPath} from 'node:url';
import {PagedSource} from '../src/globe/paged-source.mjs';
import {tileBound,tileDirection,geographic,nearestTileDirection,dot,children} from '../src/globe/cube.mjs';
import {sphereBasis} from '../src/core/spherical.mjs';
import {restorePlanetWorld} from '../src/core/planet-world.mjs';
import {requireVerificationMemory} from './verification-runtime.mjs';
requireVerificationMemory();
const manifestPath=path.resolve('examples/planet/generated/manifest.json'),manifest=JSON.parse(fs.readFileSync(manifestPath)),url=pathToFileURL(manifestPath).href;
const world=restorePlanetWorld(fs.readFileSync(fileURLToPath(new URL(manifest.planetSnapshot,url)),'utf8'));
const source=new PagedSource(manifest,url,async url=>{const b=fs.readFileSync(fileURLToPath(url));return{ok:true,arrayBuffer:async()=>b.buffer.slice(b.byteOffset,b.byteOffset+b.byteLength),text:async()=>b.toString()};});
const locations=[...world.settlements.slice(0,3),...manifest.rivers.profiles.slice(0,5).map(p=>({id:p.id,...p.points[Math.floor(p.points.length/2)]}))];
const results=[];
for(const location of locations){
 const up=sphereBasis(location).up,nearest=list=>list.sort((a,b)=>dot(nearestTileDirection(b,up),up)-dot(nearestTileDirection(a,up),up))[0];
 let tile=nearest(Array.from({length:6},(_,face)=>({face,level:0,x:0,y:0})));
 for(let level=1;level<=24;level++){
  tile=nearest(children(tile));if(![12,16,19,21,22,24].includes(level))continue;
  const bound=tileBound(tile,world.base.frame.radiusM);
  for(const feature of source.descriptors())if(Math.acos(Math.max(-1,Math.min(1,dot(bound.center,feature.center))))<=bound.angular+feature.angularRadius)await source.enableFeatures(undefined,feature);
  const heightBounds=await source.ready(()=>source.tileHeightBounds(bound));
  let minimum=Infinity,maximum=-Infinity,maxCoreDifferenceM=0;const samples=[];
  for(let y=0;y<=6;y++)for(let x=0;x<=6;x++){
   const p=geographic(tileDirection(tile,x/6,y/6));await source.enableFeaturesAt(p);
   const paged=await source.ready(()=>source.sample(p.latDeg,p.lonDeg)),core=world.sampleSurfaceAt(p.latDeg,p.lonDeg),z=paged.groundElevationM;
   minimum=Math.min(minimum,z);maximum=Math.max(maximum,z);maxCoreDifferenceM=Math.max(maxCoreDifferenceM,Math.abs(z-core.groundElevationM));
   assert.ok(z>=heightBounds[0]-1e-7&&z<=heightBounds[1]+1e-7,`${location.id} ${level}: ${z} outside ${heightBounds}`);
   assert.ok(Math.abs(z-core.groundElevationM)<1e-7);samples.push({latDeg:p.latDeg,lonDeg:p.lonDeg,groundElevationM:z});
  }
  results.push({locationId:location.id,tile,heightBounds,minimum,maximum,maxCoreDifferenceM,samples});
 }
}
const report={sourceWorldId:world.worldId,tiles:results.length,probes:results.reduce((n,r)=>n+r.samples.length,0),results,
 scope:'Actual saved-world finite samples validate, but do not replace, the conservative disk derivation. No waterline or visual acceptance is inferred.'};
fs.writeFileSync('examples/planet/verification/ground-hulls.json',JSON.stringify(report,null,2));
console.log(JSON.stringify({tiles:report.tiles,probes:report.probes,maxCoreDifferenceM:Math.max(...results.map(r=>r.maxCoreDifferenceM))}));
