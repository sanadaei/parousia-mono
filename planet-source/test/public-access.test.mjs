import test from 'node:test';import assert from 'node:assert/strict';import {planPublicAccess,PUBLIC_ACCESS_POLICY} from '../src/core/public-access.mjs';import {createTerrainLedNeighborhood} from '../src/core/terrain-led-neighborhood.mjs';import {createGlobeFeatureChart} from '../src/core/globe-features.mjs';
const roads=[{roadId:'main',halfWidthM:3,samples:[{xM:-100,yM:0,distanceM:0},{xM:100,yM:0,distanceM:200}]}],buildings=[{id:'chapel',facilityType:'chapel',bounds:{minXM:-6,maxXM:6,minYM:25,maxYM:45}}],options={roads,buildings,ground:()=>100,water:()=>({waterDepthM:0})};
test('public paths reach the actual chapel frontage with a surveyed pedestrian strip',()=>{const r=planPublicAccess(options);assert.deepEqual(r,planPublicAccess(options));assert.equal(r.access[0].status,'connected');assert.equal(r.access[0].entranceSide,'south');assert.equal(r.paths[0].role,'pedestrian-access');assert.equal(r.paths[0].samples[0].yM,0);assert.equal(r.paths[0].samples.at(-1).yM,23.75);for(const p of r.paths[0].samples)assert.equal(p.roadElevationM,100.06);});
test('water and blocked land are not painted over with a public path',()=>{for(const extra of [{water:()=>({waterDepthM:1})},{water:()=>({waterDepthM:null})},{occupied:()=>true},{ground:(x,y)=>100+y}]){const r=planPublicAccess({...options,...extra});assert.equal(r.paths.length,0);assert.equal(r.access[0].status,'blocked-within-survey');}});
test('actual village puts public access in the shared physical recipe before housing',()=>{const base={frame:{radiusM:6371000},worldId:'flat',groundElevationAt:()=>100,sampleSurfaceAt:()=>({groundElevationM:100,waterDepthM:0})},site={id:'v',population:300,latDeg:20,lonDeg:30,economicContext:{institutionPolicy:'medieval-communal@1',streetPolicy:'terrain-led-branches@2',facilityPolicy:'frontage-service-parcels@2',publicAccessPolicy:PUBLIC_ACCESS_POLICY,pondPolicy:'surveyed-communal-pond@1',agricultureSuitability:.8,grainKgPerPersonYear:300,woodland:true}},r=createTerrainLedNeighborhood(base,site);assert.equal(r.publicAccess.length,2);assert.ok(r.publicAccess.every(a=>a.status==='connected'));assert.equal(r.layoutStatus.placedDwellings,60);const chart=createGlobeFeatureChart(base,r);for(const a of r.publicAccess){const path=r.roadCenterlineProfiles.find(p=>p.roadId===a.roadId),p=path.samples[Math.floor(path.samples.length/2)],geo=chart.projection.toGeographic(p.xM,p.yM),sample=chart.sampleAt(geo.latDeg,geo.lonDeg);assert.ok(sample.roadSurface);assert.equal(sample.buildingId,null);assert.equal(sample.waterDepthM,0);}const old=createTerrainLedNeighborhood(base,{...site,economicContext:{...site.economicContext,publicAccessPolicy:undefined}});assert.equal(old.publicAccess.length,0);assert.equal(old.roadCenterlineProfiles.some(p=>p.role==='pedestrian-access'),false);});

test('foundation-aware public access stops outside retaining earthwork without inventing a doorway',async()=>{
 const {buildingPadAffectsPoint}=await import('../src/core/building-pad.mjs');
 const input={...options,buildings:buildings.map(b=>({...b,baseElevationM:101})),avoidFoundationBatters:true},r=planPublicAccess(input);
 assert.equal(r.access[0].status,'connected');assert.ok(r.paths[0].samples.at(-1).yM<23);
 for(const p of r.paths[0].samples)assert.equal(buildingPadAffectsPoint({bounds:buildings[0].bounds,targetPadElevationM:101},p.xM,p.yM,100),false);
 assert.doesNotThrow(()=>planPublicAccess({...input,ground:(x,y)=>Math.abs(x)>.3?NaN:100}));
});

