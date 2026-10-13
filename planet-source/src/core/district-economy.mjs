import {serviceFrontageCenters,servicePlotClear,servicePlotGeometry,serviceAccessClear} from './service-frontage.mjs';
import {planSettlement} from './settlement-plan.mjs';
/** Service plots are additional land, never conversions of allocated homes.
 * Regional production is an explicit scenario; no ore, water rights, potable
 * wells or imported goods are supplied merely to make a workshop feasible. */
export function planDistrictEconomy({site,settlement,ground,water,roads,occupied=()=>false,excludedTypes=[],parcelCenters=null}){
 const context=settlement.economicContext??{},parcels=[],zoned=context.institutionPolicy==='medieval-communal@1',districtIndex=site.districtIndex??0;
 const strictUrban=context.urbanFacilityPolicy==='surveyed-urban-service-parcels@1';
 const frontage=context.facilityPolicy==='frontage-service-parcels@2'&&(!parcelCenters||strictUrban);
 const institutionTags=zoned?['local_governance','religious_community',...(settlement.population>=1000?['market_right']:[]),...(settlement.population>=5000?['literate_institution']:[])]:[];
 for(const [xM,yM] of (parcelCenters??(frontage?serviceFrontageCenters(roads):[-180,-90,90,180].flatMap(x=>[-193,193].map(y=>[x,y]))))){
  if(frontage){if(!servicePlotClear(xM,yM,{roads,ground,water,occupied,strictSurvey:strictUrban}))continue;const g=servicePlotGeometry({id:'survey',type:'warehouse',xM,yM},roads,ground);let prior=null,valid=!strictUrban||serviceAccessClear(g.accessRoad,{ground,water,occupied});for(const p of g.accessRoad.samples){if(water(p.xM,p.yM).waterDepthM>0||occupied(p.xM,p.yM)||prior&&Math.abs(p.roadElevationM-prior.roadElevationM)/Math.max(.01,p.distanceM-prior.distanceM)>.18)valid=false;prior=p;}if(!valid)continue;}
  const levels=[[-9,-9],[9,-9],[9,9],[-9,9]].map(([dx,dy])=>ground(xM+dx,yM+dy));
  if([[-9,-9],[9,-9],[9,9],[-9,9]].some(([dx,dy])=>water(xM+dx,yM+dy).waterDepthM>0||occupied(xM+dx,yM+dy)))continue;
  const roadDistanceM=Math.min(...roads.flatMap(r=>r.samples.map(p=>Math.hypot(p.xM-xM,p.yM-yM))));
  if(!Number.isFinite(roadDistanceM)||roadDistanceM<15)continue;
  parcels.push({id:`service:${xM}:${yM}`,xM,yM,kind:'building',areaM2:324,radiusM:13,slope:(Math.max(...levels)-Math.min(...levels))/18,floodRisk:0,roadDistanceM,sunAccess:.5,roadBearingDeg:yM>0?0:180,tags:institutionTags,padElevationM:Math.max(...levels)+.1,provenance:'four-corner dry/grade survey; flood probability and daylight not simulated'});
 }
 const supplies=[];
 if(context.agricultureSuitability>0&&context.grainKgPerPersonYear>0)supplies.push({id:`${settlement.id}/agricultural-hinterland`,xM:0,yM:0,goods:['grain'],provenance:`regional cereal production scenario ${context.populationId}; not current inventory`});
 if(context.woodland)supplies.push({id:`${settlement.id}/woodland`,xM:0,yM:0,goods:['timber','firewood'],provenance:`regional biome ${context.biome}; accessible woodland supply assumed by ${context.method}`});
 const types=zoned?districtFacilityRequests(districtIndex,settlement.population):['handmill','granary','carpenter','warehouse','smith','weaver','bakery'];
 const economy=planSettlement({id:site.id,population:settlement.population,parcels,supplies,requests:types.filter(type=>!excludedTypes.includes(type)).map(type=>({id:type,type})),maxPlacements:zoned?8:4,maxTransportM:1500});
 const geometry=frontage?economy.placements.map(p=>servicePlotGeometry(p,roads,ground)):[];
 const buildings=frontage?geometry.map(g=>g.building):economy.placements.map(p=>{const parcel=parcels.find(q=>q.id===p.parcelId);return{id:p.id,facilityType:p.type,sector:p.sector,bounds:{minXM:p.xM-9,maxXM:p.xM+9,minYM:p.yM-9,maxYM:p.yM+9},baseElevationM:parcel.padElevationM,heightM:4,roofHeightM:2,wallColor:[.64,.60,.46],roofColor:p.sector===2?[.37,.29,.23]:[.40,.25,.16]};});
 return{...economy,buildings,workyards:geometry.map(g=>g.yard),parcelReservations:geometry.map(g=>g.reservation),accessRoads:geometry.map(g=>g.accessRoad),districtRole:zoned?(districtIndex===0?'civic-market':districtIndex%8===1?'crafts':'residential'):'mixed-service',institutionPolicy:context.institutionPolicy??'none',assumptions:[...(zoned?['Generated medieval-communal institutional scenario, not inferred from terrain']:[]),'Static production dependencies, not production quantities','Dry today is not a flood return-period estimate','Service daylight is a neutral unmodeled score'],sourceContext:context,coordinateFrame:'district-local-meters'};
}

/** Stable district function, without rebuilding other quarters on population growth.
 * Workshops remain subject to their resource and safety prerequisites. */
export function districtFacilityRequests(index,population){
 if(index===0)return population>=1000?['hall','market','chapel','school','granary','warehouse','handmill','carpenter']:['hall','chapel','granary','handmill','carpenter'];
 if(index%8===1)return['carpenter','smith','weaver','tailor','potter','bakery','brewery'];
 if(index%16===0)return['warehouse','granary'];
 if(index%4===0)return['handmill','granary'];
 return[];
}
