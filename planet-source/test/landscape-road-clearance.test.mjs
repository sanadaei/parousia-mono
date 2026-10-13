import test from 'node:test';import assert from 'node:assert/strict';import {compactRoadClearance,createLandscapeRoadClearance} from '../src/core/landscape-road-clearance.mjs';
test('land clearance reuses a saved road, keeps bends and removes redundant samples',()=>{const tile={latDeg:20,lonDeg:30},radiusM=6371000,recipe={projection:{centerLatDeg:20,centerLonDeg:30,radiusM},roadCenterlineProfiles:[{halfWidthM:2.5,samples:[{xM:-100,yM:0},{xM:0,yM:0},{xM:100,yM:0},{xM:100,yM:100}]}]},lines=compactRoadClearance(recipe);assert.equal(lines[0].points.length,3);const clear=createLandscapeRoadClearance(tile,radiusM,lines);assert.ok(clear.occupied({xM:0,yM:0},6));assert.ok(!clear.occupied({xM:0,yM:20},6));assert.ok(clear.intersectsTriangle([{xM:-10,yM:-10},{xM:10,yM:-10},{xM:0,yM:10}]));assert.ok(!clear.intersectsTriangle([{xM:-10,yM:20},{xM:10,yM:20},{xM:0,yM:30}]));});

test('a field tile requests only conservatively nearby road segments, not all regional links',async()=>{
 const {SettlementPages}=await import('../src/globe/settlement-pages.mjs'),radiusM=6371000;
 const long={id:'long',from:'a',to:'b',fromPoint:{latDeg:0,lonDeg:0},toPoint:{latDeg:0,lonDeg:8},points:[{latDeg:0,lonDeg:0},{latDeg:0,lonDeg:8}],distanceM:889559};
 const manifest={base:{worldId:'w',frame:{radiusM}},settlementCatalogue:{baseWorldId:'w',regions:[],landmarks:[],roadNetwork:{links:[long,...Array.from({length:100},(_,i)=>({id:`far:${i}`,fromPoint:{latDeg:40,lonDeg:i/100},toPoint:{latDeg:40,lonDeg:i/100+.01},distanceM:900}))]}}};
 const pages=new SettlementPages(manifest,'https://example.test/manifest.json',()=>{throw Error('No region should be downloaded');});
 const links=await pages.landscapeRoadLinks({latDeg:0,lonDeg:4});assert.ok(links.length>0&&links.length<=4);assert.ok(links.every(r=>r.parentRoadId==='long'));
});

test('woodland preparation excludes a road outside its maximum routing rectangle',async()=>{
 const {SettlementPages}=await import('../src/globe/settlement-pages.mjs'),{createSphericalProjection}=await import('../src/core/spherical.mjs'),radiusM=6371000,p=createSphericalProjection({centerLatDeg:0,centerLonDeg:0,radiusM});
 const link={id:'route',fromPoint:p.toGeographic(0,0),toPoint:p.toGeographic(20000,0),distanceM:20000},manifest={base:{worldId:'w',frame:{radiusM}},settlementCatalogue:{baseWorldId:'w',regions:[],landmarks:[],roadNetwork:{links:[link]}}},pages=new SettlementPages(manifest,'https://example.test/manifest.json',()=>{throw Error('No download');});
 assert.equal((await pages.landscapeRoadLinks(p.toGeographic(10000,16000))).length,0);
 assert.equal((await pages.landscapeRoadLinks(p.toGeographic(10000,10800))).length,1);
});
