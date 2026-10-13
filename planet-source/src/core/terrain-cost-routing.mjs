/** Terrain-aware corridor experiment. Uses the project's spherical coordinates
 * and monotone interval fitter. Motivation: terrain/river coupling (Genevaux
 * 2013) and terrain-sensitive path costs (Galin 2010, originally for roads).
 * Our forward-layer bounded search is NOT either paper's full algorithm.
 * It is not a meander/sediment simulation and is gated by the production route acceptance checks.
 */
import {sphereBasis,geographicPoint,greatCircle,createSphericalProjection} from './spherical.mjs';
import {fitMonotoneWaterProfile} from './river-profile-fit.mjs';
import {channelRoute} from './channel-route.mjs';
const dot=(a,b)=>a.reduce((s,v,i)=>s+v*b[i],0),cross=(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]],unit=v=>{const n=Math.hypot(...v);return v.map(x=>x/n);};
const geo=d=>geographicPoint(Math.atan2(d[2],Math.hypot(d[0],d[1]))*180/Math.PI,Math.atan2(d[1],d[0])*180/Math.PI);
const interpolate=(a,b,t)=>{const av=sphereBasis(a).up,bv=sphereBasis(b).up,angle=Math.atan2(Math.hypot(...cross(av,bv)),dot(av,bv));if(angle<1e-12)return {...a};return geo(unit(av.map((v,i)=>(Math.sin((1-t)*angle)*v+Math.sin(t*angle)*bv[i])/Math.sin(angle))));};
export function fitResearchRiverPath(path,{sampleSurface,radiusM,startLevelM,endLevelM,depthM,maxIncisionM=600,stepM=500,maxPoints=4096,incisionScaleM=30}){
 if(!Array.isArray(path)||path.length<2||typeof sampleSurface!=='function'||![radiusM,startLevelM,endLevelM,depthM,maxIncisionM,stepM,incisionScaleM].every(Number.isFinite)||radiusM<=0||depthM<=0||maxIncisionM<=0||stepM<=0||incisionScaleM<=0||!Number.isInteger(maxPoints)||maxPoints<2||maxPoints>8192)throw new RangeError('Bounded river profile required');
 const points=[];let lengthM=0;
 for(let k=1;k<path.length;k++){
  const a=path[k-1],b=path[k],length=greatCircle(a,b,radiusM).distanceM;if(length<1e-6)continue;const steps=Math.ceil(length/stepM);
  for(let j=k===1?0:1;j<=steps;j++){
   if(points.length>=Math.min(maxPoints,4097))return {valid:false,reason:'profile-work-budget'};
   const p=j===0?a:j===steps?b:interpolate(a,b,j/steps),s=sampleSurface(p.latDeg,p.lonDeg);
   if(!Number.isFinite(s.groundElevationM)||s.waterDepthM==null)return {valid:false,reason:'unknown-ground-or-water'};
   const upper=s.waterDepthM>0?s.waterLevelElevationM:s.groundElevationM+.05;
   points.push({...p,distanceM:lengthM+length*j/steps,groundElevationM:s.groundElevationM,minimumLevelM:s.groundElevationM-maxIncisionM+depthM,maximumLevelM:upper,preferredLevelM:s.groundElevationM-.3});
  }
  lengthM+=length;
 }
 if(points.length<2||points.some(p=>p.minimumLevelM>p.maximumLevelM))return {valid:false,reason:'infeasible-local-interval'};
 const fit=fitMonotoneWaterProfile(points,{startLevelM,endLevelM});if(!fit.valid)return {valid:false,reason:'infeasible-monotone-path',detail:fit};
 let scoreM=0,maximumIncisionM=0,incisionIntegralM2=0;
 const result=points.map((p,i)=>{const incision=Math.max(0,p.groundElevationM-fit.levels[i]+depthM);maximumIncisionM=Math.max(maximumIncisionM,incision);return {...p,waterLevelElevationM:fit.levels[i],incisionM:incision};});
 for(let i=1;i<result.length;i++){const a=result[i-1],b=result[i],length=b.distanceM-a.distanceM;scoreM+=length*(1+(a.incisionM*a.incisionM+b.incisionM*b.incisionM)/(2*incisionScaleM*incisionScaleM));incisionIntegralM2+=length*(a.incisionM+b.incisionM)/2;}
 return {valid:true,points:result,lengthM,maximumIncisionM,incisionIntegralM2,scoreM};
}
export function searchTerrainCostCorridor(start,end,{radiusM,sampleSurface,stepM=3000,halfWidthM=20000,incisionScaleM=30,maxCells=4096,lateralSteps=8}){
 if(typeof sampleSurface!=='function'||![radiusM,stepM,halfWidthM,incisionScaleM,start.waterLevelElevationM,end.waterLevelElevationM].every(Number.isFinite)||radiusM<=0||stepM<=0||halfWidthM<=0||halfWidthM>radiusM*.1||incisionScaleM<=0||!Number.isInteger(maxCells)||maxCells<85||maxCells>16384)throw new RangeError('Bounded terrain corridor required');
 if(!Number.isInteger(lateralSteps)||lateralSteps<2||lateralSteps>32)throw new RangeError('Bounded lateral corridor resolution required');
 const av=sphereBasis(start).up,bv=sphereBasis(end).up,c=cross(av,bv),angle=Math.atan2(Math.hypot(...c),dot(av,bv));if(angle<1e-12||angle>Math.PI/2)return {path:null,status:'unsupported-span'};
 const length=angle*radiusM,normal=unit(c),nx=Math.max(4,Math.min(128,Math.ceil(length/stepM))),ny=2*lateralSteps+1,n=(nx+1)*ny;if(n>maxCells)return {path:null,status:'cell-budget'};
 const positions=[],elevation=[],valid=[];
 for(let x=0;x<=nx;x++)for(let y=0;y<ny;y++){
  const t=x/nx,offset=(y-lateralSteps)/lateralSteps*halfWidthM/radiusM,v=unit(av.map((a,k)=>(Math.sin((1-t)*angle)*a+Math.sin(t*angle)*bv[k])/Math.sin(angle))),p=geo(v.map((a,k)=>Math.cos(offset)*a+Math.sin(offset)*normal[k]));
  if(x===0&&y===lateralSteps)Object.assign(p,{latDeg:start.latDeg,lonDeg:start.lonDeg});if(x===nx&&y===lateralSteps)Object.assign(p,{latDeg:end.latDeg,lonDeg:end.lonDeg});
  const s=sampleSurface(p.latDeg,p.lonDeg);if(!Number.isFinite(s.groundElevationM)||s.waterDepthM==null)throw new Error('Unknown terrain in corridor');
  positions.push(p);elevation.push(s.groundElevationM);valid.push((s.waterDepthM>0?s.waterLevelElevationM:s.groundElevationM+.05)>=end.waterLevelElevationM-1e-7);
 }
 const costs=new Float64Array(n).fill(Infinity),parent=new Int32Array(n).fill(-1);costs[lateralSteps]=0;let transitions=0;
 for(let x=1;x<=nx;x++)for(let y=0;y<ny;y++){
  const j=x*ny+y;if(!valid[j]||x===nx&&y!==lateralSteps)continue;
  for(let dy=-2;dy<=2;dy++){
   const yy=y+dy;if(yy<0||yy>=ny)continue;const i=(x-1)*ny+yy;if(!Number.isFinite(costs[i]))continue;
   const length=greatCircle(positions[i],positions[j],radiusM).distanceM,t=(x-.5)/nx,reference=start.waterLevelElevationM+(end.waterLevelElevationM-start.waterLevelElevationM)*t;
   const cut0=Math.max(0,elevation[i]-reference),cut1=Math.max(0,elevation[j]-reference),uphill=Math.max(0,elevation[j]-elevation[i])/length;
   const next=costs[i]+length*(1+(cut0*cut0+cut1*cut1)/(2*incisionScaleM*incisionScaleM)+100*uphill*uphill);transitions++;
   if(next<costs[j]){costs[j]=next;parent[j]=i;}
  }
 }
 const last=nx*ny+lateralSteps;if(!Number.isFinite(costs[last]))return {path:null,status:'no-corridor-path',cells:n,transitions};
 const path=[],indices=[];for(let i=last;i>=0;i=parent[i]){path.push(positions[i]);indices.push(i);}const boundaryContactNodes=indices.filter(i=>i%ny===0||i%ny===ny-1).length;return {boundaryContactNodes,boundaryContactFraction:boundaryContactNodes/indices.length,path:path.reverse(),status:'candidate-needs-continuous-profile-fit',proxyScoreM:costs[last],cells:n,transitions,halfWidthM,limitations:['Forward-layer corridor cannot represent arbitrary backtracking','Cell proxy cost does not establish between-cell or hydraulic validity','No sediment transport, floodplain or natural meander model']};
}

