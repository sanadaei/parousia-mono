import {greatCircle,offsetGeographic} from './spherical.mjs';
export const WATER_LED_SITING='river-access-siting@1';
export const BALANCED_WATER_LED_SITING='river-access-siting@2';
export const isWaterLedSiting=method=>method===WATER_LED_SITING||method===BALANCED_WATER_LED_SITING;
const setbacks={village:180,town:350,city:800};
/** Saved river geometry proposes locations, never creates water. One bounded
 * index is shared by packaging, not rebuilt per village or camera visit.
 * Springs, wells, lakes and drinking-water quality are not inferred here. */
export function createSettlementWaterIndex(network,grid,radiusM,{maxCandidates=32768,spacingM=500,method=WATER_LED_SITING}={}){
 if(!Number.isSafeInteger(maxCandidates)||maxCandidates<0||maxCandidates>65536||!Number.isFinite(spacingM)||spacingM<100||!Number.isFinite(radiusM)||radiusM<=0||!Number.isSafeInteger(grid.columns)||!Number.isSafeInteger(grid.rows)||grid.columns<1||grid.rows<1)throw new RangeError('Invalid water siting index budget');
 if(!isWaterLedSiting(method))throw new RangeError('Unknown water siting policy');
 if(method===BALANCED_WATER_LED_SITING)return createBalancedWaterIndex(network,grid,radiusM,{maxCandidates,spacingM});
 const cells=new Map();let candidates=0,withheld=0,stations=0;
 const cellAt=p=>Math.min(grid.rows-1,Math.floor((90-p.latDeg)/180*grid.rows))*grid.columns+Math.floor(((p.lonDeg%360+360)%360)/360*grid.columns);
 for(const profile of [...(network?.profiles??[])].sort((a,b)=>a.id<b.id?-1:a.id>b.id?1:0)){
  let distance=Infinity;
  for(let i=0;i<profile.points.length;i++){
   const p=profile.points[i];if(i)distance+=greatCircle(profile.points[i-1],p,radiusM).distanceM;
   if(distance<spacingM&&i!==profile.points.length-1)continue;distance=0;stations++;
   const a=profile.points[Math.max(0,i-1)],b=profile.points[Math.min(profile.points.length-1,i+1)],bearing=greatCircle(a,b,radiusM).bearingDeg;
   if(bearing==null)continue;
   const angle=(bearing+90)*Math.PI/180;
   for(const [kind,setback] of Object.entries(setbacks))for(const side of [-1,1]){
    if(candidates>=maxCandidates){withheld++;continue;}
    const shift=d=>offsetGeographic(p,side*Math.sin(angle)*d,side*Math.cos(angle)*d,radiusM),site=shift(p.halfWidthM+p.bankWidthM+setback),waterPoint=shift(p.halfWidthM*.8),cell=cellAt(site);
    const item={id:`${profile.id}/station:${i}/${kind}/${side}`,sourceId:profile.id,kind,...site,waterPoint};
    const list=cells.get(cell)??[];list.push(item);cells.set(cell,list);candidates++;
   }
  }
 }
 return{method:WATER_LED_SITING,diagnostics:{stations,candidates,withheld,maxCandidates,spacingM},forCell(cellIndex,kind){return(cells.get(cellIndex)??[]).filter(p=>p.kind===kind);}};
}
/** Finite approach survey, not a flood guarantee or engineered road. Wet or
 * steep intermediate ground rejects the proposal; the final wet point must
 * belong to the proposed saved river, not an unrelated sea/lake. */
export function surveySettlementWaterAccess(base,candidate,{maxSamples=80,maxGrade=.25}={}){
 if(!Number.isSafeInteger(maxSamples)||maxSamples<2||maxSamples>128||!Number.isFinite(maxGrade)||maxGrade<=0||maxGrade>1)throw new RangeError('Invalid water access survey budget');
 const radius=base.frame.radiusM,route=greatCircle(candidate,candidate.waterPoint,radius),steps=Math.ceil(route.distanceM/20);
 if(steps<1||steps+1>maxSamples)return{status:'withheld',reason:'approach-budget',samples:0};
 const angle=route.bearingDeg*Math.PI/180,water=base.sampleSurfaceAt(candidate.waterPoint.latDeg,candidate.waterPoint.lonDeg);
 if(!(water.waterDepthM>0)||!water.waterSourceIds?.includes(candidate.sourceId))return{status:'withheld',reason:'water-source-not-confirmed',samples:1};
 const points=[];let previous=null,maxObservedGrade=0,shorePoint=null;
 for(let i=0;i<steps;i++){
  const d=route.distanceM*i/steps,p=offsetGeographic(candidate,Math.sin(angle)*d,Math.cos(angle)*d,radius),s=base.sampleSurfaceAt(p.latDeg,p.lonDeg);
  if(!Number.isFinite(s.groundElevationM)||s.waterDepthM==null||s.waterDepthM>0)return{status:'withheld',reason:'unknown-or-wet-approach',samples:i+2};
  const grade=previous?Math.abs(s.groundElevationM-previous.elevationM)/(route.distanceM/steps):0;
  if(grade>maxGrade)return{status:'withheld',reason:'steep-approach',samples:i+2};
  maxObservedGrade=Math.max(maxObservedGrade,grade);previous={...p,elevationM:s.groundElevationM};points.push(previous);shorePoint=p;
 }
 const lastGrade=Math.abs(water.waterLevelElevationM-previous.elevationM)/(route.distanceM/steps);
 if(!Number.isFinite(lastGrade)||lastGrade>maxGrade)return{status:'withheld',reason:'inaccessible-water-edge',samples:steps+1};
 return{status:'sampled-river-approach',sourceId:candidate.sourceId,waterPoint:candidate.waterPoint,shorePoint,distanceM:route.distanceM,maxObservedGrade:Math.max(maxObservedGrade,lastGrade),samples:steps+1,points,limitations:'20 m finite natural-ground samples; no engineered footpath, flood safety, yield or potability claim'};
}


