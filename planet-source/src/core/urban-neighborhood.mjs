import {selectPublicChurchSite} from './public-site-selection.mjs';
import {buildingPadAffectsPoint} from './building-pad.mjs';
import {planPublicAccess} from './public-access.mjs';
import {createUrbanBlockPlanner,insideUrbanBlock,surveyUrbanBlockStreets} from './urban-blocks.mjs';
import {planFrontageLots} from './terrain-frontage-lots.mjs';
import {planFrontageGardens} from './frontage-gardens.mjs';
import {planDistrictEconomy} from './district-economy.mjs';
import {planSettlementDistricts} from './settlement-districts.mjs';
import {settlementLandBlockers,landReservedAt} from './settlement-land-reservations.mjs';
import {createSphericalProjection} from './spherical.mjs';
import {WATER_SCHEMA} from './water-model.mjs';
export function createUrbanNeighborhood(base,settlement,{districtIndex=0,nearbySettlements=[]}={}){
 const radius=base.frame.radiusM,plan=planSettlementDistricts(settlement,radius),site=plan.district(districtIndex),projection=createSphericalProjection({centerLatDeg:settlement.latDeg,centerLonDeg:settlement.lonDeg,radiusM:radius,maxRadiusM:Math.max(2000,plan.extentM*2)}),blockers=settlementLandBlockers(settlement,nearbySettlements,radius),globalGround=(x,y)=>{const p=projection.toGeographic(x,y);return base.groundElevationAt(p.latDeg,p.lonDeg);},globalWater=(x,y)=>{const p=projection.toGeographic(x,y);return base.sampleSurfaceAt(p.latDeg,p.lonDeg);},ground=(x,y)=>globalGround(x+site.offsetEastM,y+site.offsetNorthM),water=(x,y)=>globalWater(x+site.offsetEastM,y+site.offsetNorthM),occupied=(x,y)=>landReservedAt(projection.toGeographic(x+site.offsetEastM,y+site.offsetNorthM),blockers,radius);
 const planner=createUrbanBlockPlanner({settlementId:settlement.id,ground:globalGround,water:globalWater,seedPolicy:settlement.economicContext?.urbanBlockSeedPolicy}),blocks=[];
 for(let y=-1;y<=1;y++)for(let x=-1;x<=1;x++){const b=planner.cell(site.column*3+x,site.row*3+y),shift=p=>({xM:p.xM-site.offsetEastM,yM:p.yM-site.offsetNorthM});blocks.push({...b,center:shift(b.center),polygon:b.polygon.map(shift)});}
 const roads=[],seen=new Set(),blockedEdges=[];for(const b of blocks){const survey=surveyUrbanBlockStreets(b,{ground,water,occupied});b.roads=survey.roads;blockedEdges.push(...survey.rejected.map(e=>({blockId:b.id,...e})));for(const r of b.roads){const key=[r.samples[0],r.samples.at(-1)].map(p=>`${Math.round((p.xM+site.offsetEastM)*1000)},${Math.round((p.yM+site.offsetNorthM)*1000)}`).sort().join('|');r.roadId=`${settlement.id}/urban-street:${key}`;if(!seen.has(key)){seen.add(key);roads.push(r);}}}
 // Explicit external-road gates connect to this same street graph. No second
 // invisible road network and no road driven through a previously placed house.
 const connections=[];
 for(const [axis,sign]of [['x',-1],['x',1],['y',-1],['y',1]]){const start={xM:axis==='x'?sign*120:0,yM:axis==='y'?sign*120:0},targets=roads.flatMap(r=>r.samples.slice(1).map((b,i)=>{const a=r.samples[i],dx=b.xM-a.xM,dy=b.yM-a.yM,t=Math.max(0,Math.min(1,((start.xM-a.xM)*dx+(start.yM-a.yM)*dy)/(dx*dx+dy*dy||1)));return{xM:a.xM+dx*t,yM:a.yM+dy*t};})).sort((a,b)=>Math.hypot(a.xM-start.xM,a.yM-start.yM)-Math.hypot(b.xM-start.xM,b.yM-start.yM));const end=targets[0];if(!end){connections.push({axis,sign,status:'no-street'});continue;}const length=Math.hypot(end.xM-start.xM,end.yM-start.yM);if(length<.1){connections.push({axis,sign,status:'connected'});continue;}const steps=Math.ceil(length/2),samples=[];let valid=true,prior=null;for(let i=0;i<=steps;i++){const t=i/steps,xM=start.xM+(end.xM-start.xM)*t,yM=start.yM+(end.yM-start.yM)*t,z=ground(xM,yM);if(water(xM,yM).waterDepthM>0||occupied(xM,yM)||prior!=null&&Math.abs(z-prior)/(length/steps)>.18)valid=false;prior=z;samples.push({xM,yM,distanceM:length*t,roadElevationM:z+.06,structureKind:'fill',segmentKind:'fill'});}if(valid)roads.push({roadId:`${site.id}/gate:${axis}:${sign}`,halfWidthM:2.5,surfaceMaterial:'compacted-earth',samples});connections.push({axis,sign,status:valid?'connected':'blocked-ground'});}
 const surveyCivic=settlement.economicContext?.urbanPublicSitePolicy==='surveyed-civic-chapel@1';let civicSurvey=null;
 const civic=blocks.find(b=>b.x===0&&b.y===0),landParcels=[],facilities=[],buildingPads=[];
 if(civic){const center=civic.center,steps=8,points=[];let dry=true;for(let y=0;y<=steps;y++)for(let x=0;x<=steps;x++){const xM=center.xM-20+x*25/steps,yM=center.yM-20+y*40/steps;dry&&=water(xM,yM).waterDepthM===0&&insideUrbanBlock({xM,yM},civic.polygon,4);points.push({xM,yM,elevationM:ground(xM,yM)+.04});}if(dry)landParcels.push({id:`${settlement.id}/market-square`,type:'market_square',steps,points,color:[.57,.51,.36]});
  if(settlement.economicContext?.institutionPolicy==='medieval-communal@1'&&!surveyCivic){const bounds={minXM:8,maxXM:20,minYM:-12,maxYM:12},corners=[[8,-12],[20,-12],[20,12],[8,12]],levels=corners.map(([x,y])=>ground(x,y));if(corners.every(([xM,yM])=>insideUrbanBlock({xM,yM},civic.polygon,4)&&water(xM,yM).waterDepthM===0)&&Math.max(...levels)-Math.min(...levels)<1.2){const z=Math.max(...levels)+.1,id=`${settlement.id}/church`;facilities.push({id,facilityType:'chapel',sector:3,bounds,baseElevationM:z,heightM:8,roofHeightM:4,wallColor:[.68,.66,.57],roofColor:[.35,.24,.18]},{id:id+'/tower',facilityType:'chapel_tower',sector:3,bounds:{minXM:8,maxXM:13,minYM:-12,maxYM:-7},baseElevationM:z,heightM:16,roofHeightM:3,wallColor:[.68,.66,.57],roofColor:[.35,.24,.18]});}}
 }
 if(civic&&surveyCivic&&settlement.economicContext?.institutionPolicy==='medieval-communal@1'){
  const reserved=landParcels.map(p=>({minXM:Math.min(...p.points.map(q=>q.xM)),maxXM:Math.max(...p.points.map(q=>q.xM)),minYM:Math.min(...p.points.map(q=>q.yM)),maxYM:Math.max(...p.points.map(q=>q.yM))}));
  const attempts=[];for(const siteProfile of ['civic-yard','compact-civic-yard']){civicSurvey=selectPublicChurchSite({id:settlement.id,roads:civic.roads,center:civic.center,ground,water,occupied,reservations:reserved,siteProfile,siteAllowed:(xM,yM)=>insideUrbanBlock({xM,yM},civic.polygon,3),avoidFoundationBatters:true});attempts.push({siteProfile,surveyed:civicSurvey.surveyed,rejected:civicSurvey.rejected,reason:civicSurvey.reason});if(civicSurvey.site)break;}civicSurvey={...civicSurvey,attempts,totalSurveyed:attempts.reduce((n,a)=>n+a.surveyed,0),maxTotalCandidates:96};
  if(civicSurvey.site){const chosen=civicSurvey.site;facilities.push(...chosen.buildings);
   const yard=chosen.yard,steps=8,points=[];for(let y=0;y<=steps;y++)for(let x=0;x<=steps;x++){const xM=yard.minXM+(yard.maxXM-yard.minXM)*x/steps,yM=yard.minYM+(yard.maxYM-yard.minYM)*y/steps;points.push({xM,yM,elevationM:ground(xM,yM)+.04});}
   landParcels.push({id:settlement.id+'/churchyard',type:'churchyard',steps,points,color:[.42,.47,.28],provenance:'Street-front civic yard and foundation surveyed inside the central block; institutional scenario, not inferred belief or population history'});
  }
 }
 const detailedServices=settlement.economicContext?.urbanFacilityPolicy==='surveyed-urban-service-parcels@1';
 const economy=planDistrictEconomy({site,settlement,ground,water,roads,occupied:(x,y)=>occupied(x,y)||!!civic&&insideUrbanBlock({xM:x,yM:y},civic.polygon),excludedTypes:civic?['chapel','market']:[],parcelCenters:blocks.map(b=>[b.center.xM,b.center.yM])});facilities.push(...economy.buildings);
 const publicAccess=detailedServices?planPublicAccess({roads,buildings:facilities,ground,water,occupied,avoidFoundationBatters:true}):null;
 if(detailedServices){roads.push(...economy.accessRoads,...publicAccess.paths);landParcels.push(...economy.workyards);}
 const roadClearanceSamples=[];
 if(detailedServices)for(const road of roads)for(let i=1;i<road.samples.length;i++){
  const a=road.samples[i-1],b=road.samples[i],dx=b.xM-a.xM,dy=b.yM-a.yM,d=Math.hypot(dx,dy);if(d<1e-9)continue;
  const count=Math.ceil(d);for(let k=0;k<=count;k++)for(const side of [-road.halfWidthM,0,road.halfWidthM]){
   const x=a.xM+dx*k/count-dy/d*side,y=a.yM+dy*k/count+dx/d*side;
   roadClearanceSamples.push({x,y,z:ground(x,y),roadZ:a.roadElevationM+(b.roadElevationM-a.roadElevationM)*k/count});
  }
 }
 const padClear=pad=>!roadClearanceSamples.some(p=>buildingPadAffectsPoint(pad,p.x,p.y,p.z)||buildingPadAffectsPoint(pad,p.x,p.y,p.roadZ));
 const gardenBlocks=new Map();
 const housingBlocks=blocks.filter(b=>b!==civic),buildings=[],reservations=[...facilities.map(b=>b.bounds),...(detailedServices?economy.parcelReservations:[])],allocations=[],missingHouseIds=[];let requestedOffset=0,redistributedDwellings=0;
 const allocate=(b,requested)=>planFrontageLots({id:b.id,requested,roads:b.roads,avoidRoads:roads,padClear,ground,water,frontageSpacingM:detailedServices?12:14,footprint:{lengthM:8,widthM:6,heightM:5.6},setbackM:detailedServices?4:1.5,gapM:1,occupied:(xM,yM)=>occupied(xM,yM)||!insideUrbanBlock({xM,yM},b.polygon,3),reservations});
 const append=(lots,k,id,block)=>{gardenBlocks.set(id,block);lots.buildings[k].id=id;lots.buildingPads[k].id=id;buildings.push(lots.buildings[k]);buildingPads.push(lots.buildingPads[k]);};
 for(let i=0;i<housingBlocks.length;i++){
  const b=housingBlocks[i],requested=Math.floor(site.requestedDwellings/housingBlocks.length)+(i<site.requestedDwellings%housingBlocks.length?1:0),lots=allocate(b,requested);
  for(let k=0;k<requested;k++){const id=`${site.id}/house:${requestedOffset+k}`;if(k<lots.placed)append(lots,k,id,b);else missingHouseIds.push(id);}
  allocations.push({block:b,placed:lots.placed});requestedOffset+=requested;
 }
 // A block's failed quota need not become an unhoused family if another block
 // has surveyed capacity. Retry each block once; accepted prefix lots stay fixed.
 if(detailedServices)for(const a of allocations){if(!missingHouseIds.length)break;const lots=allocate(a.block,Math.min(512,a.placed+missingHouseIds.length));for(let k=a.placed;k<lots.placed&&missingHouseIds.length;k++){append(lots,k,missingHouseIds.shift(),a.block);redistributedDwellings++;}}

 const placed=buildings.length;buildings.push(...facilities);for(const b of facilities)buildingPads.push({id:b.id,bounds:{...b.bounds},targetPadElevationM:b.baseElevationM});landParcels.push(...planFrontageGardens({buildings,roads,ground,water,backland:settlement.economicContext?.gardenParcelPolicy==='bounded-backland-gardens@1',withinPlot:(b,p)=>{const block=gardenBlocks.get(b.id);return !!block&&insideUrbanBlock(p,block.polygon,3);},reservations:[...(civic?[{minXM:-40,maxXM:40,minYM:-40,maxYM:40}]:[]),...(detailedServices?economy.parcelReservations:[])]}));
 const shift=b=>({minXM:b.minXM+site.offsetEastM,maxXM:b.maxXM+site.offsetEastM,minYM:b.minYM+site.offsetNorthM,maxYM:b.maxYM+site.offsetNorthM});for(const b of [...buildings,...buildingPads])b.bounds=shift(b.bounds);for(const b of buildings)if(b.frontage){b.frontage.access.xM+=site.offsetEastM;b.frontage.access.yM+=site.offsetNorthM;}for(const r of roads)for(const p of r.samples){p.xM+=site.offsetEastM;p.yM+=site.offsetNorthM;}for(const p of landParcels)for(const q of p.points){q.xM+=site.offsetEastM;q.yM+=site.offsetNorthM;}
 return{id:site.id,projection:projection.contract,bounds:shift({minXM:-170,maxXM:170,minYM:-170,maxYM:170}),model:{schema:WATER_SCHEMA,construction:'strip-with-smooth-banks@4',nodes:[],edges:[],bodies:[],topologyOrder:[],basins:null},buildings,buildingPads,roadCenterlineProfiles:roads,landParcels,economy,connections,...(civicSurvey?{publicSiteSurvey:civicSurvey}:{}),...(publicAccess?{publicAccess:publicAccess.access}:{}),layoutStatus:{method:'urban-block-frontage@1',...(detailedServices?{redistributedDwellings}:{}),settlementId:settlement.id,districtIndex,districtCount:plan.count,totalRequestedDwellings:plan.households,requestedDwellings:site.requestedDwellings,placedDwellings:placed,unplacedDwellings:site.requestedDwellings-placed,representedPopulation:Math.min(site.population,placed*5),districtComplete:placed===site.requestedDwellings,complete:plan.count===1&&placed===site.requestedDwellings,blockedEdges,limitations:['Town-wide terrain-biased blocks, not simulated historical growth','Water/grade-rejected streets need connected-component acceptance','Unplaced households remain explicit; no forced housing on unsuitable land','Facility yards and external agriculture still require refinement']}};
}