/** Smooth only within a bounded local projection, then refit every candidate.
 * Selection establishes sampled cost/height validity, NOT network safety.
 * Crossings and between-sample extrema remain separate adoption gates. */
export function selectResearchRiverRoute(start,end,options){
 const fitOptions={...options,startLevelM:start.waterLevelElevationM,endLevelM:end.waterLevelElevationM};
 const directPath=[start,end],direct=fitResearchRiverPath(directPath,fitOptions);
 const search=searchTerrainCostCorridor(start,end,{...options,stepM:options.corridorStepM??3000});
 const candidates=[{kind:'direct',path:directPath,fit:direct}];
 if(search.path){
  candidates.push({kind:'terrain-corridor',path:search.path,fit:fitResearchRiverPath(search.path,fitOptions)});
  const center=interpolate(start,end,.5),projection=createSphericalProjection({centerLatDeg:center.latDeg,centerLonDeg:center.lonDeg,radiusM:options.radiusM,maxRadiusM:options.radiusM*.1});
  const local=search.path.map(p=>projection.toLocalIfWithin(p.latDeg,p.lonDeg));
  if(local.every(Boolean)){
   const path=channelRoute(local.map(p=>({...p,areaM2:0})),'rounded-survey-path@1').map(p=>projection.toGeographic(p.xM,p.yM));
   path[0]={...start};path[path.length-1]={...end};
   candidates.push({kind:'rounded-terrain-corridor',path,fit:fitResearchRiverPath(path,fitOptions)});
  }
 }
 let selected=null;
 for(const c of candidates)if(c.fit.valid&&(!selected||c.fit.scoreM<selected.fit.scoreM-1e-6))selected=c;
 return {selected,candidates,search,adoptionReady:false,remainingChecks:['Other river crossings and confluence topology','Sub-sample terrain and water validation','Landscape morphology and local visual inspection']};
}

