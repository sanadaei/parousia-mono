import test from'node:test';import assert from'node:assert/strict';import{GlobeStream}from'../src/globe/stream.mjs';import{tileKey}from'../src/globe/cube.mjs';
class FakeWorker{static all=[];constructor(){this.messages=[];this.terminated=false;FakeWorker.all.push(this);}postMessage(m){this.messages.push(m);}terminate(){this.terminated=true;}emit(data){this.onmessage?.({data});}}
function setup(t){const old=globalThis.Worker;globalThis.Worker=FakeWorker;FakeWorker.all=[];t.after(()=>globalThis.Worker=old);const renderer={dispose(){},destroy(){this.destroyed=true;}};return new GlobeStream(renderer,{},'http://example.test/manifest.json');}
test('fatal workers restart after bounded backoff without destroying retained geometry',t=>{
 const s=setup(t),slot=s.workers[0],old=slot.worker;s.cache.put('retained',{name:'old mesh'},4);old.onerror({message:'crash',preventDefault(){}});
 assert.equal(old.terminated,true);assert.equal(slot.worker,null);assert.ok(slot.retryAt>Date.now());s.dispatch();assert.equal(FakeWorker.all.length,2);
 slot.retryAt=0;s.dispatch();assert.equal(FakeWorker.all.length,3);assert.equal(slot.restarts,1);assert.equal(s.cache.entries.size,1);
 old.emit({type:'ready'});assert.equal(slot.ready,false,'stale worker must not revive a slot');slot.worker.emit({type:'ready'});assert.equal(slot.ready,true);s.destroy();
});
test('stale job IDs cannot clear a new mesh request',t=>{
 const s=setup(t),tile={face:0,level:0,x:0,y:0},slot=s.workers[0];s.wanted.set(tileKey(tile),{tile,priority:0});slot.worker.emit({type:'ready'});const id=slot.job.id;
 slot.worker.emit({type:'cancelled',id:id-1});assert.equal(slot.job.id,id);
 slot.worker.emit({type:'mesh',id,mesh:{tile}});assert.equal(slot.job,null);assert.equal(s.uploads.length,1);s.destroy();
});
test('hung startup and jobs are reclaimed, and destroy does not restart them',async t=>{
 const s=setup(t),slot=s.workers[0];slot.startedAt=Date.now()-16000;s.dispatch();assert.equal(slot.worker,null);
 slot.retryAt=0;s.dispatch();slot.worker.emit({type:'ready'});const pending=s.probe({latDeg:0,lonDeg:0}),rejected=assert.rejects(pending,/deadline/);slot.job.startedAt=Date.now()-121000;s.dispatch();await rejected;
 const count=FakeWorker.all.length;s.destroy();slot.retryAt=0;s.dispatch();assert.equal(FakeWorker.all.length,count);assert.ok(FakeWorker.all.every(w=>w.terminated));
});
test('repeated startup failure increases delay but stays bounded',t=>{
 const s=setup(t),slot=s.workers[0];let previous=0;
 for(let i=0;i<9;i++){slot.worker.onerror({message:'failed'});const delay=slot.retryAt-Date.now();assert.ok(delay>=previous-10);assert.ok(delay<=60000);previous=delay;slot.retryAt=0;s.dispatch();}
 assert.equal(slot.restarts,9);assert.ok(s.errors.length<=10);assert.equal(FakeWorker.all.filter(w=>!w.terminated).length,2);s.destroy();
});
test('explicit reload preserves cached meshes while replacing exactly two workers',t=>{
 const s=setup(t);s.cache.put('kept',{name:'mesh'},4);s.restartWorkers();assert.equal(FakeWorker.all.length,4);assert.equal(FakeWorker.all.filter(w=>!w.terminated).length,2);assert.equal(s.cache.entries.size,1);assert.ok(s.workers.every(s=>s.restarts===1));s.destroy();
});
test('retry bookkeeping stays bounded during repeated failed page requests',t=>{
 const s=setup(t);for(let i=0;i<2000;i++)s.deferTile(`failed:${i}`,Date.now()+10000);assert.equal(s.failedUntil.size,1024);
 for(const key of s.failedUntil.keys())s.failedUntil.set(key,0);s.dispatch();assert.equal(s.failedUntil.size,0);s.destroy();
});
test('stream requests displayable coarse ancestors before attractive but unusable descendants',t=>{
 const s=setup(t),root={face:0,level:0,x:0,y:0},child={face:0,level:1,x:0,y:0},fine={face:0,level:2,x:0,y:0},other={face:1,level:0,x:0,y:0};
 for(const [tile,priority] of [[fine,-100],[child,-10],[root,10],[other,20]])s.wanted.set(tileKey(tile),{tile,priority});
 const slot=s.workers[0];slot.worker.emit({type:'ready'});assert.deepEqual(slot.job.tile,root);
 slot.worker.emit({type:'mesh',id:slot.job.id,mesh:{tile:root}});assert.deepEqual(slot.job.tile,other,'pending upload is not a displayed ancestor');
 s.cache.put(tileKey(root),{tile:root},4);slot.worker.emit({type:'mesh',id:slot.job.id,mesh:{tile:other}});assert.deepEqual(slot.job.tile,child);
 s.destroy();
});

