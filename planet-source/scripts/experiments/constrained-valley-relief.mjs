/** Constraint-compatible local valley experiment. Not a production policy.
 * Uses the curve/compact-primitive family described by Genevaux et al. 2013;
 * the interval fitting, boundary reservation and acceptance checks are ours.
 * No new water is inferred. Existing terrain is the only baseline surface.
 */
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {pathToFileURL} from 'node:url';
import {createGlobalTerrain} from '../../src/core/global-terrain.mjs';
import {fitMonotoneWaterProfile} from '../../src/core/river-profile-fit.mjs';
import {createExperiment,reliefSvg} from './drainage-led-relief.mjs';
import {extractParent} from './planet-parent-relief.mjs';
import {requireVerificationMemory} from '../verification-runtime.mjs';
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
function projection(x,y,a,b) {const dx=b.x-a.x,dy=b.y-a.y,t=clamp(((x-a.x)*dx+(y-a.y)*dy)/(dx*dx+dy*dy),0,1);return{t,distance:Math.hypot(x-a.x-t*dx,y-a.y-t*dy)};}
function curveInfluence(x,y,curve) {
 const first=curve.points[0],last=curve.points.at(-1),q=projection(x,y,first,last);
 const u=q.t*(curve.points.length-1),i=Math.min(curve.points.length-2,Math.floor(u)),t=u-i,a=curve.points[i],b=curve.points[i+1];
 const width=a.width+(b.width-a.width)*t;if(q.distance>=width)return null;
 const z=a.z+(b.z-a.z)*t,w=(1-(q.distance/width)**2)**2;
 return {z,distance:q.distance,weight:w/Math.max(1e-20,q.distance*q.distance)};
}
export function fitConstrainedValleys({graph,groundAt,extentM=8192,maxIncisionM=80,maxFillM=.1,guardM=512,maxWidthM=256,sampleStepM=8}) {
 if(typeof groundAt!=='function'||!(extentM>0&&maxIncisionM>0&&maxIncisionM<=200&&maxFillM>=0&&maxFillM<=1&&guardM>maxWidthM&&maxWidthM>=16&&sampleStepM>=8))throw new RangeError('Explicit bounded valley constraints required');
 const curves=[],accepted=new Map(),rejected=[],cache=new Map();
 const original=(x,y)=>{const key=`${x}/${y}`;if(cache.has(key))return cache.get(key);const z=groundAt(x,y);if(!Number.isFinite(z))throw new Error('Unknown original terrain');if(cache.size<65536)cache.set(key,z);return z;};
 const parentSegments=graph.segments.filter(s=>s.level===0);
 const protectedWidth=s=>Math.max(s.a.protectWidthM??0,s.b.protectWidthM??0)+(s.a.protectWidthM===undefined?0:4);
 const protectedDistance=(x,y)=>Math.min(...parentSegments.map(s=>projection(x,y,s.a,s.b).distance-protectedWidth(s)));
 const field=(x,y,list=curves)=>{
  const z=original(x,y);let weight=1/(maxWidthM*maxWidthM),sum=0;
  // The existing river is an exact zero-displacement constraint. Weighted
  // compact primitives interpolate line constraints without sequential cuts.
  for(const s of parentSegments){const q=projection(x,y,s.a,s.b),distance=q.distance-protectedWidth(s);if(distance<1e-8)return z;if(distance<maxWidthM){const r=distance/maxWidthM;weight+=(1-r*r)**2/(distance*distance);}}
  for(const c of list){const q=curveInfluence(x,y,c);if(!q)continue;const delta=clamp(q.z-z,-maxIncisionM,maxFillM);if(q.distance<1e-8)return z+delta;sum+=q.weight*delta;weight+=q.weight;}
  return z+sum/weight;
 };
 for(const sourceSegment of graph.segments) {
  let s=sourceSegment;
  if(s.level===0){accepted.set(s.id,{parent:true});continue;}
  if(!accepted.has(s.parentId)){rejected.push({id:s.id,reason:'parent-not-accepted'});continue;}
  const parentCurve=accepted.get(s.parentId);
  if(!parentCurve.parent&&projection(s.a.x,s.a.y,parentCurve.points[0],parentCurve.points.at(-1)).distance>1e-4){rejected.push({id:s.id,reason:'attachment-outside-parent-profile'});continue;}
  if(protectedDistance(s.b.x,s.b.y)<=0){rejected.push({id:s.id,reason:'inside-existing-river-corridor'});continue;}
  if(protectedDistance(s.a.x,s.a.y)<=0){
   let lo=0,hi=1;for(let k=1;k<=64;k++){const t=k/64;if(protectedDistance(s.a.x+(s.b.x-s.a.x)*t,s.a.y+(s.b.y-s.a.y)*t)>0){lo=(k-1)/64;hi=t;break;}}
   for(let k=0;k<40;k++){const t=(lo+hi)/2;if(protectedDistance(s.a.x+(s.b.x-s.a.x)*t,s.a.y+(s.b.y-s.a.y)*t)>0)hi=t;else lo=t;}
   const t=Math.min(1,hi+1e-8);s={...s,a:{...s.a,x:s.a.x+(s.b.x-s.a.x)*t,y:s.a.y+(s.b.y-s.a.y)*t}};
  }
  if([s.a,s.b].some(p=>Math.min(p.x,p.y,extentM-p.x,extentM-p.y)<guardM)){rejected.push({id:s.id,reason:'boundary-reservation'});continue;}
  const length=Math.hypot(s.b.x-s.a.x,s.b.y-s.a.y),count=Math.ceil(length/sampleStepM),points=[];
  if(count>1024){rejected.push({id:s.id,reason:'profile-work-budget'});continue;}
  for(let i=0;i<=count;i++){const t=i/count,x=s.b.x+(s.a.x-s.b.x)*t,y=s.b.y+(s.a.y-s.b.y)*t;points.push({x,y,ground:field(x,y),original:original(x,y)});}
  if(points.some(p=>protectedDistance(p.x,p.y)<-1e-6)){rejected.push({id:s.id,reason:'crosses-existing-river-corridor'});continue;}
  const start=points[0].ground,end=points.at(-1).ground;
  if(start<end+1){rejected.push({id:s.id,reason:'no-upstream-relief'});continue;}
  const intervals=points.map((p,i)=>({minimumLevelM:p.original-maxIncisionM+.1,maximumLevelM:p.ground,preferredLevelM:start+(end-start)*i/count}));
  if(intervals.some(p=>p.minimumLevelM>p.maximumLevelM)){rejected.push({id:s.id,reason:'prior-valley-saturated-cut-budget'});continue;}
  const fit=fitMonotoneWaterProfile(intervals,{startLevelM:start,endLevelM:end});
  if(!fit.valid){rejected.push({id:s.id,reason:'infeasible-source-interval'});continue;}
  if(fit.levels.some((z,i)=>i&&Math.abs(z-fit.levels[i-1])/(length/count)>.5)){rejected.push({id:s.id,reason:'excessive-longitudinal-grade'});continue;}
  const connector=[];
  if(parentCurve.parent){
   const distance=Math.hypot(s.a.x-sourceSegment.a.x,s.a.y-sourceSegment.a.y),steps=Math.max(1,Math.ceil(distance/2));
   let previous=end,riseM=0;
   for(let k=0;k<=steps;k++){const t=k/steps,x=s.a.x+(sourceSegment.a.x-s.a.x)*t,y=s.a.y+(sourceSegment.a.y-s.a.y)*t,z=original(x,y);riseM=Math.max(riseM,z-previous);previous=z;connector.push({x,y,z});}
   if(riseM>1e-6){rejected.push({id:s.id,reason:'existing-bank-connector-uphill',riseM});continue;}
  }
  const c={id:s.id,parentId:s.parentId,level:s.level,connector,points:points.map((p,i)=>({x:p.x,y:p.y,z:fit.levels[i],width:Math.min(maxWidthM,Math.max(16,(p.ground-fit.levels[i])/.35+16))}))};
  // Reject a proposed curve if its actual composed surface fails between knots.
  // Finer checks remain finite; do not label them a continuous proof.
  let ownConflict=false,previous=Infinity,ownErrorM=0,ownRiseM=0;
  for(let i=1;i<c.points.length;i++)for(let k=0;k<=4;k++) {
   const a=c.points[i-1],b=c.points[i],t=k/4,x=a.x+(b.x-a.x)*t,y=a.y+(b.y-a.y)*t,z=field(x,y,[...curves,c]),wanted=a.z+(b.z-a.z)*t;
   ownErrorM=Math.max(ownErrorM,Math.abs(z-wanted));ownRiseM=Math.max(ownRiseM,z-previous);if(Math.abs(z-wanted)>.02||z>previous+1e-6)ownConflict=true;previous=z;
  }
  if(ownConflict){rejected.push({id:s.id,reason:'between-knot-surface-conflict',ownErrorM,ownRiseM});continue;}
  // Protect earlier accepted valley beds and the actual parent centre line.
  let conflict=false;
  const protectedPoints=curves.flatMap(c=>c.points.slice(1).flatMap((b,i)=>{const a=c.points[i];return [0,.25,.5,.75,1].map(t=>({x:a.x+(b.x-a.x)*t,y:a.y+(b.y-a.y)*t}));}));
  for(const p of protectedPoints){const old=field(p.x,p.y);if(Math.abs(field(p.x,p.y,[...curves,c])-old)>1e-6){conflict=true;break;}}
  if(!conflict)for(const parent of graph.segments.filter(s=>s.level===0))for(let k=0;k<=64;k++){
   const t=k/64,x=parent.a.x+(parent.b.x-parent.a.x)*t,y=parent.a.y+(parent.b.y-parent.a.y)*t,z=original(x,y);
   if(Math.abs(field(x,y,[...curves,c])-z)>1e-6){conflict=true;break;}
  }
  if(conflict){rejected.push({id:s.id,reason:'existing-bed-conflict'});continue;}
  curves.push(c);accepted.set(s.id,c);
 }
 return {curves,rejected,sample:field,original,cache,protectedDistance,parameters:{extentM,maxIncisionM,maxFillM,guardM,maxWidthM,sampleStepM}};
}
export function auditConstrained(model,graph,{resolution=129}={}) {
 const {extentM}=model.parameters,heights=[],oldHeights=[];let edgeChangeM=0,parentChangeM=0,corridorChangeM=0,maximumCutM=0,maximumFillM=0,uphillSteps=0,connectorUphillSteps=0,maximumBedErrorM=0;
 for(let y=0;y<resolution;y++)for(let x=0;x<resolution;x++) {
  const xm=x*extentM/(resolution-1),ym=y*extentM/(resolution-1),old=model.original(xm,ym),z=model.sample(xm,ym);
  heights.push(z);oldHeights.push(old);maximumCutM=Math.max(maximumCutM,old-z);maximumFillM=Math.max(maximumFillM,z-old);if(model.protectedDistance(xm,ym)<=0)corridorChangeM=Math.max(corridorChangeM,Math.abs(z-old));if(!x||!y||x===resolution-1||y===resolution-1)edgeChangeM=Math.max(edgeChangeM,Math.abs(z-old));
 }
 for(const c of model.curves){let prev=Infinity;for(const p of c.connector){const z=model.sample(p.x,p.y);if(z>prev+1e-6)connectorUphillSteps++;prev=z;}let prior=Infinity;for(let i=1;i<c.points.length;i++)for(let k=0;k<=4;k++){
  const a=c.points[i-1],b=c.points[i],t=k/4,z=model.sample(a.x+(b.x-a.x)*t,a.y+(b.y-a.y)*t);if(z>prior+1e-6)uphillSteps++;prior=z;maximumBedErrorM=Math.max(maximumBedErrorM,Math.abs(z-a.z-(b.z-a.z)*t));
 }}
 for(const s of graph.segments.filter(s=>s.level===0))for(let k=0;k<=128;k++){const t=k/128,x=s.a.x+(s.b.x-s.a.x)*t,y=s.a.y+(s.b.y-s.a.y)*t;parentChangeM=Math.max(parentChangeM,Math.abs(model.sample(x,y)-model.original(x,y)));}
 return {heights,oldHeights,report:{acceptedValleys:model.curves.length,rejected:model.rejected,edgeChangeM,parentChangeM,corridorChangeM,maximumCutM,maximumFillM,uphillSteps,connectorUphillSteps,maximumBedErrorM,parameters:model.parameters,limitations:['Finite profile/parent checks, not continuous geometric proofs','Compact support preserves a boundary collar but does not generate cross-region tributaries','No flow, sediment, water surface or ecological output','Curve continuity between sampled original heights still requires verification','Not installed in canonical production sampler']}};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href) {
 requireVerificationMemory();const snapshot=JSON.parse(readFileSync(process.argv[2])),out=process.argv[3]||'/tmp/planet-constrained-relief';mkdirSync(out,{recursive:true});
 const base=createGlobalTerrain(snapshot),input=extractParent(snapshot),graph=createExperiment({seed:`${snapshot.worldId}/${input.source.profileId}`,parent:input.parent}),groundAt=(x,y)=>{const p=input.projection.toGeographic(x-4096,y-4096);return base.groundElevationAt(p.latDeg,p.lonDeg);};
 const t=performance.now(),model=fitConstrainedValleys({graph,groundAt}),audit=auditConstrained(model,graph);audit.report.source=input.source;audit.report.runtimeMs=performance.now()-t;
 const segments=model.curves.flatMap(c=>c.points.slice(1).map((b,i)=>({a:c.points[i],b,level:c.level})));
 writeFileSync(`${out}/field.json`,JSON.stringify({...audit,segments}));writeFileSync(`${out}/report.json`,JSON.stringify(audit.report,null,2));writeFileSync(`${out}/proposed.svg`,reliefSvg({...graph,segments},{heights:audit.heights}));console.log(JSON.stringify(audit.report,null,2));
}
