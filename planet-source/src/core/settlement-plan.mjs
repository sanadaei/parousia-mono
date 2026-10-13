import {facilityById} from './settlement-facilities.mjs';
const distance=(a,b)=>Math.hypot(a.xM-b.xM,a.yM-b.yM);
const radius=p=>p.radiusM??Math.sqrt(p.areaM2/2);
const sorted=a=>[...a].sort((a,b)=>a.id<b.id?-1:a.id>b.id?1:0);
/** Survey -> saved placements. No camera, runtime clock, Math.random or LOD input.
 * Each candidate is an already surveyed, non-overlapping usable land parcel.
 * Inputs supplied from outside require named, located provenance, not free goods.
 */
export function planSettlement({id,population,parcels,requests,supplies=[],maxPlacements=128,maxBuildingPlacements=maxPlacements,maxTransportM=1500,designSunAzimuthDeg=180,transportDistance=distance}){
 if(typeof transportDistance!=='function'||typeof id!=='string'||!id||!Number.isFinite(population)||population<0||!Array.isArray(parcels)||parcels.length>512||!Array.isArray(supplies)||supplies.length>512||!Array.isArray(requests)||requests.length>128||!Number.isInteger(maxPlacements)||maxPlacements<0||maxPlacements>128||!Number.isInteger(maxBuildingPlacements)||maxBuildingPlacements<0||maxBuildingPlacements>128||!Number.isFinite(maxTransportM)||maxTransportM<=0||!Number.isFinite(designSunAzimuthDeg))throw new RangeError('Invalid settlement planning budget');
 const ids=new Set();
 for(const p of parcels){if(!p.id||ids.has(p.id)||![p.xM,p.yM,p.areaM2,p.slope,p.floodRisk,p.roadDistanceM,p.sunAccess,p.roadBearingDeg].every(Number.isFinite)||p.areaM2<=0||p.slope<0||p.roadDistanceM<0||p.sunAccess<0||p.sunAccess>1||p.floodRisk<0||p.floodRisk>1||!Array.isArray(p.tags)||(p.radiusM!==undefined&&(!Number.isFinite(p.radiusM)||p.radiusM<=0)))throw new TypeError('Invalid surveyed parcel');ids.add(p.id);}
 for(const s of supplies)if(!s.id||!s.provenance||!Array.isArray(s.goods)||![s.xM,s.yM].every(Number.isFinite))throw new TypeError('Located supply provenance required');
 const requestIds=new Set();for(const r of requests){if(!r.id||requestIds.has(r.id)||!facilityById(r.type))throw new TypeError('Unknown or duplicate facility request');requestIds.add(r.id);}
 const checks=new Map(requests.map(r=>[r.id,{}]));
 const placements=[],rejected=[],used=new Set(),remaining=sorted(requests),sources=supplies.map(s=>({...s}));let evaluated=0;
 // Fixed-point passes allow input order independence and dependencies; cycles
 // without an external source remain unresolved rather than inventing output.
 for(let pass=0;pass<requests.length&&remaining.length&&placements.length<maxPlacements;pass++){
  let progress=false;
  for(let ri=0;ri<remaining.length&&placements.length<maxPlacements;){const request=remaining[ri],spec=facilityById(request.type),options=[];
   if(spec.siteKind==='building'&&placements.filter(p=>p.siteKind==='building').length>=maxBuildingPlacements){ri++;continue;}
   const fail=key=>{const c=checks.get(request.id);c[key]=(c[key]??0)+1;};
   for(const p of sorted(parcels)){evaluated++;
    const reason=used.has(p.id)?'occupied':p.kind&&p.kind!==spec.siteKind?'wrong-parcel-kind':population<spec.minPopulation?'population':p.areaM2<spec.minAreaM2?'area':p.slope>spec.maxSlope?'slope':p.floodRisk>(spec.maxFloodRisk??.15)?'flood':p.roadDistanceM>spec.maxRoadDistanceM?'road-access':spec.requires.some(tag=>!p.tags.includes(tag))?'resource-or-institution':null;
    if(reason){fail(reason);continue;}
    // Distance is conservative parcel-edge clearance, symmetric regardless of order.
    if(placements.some(q=>distance(p,q)<radius(p)+q.radiusM+Math.max(spec.hazardRadiusM??0,q.hazardRadiusM))){fail('overlap-or-safety-distance');continue;}
    // Dirty water requires explicit audited disposal and hydraulic separation.
    if(spec.polluting&&!p.tags.includes('safe_disposal')){fail('safe-disposal');continue;}
    if(spec.protectedWater&&!p.tags.includes('protected_catchment')){fail('protected-catchment');continue;}
    const links=spec.inputs.map(good=>{const s=sources.filter(s=>s.goods.includes(good)&&transportDistance(p,s)<=maxTransportM).sort((a,b)=>transportDistance(p,a)-transportDistance(p,b)||(a.id<b.id?-1:1))[0];return s?{good,sourceId:s.id,distanceM:transportDistance(p,s),provenance:s.provenance}:null;});if(links.some(x=>!x)){fail('supply-or-transport');continue;}
    const transportM=links.reduce((n,l)=>n+l.distanceM,0),score=p.roadDistanceM+transportM*.1+Math.hypot(p.xM,p.yM)*(spec.centralWeight??.05)+p.slope*100-p.sunAccess*(spec.sunWeight??0);
    options.push({p,links,score});
   }
   options.sort((a,b)=>a.score-b.score||(a.p.id<b.p.id?-1:1));const best=options[0];if(!best){ri++;continue;}
   const {p,links,score}=best,placed={id:`${id}/${request.id}`,type:spec.id,label:spec.label,sector:spec.sector,parcelId:p.id,siteKind:spec.siteKind,access:p.access??null,xM:p.xM,yM:p.yM,radiusM:radius(p),hazardRadiusM:spec.hazardRadiusM??0,entranceBearingDeg:(p.roadBearingDeg%360+360)%360,daylightFacadeBearingDeg:(designSunAzimuthDeg%360+360)%360,links,score,reasons:{requiredTags:spec.requires,roadDistanceM:p.roadDistanceM,slope:p.slope,floodRisk:p.floodRisk,sunAccess:p.sunAccess,surveyProvenance:p.provenance??'caller-survey'}};
   placements.push(placed);used.add(p.id);sources.push({id:placed.id,xM:p.xM,yM:p.yM,goods:spec.outputs,access:p.access??null,provenance:'planned-production-not-current-stock'});remaining.splice(ri,1);progress=true;
  }if(!progress)break;
 }
 for(const r of remaining){const s=facilityById(r.type);rejected.push({requestId:r.id,type:r.type,reason:placements.length>=maxPlacements?'placement-budget':population<s.minPopulation?'population-too-small':'no-feasible-parcel-or-supply',candidateRejectionChecks:checks.get(r.id),requiredTags:s.requires,missingGoods:s.inputs.filter(g=>!sources.some(x=>x.goods.includes(g)))});}
 return {schema:'settlement-plan@1',id,population,placements,rejected,diagnostics:{evaluatedCandidates:evaluated,parcelCount:parcels.length,maxPlacements,maxBuildingPlacements,maxTransportM,scope:'static feasible layout; optional saved-road routing; no production capacity, historical growth or regional trade simulation'}};
}
