/** Finite radial-height interpolation diagnostic. This deliberately does not
 * claim full mesh/Float32/morph/streamer or browser acceptance. */
import fs from 'node:fs';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {restorePlanetWorld} from '../src/core/planet-world.mjs';
import {sphereBasis,offsetGeographic} from '../src/core/spherical.mjs';
import {directionTile} from '../src/globe/lod-neighbors.mjs';
import {tileDirection,geographic,triangleInterpolate} from '../src/globe/cube.mjs';
import {requireVerificationMemory} from './verification-runtime.mjs';
export function auditTerrainResolution(world,center,{levels=[12,13,14,15,16,17],spanM=1000,stepM=2,bearingDeg=90}={}){
 if(!center||!Number.isFinite(center.latDeg)||Math.abs(center.latDeg)>90||!Number.isFinite(center.lonDeg))throw new RangeError('Finite geographic center required');
 if(!Array.isArray(levels)||levels.length<1||levels.length>12||!levels.every(l=>Number.isSafeInteger(l)&&l>=0&&l<=22)||new Set(levels).size!==levels.length)throw new RangeError('Distinct bounded LOD levels required');
 if(!Number.isFinite(spanM)||spanM<=0||spanM>100000||!Number.isFinite(stepM)||stepM<=0||stepM>spanM||Math.ceil(spanM/stepM)>10000)throw new RangeError('Bounded transect required');
 if(!Number.isFinite(bearingDeg))throw new RangeError('Finite bearing required');
 const bearing=bearingDeg*Math.PI/180;
 const base=world.base,R=base.frame.radiusM,count=Math.ceil(spanM/stepM),profiles=[];
 const height=d=>{const p=geographic(d);return base.groundElevationAt(p.latDeg,p.lonDeg);};
 for(const level of levels){
  const cache=new Map(),rows=[];
  for(let k=0;k<=count;k++){
   const offsetM=-spanM/2+spanM*k/count,p=offsetGeographic(center,offsetM*Math.sin(bearing),offsetM*Math.cos(bearing),R),d=sphereBasis(p).up,t=directionTile(d,level);
   const a=[[d[0],d[1],d[2]],[-d[0],-d[1],d[2]],[d[1],-d[0],d[2]],[-d[1],d[0],d[2]],[d[2],d[0],d[1]],[-d[2],d[0],-d[1]]][t.face],n=2**level;
   const u=Math.max(0,Math.min(16,((a[1]/a[0]+1)*n/2-t.x)*16)),v=Math.max(0,Math.min(16,((a[2]/a[0]+1)*n/2-t.y)*16)),i=Math.min(15,Math.floor(u)),j=Math.min(15,Math.floor(v));
   const vertex=(x,y)=>{const key=`${t.face}/${t.x}/${t.y}/${x}/${y}`;if(!cache.has(key))cache.set(key,height(tileDirection(t,x/16,y/16)));return[cache.get(key)];};
   const interpolatedM=triangleInterpolate(vertex(i,j),vertex(i+1,j),vertex(i,j+1),vertex(i+1,j+1),u-i,v-j)[0],actualM=height(d);
   rows.push({offsetM,actualM,interpolatedM,errorM:interpolatedM-actualM});
  }
  profiles.push({level,maxAbsErrorM:Math.max(...rows.map(r=>Math.abs(r.errorM))),rmsM:Math.sqrt(rows.reduce((s,r)=>s+r.errorM*r.errorM,0)/rows.length),rows});
 }
 return{worldId:world.worldId,center,spanM,bearingDeg,sampleStepM:spanM/count,profiles,scope:'Finite fixed-bearing transect using the 16-cell cube-tile triangle diagonal and scalar radial heights. Excludes ECEF chord, Float32, morph, stitching, feature refinement and runtime LOD selection. Not a global error bound or browser acceptance.'};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href){
 requireVerificationMemory();const[input,output,lat,lon,bearingArg]=process.argv.slice(2);if(!input||!output||lat===undefined||lon===undefined)throw Error('Usage: node audit-terrain-resolution.mjs WORLD.json REPORT.json LAT LON [BEARING_DEG]');
 const report=auditTerrainResolution(restorePlanetWorld(JSON.parse(fs.readFileSync(input))),{latDeg:Number(lat),lonDeg:Number(lon)},{bearingDeg:bearingArg===undefined?90:Number(bearingArg)});fs.writeFileSync(output,JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report.profiles.map(({level,maxAbsErrorM,rmsM})=>({level,maxAbsErrorM,rmsM}))));
}