import {planRiverbankAccess,RIVERBANK_ACCESS_POLICY} from '../src/core/riverbank-access.mjs';
import {createSphericalProjection} from '../src/core/spherical.mjs';
import {summarizeLayouts} from '../src/globe/layout-summary.mjs';
const riverProjection=createSphericalProjection({centerLatDeg:20,centerLonDeg:30,radiusM:6371000,maxRadiusM:2000});
const riverWater=(x,y)=>({groundElevationM:y>=180?98:100,waterDepthM:y>=180?1.5:0,waterLevelElevationM:y>=180?99.5:null,waterSourceIds:y>=180?['river:actual']:[]});
const riverSettlement={id:'river-village',kind:'village',siting:{waterAccess:{status:'sampled-river-approach',sourceId:'river:actual',shorePoint:riverProjection.toGeographic(0,165),waterPoint:riverProjection.toGeographic(0,182)}}};
const riverOptions={settlement:riverSettlement,projection:riverProjection,roads,buildings:[],ground:(x,y)=>riverWater(x,y).groundElevationM,water:riverWater,bounds:{minXM:-200,maxXM:200,minYM:-230,maxYM:230}};
test('named riverbank becomes an actual stable pedestrian street profile, without inventing water',()=>{
 const r=planRiverbankAccess(riverOptions);assert.equal(r.status.status,'connected');assert.equal(r.paths.length,1);assert.equal(r.paths[0].waterSourceId,'river:actual');assert.equal(r.paths[0].role,'pedestrian-access');assert.equal(r.status.joinsRoadId,'main');assert.deepEqual(r,planRiverbankAccess(riverOptions));
 const end=r.paths[0].samples.at(-1);assert.ok(end.yM>176&&end.yM<180);assert.equal(riverWater(end.xM,end.yM).waterDepthM,0);assert.ok(r.paths[0].samples.length<=601);
});
test('missing, mismatched and inaccessible river banks are withheld',()=>{
 for(const extra of [{settlement:{...riverSettlement,siting:{}}},{water:()=>({groundElevationM:100,waterDepthM:0,waterSourceIds:[]})},{water:(x,y)=>({...riverWater(x,y),waterSourceIds:['another-river']})},{occupied:()=>true},{bounds:{minXM:-10,maxXM:10,minYM:-10,maxYM:10}},{settlement:{...riverSettlement,kind:'city'}}]){
  const r=planRiverbankAccess({...riverOptions,...extra});assert.equal(r.status.status,'withheld');assert.equal(r.paths.length,0);
 }
});
test('point destinations can choose a different street when the nearest direct approach is blocked',()=>{
 const alternative={roadId:'alternative',halfWidthM:2,samples:[{xM:50,yM:120,distanceM:0},{xM:50,yM:160,distanceM:40}]};
 const obstruction={id:'building',bounds:{minXM:20,maxXM:30,minYM:130,maxYM:150},baseElevationM:100.1};
 const r=planPublicAccess({...options,buildings:[obstruction],roads:[...roads,alternative],destinationsOnly:true,destinations:[{id:'bank',type:'riverbank',point:{xM:0,yM:140},sourceId:'river:actual'}]});
 assert.equal(r.access[0].status,'connected');assert.equal(r.access[0].joinsRoadId,'main');
 assert.throws(()=>planPublicAccess({...options,destinations:Array(9).fill({id:'x',point:{xM:0,yM:0}})}),/bounded/);
 const wet=planPublicAccess({...options,buildings:[],water:()=>({waterDepthM:1}),destinationsOnly:true,destinations:[{id:'on-road',type:'riverbank',point:{xM:0,yM:0}}]});assert.equal(wet.paths.length,0);assert.equal(wet.access[0].status,'blocked-within-survey');
});
test('riverbank status is shown separately from completed houses',()=>{
 const r=summarizeLayouts([{settlementId:'v',districtCount:1,placedDwellings:60,requestedDwellings:60,riverbankAccess:{status:'withheld'}}]);assert.match(r,/60\/60戸/);assert.match(r,/川岸への道 0接続 \/ 1未確認/);
});

test('riverbank footpath is in the same physical village recipe as roads and protected house pads',()=>{
 const surface=(lat,lon)=>{const p=riverProjection.toLocal(lat,lon);return riverWater(p.xM,p.yM);};
 const base={frame:{radiusM:6371000},worldId:'riverbank-fixture',groundElevationAt:(lat,lon)=>surface(lat,lon).groundElevationM,sampleSurfaceAt:surface};
 const site={...riverSettlement,population:300,latDeg:20,lonDeg:30,economicContext:{streetPolicy:'terrain-led-branches@2',riverbankAccessPolicy:RIVERBANK_ACCESS_POLICY,roadPadClearance:'surveyed-frontage-pads@1',agricultureSuitability:.8,grainKgPerPersonYear:300,woodland:true}};
 const r=createTerrainLedNeighborhood(base,site);assert.equal(r.riverbankAccess.status,'connected');
 const path=r.roadCenterlineProfiles.find(p=>p.waterSourceId==='river:actual');assert.ok(path);assert.equal(path.role,'pedestrian-access');
 const chart=createGlobeFeatureChart(base,r);
 for(let i=0;i<path.samples.length;i+=Math.max(1,Math.floor(path.samples.length/20))){const p=path.samples[i],g=chart.projection.toGeographic(p.xM,p.yM),s=chart.sampleAt(g.latDeg,g.lonDeg);assert.ok(s.roadSurface);assert.equal(s.buildingId,null);assert.equal(s.waterDepthM,0);}
 assert.deepEqual(r,createTerrainLedNeighborhood(base,site));
 const old=createTerrainLedNeighborhood(base,{...site,economicContext:{...site.economicContext,riverbankAccessPolicy:undefined}});assert.equal(old.riverbankAccess,undefined);assert.equal(old.roadCenterlineProfiles.some(p=>p.waterSourceId==='river:actual'),false);
});