test('a newer queued inspection cancels the older request without a runtime failure',async()=>{const s=Object.assign(Object.create(GlobeStream.prototype),{probeRequest:null,dispatch(){}}),first=s.probe({latDeg:0,lonDeg:0}),cancelled=assert.rejects(first,e=>e.name==='AbortError'&&e.message==='Probe superseded'),second=s.probe({latDeg:1,lonDeg:2});await cancelled;s.probeRequest.resolve({point:s.probeRequest.point});assert.deepEqual(await second,{point:{latDeg:1,lonDeg:2}});});

test('a distant opposite-face frontier does not starve a ready nearby branch',t=>{
 const s=setup(t),root={face:0,level:0,x:0,y:0},parent={face:0,level:1,x:0,y:0},near={face:0,level:2,x:0,y:0},far={face:1,level:1,x:1,y:1};
 s.cache.put(tileKey(root),{tile:root},4);for(const t of [{face:0,level:1,x:0,y:0},{face:0,level:1,x:1,y:0},{face:0,level:1,x:0,y:1},{face:0,level:1,x:1,y:1}])s.cache.put(tileKey(t),{tile:t},4);
 s.cache.put(tileKey({face:1,level:0,x:0,y:0}),{tile:{face:1,level:0,x:0,y:0}},4);s.wanted.set(tileKey(far),{tile:far,priority:100});s.wanted.set(tileKey(near),{tile:near,priority:.2});
 const slot=s.workers[0];slot.worker.emit({type:'ready'});assert.deepEqual(slot.job.tile,near);s.destroy();
});

test('near descendants wait for the complete parent sibling group',t=>{
 const s=setup(t),root={face:0,level:0,x:0,y:0},parent={face:0,level:1,x:0,y:0},fine={face:0,level:2,x:0,y:0},sibling={face:0,level:1,x:1,y:0};
 s.cache.put(tileKey(root),{tile:root},4);s.cache.put(tileKey(parent),{tile:parent},4);
 s.wanted.set(tileKey(fine),{tile:fine,priority:0});s.wanted.set(tileKey(sibling),{tile:sibling,priority:10});
 const slot=s.workers[0];slot.worker.emit({type:'ready'});assert.deepEqual(slot.job.tile,sibling);s.destroy();
});

import{streamLimitsForBudget}from'../src/globe/stream.mjs';
test('memory presets are fixed, reserve one MiB for villages, and reject arbitrary expansion',t=>{
 assert.equal(streamLimitsForBudget().gpuBytes,63*1024*1024);
 assert.equal(streamLimitsForBudget(128).gpuBytes,127*1024*1024);
 for(const n of [0,65,256,Infinity,'128'])assert.throws(()=>streamLimitsForBudget(n),/budget/);
 const old=globalThis.Worker;globalThis.Worker=FakeWorker;t.after(()=>globalThis.Worker=old);
 const s=new GlobeStream({dispose(){},destroy(){}},{},'http://example.test/world',{meshBudgetMiB:128});
 assert.equal(s.cache.maxBytes,s.limits.gpuBytes);assert.equal(s.limits.maxWantedTiles,6144);
 s.destroy();
});

test('deadline diagnostics identify the blocked mesh without losing cached geometry',t=>{const s=setup(t),tile={face:3,level:5,x:0,y:16},slot=s.workers[0];s.wanted.set(tileKey(tile),{tile,priority:0});slot.ready=true;slot.job={id:7,tile,startedAt:Date.now()-121000};s.recoverWorkers();assert.match(s.errors.at(-1),/3\/5\/0\/16/);assert.equal(slot.job,null);s.destroy();});
test('provisional cached tiles are refined again without starving missing visible tiles',t=>{const s=setup(t),a={face:0,level:0,x:0,y:0},b={face:1,level:0,x:0,y:0};s.cache.put(tileKey(a),{tile:a,pendingFeatures:1},4);s.wanted.set(tileKey(a),{tile:a,priority:0});s.wanted.set(tileKey(b),{tile:b,priority:1});const slot=s.workers[0];slot.worker.emit({type:'ready'});assert.deepEqual(slot.job.tile,b);assert.deepEqual(slot.worker.messages.at(-1).retainedTiles,[tileKey(a),tileKey(b)]);slot.worker.emit({type:'mesh',id:slot.job.id,mesh:{tile:b}});assert.deepEqual(slot.job.tile,a);s.destroy();});
