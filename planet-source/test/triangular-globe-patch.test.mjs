import test from 'node:test';import assert from 'node:assert/strict';
import {createTerrainAdapter,TRIANGULAR_TERRAIN_SCHEMA} from '../src/core/index.mjs';
import {createTriangularPatchView,buildTriangularPatchMesh} from '../src/globe/triangular-patch.mjs';
import {GlobeRenderer} from '../src/globe/renderer.mjs';
const saved=()=>createTerrainAdapter({schema:TRIANGULAR_TERRAIN_SCHEMA,seed:'geographic-ridge',revision:'1',frame:{kind:'planar-metric',verticalDatum:'test'},mesh:{points:[[0,0],[100,0],[100,100],[0,100],[43,57]],triangles:[[0,1,4],[1,2,4],[2,3,4],[3,0,4]]},fields:{groundElevationM:[0,0,0,0,80]}}).toSnapshot();
const view=(lat=40,lon=179.999)=>createTriangularPatchView(saved(),{projection:{centerLatDeg:lat,centerLonDeg:lon,radiusM:6371000,maxRadiusM:1000},metricOrigin:{xM:50,yM:50}});
test('geographic binding has stable separate identity and round trips across antimeridian and poles',()=>{
 for(const lat of [40,89.999,90,-90]){const v=view(lat),p=v.toGeographic(43,57),s=v.sampleGeographic(p.latDeg,p.lonDeg);assert.ok(Math.abs(s.groundElevationM-80)<1e-5);assert.equal(v.viewId,view(lat).viewId);assert.equal(v.sourceWorldId,saved().worldId);}
 assert.notEqual(view(40).viewId,view(41).viewId);assert.throws(()=>view().sampleGeographic(0,0),/projection/);
});
test('native draw buffers retain ridge vertices without a coarse-grid morph',()=>{
 const v=view(),m=buildTriangularPatchMesh(v,{minXM:0,minYM:0,maxXM:100,maxYM:100});assert.equal(m.index.length,12);
 let maximum=0;for(let i=0;i<m.vertex.length;i+=12){assert.deepEqual(Array.from(m.vertex.slice(i,i+3)),Array.from(m.vertex.slice(i+3,i+6)));const r=Math.hypot(...m.anchor.map((v,k)=>v+m.vertex[i+k]));maximum=Math.max(maximum,r-v.radiusM);}
 assert.ok(Math.abs(maximum-80)<1e-4);assert.ok(m.diagnostics.maxVertexFloat32ErrorM<1e-4);assert.ok(m.diagnostics.maxSampledChordErrorM<.01);
 assert.throws(()=>buildTriangularPatchMesh(v,{minXM:0,minYM:0,maxXM:100,maxYM:100,maxTriangles:1}),/budget/);
});
test('regional draw packet uses actual GlobeRenderer upload/disposal layout',()=>{
 const m=buildTriangularPatchMesh(view(),{minXM:0,minYM:0,maxXM:100,maxYM:100});let id=0;const live=new Set();
 const gl={NO_ERROR:0,ARRAY_BUFFER:1,ELEMENT_ARRAY_BUFFER:2,STATIC_DRAW:3,FLOAT:4,createBuffer(){live.add(++id);return id;},createVertexArray(){live.add(++id);return id;},deleteBuffer(i){assert.ok(live.delete(i));},deleteVertexArray(i){assert.ok(live.delete(i));},bindVertexArray(){},bindBuffer(){},bufferData(){},enableVertexAttribArray(){},vertexAttribPointer(){},getError(){return 0;},isContextLost(){return false;}};
 const renderer=Object.assign(Object.create(GlobeRenderer.prototype),{gl,gpuBytes:0,peakGpuBytes:0,allocations:0,deletions:0}),tile=renderer.upload(m);assert.equal(tile.ground.count,m.index.length);assert.equal(renderer.gpuBytes,m.diagnostics.bufferBytes);renderer.dispose(tile);assert.equal(renderer.gpuBytes,0);assert.equal(live.size,0);
});
test('cooperative packet preparation yields without changing any draw buffer',async()=>{
 const {iterateTriangularPatchMesh}=await import('../src/globe/triangular-patch.mjs');const points=[],triangles=[];
 for(let y=0;y<17;y++)for(let x=0;x<17;x++)points.push([x*10,y*10]);
 for(let y=0;y<16;y++)for(let x=0;x<16;x++){const a=y*17+x;triangles.push([a,a+1,a+17],[a+1,a+18,a+17]);}
 const s=createTerrainAdapter({schema:TRIANGULAR_TERRAIN_SCHEMA,seed:'cooperative',revision:'1',frame:{kind:'planar-metric',verticalDatum:'test'},mesh:{points,triangles},fields:{groundElevationM:points.map(([x,y])=>x*.1+y*.2)}}).toSnapshot();
 const v=createTriangularPatchView(s,{projection:{centerLatDeg:0,centerLonDeg:0,radiusM:6371000,maxRadiusM:1000},metricOrigin:{xM:80,yM:80}}),options={minXM:0,minYM:0,maxXM:160,maxYM:160};
 const it=iterateTriangularPatchMesh(v,options);let step,yields=0;do{step=it.next();if(!step.done)yields++;}while(!step.done);
 assert.ok(yields>=4);assert.deepEqual(step.value,buildTriangularPatchMesh(v,options));
});
