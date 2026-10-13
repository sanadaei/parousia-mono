import test from 'node:test';
import assert from 'node:assert/strict';
import {planSettlementDistricts} from '../src/core/settlement-districts.mjs';
import {createSettlementLayout} from '../src/core/settlement-layout.mjs';
const site={id:'city',latDeg:45,lonDeg:179.99,population:50003};
const base={frame:{radiusM:6371000},groundElevationAt:()=>20,sampleSurfaceAt:()=>({waterDepthM:0})};
test('all city households are allocated once, including final partial district',()=>{
 const p=planSettlementDistricts(site,base.frame.radiusM),ids=new Set();let people=0,houses=0;
 for(let i=0;i<p.count;i++){const d=p.district(i);assert.ok(!ids.has(`${d.column},${d.row}`));ids.add(`${d.column},${d.row}`);people+=d.population;houses+=d.requestedDwellings;}
 assert.equal(people,site.population);assert.equal(houses,10001);assert.equal(p.count,105);
 const grown=planSettlementDistricts({...site,population:100000},base.frame.radiusM);
 for(let i=0;i<p.count;i++){assert.equal(p.district(i).latDeg,grown.district(i).latDeg);assert.equal(p.district(i).lonDeg,grown.district(i).lonDeg);}
});
test('full city actually builds all requested houses on suitable land, not just first 96',()=>{
 const p=planSettlementDistricts(site,base.frame.radiusM),ids=new Set();let count=0;
 for(let i=0;i<p.count;i++){const r=createSettlementLayout(base,site,{districtIndex:i});assert.equal(r.layoutStatus.districtComplete,true);for(const b of r.buildings.filter(b=>!b.facilityType)){assert.ok(!ids.has(b.id));ids.add(b.id);count++;}assert.deepEqual(r,createSettlementLayout(base,site,{districtIndex:i}));}
 assert.equal(count,10001);
});
test('adjacent district street ports share exact canonical coordinates',()=>{
 const a=createSettlementLayout(base,site,{districtIndex:0}),b=createSettlementLayout(base,site,{districtIndex:1});
 assert.deepEqual(a.projection,b.projection);
 const pa=a.roadCenterlineProfiles.find(r=>r.roadId.endsWith('arterial:x:1')).samples.at(-1);
 const pb=b.roadCenterlineProfiles.find(r=>r.roadId.endsWith('arterial:x:-1')).samples.at(-1);
 assert.equal(pa.xM,pb.xM);assert.equal(pa.yM,pb.yM);assert.equal(pa.roadElevationM,pb.roadElevationM);
});
test('industry uses explicit regional sources, missing inputs remain rejected',()=>{
 const rich={...site,economicContext:{method:'test',populationId:'p',agricultureSuitability:.8,grainKgPerPersonYear:300,woodland:true,biome:'forest'}},r=createSettlementLayout(base,rich);
 assert.ok(r.economy.placements.some(p=>p.type==='carpenter'));assert.ok(r.economy.placements.some(p=>p.type==='handmill'));
 assert.ok(r.economy.rejected.some(p=>p.type==='smith'));assert.equal(r.layoutStatus.placedDwellings,96);
 for(const p of r.economy.placements)assert.ok(p.reasons.roadDistanceM>=15);
 assert.equal(createSettlementLayout(base,site).economy.placements.some(p=>p.type==='smith'),false);
 const full=buildBuildingMesh(r,base.frame.radiusM),coarse=buildBuildingMesh(r,base.frame.radiusM,{coarse:true});assert.deepEqual(full.buildingIds,coarse.buildingIds);assert.ok(coarse.vertex.byteLength<full.vertex.byteLength/4);
});
import {buildBuildingMesh} from '../src/globe/buildings.mjs';
test('land reservation priority is independent of query order, rejected homes are not relocated',()=>{const village={...site,id:'small',population:300},city={...site,id:'large'},blocked=createSettlementLayout(base,village,{nearbySettlements:[village,city]});assert.equal(blocked.layoutStatus.placedDwellings,0);assert.equal(createSettlementLayout(base,city,{nearbySettlements:[village,city]}).layoutStatus.placedDwellings,96);assert.deepEqual(blocked,createSettlementLayout(base,village,{nearbySettlements:[city,village]}));});
import {settlementRoadObstacle} from '../src/core/settlement-land-reservations.mjs';
import {createSphericalProjection} from '../src/core/spherical.mjs';
test('inter-village routing cannot cut through housing but may join its public streets',()=>{const block=settlementRoadObstacle(site,base.frame.radiusM),p=createSphericalProjection({centerLatDeg:site.latDeg,centerLonDeg:site.lonDeg,radiusM:base.frame.radiusM});assert.equal(block(p.toGeographic(0,0)),false);assert.equal(block(p.toGeographic(-135,100)),false);assert.equal(block(p.toGeographic(-154,105)),true);});
import {BuildingLayer} from '../src/globe/buildings.mjs';
test('a road entering the view is not culled because its distant midpoint lies outside the view',()=>{const a=.001,road={path:'road',center:[Math.cos(a),Math.sin(a),0],angularRadius:.001,roadLink:{}},layer=new BuildingLayer({}, {base:{frame:{radiusM:6371000}},featureCharts:[road]},'http://example.test/manifest.json'),selected=[];layer.load=d=>selected.push(d.path);layer.update({altitude:1000,targetUp:[1,0,0]});assert.deepEqual(selected,['road']);layer.destroy();});
test('explicit medieval institution profile creates a civic center without copying it into every quarter',()=>{
 const town={...site,economicContext:{institutionPolicy:'medieval-communal@1',populationId:'test',agricultureSuitability:.8,grainKgPerPersonYear:300,woodland:true,method:'test',biome:'forest'}};
 const central=createSettlementLayout(base,town,{districtIndex:0}),residential=createSettlementLayout(base,town,{districtIndex:2}),crafts=createSettlementLayout(base,town,{districtIndex:1});
 assert.equal(central.economy.districtRole,'civic-market');for(const type of ['hall','market','chapel','school'])assert.ok(central.economy.placements.some(p=>p.type===type),type);
 assert.equal(residential.economy.placements.length,0);assert.equal(residential.layoutStatus.placedDwellings,96);assert.equal(crafts.economy.districtRole,'crafts');assert.ok(crafts.economy.rejected.some(p=>p.type==='smith'));assert.ok(!crafts.economy.placements.some(p=>p.type==='hall'));
});
