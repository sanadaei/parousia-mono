import test from'node:test';import assert from'node:assert/strict';import{recordBenchmarkFrame}from'../src/globe/benchmark-summary.mjs';
test('long benchmark samples remain bounded and include later frames',()=>{const b={};for(let i=1;i<=97;i++)recordBenchmarkFrame(b,i,2*i,{capacity:8});assert.equal(b.frames,97);assert.ok(b.intervals.length<=8);assert.equal(b.sampleStride,16);assert.deepEqual(b.intervals,[16,32,48,64,80,96]);assert.deepEqual(b.cpu,b.intervals.map(i=>i*2));assert.equal(b.intervalMaxMs,97);assert.equal(b.cpuMaxMs,194);assert.equal(b.framesOver33ms,64);});
test('uncaptured late stalls still affect full-run maxima and slow frame counts',()=>{const b={};for(let i=1;i<=97;i++)recordBenchmarkFrame(b,i===97?1000:10,i===97?800:2,{capacity:8});assert.equal(b.intervalMaxMs,1000);assert.equal(b.cpuMaxMs,800);assert.equal(b.framesOver33ms,1);assert.ok(!b.intervals.includes(1000));assert.throws(()=>recordBenchmarkFrame(b,NaN,0),/timing/);assert.throws(()=>recordBenchmarkFrame({},1,0,{capacity:3}),/capacity/);});

import{benchmarkRunProgress}from'../src/globe/benchmark-summary.mjs';
test('intermediate benchmark exports cannot impersonate a completed long run',()=>{
 assert.deepEqual(benchmarkRunProgress({elapsedMs:300000,requestedDurationMs:1800000}),{runStatus:'running-checkpoint',requestedDurationMs:1800000,completionFraction:1/6});
 assert.equal(benchmarkRunProgress({elapsedMs:1800001,requestedDurationMs:1800000,complete:true}).runStatus,'completed');
 assert.equal(benchmarkRunProgress({elapsedMs:1800001,requestedDurationMs:1800000}).runStatus,'running-checkpoint');
 assert.throws(()=>benchmarkRunProgress({elapsedMs:1799999,requestedDurationMs:1800000,complete:true}),/before/);
 assert.throws(()=>benchmarkRunProgress({elapsedMs:NaN,requestedDurationMs:1800000}));
});

import {benchmarkFrameBudgetPass} from '../src/globe/benchmark-summary.mjs';
test('constant 30fps acceptance rejects rare slow frames hidden by p95',()=>{
 const good={rendererKind:'webgl2',actualDrawFPS:60,frames:600,framesOver33ms:0,intervalMs:{p95:16.7,max:20}};
 assert.equal(benchmarkFrameBudgetPass(good),true);
 for(const patch of [{framesOver33ms:1,intervalMs:{p95:16.7,max:40}},{framesOver33ms:1},{intervalMs:{max:40}},{rendererKind:'software-diagnostic'},{frames:0},{actualDrawFPS:29}])assert.equal(benchmarkFrameBudgetPass({...good,...patch}),false);
});