/** Bounded sensitivity check: widen the search while retaining lateral spacing.
 * Hitting the final search boundary is an unresolved limitation, never success.
 * This diagnoses corridor clipping; it does not solve basin membership. */
export function compareResearchCorridorWidths(start,end,options){
 const initial=options.halfWidthM??20000,attempts=[];
 if(!Number.isFinite(initial)||initial<=0||initial*4>options.radiusM*.1)throw new RangeError('Bounded width comparison required');
 for(const multiplier of [1,2,4]){
  const result=selectResearchRiverRoute(start,end,{...options,halfWidthM:initial*multiplier,lateralSteps:8*multiplier,maxCells:16384});
  attempts.push({halfWidthM:initial*multiplier,lateralSpacingM:initial/8,result});
 }
 const interior=attempts.filter(a=>a.result.search.path&&a.result.search.boundaryContactNodes===0);
 const chosen=interior.filter(a=>a.result.selected).sort((a,b)=>a.result.selected.fit.scoreM-b.result.selected.fit.scoreM)[0]??null;
 return{attempts,selectedInterior:chosen,searchBoundaryResolved:interior.length>0,adoptionReady:false,limitations:['Fixed lateral spacing; forward-only search remains directional','Wider search may leave the source catchment; basin membership not certified','Centerline and bank clearance, hydraulic and visual checks remain required']};
}
