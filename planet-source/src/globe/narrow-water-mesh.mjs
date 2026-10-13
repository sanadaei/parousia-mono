import {cooperativeYield} from './cooperative-yield.mjs';
import {sphereBasis,greatCircle,offsetGeographic} from '../core/spherical.mjs';
import {tileDirection,tileBound,normalize,cross,dot,geographic} from './cube.mjs';
/** Supplement the sparse height-grid clipping with sampled, actual wet strips.
 * Width and water level come from committed hydrology. No ground is changed,
 * and a dry sample breaks the strip instead of inventing water over it. */
export async function buildCommittedWaterStrips(source,tile,signal,{maxVertices=8192,maxSamples=4096}={}){
 if(!Number.isSafeInteger(maxVertices)||maxVertices<0||maxVertices>8192||!Number.isSafeInteger(maxSamples)||maxSamples<0||maxSamples>4096)throw new RangeError('Invalid narrow-water display budget');
 const triangles=[],stats={segments:0,quads:0,samples:0,dry:0,limited:false};
 if(tile.level<12||!source.materializedWaterPlans?.size)return{triangles,stats};
 const radius=source.manifest.base.frame.radiusM,bound=tileBound(tile,radius),center=geographic(bound.center),corners=[[0,0],[1,0],[1,1],[0,1]].map(q=>tileDirection(tile,...q));
 const planes=corners.map((a,i)=>{let n=normalize(cross(a,corners[(i+1)%4]));if(dot(n,bound.center)<0)n=n.map(v=>-v);return n;});
 const at=async point=>{
  if(signal?.aborted)throw new DOMException('Cancelled','AbortError');
  if(stats.samples>=maxSamples){stats.limited=true;return null;}stats.samples++;if(stats.samples%64===0)await cooperativeYield();
  const sample=await source.ready(()=>(source.sampleWithoutCover??source.sample).call(source,point.latDeg,point.lonDeg),signal);
  if(!(sample.waterDepthM>.0001)||!Number.isFinite(sample.waterLevelElevationM)){stats.dry++;return null;}
  return{direction:sphereBasis(point).up,waterLevelElevationM:sample.waterLevelElevationM};
 };
 const clip=async polygon=>{
  for(const plane of planes){const next=[];for(let i=0;i<polygon.length;i++){const a=polygon[i],b=polygon[(i+1)%polygon.length],da=dot(plane,a.direction),db=dot(plane,b.direction),ia=da>=-1e-14,ib=db>=-1e-14;if(ia)next.push(a);if(ia!==ib){const t=da/(da-db),direction=normalize(a.direction.map((v,k)=>v*(1-t)+b.direction[k]*t)),p=await at(geographic(direction));if(!p)return[];next.push(p);}}polygon=next;if(polygon.length<3)return[];}return polygon;
 };
 for(const plan of source.materializedWaterPlans.values())for(const profile of plan.profiles)for(let i=1;i<profile.points.length;i++){
  const a=profile.points[i-1],b=profile.points[i];if(Math.max(a.halfWidthM,b.halfWidthM)>4)continue;
  const arc=greatCircle(a,b,radius);if(greatCircle(center,a,radius).distanceM>bound.angular*radius+arc.distanceM+8)continue;
  stats.segments++;const bearing=arc.bearingDeg*Math.PI/180,steps=Math.max(1,Math.ceil(arc.distanceM/2));let prior=null;
  for(let k=0;k<=steps;k++){
   if(stats.limited)return{triangles,stats};const t=k/steps,p=offsetGeographic(a,Math.sin(bearing)*arc.distanceM*t,Math.cos(bearing)*arc.distanceM*t,radius),width=(a.halfWidthM*(1-t)+b.halfWidthM*t)*.9;
   const wet=await at(p);let row=null;if(wet){const left=await at(offsetGeographic(p,-Math.cos(bearing)*width,Math.sin(bearing)*width,radius)),right=await at(offsetGeographic(p,Math.cos(bearing)*width,-Math.sin(bearing)*width,radius));if(left&&right)row=[left,right];}
   if(prior&&row){const polygon=await clip([prior[0],prior[1],row[1],row[0]]);if(triangles.length*3+(polygon.length-2)*3>maxVertices){stats.limited=true;return{triangles,stats};}for(let j=2;j<polygon.length;j++)triangles.push([polygon[0],polygon[j-1],polygon[j]]);if(polygon.length>=3)stats.quads++;}prior=row;
  }
 }
 return{triangles,stats};
}
