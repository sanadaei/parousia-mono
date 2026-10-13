import {withEarthworkEnvelope,EARTHWORK_ENVELOPE} from './chart-earthwork-envelope.mjs';
import {createUrbanNeighborhood} from './urban-neighborhood.mjs';
import {createTerrainLedNeighborhood,TERRAIN_NEIGHBORHOOD_METHOD} from './terrain-led-neighborhood.mjs';
import {completeResidentialLots} from './terrain-adaptive-housing.mjs';
import {settlementLandBlockers,landReservedAt} from './settlement-land-reservations.mjs';
import {planDistrictEconomy} from './district-economy.mjs';
import {planSettlementDistricts} from './settlement-districts.mjs';
import {createSphericalProjection} from './spherical.mjs';
import {WATER_SCHEMA} from './water-model.mjs';
/** Demand-built residential neighbourhood, shared by collision terrain and mesh.
 * The site and already-built houses are immutable. Opt-in deterministic spare lots can house otherwise unplaced households within the reserved district. This first
 * district has at most 96 households; the plan allocates every household. */
export function createSettlementLayout(base,settlement,{districtIndex=0,nearbySettlements=[]}={}){
 if(settlement.economicContext?.layoutPolicy==='terrain-led-neighborhood@2'&&(settlement.kind==='city'||settlement.kind==='town'))return createUrbanNeighborhood(base,settlement,{districtIndex,nearbySettlements});
 if([TERRAIN_NEIGHBORHOOD_METHOD,'terrain-led-neighborhood@2'].includes(settlement.economicContext?.layoutPolicy)){const recipe=createTerrainLedNeighborhood(base,settlement,{districtIndex,nearbySettlements});return settlement.kind==='village'&&settlement.economicContext?.earthworkEnvelopePolicy===EARTHWORK_ENVELOPE?withEarthworkEnvelope(recipe):recipe;}
 const plan=planSettlementDistricts(settlement,base.frame.radiusM),site=plan.district(districtIndex);
 const radius=base.frame.radiusM,projection=createSphericalProjection({centerLatDeg:settlement.latDeg,centerLonDeg:settlement.lonDeg,radiusM:radius,maxRadiusM:Math.max(2000,plan.extentM*2)});
 const blockers=settlementLandBlockers(settlement,nearbySettlements,radius),occupied=(x,y)=>landReservedAt(projection.toGeographic(x+site.offsetEastM,y+site.offsetNorthM),blockers,radius);
 const ground=(x,y)=>{const p=projection.toGeographic(x+site.offsetEastM,y+site.offsetNorthM);return base.groundElevationAt(p.latDeg,p.lonDeg);};
 const water=(x,y)=>{const p=projection.toGeographic(x+site.offsetEastM,y+site.offsetNorthM);return base.sampleSurfaceAt(p.latDeg,p.lonDeg);};
 const requested=site.requestedDwellings,target=requested,buildings=[],buildingPads=[],roads=[];
 const streetCount=Math.max(1,Math.ceil(target/24)),halfLength=210;
 for(let street=0;street<streetCount;street++){
  const x=(street-(streetCount-1)/2)*90,samples=[];let dry=true;
  for(let k=0;k<=21;k++){const y=-halfLength+k*20,s=water(x,y);if(s.waterDepthM>0||occupied(x,y))dry=false;samples.push({xM:x,yM:y,distanceM:k*20,roadElevationM:ground(x,y)+.06,structureKind:'fill',segmentKind:'fill'});}
  // No invented bridges across water. Wet streets and their houses are omitted.
  if(!dry)continue;
  const roadId=`${site.id}/street:${street}`;roads.push({roadId,halfWidthM:2.5,samples});
  for(let lot=0;lot<24&&street*24+lot<target;lot++){
   const y=-165+Math.floor(lot/2)*30,cx=x+(lot%2?19:-19),b={minXM:cx-6,maxXM:cx+6,minYM:y-6,maxYM:y+6};
   const corners=[[b.minXM,b.minYM],[b.maxXM,b.minYM],[b.maxXM,b.maxYM],[b.minXM,b.maxYM]],levels=corners.map(([a,b])=>ground(a,b)),z=Math.max(...levels)+.1;
   if(Math.max(...levels)-Math.min(...levels)>.8||corners.some(([a,b])=>water(a,b).waterDepthM>0||occupied(a,b)))continue;
   const id=`${site.id}/house:${street*24+lot}`;
   buildingPads.push({id,bounds:b,targetPadElevationM:z});buildings.push({id,bounds:b,baseElevationM:z,heightM:3.2,roofHeightM:1.8,wallColor:[.72,.67,.54],roofColor:[.40,.22,.13]});
  }
 }
 // Cross street connects residential lanes, unless water interrupts it.
 if(streetCount>1){const samples=[];let dry=true;const lo=-(streetCount-1)*45,hi=-lo,n=Math.ceil((hi-lo)/15);for(let k=0;k<=n;k++){const x=lo+(hi-lo)*k/n,y=210;if(water(x,y).waterDepthM>0||occupied(x,y))dry=false;samples.push({xM:x,yM:y,distanceM:x-lo,roadElevationM:ground(x,y)+.06,structureKind:'fill',segmentKind:'fill'});}if(dry){roads.push({roadId:`${site.id}/cross-street`,halfWidthM:2.5,samples});}}
 const connections=[];
 for(const [axis,sign]of [['x',-1],['x',1],['y',-1],['y',1]]){
  const end=axis==='x'?{xM:sign*200,yM:0}:{xM:0,yM:sign*230},length=Math.hypot(end.xM,end.yM),steps=Math.ceil(length/10),samples=[];let dry=true;
  for(let k=0;k<=steps;k++){const t=k/steps,xM=end.xM*t,yM=end.yM*t;if(water(xM,yM).waterDepthM>0||occupied(xM,yM))dry=false;samples.push({xM,yM,distanceM:length*t,roadElevationM:ground(xM,yM)+.06,structureKind:'fill',segmentKind:'fill'});}
  connections.push({axis,sign,status:dry?'dry-local-street':'blocked-water'});if(dry)roads.push({roadId:`${site.id}/arterial:${axis}:${sign}`,halfWidthM:3,samples});
 }
 const infill=settlement.economicContext?.infillPolicy==='fixed-terrain-adaptive-infill@1'?completeResidentialLots({id:site.id,requested:target,buildings,buildingPads,roads,ground,water,occupied}):{placed:0,remaining:target-buildings.length};
 const placedDwellings=buildings.length;
 const economy=planDistrictEconomy({site,settlement,ground,water,roads,occupied});
 for(const b of economy.buildings){buildings.push(b);buildingPads.push({id:b.id,bounds:{...b.bounds},targetPadElevationM:b.baseElevationM});}
 const shiftBounds=b=>({minXM:b.minXM+site.offsetEastM,maxXM:b.maxXM+site.offsetEastM,minYM:b.minYM+site.offsetNorthM,maxYM:b.maxYM+site.offsetNorthM});
 for(const b of buildings)b.bounds=shiftBounds(b.bounds);
 for(const b of buildingPads)b.bounds=shiftBounds(b.bounds);
 for(const road of roads)for(const p of road.samples){p.xM+=site.offsetEastM;p.yM+=site.offsetNorthM;}
 return{id:site.id,economy,connections,projection:projection.contract,bounds:shiftBounds({minXM:-200,maxXM:200,minYM:-230,maxYM:230}),model:{schema:WATER_SCHEMA,construction:'strip-with-smooth-banks@4',nodes:[],edges:[],bodies:[],topologyOrder:[],basins:null},roadCenterlineProfiles:roads,buildingPads,buildings,
  layoutStatus:{method:'population-districts@1',settlementId:settlement.id,districtIndex,districtCount:plan.count,totalRequestedDwellings:plan.households,requestedDwellings:requested,placedDwellings,infillDwellings:infill.placed,representedPopulation:Math.min(site.population,placedDwellings*5),districtComplete:placedDwellings===requested,complete:plan.count===1&&placedDwellings===requested,limitations:['Facility dependencies are planned production, not stock or capacity','No bridges or local drainage design']}};
}
