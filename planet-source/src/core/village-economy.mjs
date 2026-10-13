import {villageTransportDistance} from './settlement-transport.mjs';
import {surveyVillageLots,surveyVillageLand} from './settlement-survey.mjs';
import {planSettlement} from './settlement-plan.mjs';
/** Explicit generation/edit step; never invoked by the renderer. */
export function planVillageEconomy(recipe,{groundAt,waterAt,profile}){
 if(!profile||!Array.isArray(profile.requests))throw new TypeError('Explicit settlement profile required');
 const householdSize=profile.householdSize??5;if(!Number.isFinite(householdSize)||householdSize<=0||householdSize>20)throw new RangeError('Invalid household size');
 const minimumHomes=Math.ceil(profile.population/householdSize);if(minimumHomes>recipe.buildings.length)throw new RangeError('Population exceeds available housing; add plots explicitly');
 const survey=surveyVillageLots(recipe,{groundAt,waterAt,lotTags:profile.lotTags,designDeclinationDeg:profile.designDeclinationDeg??0});
 const landSurvey=surveyVillageLand(recipe,profile.landParcels??[],{groundAt,waterAt});
 const sources=(profile.supplies??[]).map(source=>{const x=source.xM,y=source.yM,probe={...recipe,buildings:[{id:source.id,bounds:{minXM:x-1,maxXM:x+1,minYM:y-1,maxYM:y+1},baseElevationM:groundAt(x,y),heightM:0,roofHeightM:0}]};const access=surveyVillageLots(probe,{groundAt,waterAt,obstacles:recipe.buildings}).parcels[0]?.access;return {...source,access};});
 const plan=planSettlement({id:recipe.id,population:profile.population,parcels:[...survey.parcels,...landSurvey.parcels],requests:profile.requests,maxPlacements:Math.min(128,Math.max(0,recipe.buildings.length-minimumHomes+landSurvey.parcels.length)),maxBuildingPlacements:Math.min(128,Math.max(0,recipe.buildings.length-minimumHomes)),supplies:sources,transportDistance:villageTransportDistance(recipe),designSunAzimuthDeg:recipe.projection.centerLatDeg<0?0:180});
 // Hazardous uses cannot be inserted among occupied existing homes. The full
 // site planner can plan new neighbourhoods; this adapter is conservative reuse.
 const buildings=recipe.buildings.map(b=>{const p=plan.placements.find(p=>p.parcelId===b.id),parcel=survey.parcels.find(p=>p.id===b.id);return {...b,...(parcel?{orientation:parcel.orientation}:{}),facilityType:p?.type??'house',entranceBearingDeg:parcel?.roadBearingDeg??null,roofAxis:parcel&&Math.abs(Math.cos(parcel.roadBearingDeg*Math.PI/180))>.707?'x':'y',placementId:p?.id??null};});
 const blocked=plan.placements.filter(p=>p.hazardRadiusM>0&&buildings.some(b=>b.id!==p.parcelId&&Math.hypot((b.bounds.minXM+b.bounds.maxXM)/2-p.xM,(b.bounds.minYM+b.bounds.maxYM)/2-p.yM)<p.hazardRadiusM+p.radiusM+Math.hypot(b.bounds.maxXM-b.bounds.minXM,b.bounds.maxYM-b.bounds.minYM)/2));
 if(blocked.length)throw new RangeError('Hazardous conversion conflicts with existing homes; use new surveyed parcels instead');
 return {...recipe,buildings,landUses:plan.placements.filter(p=>p.siteKind==='land').map(p=>({...p,bounds:landSurvey.parcels.find(q=>q.id===p.parcelId).bounds})),settlementPlan:{...plan,surveyRejected:[...survey.rejected,...landSurvey.rejected],housing:{population:profile.population,householdSize,minimumHomes,remainingHomes:buildings.filter(b=>b.facilityType==='house').length},profileId:profile.id??'explicit',profileNotes:profile.notes??[],limitations:['Existing house footprints retained; land parcels come from explicit scenario surveys; no street network is invented',...new Set(survey.parcels.flatMap(p=>p.limitations))]}};
}
