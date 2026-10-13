import test from 'node:test';import assert from 'node:assert/strict';
import {createSettlementWaterIndex,surveySettlementWaterAccess,WATER_LED_SITING} from '../src/core/settlement-water-access.mjs';
import {sitePopulationRegion} from '../src/core/settlement-catalogue.mjs';
import {offsetGeographic,createSphericalProjection,greatCircle} from '../src/core/spherical.mjs';
const radius=6371000,grid={columns:360,rows:180},cellIndex=90*360;
const flat={worldId:'water-fixture',frame:{radiusM:radius},groundElevationAt:()=>20,sampleSurfaceAt:()=>({groundElevationM:20,waterDepthM:0,waterLevelElevationM:null,waterSourceIds:[]})};
const population={sourceWorldId:flat.worldId,grid,cells:[]};population.cells[cellIndex]={cellIndex,population:300,ruralPopulation:300,townPopulation:0,cityPopulation:0,villages:1,towns:0,cities:0};
const origin=sitePopulationRegion(flat,population,cellIndex).sites[0],projection=createSphericalProjection({centerLatDeg:origin.latDeg,centerLonDeg:origin.lonDeg,radiusM:radius,maxRadiusM:10000});
const points=[-2000,0,2000].map(x=>({...offsetGeographic(origin,x,0,radius),halfWidthM:5,bankWidthM:2,depthM:1.5,waterLevelElevationM:19.5})),network={profiles:[{id:'river:fixture',points}]};
const surface=(lat,lon)=>{const p=projection.toLocalIfWithin(lat,lon),wet=p&&Math.abs(p.yM)<5&&Math.abs(p.xM)<2100;return{groundElevationM:wet?18:20,waterDepthM:wet?1.5:0,waterLevelElevationM:wet?19.5:null,waterSourceIds:wet?['river:fixture']:[]};};
const base={...flat,sampleSurfaceAt:surface,groundElevationAt:(lat,lon)=>surface(lat,lon).groundElevationM};
test('water station index is bounded, deterministic and independent of query order',()=>{
 const a=createSettlementWaterIndex(network,grid,radius,{maxCandidates:7}),b=createSettlementWaterIndex(network,grid,radius,{maxCandidates:7});
 assert.equal(a.diagnostics.candidates,7);assert.ok(a.diagnostics.withheld>0);a.forCell(1,'city');assert.deepEqual(a.forCell(cellIndex,'village'),b.forCell(cellIndex,'village'));
 assert.equal(createSettlementWaterIndex(null,grid,radius).diagnostics.candidates,0);
 assert.throws(()=>createSettlementWaterIndex(network,grid,radius,{maxCandidates:Infinity}),/budget/);
});
test('opt-in river siting keeps slot identity and persists a physically sampled approach',()=>{
 const waterIndex=createSettlementWaterIndex(network,grid,radius),old=sitePopulationRegion(base,population,cellIndex),a=sitePopulationRegion(base,population,cellIndex,{waterIndex}),b=sitePopulationRegion(base,population,cellIndex,{waterIndex});
 assert.deepEqual(a,b);assert.equal(a.sites.length,1);assert.equal(a.sites[0].id,old.sites[0].id);assert.equal(a.survey.method,WATER_LED_SITING);
 const access=a.sites[0].siting.waterAccess;assert.equal(access.status,'sampled-river-approach');assert.equal(access.sourceId,'river:fixture');assert.ok(access.distanceM<250);assert.ok(access.points.every(p=>base.sampleSurfaceAt(p.latDeg,p.lonDeg).waterDepthM===0));assert.ok(base.sampleSurfaceAt(access.waterPoint.latDeg,access.waterPoint.lonDeg).waterDepthM>0);
 assert.ok(a.survey.candidateSurveys<=12);assert.equal(a.survey.water.accepted,1);assert.ok(greatCircle(a.sites[0],origin,radius).distanceM<3000);
 assert.equal(old.sites[0].siting.waterAccess,undefined);
});
test('unconfirmed water never becomes a water-access claim, fallback stays bounded',()=>{
 const waterIndex=createSettlementWaterIndex(network,grid,radius),r=sitePopulationRegion(flat,population,cellIndex,{waterIndex});
 assert.equal(r.sites[0].siting.waterAccess.status,'not-established');assert.equal(r.survey.water.accepted,0);assert.ok(r.survey.water.rejected>0);assert.ok(r.survey.candidateSurveys<=12);
 const other={...base,sampleSurfaceAt:(lat,lon)=>({...surface(lat,lon),waterSourceIds:['sea']})};
 assert.equal(surveySettlementWaterAccess(other,waterIndex.forCell(cellIndex,'village')[0]).reason,'water-source-not-confirmed');
});
test('steep natural approaches are withheld instead of manufacturing a passable road',()=>{
 const c=createSettlementWaterIndex(network,grid,radius).forCell(cellIndex,'village').find(p=>Math.abs(projection.toLocal(p.latDeg,p.lonDeg).xM)<1);
 const cliff={...base,sampleSurfaceAt:(lat,lon)=>{const s=surface(lat,lon),p=projection.toLocalIfWithin(lat,lon);return{...s,groundElevationM:s.groundElevationM+(p&&Math.abs(p.yM)>80?30:0)};}};
 assert.equal(surveySettlementWaterAccess(cliff,c).reason,'steep-approach');
 assert.equal(surveySettlementWaterAccess(base,c,{maxSamples:2}).reason,'approach-budget');
 assert.throws(()=>surveySettlementWaterAccess(base,c,{maxSamples:Infinity}),/budget/);
});
test('dateline water candidates are assigned to valid saved regions',()=>{
 const net={profiles:[{id:'seam',points:[{latDeg:0,lonDeg:179.99,halfWidthM:1,bankWidthM:1},{latDeg:0,lonDeg:-179.99,halfWidthM:1,bankWidthM:1}]}]};
 const index=createSettlementWaterIndex(net,{columns:4,rows:2},radius);let n=0;for(let i=0;i<8;i++)for(const kind of ['village','town','city'])n+=index.forCell(i,kind).length;assert.equal(n,index.diagnostics.candidates);assert.equal(n,12);
});

