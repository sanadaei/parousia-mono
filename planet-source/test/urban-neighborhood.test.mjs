import test from 'node:test';import assert from 'node:assert/strict';import {createSettlementLayout} from '../src/core/settlement-layout.mjs';import {buildBuildingMesh} from '../src/globe/buildings.mjs';import {createGlobeFeatureChart} from '../src/core/globe-features.mjs';import {planSettlementDistricts,settlementStreetGate} from '../src/core/settlement-districts.mjs';
const base={worldId:'flat',frame:{radiusM:6371000},groundElevationAt:()=>100,sampleSurfaceAt:()=>({groundElevationM:100,waterDepthM:0})},site={id:'city',kind:'city',population:50000,latDeg:20,lonDeg:30,economicContext:{layoutPolicy:'terrain-led-neighborhood@2',institutionPolicy:'medieval-communal@1'}};
test('city density, civic block and physical homes use the same new layout entry point',()=>{const p=planSettlementDistricts(site,6371000);assert.equal(p.widthM,240);const r=createSettlementLayout(base,site);assert.deepEqual(r,createSettlementLayout(base,site));assert.equal(r.layoutStatus.placedDwellings,96);assert.ok(r.landParcels.some(p=>p.type==='market_square'));assert.ok(r.buildings.some(b=>b.facilityType==='chapel'));const mesh=buildBuildingMesh(r,6371000,{includeRoads:true});assert.ok(mesh.vertex.every(Number.isFinite));const chart=createGlobeFeatureChart(base,r),b=r.buildings[0],q=chart.projection.toGeographic((b.bounds.minXM+b.bounds.maxXM)/2,(b.bounds.minYM+b.bounds.maxYM)/2);assert.equal(chart.sampleAt(q.latDeg,q.lonDeg).buildingId,b.id);});
test('neighboring city pages share street identities instead of repeating separate hubs',()=>{const a=createSettlementLayout(base,site),b=createSettlementLayout(base,site,{districtIndex:1}),ids=new Set(a.roadCenterlineProfiles.map(r=>r.roadId));assert.ok(b.roadCenterlineProfiles.some(r=>ids.has(r.roadId)));const gate=settlementStreetGate(site,{latDeg:20,lonDeg:31},6371000);assert.ok(gate.lonDeg>site.lonDeg);assert.ok(!b.landParcels.some(p=>p.type==='market_square'));});

test('new urban services reserve workyards and put facility approaches in the physical recipe',()=>{
 const input={...site,economicContext:{...site.economicContext,facilityPolicy:'frontage-service-parcels@2',urbanFacilityPolicy:'surveyed-urban-service-parcels@1',agricultureSuitability:.8,grainKgPerPersonYear:300,woodland:true}};
 for(const districtIndex of [0,1,4,16]){
  const r=createSettlementLayout(base,input,{districtIndex});assert.deepEqual(r,createSettlementLayout(base,input,{districtIndex}));
  assert.ok(r.economy.workyards.length>0);assert.equal(r.economy.workyards.length,r.economy.buildings.length);
  for(const yard of r.economy.workyards)assert.ok(r.landParcels.some(p=>p.id===yard.id));
  const chart=createGlobeFeatureChart(base,r);
  for(const access of r.economy.accessRoads){const road=r.roadCenterlineProfiles.find(p=>p.roadId===access.roadId);assert.ok(road);
   for(const p of road.samples){const g=chart.projection.toGeographic(p.xM,p.yM),s=chart.sampleAt(g.latDeg,g.lonDeg);assert.ok(s.roadSurface,JSON.stringify({districtIndex,road:road.roadId,p,s}));assert.ok(!s.buildingId);}
  }
  assert.equal(r.layoutStatus.placedDwellings,r.layoutStatus.requestedDwellings);
  if(districtIndex===0)assert.ok(r.publicAccess.some(p=>p.targetType==='chapel'&&p.status==='connected'));
 }
 const legacy=createSettlementLayout(base,{...input,economicContext:{...input.economicContext,urbanFacilityPolicy:undefined}});
 assert.equal(legacy.economy.workyards.length,0);assert.equal(legacy.publicAccess,undefined);
});

test('independent urban seed axes remain connected to shared streamed streets and surveyed capacity',()=>{
 const input={...site,economicContext:{...site.economicContext,facilityPolicy:'frontage-service-parcels@2',urbanFacilityPolicy:'surveyed-urban-service-parcels@1',urbanBlockSeedPolicy:'terrain-ranked-block-seeds@2',agricultureSuitability:.8,grainKgPerPersonYear:300,woodland:true}},layouts=[0,1,4,16].map(districtIndex=>createSettlementLayout(base,input,{districtIndex}));
 for(const r of layouts){assert.equal(r.layoutStatus.placedDwellings,96);assert.equal(r.layoutStatus.unplacedDwellings,0);assert.ok(buildBuildingMesh(r,6371000,{includeRoads:true}).vertex.every(Number.isFinite));}
 const ids=new Set(layouts[0].roadCenterlineProfiles.map(r=>r.roadId));assert.ok(layouts[1].roadCenterlineProfiles.some(r=>ids.has(r.roadId)));assert.ok(layouts[0].publicAccess.some(p=>p.status==='connected'));
 assert.deepEqual(layouts[0],createSettlementLayout(base,input));assert.notDeepEqual(layouts[0].roadCenterlineProfiles,createSettlementLayout(base,{...input,economicContext:{...input.economicContext,urbanBlockSeedPolicy:undefined}}).roadCenterlineProfiles);
});
