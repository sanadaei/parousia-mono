/** Low-gradient, unconstrained-bank scenario. Wavelength is scaled from channel
 * width, following the empirical relation discussed by Leopold & Wolman (1957),
 * USGS PP282-B. This is NOT their process model: cohesive banks are assumed,
 * sediment, cutoffs and braided channels are not simulated. Terrain confinement,
 * profile fitting and network crossing checks must gate adoption. */
import {sphereBasis,geographicPoint,greatCircle} from './spherical.mjs';
const dot=(a,b)=>a.reduce((s,v,i)=>s+v*b[i],0),cross=(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]],unit=v=>{const n=Math.hypot(...v);return v.map(x=>x/n);};
const geo=d=>geographicPoint(Math.atan2(d[2],Math.hypot(d[0],d[1]))*180/Math.PI,Math.atan2(d[1],d[0])*180/Math.PI);
export function channelPlanform(profile,radiusM,{sampleSurface,maxPoints=4096,confinement='whole-reach@1'}={}){
 if(!Number.isFinite(radiusM)||radiusM<=0||!Number.isInteger(maxPoints)||maxPoints<2||maxPoints>4097||typeof sampleSurface!=='function'||typeof profile?.id!=='string'||!Array.isArray(profile.points)||profile.points.length<2||profile.points.length>131072)throw new RangeError('Invalid bounded channel planform');
 for(const p of profile.points)if(![p.latDeg,p.lonDeg,p.waterLevelElevationM,p.halfWidthM].every(Number.isFinite)||Math.abs(p.latDeg)>90||p.halfWidthM<=0)throw new RangeError('Invalid channel point');
 if(!['whole-reach@1','local-taper@2'].includes(confinement))throw new RangeError('Invalid confinement policy');
 const local=confinement==='local-taper@2';
 const original=profile.points,lengths=[0];for(let i=1;i<original.length;i++){const d=greatCircle(original[i-1],original[i],radiusM).distanceM;if(d<1e-6)throw new RangeError('Degenerate channel segment');lengths.push(lengths.at(-1)+d);}
 const length=lengths.at(-1),width=2*original[Math.floor(original.length/2)].halfWidthM,gradient=(original[0].waterLevelElevationM-original.at(-1).waterLevelElevationM)/length;
 if(width<20||gradient<0||gradient>.002||length<width*30)return{status:'confined-or-short-reach',path:null};
 let h=2166136261;for(const c of profile.id)h=Math.imul(h^c.charCodeAt(0),16777619);const phase=(h>>>0)/4294967296*2*Math.PI;
 const wavelength=width*10,steps=Math.ceil(length/(wavelength/16));if(steps+1>maxPoints)return{status:'point-budget',path:null};
 const path=[],probes=[],candidates=[];let seg=1,maxOffsetM=0;
 for(let i=0;i<=steps;i++){
  const distance=length*i/steps;while(seg<lengths.length-1&&lengths[seg]<distance)seg++;
  const a=original[seg-1],b=original[seg],t=(distance-lengths[seg-1])/(lengths[seg]-lengths[seg-1]),av=sphereBasis(a).up,bv=sphereBasis(b).up,normal=unit(cross(av,bv)),angle=Math.acos(Math.max(-1,Math.min(1,dot(av,bv)))),v=unit(av.map((x,j)=>(Math.sin((1-t)*angle)*x+Math.sin(t*angle)*bv[j])/Math.sin(angle)));
  const envelope=Math.min(1,distance/(local?width*3:wavelength*2),(length-distance)/(local?width*3:wavelength*2)),e=envelope*envelope*(3-2*envelope),offset=width*.8*e*Math.sin(2*Math.PI*distance/wavelength+phase+.3*Math.sin(distance/(wavelength*3)));
  const p=i===0?{...a}:i===steps?{...b}:geo(v.map((x,j)=>Math.cos(offset/radiusM)*x+Math.sin(offset/radiusM)*normal[j])),center=geo(v),old=sampleSurface(center.latDeg,center.lonDeg),next=sampleSurface(p.latDeg,p.lonDeg);
  if(![old.groundElevationM,next.groundElevationM].every(Number.isFinite)||old.waterDepthM==null||next.waterDepthM==null)return{status:'unknown-terrain-or-water',path:null};
  if(local){candidates.push({v,normal,offset,old,limit:next.groundElevationM-old.groundElevationM>Math.max(10,width*.02)?0:1});}
  else if(next.groundElevationM-old.groundElevationM>Math.max(10,width*.02))return{status:'confining-terrain',path:null};
  path.push(p);probes.push({distanceM:distance,offsetM:offset});maxOffsetM=Math.max(maxOffsetM,Math.abs(offset));
 }
 if(local){
  // One confined section suppresses only its neighborhood. Conservative
  // forward/backward envelopes taper the offset without raising any local
  // allowance. Every moved sample is checked again after tapering.
  const increment=Math.min(1,(length/steps)/(width*3));let settled=false;
  for(let pass=0;pass<8;pass++){
   const limits=candidates.map(c=>c.limit);
   for(let i=1;i<limits.length;i++)limits[i]=Math.min(limits[i],limits[i-1]+increment);
   for(let i=limits.length-2;i>=0;i--)limits[i]=Math.min(limits[i],limits[i+1]+increment);
   let rejected=0;maxOffsetM=0;
   for(let i=0;i<candidates.length;i++){
    const c=candidates[i],factor=limits[i]**2*(3-2*limits[i]),offset=c.offset*factor,p=i===0?{...original[0]}:i===steps?{...original.at(-1)}:geo(c.v.map((x,j)=>Math.cos(offset/radiusM)*x+Math.sin(offset/radiusM)*c.normal[j])),next=sampleSurface(p.latDeg,p.lonDeg);
    if(!Number.isFinite(next.groundElevationM)||next.waterDepthM==null)return{status:'unknown-terrain-or-water',path:null};
    if(next.groundElevationM-c.old.groundElevationM>Math.max(10,width*.02)){c.limit=0;rejected++;}
    path[i]=p;probes[i].offsetM=offset;maxOffsetM=Math.max(maxOffsetM,Math.abs(offset));
   }
   if(!rejected){settled=true;break;}
  }
  if(!settled||maxOffsetM<Math.min(1,width*.01))return{status:'confining-terrain',path:null};
 }
 return{status:'candidate',path,probes,...(local?{confinement,confinedSamples:candidates.filter(c=>c.limit===0).length,endpointTransitionM:width*3}:{}),gradient,wavelengthM:wavelength,maxOffsetM,scope:'Empirical-scale low-gradient channel scenario; not sediment dynamics'};
}
