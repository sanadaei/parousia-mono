/** Read an actual saved terrain's river profile as an immutable experiment parent.
 * Does NOT mutate/replace its terrain or publish new water geometry. */
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {pathToFileURL} from 'node:url';
import {requireVerificationMemory} from '../verification-runtime.mjs';
import {createSphericalProjection} from '../../src/core/spherical.mjs';
import {createGlobalTerrain} from '../../src/core/global-terrain.mjs';
import {createExperiment,auditExperiment,smoothReconstruction,reliefSvg} from './drainage-led-relief.mjs';
export function extractParent(snapshot,{extentM=8192,profileId=null}={}) {
 const network=snapshot.references.rivers;
 for(const profile of [...network.profiles].filter(p=>profileId===null||p.id===profileId).sort((a,b)=>a.id.localeCompare(b.id))) {
  if(profile.points.length<3)continue;
  const center=profile.points[Math.floor(profile.points.length/2)];
  const projection=createSphericalProjection({centerLatDeg:center.latDeg,centerLonDeg:center.lonDeg,radiusM:snapshot.frame.radiusM,maxRadiusM:snapshot.frame.radiusM*.1});
  const points=profile.points.map(p=>{const q=projection.toLocalIfWithin(p.latDeg,p.lonDeg);return q?{x:q.xM+extentM/2,y:q.yM+extentM/2,z:p.waterLevelElevationM-p.depthM,protectWidthM:p.halfWidthM+p.bankWidthM}:null;});
  const clipped=[];
  for(let i=1;i<points.length;i++) {
   const a=points[i-1],b=points[i];if(!a||!b)continue;
   let lo=0,hi=1;
   for(const key of ['x','y']) {const d=b[key]-a[key];if(Math.abs(d)<1e-12){if(a[key]<0||a[key]>extentM){lo=1;hi=0;}continue;}const t0=-a[key]/d,t1=(extentM-a[key])/d;lo=Math.max(lo,Math.min(t0,t1));hi=Math.min(hi,Math.max(t0,t1));}
   if(hi<=lo)continue;
   const at=t=>({x:Math.max(0,Math.min(extentM,a.x+(b.x-a.x)*t)),y:Math.max(0,Math.min(extentM,a.y+(b.y-a.y)*t)),z:a.z+(b.z-a.z)*t,protectWidthM:a.protectWidthM+(b.protectWidthM-a.protectWidthM)*t});
   const p=at(lo),q=at(hi);
   if(clipped.length&&Math.hypot(p.x-clipped.at(-1).x,p.y-clipped.at(-1).y)>1e-4)break;
   if(!clipped.length)clipped.push(p);clipped.push(q);
  }
  if(clipped.length<2)continue;
  const parent=clipped.reverse();if(parent.some((p,i)=>i&&p.z<parent[i-1].z))continue;
  return {parent,extentM,projection,source:{worldId:snapshot.worldId,profileId:profile.id,center,scope:'Clipped existing river bed profile; no invented receiving water or new world committed'}};
 }
 throw new Error('No suitable explicit parent profile found; no synthetic fallback');
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href) {
 requireVerificationMemory();
 const snapshot=JSON.parse(readFileSync(process.argv[2])),out=process.argv[3]||'/tmp/planet-parent-relief';mkdirSync(out,{recursive:true});
 const input=extractParent(snapshot),base=createGlobalTerrain(snapshot),model=createExperiment({seed:`${snapshot.worldId}/${input.source.profileId}`,parent:input.parent}),raw=auditExperiment(model),smooth=smoothReconstruction(model);
 const heights=[],oldHeights=[];let squaredChange=0,maxChange=0,edgeMaximumChangeM=0,bedError=0;
 for(let y=0;y<129;y++)for(let x=0;x<129;x++) {
  const xm=x*8192/128,ym=y*8192/128,p=input.projection.toGeographic(xm-4096,ym-4096),old=base.groundElevationAt(p.latDeg,p.lonDeg),z=smooth.sample(xm,ym),d=z-old;
  heights.push(z);oldHeights.push(old);squaredChange+=d*d;maxChange=Math.max(maxChange,Math.abs(d));if(x===0||y===0||x===128||y===128)edgeMaximumChangeM=Math.max(edgeMaximumChangeM,Math.abs(d));
 }
 for(const s of model.segments)for(let k=0;k<=64;k++){const t=k/64,z=smooth.sample(s.a.x+(s.b.x-s.a.x)*t,s.a.y+(s.b.y-s.a.y)*t);bedError=Math.max(bedError,Math.abs(z-s.a.z-(s.b.z-s.a.z)*t));}
 const report={status:'UNADOPTED: regional boundaries not reconciled',source:input.source,graph:raw.report,smoothBedErrorM:bedError,maximumTerrainChangeM:maxChange,rmsTerrainChangeM:Math.sqrt(squaredChange/heights.length),edgeMaximumChangeM,primitiveCount:smooth.cache.size,limitations:['Actual source river constrains this experiment only; production sampler is unchanged','No adjacent catchment compatibility or coastline guarantee','Changes to existing saved worlds are not permitted','No inference of new surface water from a dry drainage graph']};
 writeFileSync(`${out}/proposed.svg`,reliefSvg(model,{heights}));
 writeFileSync(`${out}/existing.svg`,reliefSvg({...model,segments:[]},{heights:oldHeights}));
 writeFileSync(`${out}/input.json`,JSON.stringify({parent:input.parent,extentM:input.extentM,source:input.source},null,2));
 writeFileSync(`${out}/report.json`,JSON.stringify(report,null,2));writeFileSync(`${out}/field.json`,JSON.stringify({heights,oldHeights,segments:model.segments,report}));console.log(JSON.stringify(report,null,2));
}
