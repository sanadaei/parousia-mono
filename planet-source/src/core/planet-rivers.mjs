import {ALLUVIAL_RIVER_BED} from './river-valley-section.mjs';
import {createRiverSpatialIndex} from './river-spatial-index.mjs';
import { createIncisionKernel, smoothIncisionUnion } from './incision-kernel.mjs';
import { fitMonotoneWaterProfile } from './river-profile-fit.mjs';
import { searchRiverCorridor } from './river-corridor-search.mjs';
import { sphereBasis, geographicPoint } from './spherical.mjs';
const dot=(a,b)=>a[0]*b[0]+a[1]*b[1]+a[2]*b[2],cross=(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]],norm=a=>Math.hypot(...a),unit=a=>{const n=norm(a);return a.map(v=>v/n);};
const geo=d=>geographicPoint(Math.atan2(d[2],Math.hypot(d[0],d[1]))*180/Math.PI,Math.atan2(d[1],d[0])*180/Math.PI);
export const PLANET_RIVERS_SCHEMA='planet-spherical-rivers@1';
export const LEGACY_SMOOTH_RIVER_BED='c1-incision-pnorm16@1';
export const SMOOTH_RIVER_BED='c1-incision-smoothmax@2';
/** Fit a source drainage graph to shared spherical profiles. Rejected fits stay
 * explicit; a river graph is not proof that its bed fits the continuous ground. */
