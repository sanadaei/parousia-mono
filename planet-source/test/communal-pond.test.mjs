import test from 'node:test';import assert from 'node:assert/strict';
import {planCommunalPond,COMMUNAL_POND_POLICY} from '../src/core/communal-pond.mjs';
import {createTerrainLedNeighborhood} from '../src/core/terrain-led-neighborhood.mjs';
import {createGlobeFeatureChart} from '../src/core/globe-features.mjs';
const ground=()=>100,water=()=>({groundElevationM:100,waterDepthM:0,waterLevelElevationM:null});
test('constructed pond has real submerged bed, bounded excavation and dry rim',()=>{const p=planCommunalPond({id:'v',ground,water});assert.ok(p);assert.ok(p.sample(p.center.xM,p.center.yM).waterDepthM>1.4);for(let y=p.bounds.minYM;y<=p.bounds.maxYM;y++)for(let x=p.bounds.minXM;x<=p.bounds.maxXM;x++){const s=p.sample(x,y);assert.ok(s.groundElevationM>=97&&s.groundElevationM<=100);if(x===p.bounds.minXM||x===p.bounds.maxXM||y===p.bounds.minYM||y===p.bounds.maxYM)assert.equal(s.waterDepthM,0);}assert.equal(p.sample(0,0).groundElevationM,100);assert.deepEqual(p.model,planCommunalPond({id:'v',ground,water}).model);});
test('pond refuses steep, wet, occupied and nonfinite sites',()=>{assert.equal(planCommunalPond({id:'v',ground:(x,y)=>100+x,water}),null);assert.equal(planCommunalPond({id:'v',ground,water:()=>({waterDepthM:1})}),null);assert.equal(planCommunalPond({id:'v',ground,water,occupied:()=>true}),null);assert.equal(planCommunalPond({id:'v',ground:()=>NaN,water}),null);});
test('opt-in village pond is in exported physical terrain and excludes roads and houses',()=>{const base={frame:{radiusM:6371000},worldId:'flat',groundElevationAt:ground,sampleSurfaceAt:water},site={id:'v',population:300,latDeg:20,lonDeg:30,economicContext:{institutionPolicy:'medieval-communal@1',pondPolicy:COMMUNAL_POND_POLICY}},r=createTerrainLedNeighborhood(base,site),c=createGlobeFeatureChart(base,r),p=r.waterFeatures[0];assert.ok(p);const x=(p.bounds.minXM+p.bounds.maxXM)/2,y=(p.bounds.minYM+p.bounds.maxYM)/2,g=c.projection.toGeographic(x,y),s=c.sampleAt(g.latDeg,g.lonDeg);assert.ok(s.waterDepthM>1.4);assert.ok(r.layoutStatus.placedDwellings>30);const inside=(x,y)=>x>=p.bounds.minXM&&x<=p.bounds.maxXM&&y>=p.bounds.minYM&&y<=p.bounds.maxYM;for(const road of r.roadCenterlineProfiles)for(const q of road.samples)assert.equal(inside(q.xM,q.yM),false);for(const b of r.buildings)assert.equal(inside((b.bounds.minXM+b.bounds.maxXM)/2,(b.bounds.minYM+b.bounds.maxYM)/2),false);assert.deepEqual(r,createTerrainLedNeighborhood(base,site));const old=createTerrainLedNeighborhood(base,{...site,economicContext:{}});assert.equal(old.model.edges.length,0);});
test('adaptive storage pond fits a gentle hill without inventing flat ground or natural water',()=>{
 const slope=(x,y)=>100+.04*x+.01*y,w=(x,y)=>({groundElevationM:slope(x,y),waterDepthM:0,waterLevelElevationM:null}),args={id:'hill',ground:slope,water:w,policy:'surveyed-communal-pond@2'};
 assert.equal(planCommunalPond({...args,policy:COMMUNAL_POND_POLICY}),null);
 const p=planCommunalPond(args);assert.ok(p);assert.ok(p.survey.requiredIncisionM<=2.9);assert.ok(p.survey.groundSamples<100000);assert.deepEqual(p.model,planCommunalPond(args).model);
 assert.ok(p.sample(p.center.xM,p.center.yM).waterDepthM>.9);
 for(let y=p.bounds.minYM;y<=p.bounds.maxYM;y++)for(let x=p.bounds.minXM;x<=p.bounds.maxXM;x++){
  const s=p.sample(x,y),raw=slope(x,y);assert.ok(s.groundElevationM<=raw&&s.groundElevationM>=raw-3);
  if(x===p.bounds.minXM||x===p.bounds.maxXM||y===p.bounds.minYM||y===p.bounds.maxYM){assert.equal(s.waterDepthM,0);assert.equal(s.groundElevationM,raw);}
 }
 assert.match(p.limitations.join(' '),/not a natural pond/);
});
test('adaptive pond requires known dry unoccupied ground and rejects excess excavation',()=>{
 for(const overrides of [{ground:(x,y)=>100+x},{ground:()=>NaN},{water:()=>({waterDepthM:null})},{water:()=>({waterDepthM:1})},{occupied:()=>true}])assert.equal(planCommunalPond({id:'v',ground,water,policy:'surveyed-communal-pond@2',...overrides}),null);
 assert.throws(()=>planCommunalPond({id:'v',ground,water,policy:'typo'}));
});
test('new adaptive pond remains part of the shared neighborhood water and pedestrian model',()=>{
 const base={frame:{radiusM:6371000},worldId:'flat',groundElevationAt:ground,sampleSurfaceAt:water},site={id:'adaptive',population:300,latDeg:20,lonDeg:30,economicContext:{institutionPolicy:'medieval-communal@1',pondPolicy:'surveyed-communal-pond@2',publicAccessPolicy:'surveyed-public-footpaths@1',streetPolicy:'terrain-led-branches@2'}},r=createTerrainLedNeighborhood(base,site),p=r.waterFeatures[0];
 assert.ok(p?.survey);const chart=createGlobeFeatureChart(base,r),geo=chart.projection.toGeographic((p.bounds.minXM+p.bounds.maxXM)/2,(p.bounds.minYM+p.bounds.maxYM)/2);assert.ok(chart.sampleAt(geo.latDeg,geo.lonDeg).waterDepthM>.9);
 assert.equal(r.publicAccess.find(a=>a.targetId===p.id)?.status,'connected');assert.deepEqual(r,createTerrainLedNeighborhood(base,site));
});

test('a communal pond preserves the identity of existing water outside its own wet footprint',()=>{
 for(const policy of ['surveyed-communal-pond@1','surveyed-communal-pond@2']){
  const pond=planCommunalPond({id:'source-identity',policy,ground:()=>100,water:(x,y)=>({groundElevationM:100,waterDepthM:x>300?1:0,waterLevelElevationM:x>300?101:null,waterSourceIds:x>300?['river:existing']:[]})});
  assert.ok(pond);const outside=pond.sample(400,0);assert.equal(outside.waterDepthM,1);assert.deepEqual(outside.waterSourceIds,['river:existing']);
  const inside=pond.sample(pond.center.xM,pond.center.yM);assert.ok(inside.waterDepthM>0);assert.ok(inside.waterSourceIds.includes(pond.id));assert.ok(!inside.waterSourceIds.includes('river:existing'));
 }
});
