import test from 'node:test';import assert from 'node:assert/strict';
import {createReliefMesh,evolveMeshRelief,meshHeightSampler,rasterizeReliefMesh} from '../scripts/experiments/mesh-relief.mjs';
import {routeBasinGraph} from '../scripts/experiments/mst-relief.mjs';
import {restoreMetricTerrain} from '../src/ui/scene.mjs';
const input=()=>({points:[[0,0],[100,0],[100,100],[0,100],[45,55]],triangles:[[0,1,4],[1,2,4],[2,3,4],[3,0,4]]});
test('irregular mesh retains metric adjacency, exact total lumped area and input ownership',()=>{
 const q=input(),m=createReliefMesh(q);assert.equal(m.nodeCount,5);assert.equal(Array.from(m.nodeAreasM2).reduce((a,b)=>a+b,0),10000);
 assert.deepEqual(m.boundaryNodes,[0,1,2,3]);assert.equal(m.neighbors[0].find(x=>x.i===4).distanceM,Math.hypot(45,55));
 q.points[4][0]=99;assert.equal(m.contract.points[4][0],45);
 const r=routeBasinGraph([0,4,8,4,2],m,{outlets:[0]});assert.ok(Math.abs(r.area[0]-10000)<1e-9);assert.equal(r.order.length,5);
});
test('irregular incision is deterministic, preserves declared outlet and routes every node',()=>{
 const m=createReliefMesh(input()),z=[0,4,8,4,2],options={mesh:m,initial:z,outlets:[0],steps:4,dtYears:1000,erodibility:.0001,upliftMPerYear:.001};
 const a=evolveMeshRelief(options),b=evolveMeshRelief(options);assert.deepEqual(a.heights,b.heights);assert.equal(a.heights[0],0);assert.deepEqual(z,[0,4,8,4,2]);
 for(let i=0;i<5;i++){let j=i,steps=0;while(a.routing.receiver[j]>=0){j=a.routing.receiver[j];assert.ok(++steps<=5);}assert.equal(j,0);}
 assert.equal(a.report.meshId,m.id);assert.deepEqual(a.report.outlets,[0]);
});
test('mesh validation refuses bad topology, degeneracy and unbounded evolution',()=>{
 const q=input();assert.throws(()=>createReliefMesh({...q,triangles:[[0,4,1]]}),/counterclockwise/);
 assert.throws(()=>createReliefMesh({...q,triangles:[...q.triangles,q.triangles[0]]}),/Duplicate/);
 assert.throws(()=>createReliefMesh({...q,points:[...q.points,[200,200]]}),/Isolated/);
 const m=createReliefMesh(q);assert.throws(()=>evolveMeshRelief({mesh:m,initial:[0,4,8,4,2],outlets:[],steps:3,dtYears:1,erodibility:.0001,upliftMPerYear:0}),/bounded/);
});
test('barycentric mesh reconstruction preserves a plane and refuses missing coverage',()=>{
 const m=createReliefMesh(input()),h=m.contract.points.map(([x,y])=>x+2*y),s=meshHeightSampler(m,h);
 for(const[x,y]of[[0,0],[100,100],[25,45],[45,55]])assert.ok(Math.abs(s.heightAt(x,y)-x-2*y)<1e-9);
 h[0]=10000;assert.equal(s.heightAt(0,0),0);assert.throws(()=>s.heightAt(-1,0),/outside/);
 const triangle=createReliefMesh({points:[[0,0],[100,0],[0,100]],triangles:[[0,1,2]]});
 assert.throws(()=>meshHeightSampler(triangle,[0,0,0]).heightAt(90,90),/uncovered/);
});
test('triangular result exports through the actual canonical viewer loader with explicit conversion loss',()=>{
 const m=createReliefMesh(input()),r=evolveMeshRelief({mesh:m,initial:[0,4,8,4,2],outlets:[0],steps:2,dtYears:1000,erodibility:.0001,upliftMPerYear:.001});
 const {terrain:t,diagnostics:d}=rasterizeReliefMesh(m,r,{n:9,extentM:100,seed:'mesh-export'}),saved=t.toSnapshot(),restored=restoreMetricTerrain(saved).terrain;
 assert.equal(restored.worldId,t.worldId);assert.deepEqual(restored.sampleAt(34,56),t.sampleAt(34,56));
 assert.equal(saved.fields.waterLevelElevationM,null);assert.equal(saved.references.reliefResearch.parameters.outlets,undefined);
 assert.deepEqual(saved.references.reliefResearch.meshSource.sourceOutletNodes,[0]);assert.equal(d.sourceNodesChecked,5);assert.ok(d.maxNodeReconstructionDifferenceM>=0);
 assert.throws(()=>rasterizeReliefMesh(m,r,{n:9,extentM:200,seed:'outside'}),/outside/);
});
