import test from 'node:test';import assert from 'node:assert/strict';
import {boundedNodeField,materialColumn,inciseMaterialColumn} from '../scripts/experiments/mesh-materials.mjs';
import {createReliefMesh,evolveMeshRelief,preserveReliefMesh} from '../scripts/experiments/mesh-relief.mjs';
const mesh=createReliefMesh({points:[[0,0],[100,0],[0,100]],triangles:[[0,1,2]]});
const options={mesh,initial:[0,100,120],outlets:[0],steps:4,dtYears:1000,erodibility:.0001,upliftMPerYear:.001};
test('mesh spatial forcing retains scalar baseline, ownership and material-free snapshot identity',()=>{
 const a=evolveMeshRelief(options),k=[.0001,.0001,.0001],u=[.001,.001,.001];
 const b=evolveMeshRelief({...options,erodibility:k,upliftMPerYear:u});assert.deepEqual(a.heights,b.heights);
 k[1]=.01;u[1]=.1;assert.equal(b.report.erodibility[1],.0001);assert.equal(b.report.upliftMPerYear[1],.001);
 const saved=preserveReliefMesh(mesh,a,{seed:'material-test'}).toSnapshot();assert.equal(saved.references.reliefResearch.parameters.lithology,undefined);
 assert.throws(()=>evolveMeshRelief({...options,erodibility:[.001]}),/complete/);
 assert.throws(()=>evolveMeshRelief({...options,upliftMPerYear:[0,NaN,0]}),/bounded/);
});
test('layer crossings consume time and cannot tunnel through a resistant lower layer',()=>{
 const c=materialColumn({boundariesM:[50],multipliers:[.01,1]},[.0001]);
 const r=inciseMaterialColumn(100,0,.1,20,0,c);
 // 10 years to 50 under implicit upper-layer update, then 10 at 100x lower K.
 assert.equal(r.crossings,1);assert.ok(Math.abs(r.height-50/1.01)<1e-12);
 const weak=inciseMaterialColumn(100,0,.1,20,0,{boundariesM:[],multipliers:[1]});assert.ok(r.height>weak.height);
});
test('contacts move with uplift; datum translation changes no erosion',()=>{
 const c=materialColumn({boundariesM:[50],multipliers:[.01,1]},[.0001]);
 const a=inciseMaterialColumn(100,0,.1,20,0,c),b=inciseMaterialColumn(120,20,.1,20,20,c);
 assert.ok(Math.abs(b.height-a.height-20)<1e-12);assert.equal(b.crossings,a.crossings);
});
test('coincident material labels add no artificial stepping and repeated contacts are bounded',()=>{
 const c=materialColumn({boundariesM:[20,40,60],multipliers:[1,1,1,1]},[.0001]);
 assert.deepEqual(c,{boundariesM:[],multipliers:[1]});assert.equal(inciseMaterialColumn(100,0,.1,20,0,c).height,100/3);
 const r=inciseMaterialColumn(100,0,1,100,0,{boundariesM:[20,40,60],multipliers:[1,.9,.8,.7]});
 assert.equal(r.crossings,3);assert.ok(r.height>=0&&r.height<20);
});
test('invalid, sparse and unbounded material fields are rejected',()=>{
 for(const s of [{boundariesM:[20,10],multipliers:[1,2,3]},{boundariesM:[10],multipliers:[1]},
 {boundariesM:new Array(1),multipliers:[1,2]},{boundariesM:[0],multipliers:[1,Infinity]},
 {boundariesM:[0],multipliers:[1,1000]}])assert.throws(()=>materialColumn(s,[.0001]),RangeError);
 assert.throws(()=>boundedNodeField(new Array(3),3,0,1,'test'),RangeError);
});
test('spatial material and layered evolution save all forcing and keep outlets fixed',()=>{
 const spec={boundariesM:[75],multipliers:[.1,1]},r=evolveMeshRelief({...options,lithology:spec});
 assert.equal(r.heights[0],0);assert.ok(r.heights.every(Number.isFinite));spec.boundariesM[0]=999;
 assert.equal(r.report.lithology.boundariesM[0],75);
 const s=preserveReliefMesh(mesh,r,{seed:'material-test'}).toSnapshot();assert.deepEqual(s.references.reliefResearch.parameters.lithology,r.report.lithology);
});