test('rejected water proposals preserve all original fallback attempts',()=>{
 const wetNearOrigin={...flat,sampleSurfaceAt:(lat,lon)=>({groundElevationM:20,waterDepthM:greatCircle(origin,{latDeg:lat,lonDeg:lon},radius).distanceM<1150?3:0,waterLevelElevationM:null})};
 const old=sitePopulationRegion(wetNearOrigin,population,cellIndex),next=sitePopulationRegion(wetNearOrigin,population,cellIndex,{waterIndex:createSettlementWaterIndex(network,grid,radius)});
 assert.equal(old.sites.length,1);assert.equal(old.sites[0].siting.candidateIndex,7);assert.equal(next.sites.length,1);assert.equal(next.sites[0].latDeg,old.sites[0].latDeg);assert.equal(next.sites[0].lonDeg,old.sites[0].lonDeg);assert.ok(next.survey.candidateSurveys<=12);
});

import {BALANCED_WATER_LED_SITING} from '../src/core/settlement-water-access.mjs';
test('balanced water budget covers regional kinds instead of the first river prefix',()=>{
 const grid={columns:12,rows:6};
 const profiles=Array.from({length:4},(_,k)=>({id:`river:${k}`,points:Array.from({length:k===0?200:3},(_,i)=>({latDeg:10,lonDeg:15+k*60+i*.015,halfWidthM:5,bankWidthM:2}))}));
 const options={method:BALANCED_WATER_LED_SITING,maxCandidates:24,spacingM:500};
 const index=createSettlementWaterIndex({profiles},grid,radius,options),reversed=createSettlementWaterIndex({profiles:[...profiles].reverse()},grid,radius,options);
 assert.equal(index.method,BALANCED_WATER_LED_SITING);
 assert.equal(index.diagnostics.candidates,24);assert.equal(index.diagnostics.coveredStrata,12);assert.equal(index.diagnostics.coveredCells,4);assert.ok(index.diagnostics.withheld>0);
 for(let cell=0;cell<72;cell++)for(const kind of ['village','town','city'])assert.deepEqual(index.forCell(cell,kind),reversed.forCell(cell,kind));
 for(let k=0;k<4;k++)for(const kind of ['village','town','city'])assert.equal(index.forCell(24+k*2,kind).length,2);
 const legacy=createSettlementWaterIndex({profiles},grid,radius,{maxCandidates:24,spacingM:500});
 assert.equal(legacy.forCell(26,'village').length,0);
});
test('balanced index spends small-stratum leftovers and remains bounded at zero and sub-coverage budgets',()=>{
 const grid={columns:12,rows:6},profiles=[{id:'a',points:[0,1].map(i=>({latDeg:10,lonDeg:15+i*.015,halfWidthM:5,bankWidthM:2}))},{id:'b',points:Array.from({length:20},(_,i)=>({latDeg:10,lonDeg:75+i*.015,halfWidthM:5,bankWidthM:2}))}];
 for(const maxCandidates of [0,2,24,1000]){
  const r=createSettlementWaterIndex({profiles},grid,radius,{method:BALANCED_WATER_LED_SITING,maxCandidates});
  const all=Array.from({length:72},(_,i)=>['village','town','city'].flatMap(k=>r.forCell(i,k))).flat();
  assert.equal(all.length,r.diagnostics.candidates);assert.ok(all.length<=maxCandidates);assert.equal(new Set(all.map(c=>c.id)).size,all.length);
  assert.equal(all.length,Math.min(maxCandidates,132));
 }
 assert.throws(()=>createSettlementWaterIndex({profiles},grid,radius,{method:'unknown'}),/policy/);
 assert.throws(()=>createSettlementWaterIndex({profiles},{columns:1000,rows:1000},radius,{method:BALANCED_WATER_LED_SITING}),/work budget/);
});
test('balanced water policy reaches the actual siting and sampled-source verification path',()=>{
 const waterIndex=createSettlementWaterIndex(network,grid,radius,{method:BALANCED_WATER_LED_SITING});
 const a=sitePopulationRegion(base,population,cellIndex,{waterIndex});
 assert.equal(a.survey.method,BALANCED_WATER_LED_SITING);assert.equal(a.sites[0].siting.waterAccess.status,'sampled-river-approach');
 assert.deepEqual(a,sitePopulationRegion(base,population,cellIndex,{waterIndex}));
});
