import test from 'node:test';
import assert from 'node:assert/strict';
import {solveRegionalDrainage} from '../src/core/regional-drainage.mjs';
import {createRegionalWaterContext,regionalWaterWindow,saveRegionalWaterWindow} from '../src/core/regional-water-context.mjs';
import {CommittedMaterializer} from '../src/core/committed-materialization.mjs';
test('legacy unowned context preserves pinned43d0afa identity and reload',async()=>{
 const elevation=Array.from({length:25},(_,i)=>100-i);
 const drainage=solveRegionalDrainage({columns:5,rows:5,cellSizeM:200,elevation,localSupplyM3PerYear:Array(25).fill(1),outlets:[{id:'legacy-exit',cell:24,kind:'river',levelM:76}]});
 assert.equal(drainage.supplyOwnership,undefined);
 const parent=createRegionalWaterContext({sourceWorldId:'legacy-world',sourceLayerId:'L1',grid:drainage.grid,elevation,drainage});
 assert.equal(parent.id,'sha256:85cabf2ddf623c114ee481dd9de72c8d58f24b2604116bf5f1af7c276ab03e85');
 const restored=JSON.parse(JSON.stringify(parent));const settings={x0M:0,y0M:0,widthM:800,heightM:800,cellSizeM:200};assert.deepEqual(regionalWaterWindow(parent,settings),regionalWaterWindow(restored,settings));
 const values=new Map(),storage={get:async k=>values.get(k),putIfAbsent:async(k,v)=>{if(!values.has(k))values.set(k,v);return values.get(k);}};
 const a=await saveRegionalWaterWindow(new CommittedMaterializer(storage),parent,settings,'legacy-window');const b=await saveRegionalWaterWindow(new CommittedMaterializer(storage),restored,settings,'legacy-window');assert.deepEqual(a,b);
});