/** Allocate the fixed candidate budget across geographic cell/kind strata.
 * Two bounded passes retain only the allocated candidates. Within a stratum,
 * stable identity ranks choose distributed stations rather than an ID prefix.
 * The legacy @1 index remains unchanged for saved worlds. */
function createBalancedWaterIndex(network,grid,radiusM,{maxCandidates,spacingM}) {
 if(grid.columns*grid.rows>131072)throw new RangeError('Water index source grid exceeds work budget');
 const profiles=[...(network?.profiles??[])].sort((a,b)=>a.id<b.id?-1:a.id>b.id?1:0);
 if(profiles.reduce((n,p)=>n+p.points.length,0)>131072)throw new RangeError('Water index source points exceed work budget');
 const rank=text=>{let h=2166136261;for(const c of text)h=Math.imul(h^c.charCodeAt(0),16777619);h=Math.imul(h^(h>>>16),0x7feb352d);h=Math.imul(h^(h>>>15),0x846ca68b);return(h^(h>>>16))>>>0;};
 const compare=(a,b)=>a.rank-b.rank||(a.id<b.id?-1:a.id>b.id?1:0);
 const cellAt=p=>Math.min(grid.rows-1,Math.floor((90-p.latDeg)/180*grid.rows))*grid.columns+Math.floor(((p.lonDeg%360+360)%360)/360*grid.columns);
 function visit(accept){let stations=0;
  for(const profile of profiles){let distance=Infinity;
   for(let i=0;i<profile.points.length;i++){
    const p=profile.points[i];if(i)distance+=greatCircle(profile.points[i-1],p,radiusM).distanceM;
    if(distance<spacingM&&i!==profile.points.length-1)continue;distance=0;stations++;
    const a=profile.points[Math.max(0,i-1)],b=profile.points[Math.min(profile.points.length-1,i+1)],bearing=greatCircle(a,b,radiusM).bearingDeg;if(bearing==null)continue;
    const angle=(bearing+90)*Math.PI/180;
    for(const [kind,setback]of Object.entries(setbacks))for(const side of [-1,1]){
     const shift=d=>offsetGeographic(p,side*Math.sin(angle)*d,side*Math.cos(angle)*d,radiusM),site=shift(p.halfWidthM+p.bankWidthM+setback),cell=cellAt(site);
     accept(cell,kind,()=>({id:`${profile.id}/station:${i}/${kind}/${side}`,sourceId:profile.id,kind,...site,waterPoint:shift(p.halfWidthM*.8)}));
    }
   }
  }return stations;
 }
 const counts=new Map();let proposed=0;
 const stations=visit((cell,kind)=>{const id=cell+'/'+kind;counts.set(id,(counts.get(id)??0)+1);proposed++;});
 const strata=[...counts].map(([id,count])=>({id,count,rank:rank('stratum/'+id),quota:0,heap:[]})).sort(compare),byId=new Map(strata.map(s=>[s.id,s]));
 let remaining=Math.min(maxCandidates,proposed),active=strata;
 // Water-fill quotas. Small strata finish early; remaining capacity is shared
 // by the others, so no empty reservation wastes the caller's work budget.
 while(remaining&&active.length){const share=Math.max(1,Math.floor(remaining/active.length));
  for(const s of active){const add=Math.min(share,s.count-s.quota,remaining);s.quota+=add;remaining-=add;if(!remaining)break;}
  active=active.filter(s=>s.quota<s.count);
 }
 const retain=(heap,item,quota)=>{
  if(heap.length<quota){let i=heap.length;heap.push(item);while(i){const parent=(i-1)>>1;if(compare(heap[parent],item)>=0)break;heap[i]=heap[parent];i=parent;}heap[i]=item;return;}
  if(compare(item,heap[0])>=0)return;
  let i=0;while(i*2+1<heap.length){let child=i*2+1;if(child+1<heap.length&&compare(heap[child+1],heap[child])>0)child++;if(compare(item,heap[child])>=0)break;heap[i]=heap[child];i=child;}heap[i]=item;
 };
 if(maxCandidates)visit((cell,kind,make)=>{const s=byId.get(cell+'/'+kind);if(!s.quota)return;const item=make();retain(s.heap,{id:item.id,rank:rank('candidate/'+item.id),item},s.quota);});
 const cells=new Map();let candidates=0;
 for(const s of strata)for(const {item}of s.heap){const cell=Number(s.id.split('/')[0]),list=cells.get(cell)??[];list.push(item);cells.set(cell,list);candidates++;}
 for(const list of cells.values())list.sort((a,b)=>a.id<b.id?-1:a.id>b.id?1:0);
 return{method:BALANCED_WATER_LED_SITING,diagnostics:{stations,candidates,withheld:proposed-candidates,maxCandidates,spacingM,allocation:'cell-kind-stratified-identity-rank@1',eligibleStrata:strata.length,coveredStrata:strata.filter(s=>s.quota>0).length,eligibleCells:new Set(strata.map(s=>s.id.split('/')[0])).size,coveredCells:cells.size,scope:'Balanced finite station proposals; coverage is not water accessibility, supply or potability'},forCell(cellIndex,kind){return(cells.get(cellIndex)??[]).filter(p=>p.kind===kind);}};
}
