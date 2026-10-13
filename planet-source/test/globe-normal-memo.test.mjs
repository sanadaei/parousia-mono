import test from'node:test';import assert from'node:assert/strict';import{PagedSource}from'../src/globe/paged-source.mjs';
function source(){return Object.assign(Object.create(PagedSource.prototype),{manifest:{base:{derivativeStepM:1}},featureCache:{revision:0},meshNormals:{entries:new Map(),limit:2,revision:-1,step:null,hits:0,misses:0,evictions:0,newest:null}});}
test('normal memo has finite LRU capacity and never quantizes coordinate keys',()=>{
 const s=source(),a=[0,0,1],b=[0,1,0],c=[1,0,0];s.putMeshNormal('0.1,0,0',a);s.putMeshNormal('0.10000000000000002,0,0',b);
 assert.deepEqual(s.getMeshNormal('0.1,0,0'),a);s.putMeshNormal('third',c);
 assert.equal(s.getMeshNormal('0.10000000000000002,0,0'),null);assert.deepEqual(s.getMeshNormal('0.1,0,0'),a);
 assert.equal(s.meshNormals.entries.size,2);assert.equal(s.meshNormals.evictions,1);
});
test('normal memo invalidates on feature addition/eviction and derivative-step change',()=>{
 const s=source();s.putMeshNormal('a',[0,0,1]);s.featureCache.revision++;assert.equal(s.getMeshNormal('a'),null);
 s.putMeshNormal('a',[0,1,0]);s.manifest.base.derivativeStepM=2;assert.equal(s.getMeshNormal('a'),null);
 assert.equal(Object.create(PagedSource.prototype).getMeshNormal('a'),null);
});
