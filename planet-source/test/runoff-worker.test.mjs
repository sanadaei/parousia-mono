import test from'node:test';import assert from'node:assert/strict';
import{RunoffClient}from'../src/globe/runoff-client.mjs';import{runRunoffJob}from'../src/globe/runoff-job.mjs';import{createRunoffState,stepRunoff}from'../src/core/runoff-dynamics.mjs';
function fake(){return{messages:[],terminated:false,postMessage(m){this.messages.push(m);},terminate(){this.terminated=true;},reply(result){const id=this.messages.at(-1).id;this.onmessage({data:{id,result}});}};}
test('runoff Worker jobs preserve direct Core results and bounded inputs',()=>{
 const state=createRunoffState({columns:3,rows:3,cellSizeM:5,groundElevationM:[3,2,1,3,2,1,3,2,1],waterDepthM:Array(9).fill(.1)}),before=structuredClone(state),job={type:'step',state,seconds:60,rainfallMmPerHour:50};
 assert.deepEqual(runRunoffJob(job).state,stepRunoff(state,{seconds:60,rainfallMPerSecond:50/1000/3600}));assert.deepEqual(state,before);
 for(const patch of[{seconds:61},{seconds:0},{rainfallMmPerHour:Infinity},{rainfallMmPerHour:501}])assert.throws(()=>runRunoffJob({...job,...patch}));assert.throws(()=>runRunoffJob({type:'other'}));
});
test('one pending runoff job, cancellation, stale replies and restart preserve state ownership',async()=>{
 const workers=[],client=new RunoffClient({createWorker:()=>{const w=fake();workers.push(w);return w;}}),first=client.request({type:'first'}),cancelled=assert.rejects(first,{name:'AbortError'});
 await assert.rejects(client.request({type:'overlap'}),/already running/);client.cancel();await cancelled;assert.equal(workers[0].terminated,true);
 const second=client.request({type:'second'});workers[0].reply({bad:true});workers[1].reply({state:42});assert.deepEqual(await second,{state:42});client.cancel();assert.equal(workers[1].terminated,true);
});
test('runoff timeout and Worker faults release jobs and allow retry',async()=>{
 const workers=[],client=new RunoffClient({createWorker:()=>{const w=fake();workers.push(w);return w;},timeoutMs:10});await assert.rejects(client.request({}),/timed out/);assert.equal(workers[0].terminated,true);
 const p=client.request({});workers[1].onerror({message:'broken'});await assert.rejects(p,/broken/);const q=client.request({});workers[2].reply({okay:true});assert.deepEqual(await q,{okay:true});client.cancel();
});
import fs from'node:fs';import{restorePlanetWorld}from'../src/core/planet-world.mjs';import{createPlanetRunoffScenario}from'../src/core/planet-runoff.mjs';
test('Worker initialization validates and samples an actual saved world with the same Core',()=>{
 const snapshot=fs.readFileSync(new URL('../examples/planet/generated/world.snapshot.json',import.meta.url),'utf8'),world=restorePlanetWorld(snapshot),options={cellSizeM:10,subcellSupports:true},result=runRunoffJob({type:'initialize',snapshot,expectedWorldId:world.worldId,options});
 assert.deepEqual(result.state,createPlanetRunoffScenario(world,options));assert.equal(result.world.worldId,world.worldId);assert.equal(result.world.settlements.length,world.settlements.length);
 assert.throws(()=>runRunoffJob({type:'initialize',snapshot,expectedWorldId:'wrong',options}),/一致/);assert.throws(()=>runRunoffJob({type:'initialize',snapshot,options:{settlementId:'missing'}}),/Unknown/);
});
