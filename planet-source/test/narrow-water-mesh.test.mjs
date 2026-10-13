import test from 'node:test';import assert from 'node:assert/strict';
import {buildCommittedWaterStrips} from '../src/globe/narrow-water-mesh.mjs';
import {createSphericalProjection,sphereBasis} from '../src/core/spherical.mjs';
import {directionTile} from '../src/globe/lod-neighbors.mjs';
import {tileDirection,cross,dot,normalize,geographic} from '../src/globe/cube.mjs';
function fixture(dryGap=false){const radiusM=6371000,center={latDeg:.003,lonDeg:.003},projection=createSphericalProjection({centerLatDeg:center.latDeg,centerLonDeg:center.lonDeg,radiusM}),tile=directionTile(sphereBasis(center).up,16),points=[-50,50].map(x=>({...projection.toGeographic(x,0),halfWidthM:.6}));let samples=0;const source={manifest:{base:{frame:{radiusM}}},materializedWaterPlans:new Map([['saved',{profiles:[{points}]}]]),ready:async f=>f(),sampleWithoutCover(lat,lon){samples++;const p=projection.toLocal(lat,lon),wet=Math.abs(p.yM)<.6&&(!dryGap||Math.abs(p.xM)>=10);return{groundElevationM:wet?99.7:100.1,waterLevelElevationM:wet?100:null,waterDepthM:wet?.3:0};}};return{source,tile,projection,samples:()=>samples};}
test('committed wet channel strips are bounded to their tile and retain canonical water level',async()=>{
 const {source,tile}=fixture(),result=await buildCommittedWaterStrips(source,tile);assert.ok(result.triangles.length>0);assert.equal(result.stats.limited,false);
 const center=tileDirection(tile,.5,.5),corners=[[0,0],[1,0],[1,1],[0,1]].map(p=>tileDirection(tile,...p)),planes=corners.map((a,i)=>{const n=normalize(cross(a,corners[(i+1)%4]));return dot(n,center)<0?n.map(v=>-v):n;});
 for(const triangle of result.triangles)for(const p of triangle){assert.equal(p.waterLevelElevationM,100);assert.ok(planes.every(n=>dot(n,p.direction)>-1e-12));}
});
test('dry intervals break the water strip instead of becoming invented bridges of water',async()=>{
 const {source,tile,projection}=fixture(true),result=await buildCommittedWaterStrips(source,tile);assert.ok(result.stats.dry>0);
 for(const triangle of result.triangles){const xs=triangle.map(p=>{const g=geographic(p.direction);return projection.toLocal(g.latDeg,g.lonDeg).xM;});assert.ok(Math.min(...xs)>=9.99||Math.max(...xs)<=-9.99);}
});
test('water strips respect explicit budgets, cancellation and worlds without committed local water',async()=>{
 const {source,tile}=fixture();const limited=await buildCommittedWaterStrips(source,tile,null,{maxVertices:12});assert.ok(limited.triangles.length*3<=12);assert.equal(limited.stats.limited,true);
 const count=await buildCommittedWaterStrips(source,tile,null,{maxSamples:5});assert.equal(count.stats.samples,5);assert.equal(count.stats.limited,true);
 const a=new AbortController();a.abort();await assert.rejects(buildCommittedWaterStrips(source,tile,a.signal),{name:'AbortError'});
 assert.equal((await buildCommittedWaterStrips({...source,materializedWaterPlans:null},tile)).triangles.length,0);
 assert.equal((await buildCommittedWaterStrips(source,{...tile,level:5})).triangles.length,0);
 await assert.rejects(buildCommittedWaterStrips(source,tile,null,{maxSamples:Infinity}),/budget/);
});
