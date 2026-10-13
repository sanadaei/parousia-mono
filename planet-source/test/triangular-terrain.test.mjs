import test from 'node:test';import assert from 'node:assert/strict';
import {createTerrainAdapter,restoreTerrain,serializeTerrain,TRIANGULAR_TERRAIN_SCHEMA} from '../src/core/index.mjs';
import {restoreMetricTerrain,loadScene} from '../src/ui/scene.mjs';
const input=()=>({schema:TRIANGULAR_TERRAIN_SCHEMA,seed:'ridge',revision:'1',frame:{kind:'planar-metric',verticalDatum:'test'},mesh:{points:[[0,0],[100,0],[100,100],[0,100],[43,57]],triangles:[[0,1,4],[1,2,4],[2,3,4],[3,0,4]]},fields:{groundElevationM:[0,0,0,0,80]},references:{status:'fixture'}});
test('triangular canonical surface preserves all vertices, identity and ownership',()=>{
 const raw=input(),t=createTerrainAdapter(raw),id=t.worldId;
 raw.fields.groundElevationM[4]=0;raw.mesh.points[4][0]=0;
 const s=t.toSnapshot();for(let i=0;i<s.mesh.points.length;i++)assert.ok(Math.abs(t.groundElevationAt(...s.mesh.points[i])-s.fields.groundElevationM[i])<1e-10);
 assert.equal(t.groundElevationAt(43,57),80);assert.equal(restoreTerrain(serializeTerrain(t)).worldId,id);
 const mesh=t.toMesh();mesh.points[4][2]=0;assert.equal(t.toMesh().points[4][2],80);
 s.fields.groundElevationM[4]=0;assert.throws(()=>restoreTerrain(s),/worldId/);
});
test('triangle face gradients are analytic and creases are explicitly one-sided',()=>{
 const raw=input();raw.fields.groundElevationM=raw.mesh.points.map(([x,y])=>2*x+3*y);
 const t=createTerrainAdapter(raw),s=t.surfaceFrameAt(20,10);
 assert.ok(Math.abs(s.gradient.x-2)<1e-12);assert.ok(Math.abs(s.gradient.y-3)<1e-12);
 assert.equal(s.curvature,null);assert.equal(t.sampleAt(43,57).gradientStatus,'one-sided-at-triangle-edge');
 assert.equal(s.waterDepthM,null);assert.equal(s.hydrologyStatus,'unresolved');
});
test('LOD sampling cannot change the canonical surface or shared window boundary',()=>{
 const t=createTerrainAdapter(input()),id=t.worldId;
 const a=t.sampleWindow({minXM:0,minYM:0,maxXM:50,maxYM:100,spacingM:25});
 const b=t.sampleWindow({minXM:50,minYM:0,maxXM:100,maxYM:100,spacingM:10});
 for(const y of [0,50,100])assert.deepEqual(a.samples.find(s=>s.xM===50&&s.yM===y),b.samples.find(s=>s.xM===50&&s.yM===y));
 assert.equal(t.worldId,id);assert.equal(t.groundElevationAt(43,57),80);
 assert.throws(()=>t.sampleWindow({minXM:0,minYM:0,maxXM:100,maxYM:100,spacingM:.01}),/bounded/);
});
test('traces include a narrow ridge vertex even when regular probes miss it',()=>{
 const t=createTerrainAdapter(input()),trace=t.traceSurfaceSegment({xM:0,yM:57},{xM:100,yM:57},{maxStepM:100});
 assert.ok(trace.samples.some(s=>Math.abs(s.xM-43)<1e-10&&Math.abs(s.groundElevationM-80)<1e-9));
 assert.throws(()=>t.traceSurfaceSegment({xM:0,yM:57},{xM:100,yM:57},{maxStepM:.001,maxSamples:20}),/budget/);
});
test('actual scene loader accepts saved triangle geometry without rasterization',async()=>{
 const t=createTerrainAdapter(input()),restored=restoreMetricTerrain(t.toSnapshot());
 assert.equal(restored.terrain.worldId,t.worldId);assert.equal(restored.interpolation,'barycentric-triangles@1');
 const scene=await loadScene(t.toSnapshot(),{buildRoads:false});
 assert.equal(scene.terrain.groundElevationAt(43,57),80);
});
test('missing coverage and unsupported water remain explicit, never invented',()=>{
 const raw=input();raw.mesh={points:[[0,0],[100,0],[0,100]],triangles:[[0,1,2]]};raw.fields.groundElevationM=[0,0,0];
 const t=createTerrainAdapter(raw);assert.throws(()=>t.sampleAt(90,90),/uncovered/);assert.throws(()=>t.sampleAt(-1,0),/outside/);
 assert.throws(()=>createTerrainAdapter({...raw,hydrology:{}}),/not implemented/);
 assert.throws(()=>createTerrainAdapter({...raw,interpolation:'smooth'}),/Unsupported/);
});
test('exact near-field windows keep narrow ridges and requested bounds',()=>{
 const t=createTerrainAdapter(input()),w=t.meshWindow({minXM:20,minYM:20,maxXM:70,maxYM:80});
 let area=0;for(const tri of w.triangles){const[a,b,c]=tri.map(i=>w.points[i]);
  area+=((b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0]))/2;
  const p=a.map((v,i)=>(v+b[i]+c[i])/3);assert.ok(Math.abs(t.groundElevationAt(p[0],p[1])-p[2])<1e-9);
 }
 assert.ok(Math.abs(area-50*60)<1e-9);assert.ok(w.points.some(p=>p[0]===43&&p[1]===57&&p[2]===80));
 for(const[x,y,z]of w.points){assert.ok(x>=20&&x<=70&&y>=20&&y<=80);assert.ok(Math.abs(t.groundElevationAt(x,y)-z)<1e-9);}
 assert.deepEqual(w,t.meshWindow({minXM:20,minYM:20,maxXM:70,maxYM:80}));
 assert.throws(()=>t.meshWindow({minXM:0,minYM:0,maxXM:100,maxYM:100,maxTriangles:1}),/budget/);
});
test('adjacent clipped windows share boundary geometry without resampling',()=>{
 const t=createTerrainAdapter(input()),a=t.meshWindow({minXM:0,minYM:0,maxXM:50,maxYM:100}),b=t.meshWindow({minXM:50,minYM:0,maxXM:100,maxYM:100});
 const edge=w=>[...new Set(w.points.filter(p=>p[0]===50).map(p=>JSON.stringify(p)))].sort();
 assert.deepEqual(edge(a),edge(b));assert.equal(a.worldId,b.worldId);
 const raw=input();raw.mesh={points:[[0,0],[100,0],[0,100]],triangles:[[0,1,2]]};raw.fields.groundElevationM=[0,0,0];
 const missing=createTerrainAdapter(raw).meshWindow({minXM:80,minYM:80,maxXM:100,maxYM:100});assert.equal(missing.triangles.length,0);
});