export function derivePlanetRivers(base,{downstream,runoffIndex,oceanCells,lakes,climateSupply=null},{minimumRunoff=20,maxIncisionM=100,profileStepM=5000,maxPoints=131072,valleySideRunPerRise=0,surveyNodeLevels=false,nodeSurveyStepM=profileStepM}={}){
 if(!Number.isFinite(nodeSurveyStepM)||nodeSurveyStepM<=0)throw new RangeError('Invalid node survey step');
 const {columns:w,rows:h}=base.grid,radius=base.frame.radiusM,n=w*h;
 if(!Number.isFinite(minimumRunoff)||minimumRunoff<1||!Number.isFinite(maxIncisionM)||maxIncisionM<=0||!Number.isFinite(profileStepM)||profileStepM<=0||!Number.isSafeInteger(maxPoints)||maxPoints<2||maxPoints>131072)throw new RangeError('Invalid river fitting limits');
 if(!Number.isFinite(valleySideRunPerRise)||valleySideRunPerRise<0||valleySideRunPerRise>16)throw new RangeError('Invalid valley side-run ratio');
 if([downstream,runoffIndex,oceanCells].some(a=>a.length!==n))throw new RangeError('River source grid mismatch');
 if(climateSupply&&(!Number.isFinite(climateSupply.referenceAreaM2)||climateSupply.referenceAreaM2<=0||typeof climateSupply.id!=='string'||![climateSupply.meanPotentialFlowM3PerSecond,climateSupply.yieldMonths].every(a=>Array.isArray(a)&&a.length===n)||!climateSupply.meanPotentialFlowM3PerSecond.every(v=>Number.isFinite(v)&&v>=0)||!climateSupply.yieldMonths.every(v=>Number.isInteger(v)&&v>=0&&v<=12)))throw new RangeError('Invalid climate river supply');
 const pos=i=>({latDeg:90-(Math.floor(i/w)+.5)*180/h,lonDeg:(i%w+.5)*360/w}),lakeAt=new Map();for(const lake of lakes)for(const i of lake.cells){const p=pos(i);if(base.groundElevationAt(p.latDeg,p.lonDeg)<=lake.levelElevationM+1e-9)lakeAt.set(i,lake);}
 const baseReferences=base.toSnapshot().references;if(baseReferences.rivers)throw new TypeError('River fitting requires an uncarved base terrain');
 const seaLevel=baseReferences.sea.levelElevationM;
 const spillNodes=new Map();
 for(const lake of lakes)if(lake.kind==='overflow-lake')for(const i of lake.outletCellIndices??[]){const j=downstream[i];if(j>=0){const p=pos(j),z=base.groundElevationAt(p.latDeg,p.lonDeg);if(Math.abs(z-lake.levelElevationM)<1e-6)spillNodes.set(j,lake.levelElevationM);}}
 const naturalNodeLevel=i=>oceanCells[i]?seaLevel:lakeAt.has(i)?lakeAt.get(i).levelElevationM:spillNodes.get(i)??base.groundElevationAt(pos(i).latDeg,pos(i).lonDeg)-.3;
 const adjustedLevels=new Map(),incoming=new Map(),links=new Map(),depthAt=new Map();
 for(let i=0;i<n;i++){const j=downstream[i];if(j<0||oceanCells[i]||runoffIndex[i]<minimumRunoff||(lakeAt.has(i)&&lakeAt.get(i)===lakeAt.get(j)))continue;
 links.set(i,j);incoming.set(i,incoming.get(i)??0);incoming.set(j,(incoming.get(j)??0)+1);
 const d=Math.min(8,1+Math.log1p(runoffIndex[i])*.35);for(const k of[i,j])depthAt.set(k,Math.max(depthAt.get(k)??0,d));}
 const queue=[...incoming].filter(([,v])=>v===0).map(([i])=>i);
 for(let k=0;k<queue.length;k++){const i=queue[k],j=links.get(i);if(j==null)continue;
 let level=adjustedLevels.get(i)??naturalNodeLevel(i);const previous=adjustedLevels.get(j)??naturalNodeLevel(j);
 // A local hollow upstream of a junction constrains its downstream water
 // level too. Lower a shared node once in topological order, never fit two
 // incident reaches to contradictory junction levels.
 if(surveyNodeLevels&&!oceanCells[j]&&!lakeAt.has(j)&&!spillNodes.has(j)){
  const a=pos(i),b=pos(j),av=sphereBasis(a).up,bv=sphereBasis(b).up,angle=Math.atan2(norm(cross(av,bv)),dot(av,bv)),step=Math.min(nodeSurveyStepM,radius*Math.min(Math.PI/h,2*Math.PI/w*Math.max(.001,Math.cos(Math.max(Math.abs(a.latDeg),Math.abs(b.latDeg))*Math.PI/180)))/4),steps=Math.min(4096,Math.max(1,Math.ceil(angle*radius/step)));
  for(let k=1;k<steps;k++){const t=k/steps,d=unit(av.map((v,q)=>Math.sin((1-t)*angle)/Math.sin(angle)*v+Math.sin(t*angle)/Math.sin(angle)*bv[q])),p=geo(d),sample=base.sampleAt(p.latDeg,p.lonDeg),ceiling=sample.waterDepthM>0?Math.max(sample.groundElevationM+.05,sample.waterLevelElevationM):sample.groundElevationM+.05;level=Math.min(level,ceiling);}
 }
 if(level<previous&&!oceanCells[j]&&!lakeAt.has(j)&&!spillNodes.has(j)){
  const p=pos(j),z=base.groundElevationAt(p.latDeg,p.lonDeg);
  if(z-level+(depthAt.get(j)??8)<=maxIncisionM)adjustedLevels.set(j,level);
 }
 incoming.set(j,incoming.get(j)-1);if(incoming.get(j)===0)queue.push(j);
 }
 if(queue.length!==incoming.size)throw new RangeError('Cyclic selected river graph');
 const nodeLevel=i=>adjustedLevels.get(i)??naturalNodeLevel(i);
 const nodes=new Map(),profiles=[],rejected=[];let pointCount=0,rerouteAttempts=0;
 function node(i){if(!nodes.has(i))nodes.set(i,{id:`river-node:${i}`,sourceCellIndex:i,...pos(i),waterLevelElevationM:nodeLevel(i)});return nodes.get(i);}
 for(let i=0;i<n;i++){
 const j=downstream[i];if(j<0||oceanCells[i]||runoffIndex[i]<minimumRunoff||(lakeAt.has(i)&&lakeAt.get(i)===lakeAt.get(j)))continue;
 const a=node(i),b=node(j),av=sphereBasis(a).up,bv=sphereBasis(b).up,angle=Math.atan2(norm(cross(av,bv)),dot(av,bv)),length=angle*radius;
 if(a.waterLevelElevationM<b.waterLevelElevationM-1e-7){rejected.push({from:i,to:j,reason:'uphill-node-level'});continue;}
 const step=Math.min(profileStepM,radius*Math.min(Math.PI/h,2*Math.PI/w*Math.max(.001,Math.cos(Math.max(Math.abs(a.latDeg),Math.abs(b.latDeg))*Math.PI/180)))/4);
 if(pointCount+Math.ceil(length/step)+1>maxPoints){rejected.push({from:i,to:j,reason:'profile-budget'});continue;}
 const q=climateSupply?.meanPotentialFlowM3PerSecond[i],width=q==null?Math.min(100,Math.max(4,Math.sqrt(runoffIndex[i])*2)):Math.min(2000,Math.max(2,2.5*Math.sqrt(q))),depth=q==null?Math.min(8,1+Math.log1p(runoffIndex[i])*.35):Math.min(25,Math.max(.5,.7*q**.3));
 function fitSegment(start,end,startLevel,final){
   const av=sphereBasis(start).up,bv=sphereBasis(end).up,angle=Math.atan2(norm(cross(av,bv)),dot(av,bv)),lengthM=angle*radius,localStep=Math.min(step,radius*Math.min(Math.PI/h,2*Math.PI/w*Math.max(.001,Math.cos(Math.max(Math.abs(start.latDeg),Math.abs(end.latDeg))*Math.PI/180)))/4),count=Math.max(1,Math.ceil(lengthM/localStep));
   if(count>4096)return{valid:false,detail:{reason:'segment-point-budget'}};
   const sampled=[];let maximumIncisionM=0;
   for(let k=0;k<=count;k++){
     const t=k/count,d=unit(av.map((v,q)=>Math.sin((1-t)*angle)/Math.sin(angle)*v+Math.sin(t*angle)/Math.sin(angle)*bv[q])),p=k===0?start:k===count?end:geo(d),ground=base.groundElevationAt(p.latDeg,p.lonDeg);
     const reservoir=base.sampleAt(p.latDeg,p.lonDeg),maximumLevelM=reservoir.waterDepthM>0?Math.max(ground+.05,reservoir.waterLevelElevationM):ground+.05;
     sampled.push({...p,ground,minimumLevelM:ground-maxIncisionM+depth,maximumLevelM,preferredLevelM:Math.max(b.waterLevelElevationM,ground-.3)});
   }
   const fitted=fitMonotoneWaterProfile(sampled,{startLevelM:startLevel,endLevelM:final?b.waterLevelElevationM:null});
   if(!fitted.valid){const p=sampled[fitted.index];return{valid:false,detail:{pointIndex:fitted.index,latDeg:p.latDeg,lonDeg:p.lonDeg,groundElevationM:p.ground,reason:'infeasible-monotone-height-interval',...fitted}};}
   const points=sampled.map((p,k)=>{const level=fitted.levels[k];maximumIncisionM=Math.max(maximumIncisionM,p.ground-(level-depth));return{latDeg:p.latDeg,lonDeg:p.lonDeg,waterLevelElevationM:level,halfWidthM:width,depthM:depth,bankWidthM:Math.max(width,valleySideRunPerRise*Math.max(0,p.ground-(level-depth)))};});
   const previous=fitted.levels.at(-1);
   return{valid:true,points,endLevelM:previous,lengthM,maximumIncisionM};
 }
 let fit=fitSegment(a,b,a.waterLevelElevationM,true),route=null;
 if(!fit.valid&&length<radius*.2&&rerouteAttempts<32){
   rerouteAttempts++;
   const transition=(from,to,level,final)=>{const result=fitSegment(from,to,level,final);return result.valid?result:null;};
   route=searchRiverCorridor(a,b,radius,transition);
   if(!route.path){const broad=route;route=searchRiverCorridor(a,b,radius,transition,{stepM:2500,halfWidthM:Math.min(20000,length*.08)});route.previousSearch={status:broad.status,visited:broad.visited,transitions:broad.transitions};}
   // Short polar/source reaches can cross kilometre-scale ridges. Their
   // former fine fallback also narrowed the corridor to 8% of reach length,
   // excluding nearby valleys. Keep the same 4096-node cap and survey cap.
   if(!route.path&&length<50000){const previous=route;route=searchRiverCorridor(a,b,radius,transition,{stepM:Math.min(1000,length/8),halfWidthM:Math.min(radius*.025,Math.max(5000,length*.3))});route.previousSearch={status:previous.status,visited:previous.visited,transitions:previous.transitions};}
   if(route.path){
     const points=[];let level=a.waterLevelElevationM,totalLength=0,maximumIncisionM=0,valid=true;
     for(let k=1;k<route.path.length;k++){const part=fitSegment(route.path[k-1],route.path[k],level,k===route.path.length-1);if(!part.valid){valid=false;break;}points.push(...part.points.slice(k===1?0:1));level=part.endLevelM;totalLength+=part.lengthM;maximumIncisionM=Math.max(maximumIncisionM,part.maximumIncisionM);}
     if(valid)fit={valid:true,points,lengthM:totalLength,maximumIncisionM};
   }
 }
 if(!fit.valid){rejected.push({from:i,to:j,reason:'continuous-ground-fit',detail:fit.detail,routeSearch:route?{status:route.status,visited:route.visited,transitions:route.transitions}:null});continue;}
 if(pointCount+fit.points.length>maxPoints){rejected.push({from:i,to:j,reason:'profile-budget'});continue;}
 pointCount+=fit.points.length;profiles.push({id:`river:${i}:${j}`,from:a.id,to:b.id,sourceCellIndex:i,receiverCellIndex:j,runoffIndex:runoffIndex[i],
 ...(climateSupply?{climateSupply:{sourceId:climateSupply.id,meanPotentialFlowM3PerSecond:climateSupply.meanPotentialFlowM3PerSecond[i],yieldMonths:climateSupply.yieldMonths[i],scope:'Representative supply, no lake loss or channel routing time; simplified snowmelt'}}:{}),
 sourceBodyId:lakeAt.get(i)?.id??null,receiverBodyId:lakeAt.get(j)?.id??(oceanCells[j]?baseReferences.sea.id:null),
 lengthM:fit.lengthM,maximumSampledIncisionM:fit.maximumIncisionM,points:fit.points,
 routing:route?.path?{method:'bounded-corridor-search',visited:route.visited,transitions:route.transitions,corridorHalfWidthM:route.corridorHalfWidthM}:{method:'direct-great-circle'}});

 }
 const used=new Set(profiles.flatMap(p=>[p.from,p.to]));
 return{schema:PLANET_RIVERS_SCHEMA,bedMethod:SMOOTH_RIVER_BED,radiusM:radius,grid:{columns:w,rows:h},nodes:[...nodes.values()].filter(n=>used.has(n.id)),profiles,
 diagnostics:{...(climateSupply?{runoffBasis:{method:'climate-yield-normalized-reference-area@1',sourceId:climateSupply.id,referenceAreaM2:climateSupply.referenceAreaM2,referenceAnnualRunoffMm:climateSupply.referenceAnnualRunoffMm,channelSizing:'scenario half-width 2.5 sqrt(Q), depth 0.7 Q^0.3; bounded, not hydraulic calibration'}}:{}),junctionLevelMethod:surveyNodeLevels?'surveyed-upstream-ceiling@3':'downstream-incision-bounded@1',loweredJunctionNodes:adjustedLevels.size,valleySideRunPerRise,bedScope:'C1 compact capsule incisions and absolute-width smooth maximum; inherited base regularity; water and graph connectivity assessed separately',sourceThreshold:minimumRunoff,acceptedProfiles:profiles.length,rejected,pointCount,rerouteAttempts,maxIncisionM,profileStepM,maxPoints,scope:'sampled spherical graph fits; between-profile hydraulic acceptance pending'}};
}
/** Shared ground/water interpretation for resident Core and paged samplers. */
export function createSphericalRiverSampler(network){
 if(!network)return null;if(!Number.isFinite(network.diagnostics?.maxIncisionM)||network.diagnostics.maxIncisionM<=0)throw new RangeError('Invalid river incision bound');if(network.schema!==PLANET_RIVERS_SCHEMA||!Number.isFinite(network.radiusM)||network.radiusM<=0||!Array.isArray(network.profiles)||network.profiles.length>131072)throw new TypeError('Invalid spherical river network');
 const incisionLimit=network.diagnostics.maxIncisionM,valleyFloor=network.bedMethod===ALLUVIAL_RIVER_BED,smoothBed=[SMOOTH_RIVER_BED,LEGACY_SMOOTH_RIVER_BED,ALLUVIAL_RIVER_BED].includes(network.bedMethod),boundedUnion=network.bedMethod===SMOOTH_RIVER_BED||valleyFloor;
 if(network.bedMethod!=null&&!smoothBed)throw new TypeError('Unsupported river bed method');
 // Compact C1 positive part and upper cap. Each capsule's incision and
 // its first derivative vanish at support boundaries. Preserve the old p-norm
 // for saved @1 worlds; new @2 worlds use an absolute-width smooth maximum.
 // Quadratic vanishing supplies zero derivative at empty capsule overlaps.
 const {positive,ceiling}=createIncisionKernel(incisionLimit);
 const {columns:w,rows:h}=network.grid??{},radius=network.radiusM,segments=[],ids=new Set();let points=0;
 if(!Number.isSafeInteger(w)||!Number.isSafeInteger(h)||w<3||h<2||w*h>131072)throw new RangeError('Invalid river index grid');
 const nodes=new Map();if(!Array.isArray(network.nodes)||network.nodes.length>131072)throw new TypeError('Invalid river nodes');
 for(const node of network.nodes){if(typeof node.id!=='string'||nodes.has(node.id)||![node.latDeg,node.lonDeg,node.waterLevelElevationM].every(Number.isFinite)||Math.abs(node.latDeg)>90)throw new TypeError('Invalid river node');nodes.set(node.id,node);}
 const samePoint=(a,b)=>Math.abs(a.latDeg-b.latDeg)<1e-9&&Math.abs(((a.lonDeg-b.lonDeg+540)%360+360)%360-180)<1e-9&&Math.abs(a.waterLevelElevationM-b.waterLevelElevationM)<1e-7;
 for(const profile of network.profiles){if(typeof profile.id!=='string'||ids.has(profile.id))throw new TypeError('Invalid river ID');ids.add(profile.id);if(!Array.isArray(profile.points)||profile.points.length<2||(points+=profile.points.length)>131072)throw new RangeError('Invalid river profile points');
 const from=nodes.get(profile.from),to=nodes.get(profile.to);if(!from||!to||!samePoint(from,profile.points[0])||!samePoint(to,profile.points.at(-1)))throw new TypeError('River endpoints disagree with shared nodes');
 for(let k=1;k<profile.points.length;k++){
 const a=profile.points[k-1],b=profile.points[k];for(const p of[a,b])if(![p.latDeg,p.lonDeg,p.waterLevelElevationM,p.halfWidthM,p.depthM,p.bankWidthM].every(Number.isFinite)||Math.abs(p.latDeg)>90||p.halfWidthM<=0||p.depthM<=0||p.bankWidthM<=0||p.halfWidthM+p.bankWidthM>radius*.1)throw new TypeError('Invalid river profile point');
 if(valleyFloor)for(const p of[a,b]){const width=p.floodplainWidthM??0,rise=p.floodplainRiseM??0;if(![width,rise].every(Number.isFinite)||width<0||width>5000||rise<0||rise>20||width>=p.bankWidthM||(width===0)!==(rise===0))throw new RangeError('Invalid alluvial valley section');}
 if(b.waterLevelElevationM>a.waterLevelElevationM+1e-7)throw new RangeError('River flows uphill');
 const av=sphereBasis(a).up,bv=sphereBasis(b).up,c=cross(av,bv),length=norm(c),angle=Math.atan2(length,dot(av,bv));if(length<1e-14)throw new RangeError('Degenerate spherical river segment');
 const bound=Math.min(Math.PI/h,2*Math.PI/w*Math.max(.001,Math.cos(Math.max(Math.abs(a.latDeg),Math.abs(b.latDeg))*Math.PI/180)));if(angle>bound)throw new RangeError('River segment exceeds spatial index cell; subdivide profile');
 const index=segments.length;segments.push({a:{...a,...(valleyFloor?{floodplainWidthM:a.floodplainWidthM??0,floodplainRiseM:a.floodplainRiseM??0,outerBankWidthM:a.bankWidthM-(a.floodplainWidthM??0)}:{})},b:{...b,...(valleyFloor?{floodplainWidthM:b.floodplainWidthM??0,floodplainRiseM:b.floodplainRiseM??0,outerBankWidthM:b.bankWidthM-(b.floodplainWidthM??0)}:{})},av,bv,normal:c.map(v=>v/length),angle,id:profile.id});
 }}
 const degree=new Map([...nodes.keys()].map(id=>[id,0])),outgoing=new Map();
 for(const p of network.profiles){degree.set(p.to,degree.get(p.to)+1);const list=outgoing.get(p.from)??[];list.push(p.to);outgoing.set(p.from,list);}
 const queue=[...degree].filter(([,n])=>n===0).map(([id])=>id);for(let k=0;k<queue.length;k++)for(const id of outgoing.get(queue[k])??[]){degree.set(id,degree.get(id)-1);if(degree.get(id)===0)queue.push(id);}
 if(queue.length!==nodes.size)throw new RangeError('River graph contains a directed cycle');
 const spatial=createRiverSpatialIndex(segments,radius);
 const sample=(lat,lon,ground,reachM=0,waterOnly=false,queryWidth=false)=>{
 const p=geographicPoint(lat,lon),d=sphereBasis(p).up;let elevation=ground,level=null,sources=[],incisionPower=0,incisionUnion=0,minimumWidth=Infinity;const waterCandidates=[];
 const candidates=spatial.query(d,reachM);
 for(const index of candidates){const s=segments[index],normalDistance=dot(d,s.normal),projected=d.map((v,i)=>v-normalDistance*s.normal[i]);if(norm(projected)<1e-14)continue;
 const foot=unit(projected),along=Math.atan2(dot(cross(s.av,foot),s.normal),dot(s.av,foot)),t=Math.max(0,Math.min(1,along/s.angle));
 const nearest=t===0?s.av:t===1?s.bv:foot,distance=radius*Math.atan2(norm(cross(d,nearest)),dot(d,nearest)),mix=k=>{const u=smoothBed?t*t*(3-2*t):t;return s.a[k]*(1-u)+s.b[k]*u;},width=mix('halfWidthM'),bank=mix('bankWidthM');const support=reachM>0?Math.max(s.a.halfWidthM+(waterOnly?0:s.a.bankWidthM),s.b.halfWidthM+(waterOnly?0:s.b.bankWidthM)):width+bank;if(distance>support+reachM)continue;if(reachM>0){if(!queryWidth)return true;minimumWidth=Math.min(minimumWidth,s.a.halfWidthM,s.b.halfWidthM);continue;}
 const z=mix('waterLevelElevationM'),depth=mix('depthM'),smooth=t=>t*t*(3-2*t);
 const floor=valleyFloor?mix('floodplainWidthM'):0,rise=valleyFloor?mix('floodplainRiseM'):0;
 const target=distance<=width?z-depth+depth*smooth(distance/width):floor>0&&distance<width+floor?z+rise*smooth((distance-width)/floor):z+rise+(ground-z-rise)*smooth((distance-width-floor)/(bank-floor));
 if(smoothBed){const incision=ceiling(positive(ground-target));if(boundedUnion)incisionUnion=smoothIncisionUnion(incisionUnion,incision);else incisionPower+=(incision/incisionLimit)**16;if(distance<=width)waterCandidates.push({level:z,id:s.id});}
 else elevation=Math.min(elevation,Math.max(ground-incisionLimit,target));
 if(!smoothBed&&distance<=width&&elevation<z){if(level==null||z>level+1e-7){level=z;sources=[s.id];}else if(Math.abs(z-level)<=1e-7&&!sources.includes(s.id))sources.push(s.id);}
 }
 if(reachM>0)return queryWidth?minimumWidth:false;
 if(smoothBed){elevation=ground-ceiling(boundedUnion?incisionUnion:incisionLimit*incisionPower**(1/16));
   for(const c of waterCandidates)if(elevation<c.level){if(level==null||c.level>level+1e-7){level=c.level;sources=[c.id];}else if(Math.abs(c.level-level)<=1e-7&&!sources.includes(c.id))sources.push(c.id);}
 }
 return{groundElevationM:elevation,waterLevelElevationM:level,waterDepthM:level==null?0:Math.max(0,level-elevation),waterSourceIds:sources.sort()};
 };
 // Bound environmental searches by the actual installed floor widths. Legacy
 // or narrow networks do not pay for an unnecessary 1 km neighborhood scan.
 sample.environmentReachM=Math.min(1000,Math.max(200,180+(valleyFloor?segments.reduce((m,s)=>Math.max(m,s.a.floodplainWidthM??0,s.b.floodplainWidthM??0),0):0)));
 // Environmental proximity reuses the very same saved channel geometry.
 sample.nearby=(lat,lon,reachM=200,{includeValley=false}={})=>{
   if(!Number.isFinite(reachM)||reachM<0||reachM>2000)throw new RangeError('Invalid environmental river reach');
   if(typeof includeValley!=='boolean')throw new TypeError('Invalid valley metadata option');
   const d=sphereBasis(geographicPoint(lat,lon)).up;let best=null;
   for(const index of spatial.query(d,reachM)){
     const s=segments[index],projected=d.map((v,i)=>v-dot(d,s.normal)*s.normal[i]);if(norm(projected)<1e-14)continue;
     const foot=unit(projected),along=Math.atan2(dot(cross(s.av,foot),s.normal),dot(s.av,foot)),t=Math.max(0,Math.min(1,along/s.angle)),nearest=t===0?s.av:t===1?s.bv:foot;
     const distance=radius*Math.atan2(norm(cross(d,nearest)),dot(d,nearest)),u=smoothBed?t*t*(3-2*t):t,mix=k=>s.a[k]*(1-u)+s.b[k]*u,bankDistanceM=Math.max(0,distance-mix('halfWidthM'));
     if(bankDistanceM>reachM||best&&(bankDistanceM>best.bankDistanceM||bankDistanceM===best.bankDistanceM&&s.id>=best.riverId))continue;
     best={riverId:s.id,bankDistanceM,waterLevelElevationM:mix('waterLevelElevationM'),...(includeValley?{floodplainWidthM:valleyFloor?((s.a.floodplainWidthM??0)*(1-u)+(s.b.floodplainWidthM??0)*u):0}: {})};
   }
   return best;
 };
 sample.intersects=(directions,{waterOnly=false}={})=>{if(!segments.length)return false;const center=unit([0,1,2].map(i=>directions.reduce((s,d)=>s+d[i],0))),p=geo(center),reach=Math.max(...directions.map(d=>radius*Math.atan2(norm(cross(d,center)),dot(d,center))));return sample(p.latDeg,p.lonDeg,0,reach+1,waterOnly);};
 sample.minimumIntersectingHalfWidth=directions=>{
   if(!segments.length)return Infinity;
   const center=unit([0,1,2].map(i=>directions.reduce((sum,d)=>sum+d[i],0))),p=geo(center),reach=Math.max(...directions.map(d=>radius*Math.atan2(norm(cross(d,center)),dot(d,center))));
   return sample(p.latDeg,p.lonDeg,0,reach+1,true,true);
 };
 // Interval hull on a spherical disk. Distance to a closed arc is
 // 1-Lipschitz; the projected along-arc angle has gradient sec(cross-track).
 // Interval interpolation and monotone incision operations enclose every
 // interior point, rather than treating a few sampled vertices as a bound.
 sample.groundHeightBounds=({center,angular},[low,high])=>{
   if(!Array.isArray(center)||center.length!==3||!center.every(Number.isFinite)||Math.abs(norm(center)-1)>1e-6||!Number.isFinite(angular)||angular<0||angular>Math.PI||![low,high].every(Number.isFinite)||low>high)throw new RangeError('Invalid river bound disk or height interval');
   const rounding=128*Number.EPSILON*radius,reach=angular*radius+rounding,clamp=x=>Math.max(0,Math.min(1,x)),smooth=x=>{const t=clamp(x);return t*t*(3-2*t);};
   let minUnion=0,maxUnion=0,minPower=0,maxPower=0,upperRoof=high;
   // An angular disk is contained in this Cartesian box (chord <= arc).
   // The existing index encloses each entire river bank including arc sagitta.
   // Keep original segment order: smooth unions must not depend on bucket order.
   const nearby=spatial.query(center,reach).map(i=>segments[i]);
   for(const s of nearby){
     const normalDistance=dot(center,s.normal),projected=center.map((v,i)=>v-normalDistance*s.normal[i]);
     if(norm(projected)<1e-14)return[low-incisionLimit,high];
     const foot=unit(projected),along=Math.atan2(dot(cross(s.av,foot),s.normal),dot(s.av,foot)),nearest=along<=0?s.av:along>=s.angle?s.bv:foot;
     const distance=radius*Math.atan2(norm(cross(center,nearest)),dot(center,nearest)),dlo=Math.max(0,distance-reach),dhi=distance+reach;
     if(dlo>Math.max(s.a.halfWidthM+s.a.bankWidthM,s.b.halfWidthM+s.b.bankWidthM))continue;
     const crossAngle=Math.asin(Math.min(1,Math.abs(normalDistance)))+angular;
     if(crossAngle>=Math.PI/2)return[low-incisionLimit,high];
     const delta=(angular+rounding/radius)/(s.angle*Math.cos(crossAngle)),tlo=clamp(along/s.angle-delta),thi=clamp(along/s.angle+delta),
       interpolate=key=>{const a=s.a[key],change=s.b[key]-a,u=smoothBed?smooth(tlo):tlo,v=smoothBed?smooth(thi):thi;return[Math.min(a+change*u,a+change*v),Math.max(a+change*u,a+change*v)];},
       [wlo,whi]=interpolate('halfWidthM'),[blo,bhi]=interpolate('bankWidthM'),[zlo,zhi]=interpolate('waterLevelElevationM'),[depthlo,depthhi]=interpolate('depthM');
     if(!valleyFloor&&dhi<=wlo+blo){
       const targetUpper=zhi+Math.max(0,high-zhi)*smooth((dhi-wlo)/blo),epsilon=smoothBed?Math.min(.01,incisionLimit*.01):0;
       upperRoof=Math.min(upperRoof,Math.max(high-incisionLimit,targetUpper)+epsilon+rounding);
     }
     let jlo=Infinity,jhi=-Infinity;
     if(dlo<=whi){ // Possible channel interior.
       jlo=Math.min(jlo,low-zhi+depthlo*(1-smooth(dhi/wlo)));
       jhi=Math.max(jhi,high-zlo+depthhi*(1-smooth(dlo/whi)));
     }
     if(valleyFloor){
       const [plo,phi]=interpolate('floodplainWidthM'),[rlo,rhi]=interpolate('floodplainRiseM'),[olo,ohi]=interpolate('outerBankWidthM');
       if(phi>0&&dhi>=wlo&&dlo<=whi+phi){
         const tlo=smooth((dlo-whi)/phi),thi=plo>0?smooth((dhi-wlo)/plo):1;
         jlo=Math.min(jlo,low-zhi-rhi*thi);jhi=Math.max(jhi,high-zlo-rlo*tlo);
       }
       if(dhi>=wlo+plo){
         const alo=low-zhi-rhi,ahi=high-zlo-rlo,flo=1-smooth((dhi-wlo-plo)/olo),fhi=1-smooth((dlo-whi-phi)/ohi),products=[alo*flo,alo*fhi,ahi*flo,ahi*fhi];
         jlo=Math.min(jlo,...products);jhi=Math.max(jhi,...products);
       }
     }else if(dhi>=wlo){ // Possible bank (including the zero-incision exterior).
       const alo=low-zhi,ahi=high-zlo,flo=1-smooth((dhi-wlo)/blo),fhi=1-smooth((dlo-whi)/bhi),products=[alo*flo,alo*fhi,ahi*flo,ahi*fhi];
       jlo=Math.min(jlo,...products);jhi=Math.max(jhi,...products);
     }
     const minimum=smoothBed?ceiling(positive(jlo)):Math.min(incisionLimit,Math.max(0,jlo)),maximum=smoothBed?ceiling(positive(jhi)):Math.min(incisionLimit,Math.max(0,jhi));
     if(smoothBed&&!boundedUnion){minPower+=(minimum/incisionLimit)**16;maxPower+=(maximum/incisionLimit)**16;}
     else if(boundedUnion){minUnion=smoothIncisionUnion(minUnion,minimum);maxUnion=smoothIncisionUnion(maxUnion,maximum);}
     else{minUnion=Math.max(minUnion,minimum);maxUnion=Math.max(maxUnion,maximum);}
   }
   if(smoothBed){minUnion=ceiling(boundedUnion?minUnion:incisionLimit*minPower**(1/16));maxUnion=ceiling(boundedUnion?maxUnion:incisionLimit*maxPower**(1/16));}
   return[Math.max(low-incisionLimit,low-maxUnion-rounding),Math.min(upperRoof,high-minUnion+rounding)];
 };

 return sample;
}

// Unlike a relative p-norm, the extra excavation is bounded in metres, not a
// fraction of a potentially deep valley. At zero, quadratic capsule vanishing
// supplies C1 regularity. The blend width smoothly vanishes with both inputs.
export { smoothIncisionUnion } from './incision-kernel.mjs';
