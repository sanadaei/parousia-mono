import test from 'node:test';
import assert from 'node:assert/strict';
import {PopulationZoneView} from '../src/globe/population-zone-map.mjs';
import {DeferredPopulationPages,zoneDescriptor} from '../src/globe/deferred-population-pages.mjs';
const tick=()=>new Promise(resolve=>setImmediate(resolve));
const cam=(altitude=100000,targetUp=[1,0,0])=>({altitude,targetUp});
test('population view permits one request and rejects late camera results',async()=>{
 const requests=[],pages={summaries:(...args)=>new Promise(resolve=>requests.push({args,resolve}))},v=new PopulationZoneView(pages,6371000);
 v.update(cam(),0,true);await tick();v.update(cam(1000),2000,true);assert.equal(requests.length,1);
 requests[0].resolve({zones:[{id:'old'}],status:'view-summary'});await tick();assert.deepEqual(v.zones,[]);
 v.update(cam(1000),3000,true);await tick();requests[1].resolve({zones:[{id:'new'}],status:'view-summary'});await tick();assert.equal(v.zones[0].id,'new');
 v.update(cam(1000),5000,true);await tick();assert.equal(requests.length,2);v.destroy();
});
test('disabled or destroyed population views never publish pending results',async()=>{
 for(const destroy of [false,true]){let resolve;const v=new PopulationZoneView({summaries:()=>new Promise(r=>resolve=r)},6371000);v.update(cam(),0,true);await tick();if(destroy)v.destroy();else v.update(cam(),2000,false);resolve({zones:[{id:'late'}],status:'view-summary'});await tick();assert.deepEqual(v.zones,[]);v.destroy();}
});
test('population view retries errors and small zoom changes share a quantized view',async()=>{
 let calls=0;const v=new PopulationZoneView({summaries:async()=>{calls++;if(calls===1)throw Error('read failure');return{zones:[],status:'view-summary'};}},6371000);
 v.update(cam(),0,true);await tick();assert.equal(v.error,'read failure');v.update(cam(),1500,true);await tick();assert.equal(v.error,null);v.update(cam(100001),3000,true);await tick();assert.equal(calls,2);v.destroy();
});
const zone=(id,bounds,population=3000000000)=>({id,rootCell:0,depth:id.split('/').length-1,population,villages:1000000,towns:0,cities:0,bounds});
function fixture(){const p=Object.create(DeferredPopulationPages.prototype),root=zone('root',{west:-4,east:4,south:-4,north:4});let calls=0;p.world={base:{frame:{radiusM:6371000}}};p.init=async()=>{};p.roots=[zoneDescriptor(root)];p.region=()=>{throw Error('must not materialize sites');};p.hierarchy={split:async z=>{calls++;const b=z.bounds,x=(b.west+b.east)/2,y=(b.south+b.north)/2;return{unallocatedPopulation:0,children:[[b.west,x,b.south,y],[x,b.east,b.south,y],[b.west,x,y,b.north],[x,b.east,y,b.north]].map(([west,east,south,north],i)=>zone(`${z.id}/${i}`,{west,east,south,north},z.population/4))};}};return{p,root,calls:()=>calls};}
const bound={center:[1,0,0],angular:Math.PI};
test('summary budget retains authoritative parents and conserves population',async()=>{const{p,calls}=fixture();const r=await p.summaries(bound,null,{targetSpanM:2000,maxNodes:1});assert.equal(calls(),1);assert.equal(r.zones.length,4);assert.equal(r.zones.reduce((s,z)=>s+z.population,0),3000000000);assert.equal(r.limited,true);});
test('summary display budget avoids splitting with insufficient room',async()=>{const{p,root,calls}=fixture();const r=await p.summaries(bound,null,{targetSpanM:2000,maxZones:1});assert.deepEqual(r.zones,[root]);assert.equal(calls(),0);});
test('global summary falls back to census instead of truncating roots',async()=>{const{p,calls}=fixture();p.roots=[...p.roots,...p.roots];const r=await p.summaries(bound,null,{maxZones:1});assert.equal(r.status,'global-census');assert.deepEqual(r.zones,[]);assert.equal(calls(),0);});
test('summary rejects invalid spatial inputs and honors cancellation before init',async()=>{const{p}=fixture();await assert.rejects(p.summaries({center:[0,0,0],angular:1}),/unit vector/);const c=new AbortController();c.abort();p.init=()=>{throw Error('should not initialize');};await assert.rejects(p.summaries(bound,c.signal),{name:'AbortError'});});
