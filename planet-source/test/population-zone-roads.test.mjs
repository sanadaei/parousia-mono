import test from 'node:test';import assert from 'node:assert/strict';
import {sharedPopulationEdge,proposePopulationZoneRoad,commitPopulationZoneRoad} from '../src/core/population-zone-roads.mjs';
import {CommittedMaterializer} from '../src/core/committed-materialization.mjs';
const R=6371000,z=(id,west,east,south=0,north=.1)=>({id,bounds:{west,east,south,north}}),reg=(zone,lon)=>({sites:[{id:`${zone.id}/site:0`,latDeg:.05,lonDeg:lon,population:300}]});
test('population road adjacency handles unequal leaves, wrap and excludes corners',()=>{assert.ok(sharedPopulationEdge(z('a',359.9,360),z('b',0,.1)));assert.ok(sharedPopulationEdge(z('a',0,.1),z('b',.1,.2,0,.05)));assert.equal(sharedPopulationEdge(z('a',0,.1),z('b',.1,.2,.1,.2)),false);assert.equal(sharedPopulationEdge(z('a',0,.2),z('b',.05,.1,.02,.08)),false);});
test('inter-zone road endpoints do not depend on argument order and incomplete routes remain explicit',()=>{const a=z('a',0,.1),b=z('b',.1,.2),A=reg(a,.05),B=reg(b,.15);const r=proposePopulationZoneRoad(a,A,b,B,R);assert.deepEqual(r,proposePopulationZoneRoad(b,B,a,A,R));assert.equal(r.status,'awaiting-local-route');assert.ok(r.link.distanceM>10000);assert.equal(proposePopulationZoneRoad(a,A,b,{sites:[]},R).status,'no-settlements');assert.equal(proposePopulationZoneRoad(a,A,b,B,R,{maxDistanceM:1000}).status,'requires-long-distance-route');assert.throws(()=>proposePopulationZoneRoad(a,B,b,A,R),/match zone/);});
test('committed road proposal is reused after reopen even if a new planner would differ',async()=>{const records=new Map(),storage={get:async k=>records.get(k),putIfAbsent:async(k,v)=>{if(!records.has(k))records.set(k,v);return records.get(k)}};const a=z('a',0,.1),b=z('b',.1,.2),A=reg(a,.05),B=reg(b,.15),args={worldId:'w',zoneA:a,regionA:A,zoneB:b,regionB:B,radiusM:R};const result=await commitPopulationZoneRoad(new CommittedMaterializer(storage),args);assert.deepEqual(await commitPopulationZoneRoad(new CommittedMaterializer(storage),{...args,zoneA:b,regionA:B,zoneB:a,regionB:A,generate:()=>{throw Error('must not regenerate')}}),result);assert.equal(records.size,1);});

test('reference-driven road neighbourhood uses a complete fixed influence margin and reuses commitments',async()=>{
 const {DeferredPopulationPages,zoneDescriptor}=await import('../src/globe/deferred-population-pages.mjs');
 const {sphereBasis}=await import('../src/core/spherical.mjs');
 const records=new Map(),storage={get:async k=>records.get(k),putIfAbsent:async(k,v)=>{if(!records.has(k))records.set(k,v);return records.get(k)}};
 const a=z('population-zone:0',0,.1),b=z('population-zone:1',.1,.2),A=reg(a,.05),B=reg(b,.15),manifest={settlementCatalogue:{interZoneRoadPolicy:'adjacent-committed-sites@1'}};
 const pages=new DeferredPopulationPages(manifest,'https://example.invalid/',null,{storage});pages.world={worldId:'saved-world',base:{frame:{radiusM:R}}};pages.materializer=new CommittedMaterializer(storage);
 let calls=0;pages.descriptors=async(bound,signal,padding,options)=>{calls++;assert.equal(padding,76000);assert.equal(options.observe,false);return [zoneDescriptor(a),zoneDescriptor(b)]};pages.region=async zone=>zone.id===a.id?A:B;
 const bound={center:sphereBasis({latDeg:.05,lonDeg:.1}).up,angular:100/R};
 const first=await pages.roadLinks(bound);assert.equal(first.length,1);assert.deepEqual(await pages.roadLinks(bound),first);assert.equal(records.size,1);assert.equal(calls,2);
 manifest.settlementCatalogue.interZoneRoadPolicy=undefined;assert.deepEqual(await pages.roadLinks(bound),[]);assert.equal(calls,2);
});
