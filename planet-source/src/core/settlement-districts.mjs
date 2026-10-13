import {validateVillagePortals,VILLAGE_PORTAL_POLICY} from './village-portals.mjs';
import {offsetGeographic} from './spherical.mjs';
export const DISTRICT_LAYOUT_METHOD='population-districts@1';
export const DISTRICT_HOUSEHOLDS=96;
/** Complete household allocation; geometry stays demand-built per district.
 * Square rings put central districts first without moving them as a city grows. */
function spiral(index){if(index===0)return[0,0];const ring=Math.ceil((Math.sqrt(index+1)-1)/2),side=ring*2,max=(2*ring+1)**2-1,d=max-index;if(d<side)return[ring-d,-ring];if(d<2*side)return[-ring,-ring+(d-side)];if(d<3*side)return[-ring+(d-2*side),ring];return[ring,ring-(d-3*side)];}
export function planSettlementDistricts(site,radiusM){
 if(typeof site.id!=='string'||!Number.isSafeInteger(site.population)||site.population<0||site.population>10000000||![site.latDeg,site.lonDeg,radiusM].every(Number.isFinite)||radiusM<=0)throw new RangeError('Invalid district planning inputs');
 const compact=site.economicContext?.layoutPolicy==='terrain-led-neighborhood@2'&&(site.kind==='city'||site.kind==='town'),widthM=compact?240:400,heightM=compact?240:460;
 const households=Math.ceil(site.population/5),count=Math.ceil(households/DISTRICT_HOUSEHOLDS);
 // A compact iterable contract, not 20,834 meshes when a metropolis is requested.
 const district=index=>{if(!Number.isSafeInteger(index)||index<0||index>=count)throw new RangeError('District index outside plan');const [column,row]=spiral(index),firstHousehold=index*DISTRICT_HOUSEHOLDS,requestedDwellings=Math.min(DISTRICT_HOUSEHOLDS,households-firstHousehold),population=Math.min(requestedDwellings*5,Math.max(0,site.population-firstHousehold*5)),p=offsetGeographic(site,column*widthM,row*heightM,radiusM);return{...site,...p,id:`${site.id}/district:${index}`,settlementId:site.id,districtIndex:index,districtCount:count,firstHousehold,requestedDwellings,population,column,row,offsetEastM:column*widthM,offsetNorthM:row*heightM,widthM,heightM};};
 return{method:DISTRICT_LAYOUT_METHOD,settlementId:site.id,population:site.population,households,count,householdSize:5,district,widthM,heightM,extentM:compact?Math.ceil(Math.sqrt(count))*170+240:Math.ceil(Math.sqrt(count))*310+400};
}

/** A public street gate on the outer occupied row/column. Inter-village roads
 * start here rather than cutting diagonally through residential lots. */
export function settlementStreetGate(site,toward,radiusM){
 if(!Number.isSafeInteger(site.population)||!site.population)return{latDeg:site.latDeg,lonDeg:site.lonDeg};
 const plan=planSettlementDistricts(site,radiusM),projection=createSphericalProjection({centerLatDeg:site.latDeg,centerLonDeg:site.lonDeg,radiusM,maxRadiusM:radiusM*.1}),p=projection.toLocalIfWithin(toward.latDeg,toward.lonDeg);
 if(!p)return{latDeg:site.latDeg,lonDeg:site.lonDeg};
 if(plan.count===1&&site.economicContext?.villagePortalPolicy===VILLAGE_PORTAL_POLICY){const portals=validateVillagePortals(site.economicContext.streetPortals),chosen=[...portals].sort((a,b)=>(b.xM*p.xM+b.yM*p.yM)/Math.hypot(b.xM,b.yM)-(a.xM*p.xM+a.yM*p.yM)/Math.hypot(a.xM,a.yM)||a.name.localeCompare(b.name))[0];return projection.toGeographic(chosen.xM,chosen.yM);}
 const axis=Math.abs(p.xM)>=Math.abs(p.yM)?'x':'y',sign=Math.sign(axis==='x'?p.xM:p.yM)||1;let edge=0;
 for(let i=0;i<plan.count;i++){const d=plan.district(i);if(axis==='x'&&d.row===0)edge=Math.max(edge,sign*d.column*plan.widthM);if(axis==='y'&&d.column===0)edge=Math.max(edge,sign*d.row*plan.heightM);}
 return projection.toGeographic(axis==='x'?sign*(edge+plan.widthM/2):0,axis==='y'?sign*(edge+plan.heightM/2):0);
}
import {createSphericalProjection} from './spherical.mjs';
