import {validatePopulationZone} from './population-zones.mjs';
export const SETTLEMENT_RUNTIME_VERSION='settlement-runtime@29';
import {isWaterLedSiting,surveySettlementWaterAccess} from './settlement-water-access.mjs';
import {createHash} from './sha256.mjs';
import {sphereBasis,offsetGeographic,greatCircle} from './spherical.mjs';
import {validateSettlementSizePolicy,settlementSlotPopulation,settlementClassFor} from './settlement-size-model.mjs';
export const SETTLEMENT_CATALOGUE_METHOD='population-sited-settlements@3';
/** Regional, bounded allocation. Every slot has a stable ID independent of LOD,
 * page visitation, rejection of other slots, or the number of detailed meshes.
 * Rejected slots remain explicitly unplaced, never silently moved to another region. */
export function sitePopulationRegion(base,population,cellIndex,options={}){
 const {anchors=[],maxSites=2048,maxCandidateSurveys=8,waterIndex=null,zone=null,sizePolicy=null,candidates=null}=options;
 // A saved L2 handoff page can be surveyed through this same regional siting
 // path. Candidate origins, ids and populations are taken from the page, so no
 // slot consumes another slot's randomness and no site is relocated.
 if(Array.isArray(candidates))return siteCandidateOrigins(base,population,candidates,{anchors,waterIndex});
 if(!Number.isSafeInteger(maxCandidateSurveys)||maxCandidateSurveys<1||maxCandidateSurveys>16)throw new RangeError('Invalid site candidate survey budget');
 if(waterIndex&&!isWaterLedSiting(waterIndex.method))throw new TypeError('Unknown water siting policy');
 const policy=sizePolicy?validateSettlementSizePolicy(sizePolicy):(zone?.sizePolicy?validateSettlementSizePolicy(zone.sizePolicy):(population?.sizePolicy?validateSettlementSizePolicy(population.sizePolicy):null));
 const waterStats=waterIndex?{proposed:0,accepted:0,rejected:0,approachSamples:0,maxRelocationM:20000,maxCandidateSurveys:4}:null;
 const {columns:w,rows:h}=population.grid,c=zone?{...population.cells[cellIndex],...zone,cellIndex}:population.cells[cellIndex];
 if(zone)validatePopulationZone(zone);
 if(zone&&(zone.rootCell!==cellIndex||!zone.bounds||typeof zone.id!=='string'))throw new RangeError('Invalid population zone');
 if(!c||c.cellIndex!==cellIndex||!Number.isSafeInteger(maxSites)||maxSites<1||maxSites>4096)throw new RangeError('Invalid regional siting budget');
 if(population.sourceWorldId!==base.worldId)throw new Error('Population geography mismatch');
 const total=c.villages+c.towns+c.cities,row=Math.floor(cellIndex/w),col=cellIndex%w,radius=base.frame.radiusM;
 const north=zone?.bounds.north??(90-row*180/h),south=zone?.bounds.south??(north-180/h),west=zone?.bounds.west??(col*360/w),lonSpan=zone?zone.bounds.east-west:360/w;
 const middle=(north+south)/2,aspect=Math.max(.05,(zone?lonSpan/(north-south):2*h/w)*Math.cos(middle*Math.PI/180));
 // Reserve enough room around every slot for a village survey and avoid
 // intersections across regional borders. Urban footprints are not assumed here.
 const acrossM=(zone?lonSpan*Math.PI/180*radius:2*Math.PI*radius/w)*Math.cos(middle*Math.PI/180),downM=zone?(north-south)*Math.PI/180*radius:Math.PI*radius/h;
 const budget=Math.min(total,maxSites,Math.max(0,Math.floor(acrossM/1200)*Math.floor(downM/1200)));
 const nx=Math.max(1,Math.ceil(Math.sqrt(Math.max(1,total)*aspect))),ny=Math.max(1,Math.ceil(total/nx));
 let rng=parseInt(createHash('sha256').update(`${base.worldId}/${SETTLEMENT_CATALOGUE_METHOD}/${zone?.id??cellIndex}`).digest('hex').slice(0,8),16)>>>0;
 const random=()=>{rng=(Math.imul(rng,1664525)+1013904223)>>>0;return rng/4294967296;};
 const result=[],rejected={wet:0,slope:0,anchor:0,budget:Math.max(0,total-budget)},populations={placed:0,unplaced:0};
 let candidateSurveys=0,relocatedSites=0;
 const sinN=Math.sin(north*Math.PI/180),sinS=Math.sin(south*Math.PI/180);
 for(let slot=0;slot<budget;slot++){
  const kind=slot<c.cities?'city':slot<c.cities+c.towns?'town':'village';
  const start=kind==='city'?0:kind==='town'?c.cities:c.cities+c.towns,number=kind==='city'?c.cities:kind==='town'?c.towns:c.villages;
  const people=kind==='city'?c.cityPopulation:kind==='town'?c.townPopulation:c.ruralPopulation;
  const count=policy?settlementSlotPopulation(policy,kind,people,number,slot-start,`${base.worldId}/${SETTLEMENT_CATALOGUE_METHOD}/${zone?.id??cellIndex}`):Math.floor(people/number)+(slot-start<people%number?1:0);
  // Jitter stays in the middle half of its own stratum. Equal-area latitude.
  const u=((slot%nx)+.25+.5*random())/nx,v=(Math.floor(slot/nx)+.25+.5*random())/ny;
  const origin={latDeg:Math.asin(sinN+(sinS-sinN)*v)*180/Math.PI,lonDeg:((west+u*lonSpan+180)%360)-180};
  // A rejected first point is not proof that the surrounding land is unusable.
  // Search only a bounded neighbourhood inside the same fixed slot. Survey
  // decisions do not consume the random sequence used by subsequent slots.
  const searchRadiusM=Math.min(1200,.2*Math.min(acrossM/nx,downM/ny)),phase=(slot*2.399963229728653)% (Math.PI*2);
  const inside=candidate=>{const uu=(((candidate.lonDeg-west)%360+360)%360)/lonSpan,vv=(Math.sin(candidate.latDeg*Math.PI/180)-sinN)/(sinS-sinN);return uu>=(slot%nx)/nx&&uu<=((slot%nx)+1)/nx&&vv>=Math.floor(slot/nx)/ny&&vv<=(Math.floor(slot/nx)+1)/ny;};
  const inset={village:350,town:600,city:1500}[kind];
  const waterCandidates=waterIndex?waterIndex.forCell(cellIndex,kind).filter(candidate=>inside(candidate)&&[[inset,0],[-inset,0],[0,inset],[0,-inset]].every(([x,y])=>inside(offsetGeographic(candidate,x,y,radius)))).map(candidate=>({candidate,distance:greatCircle(origin,candidate,radius).distanceM})).filter(p=>p.distance<=waterStats.maxRelocationM).sort((a,b)=>a.distance-b.distance||(a.candidate.id<b.candidate.id?-1:1)).slice(0,Math.min(4,Math.floor(maxCandidateSurveys/2))).map(p=>p.candidate):[];
  if(waterStats)waterStats.proposed+=waterCandidates.length;
  let p=null,sample=null,reason=null,chosenAttempt=0,chosenGrade=0,waterAccess=null;
  for(let attempt=0;attempt<maxCandidateSurveys+waterCandidates.length;attempt++){
   const waterCandidate=waterCandidates[attempt],fallbackAttempt=attempt-waterCandidates.length,
     r=fallbackAttempt>0?searchRadiusM*Math.sqrt(fallbackAttempt/(maxCandidateSurveys-1)):0,angle=phase+fallbackAttempt*2.399963229728653,
     candidate=waterCandidate??(fallbackAttempt>0?offsetGeographic(origin,Math.cos(angle)*r,Math.sin(angle)*r,radius):origin);
   const uu=(((candidate.lonDeg-west)%360+360)%360)/lonSpan,vv=(Math.sin(candidate.latDeg*Math.PI/180)-sinN)/(sinS-sinN);
   if(uu<(slot%nx)/nx||uu>((slot%nx)+1)/nx||vv<Math.floor(slot/nx)/ny||vv>(Math.floor(slot/nx)+1)/ny)continue;
   candidateSurveys++;const q=base.sampleSurfaceAt(candidate.latDeg,candidate.lonDeg);let failed=null,grade=0;
   if(q.waterDepthM>0||q.groundElevationM<=(q.waterLevelElevationM??-Infinity)+2)failed='wet';
   else if(anchors.some(a=>greatCircle(a,candidate,radius).distanceM<3000))failed='anchor';
   else{const east=offsetGeographic(candidate,30,0,radius),northP=offsetGeographic(candidate,0,30,radius);
    grade=Math.hypot((base.groundElevationAt(east.latDeg,east.lonDeg)-q.groundElevationM)/30,(base.groundElevationAt(northP.latDeg,northP.lonDeg)-q.groundElevationM)/30);if(grade>.06)failed='slope';}
   if(!failed&&waterCandidate){const access=surveySettlementWaterAccess(base,waterCandidate);waterStats.approachSamples+=access.samples;if(access.status==='sampled-river-approach')waterAccess=access;else failed='slope';}
   if(waterCandidate&&failed)waterStats.rejected++;
   if(!failed){p={latDeg:candidate.latDeg,lonDeg:candidate.lonDeg};sample=q;chosenAttempt=attempt;chosenGrade=grade;if(waterCandidate)waterStats.accepted++;break;}
   reason??=failed;
  }
  if(!p){rejected[reason??'slope']++;populations.unplaced+=count;continue;}
  if(chosenAttempt||waterAccess)relocatedSites++;
  const id=zone?`${zone.id}/site:${slot}`:`pop:${cellIndex}:${slot}`;
  result.push({id,name:`${kind==='city'?'都市':kind==='town'?'町':'村'} ${cellIndex}-${slot}`,cellIndex,slot,kind,population:count,...(policy?{settlementClass:settlementClassFor(kind,count)}:{}),...p,elevationM:sample.groundElevationM,siting:{candidateIndex:chosenAttempt,gradeMPerM:chosenGrade,...(waterIndex?{waterAccess:waterAccess??{status:'not-established'}}:{})},status:'sited-needs-local-layout'});populations.placed+=count;
 }
 populations.unplaced=c.population-populations.placed;
 return{cellIndex,...(zone?{zoneId:zone.id,bounds:zone.bounds}:{}),sites:result,requested:total,rejected,populations,survey:{method:waterIndex?waterIndex.method:SETTLEMENT_CATALOGUE_METHOD,...(waterStats?{water:waterStats}:{}),maxCandidateSurveys,candidateSurveys,relocatedSites,maxSearchRadiusM:1200}};
}
/** Survey a saved candidate page at its own fixed origins. This is the L2 hook
 * into the existing terrain, water and slope survey: each candidate keeps the
 * page's id, population and origin, a rejected candidate stays explicitly
 * unplaced, and nothing is moved to another region. No house, road or field is
 * generated. */
