import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';
import {createTerrainAdapter,TRIANGULAR_TERRAIN_SCHEMA} from '../src/core/index.mjs';
import {prepareTriangularRegion,replaceTriangularPackets,TRIANGLE_SCENE_BYTE_LIMIT} from '../src/globe/triangular-session.mjs';
const source=()=>createTerrainAdapter({schema:TRIANGULAR_TERRAIN_SCHEMA,seed:'ui-region',revision:'1',frame:{kind:'planar-metric',verticalDatum:'test'},mesh:{points:[[0,0],[100,0],[100,100],[0,100]],triangles:[[0,1,2],[0,2,3]]},fields:{groundElevationM:[0,0,20,10]}}).toSnapshot();
test('region preparation yields bounded native draw packets with fixed identity',async()=>{
 const raw=source();let yields=0;const p=await prepareTriangularRegion(raw,{}, {yieldNow:async()=>{yields++;}});
 assert.equal(yields,16);assert.equal(p.packets.length,16);assert.equal(p.view.sourceWorldId,raw.worldId);assert.ok(p.bytes>0&&p.bytes<TRIANGLE_SCENE_BYTE_LIMIT);assert.ok(Number.isFinite(p.focus.ground));
 const altered=source();altered.fields.groundElevationM[0]=1;await assert.rejects(()=>prepareTriangularRegion(altered),/worldId/);
});
test('superseded preparation aborts at a cooperative boundary',async()=>{
 let current=true;await assert.rejects(()=>prepareTriangularRegion(source(),{}, {yieldNow:async()=>{current=false;},isCurrent:()=>current}),{name:'AbortError'});
});
test('failed or cancelled uploads release staged resources and preserve previous display',async()=>{
 for(const mode of ['failure','cancel']){const old={old:true},live=new Set([old]);let count=0,current=true;
  const r={upload(m){if(mode==='failure'&&++count===2)throw new Error('GPU allocation failed');const t={m};live.add(t);return t;},dispose(t){assert.ok(live.delete(t));}};
  await assert.rejects(()=>replaceTriangularPackets(r,[old],{packets:[1,2,3]},{yieldNow:async()=>{if(mode==='cancel')current=false;},isCurrent:()=>current}));assert.deepEqual([...live],[old]);
 }
});
test('successful replacement swaps only after complete upload and page entry is linked',async()=>{
 const old={old:true},live=new Set([old]),r={upload(m){const t={m};live.add(t);return t;},dispose(t){assert.ok(live.delete(t));}};
 const next=await replaceTriangularPackets(r,[old],{packets:[1,2]},{yieldNow:async()=>assert.ok(live.has(old))});assert.deepEqual(new Set(next),live);assert.equal(live.has(old),false);
 assert.match(fs.readFileSync(new URL('../src/globe/index.html',import.meta.url),'utf8'),/href="\.\/relief\.html"/);
 assert.match(fs.readFileSync(new URL('../src/globe/relief.html',import.meta.url),'utf8'),/src="\.\/relief-view\.mjs"/);
});