function siteCandidateOrigins(base,population,candidates,{anchors=[],waterIndex=null}={}){
 if(!Array.isArray(candidates))throw new RangeError('L2 survey candidates required');
 if(!base||typeof base.sampleSurfaceAt!=='function'||typeof base.groundElevationAt!=='function')throw new TypeError('Surface sampling base required');
 if(population?.sourceWorldId!==base.worldId)throw new Error('Population geography mismatch');
 if(waterIndex&&!isWaterLedSiting(waterIndex.method))throw new TypeError('Unknown water siting policy');
 const radius=base.frame?.radiusM;
 if(!Number.isFinite(radius)||radius<=0)throw new RangeError('Survey sphere radius required');
 const sites=[],rejections=[],rejected={wet:0,slope:0,anchor:0,invalid:0},populations={placed:0,unplaced:0};
 let candidateSurveys=0,relocatedSites=0;
 for(const candidate of candidates){
  if(!candidate||typeof candidate.id!=='string'||!candidate.id)throw new RangeError('Invalid L2 survey candidate identity');
  if(candidate.kind!=='city'&&candidate.kind!=='town'&&candidate.kind!=='village')throw new RangeError('Invalid L2 survey candidate kind');
  if(!Number.isSafeInteger(candidate.population)||candidate.population<0)throw new RangeError('Invalid L2 survey candidate population');
  if(!Number.isFinite(candidate.latDeg)||!Number.isFinite(candidate.lonDeg))throw new RangeError('Invalid L2 survey candidate origin');
  const {id,kind,population:count,latDeg,lonDeg}=candidate,origin={latDeg,lonDeg};
  candidateSurveys++;
  const q=base.sampleSurfaceAt(latDeg,lonDeg);let failed=null,grade=0;
  const waterDepth=q?.waterDepthM;
  // A non-finite or negative surface value is withheld as invalid; it is never
  // silently adopted as a valid site.
  if(!q||!Number.isFinite(q.groundElevationM)||(waterDepth!==undefined&&(!Number.isFinite(waterDepth)||waterDepth<0)))failed='invalid-surface';
  else if(q.sitingWet===true||waterDepth>0||q.groundElevationM<=(q.waterLevelElevationM??-Infinity)+2)failed='wet';
  else if(anchors.some(a=>greatCircle(a,origin,radius).distanceM<3000))failed='anchor';
  else{const east=offsetGeographic(origin,30,0,radius),northP=offsetGeographic(origin,0,30,radius);
   const eastZ=base.groundElevationAt(east.latDeg,east.lonDeg),northZ=base.groundElevationAt(northP.latDeg,northP.lonDeg);
   if(!Number.isFinite(eastZ)||!Number.isFinite(northZ))failed='invalid-surface';
   else{grade=Math.hypot((eastZ-q.groundElevationM)/30,(northZ-q.groundElevationM)/30);if(!Number.isFinite(grade))failed='invalid-surface';else if(grade>.06)failed='slope';}}
  let waterAccess=null;
  if(!failed&&waterIndex){
   const list=waterIndex.forCell(candidate.cellIndex??0,kind)??[];let best=null;
   for(const proposal of list){const distance=greatCircle(origin,proposal,radius).distanceM;if(distance<=2000&&(!best||distance<best.distance))best={proposal,distance};}
   if(best){const access=surveySettlementWaterAccess(base,best.proposal);if(access.status==='sampled-river-approach')waterAccess=access;}
  }
  if(failed){rejected[failed==='invalid-surface'?'invalid':failed]++;rejections.push({id,reason:failed});populations.unplaced+=count;continue;}
  if(waterAccess)relocatedSites++;
  sites.push({id,cellIndex:candidate.cellIndex,slot:candidate.slot,kind,settlementClass:candidate.settlementClass,population:count,latDeg,lonDeg,origin:{...origin},elevationM:q.groundElevationM,siting:{gradeMPerM:grade,...(waterIndex?{waterAccess:waterAccess??{status:'not-established'}}:{})},status:'sited-needs-local-layout'});
  populations.placed+=count;
 }
 return {sites,rejections,rejected,populations,survey:{method:waterIndex?waterIndex.method:SETTLEMENT_CATALOGUE_METHOD,candidateSurveys,relocatedSites,scope:'Page candidates are surveyed at their saved origins; rejected candidates stay unresolved at their own origin and are never moved to another region'}};
}
export function catalogueRegionBound(grid,cellIndex){const {columns:w,rows:h}=grid,row=Math.floor(cellIndex/w),col=cellIndex%w;return{center:sphereBasis({latDeg:90-(row+.5)*180/h,lonDeg:(col+.5)*360/w}).up,angularRadius:Math.PI/h/2+Math.PI/w};}
export function intersectsCatalogueRegion(region,bound,padding=0){return Math.acos(Math.max(-1,Math.min(1,region.center.reduce((s,v,i)=>s+v*bound.center[i],0))))<=region.angularRadius+bound.angular+padding;}
