import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createGlobalTerrain } from '../src/core/global-terrain.mjs';
import { displayedGroundError, terrainSlopeBound, tileGeometricError, projectedErrorPixels } from '../src/globe/lod.mjs';
import { tileDirection, geographic, tileKey, tileBound, children, triangleInterpolate } from '../src/globe/cube.mjs';
import { GlobeStream, STREAM_LIMITS } from '../src/globe/stream.mjs';
import { ByteLRU } from '../src/globe/lru.mjs';

const manifest = JSON.parse(fs.readFileSync(new URL('../examples/globe/0.4.0/demo/manifest.json', import.meta.url), 'utf8'));
const core = createGlobalTerrain(JSON.parse(fs.readFileSync(new URL('../examples/globe/0.4.0/demo/reference.snapshot.json', import.meta.url), 'utf8')));
const root = { face: 0, level: 0, x: 0, y: 0 };
const camera = (altitude = 10000) => ({ eye: [6371000 + altitude, 0, 0], eyeUnit: [1, 0, 0], targetUp: [1, 0, 0],
  forward: [-1, 0, 0], right: [0, 1, 0], up: [0, 0, 1], near: .1, altitude, focal: 2.414, aspect: 1.6,
  groundReference: { up: [1, 0, 0], elevationM: 0 } });
const simpleManifest = slope => ({ base: { grid: { rows: 8 }, frame: { radiusM: 6371000 } }, elevationRangeM: [0, 0], reliefBoundM: 0,
  rowLipschitz: Array(7).fill(slope), poleLipschitz: [slope, slope] });
function planner(m) {
  return Object.assign(Object.create(GlobeStream.prototype), { manifest: m, workers: [], wanted: new Map(), generation: 0, dispatch() {} });
}

test('gradient hull includes crossed latitude strips, both caps and missing metadata', () => {
  const m = simpleManifest(.1); m.rowLipschitz[3] = 7; m.poleLipschitz = [11, 13];
  assert.equal(terrainSlopeBound(m, { center: [1, 0, 0], angular: .01 }), 7);
  assert.equal(terrainSlopeBound(m, { center: [0, 0, 1], angular: .01 }), 11);
  assert.equal(terrainSlopeBound(m, { center: [0, 0, -1], angular: .01 }), 13);
  assert.equal(terrainSlopeBound({ ...m, rowLipschitz: [] }, tileBound(root, 6371000)), Infinity);
  m.rowLipschitz[3] = NaN;
  assert.equal(terrainSlopeBound(m, { center: [1, 0, 0], angular: .01 }), Infinity);
});

test('base error bounds resident Core triangle residuals on all faces, including caps and longitude seams', () => {
  const base = { ...manifest, features: undefined }, radius = core.frame.radiusM;
  let probes = 0, nonzeroResiduals = 0;
  for (let face = 0; face < 6; face++) for (const level of [0, 5, 12, 20]) {
    const n = 2 ** level, tile = { face, level, x: Math.max(0, Math.floor(n / 2) - 1), y: Math.max(0, Math.floor(n / 2) - 1) };
    const bound = tileGeometricError(base, tile);
    const ecef = (x, y) => {
      const d = tileDirection(tile, x, y), p = geographic(d), h = core.groundElevationAt(p.latDeg, p.lonDeg);
      return d.map(v => v * (radius + h));
    };
    for (const [i, j] of [[0, 0], [7, 9], [15, 15]]) {
      const corners = [[0, 0], [1, 0], [0, 1], [1, 1]].map(([x, y]) => ecef((i + x) / 16, (j + y) / 16));
      for (const [x, y] of [[.13, .22], [.49, .51], [.81, .67]]) {
        const actual = ecef((i + x) / 16, (j + y) / 16), approximate = triangleInterpolate(...corners, x, y);
        const error = Math.hypot(...actual.map((v, k) => v - approximate[k]));
        assert.ok(error <= bound.terrainErrorM, `${face}/${level}: ${error} > ${bound.terrainErrorM}`);
        if (error > 1e-5) nonzeroResiduals++;
        probes++;
      }
    }
  }
  assert.equal(probes, 216); assert.ok(nonzeroResiduals > 100);
});

test('off-vertex terrain gradient causes finer plans than a flat sphere at the same camera and budgets', () => {
  // A [0,0] global range itself certifies a flat field, regardless of a
  // loose slope upper bound. Give both fixtures a genuine nonzero envelope.
  const ranged=slope=>({...simpleManifest(slope),elevationRangeM:[-1000,1000],reliefBoundM:1000});
  const flat = planner(ranged(0)), rough = planner(ranged(4));
  flat.plan(camera(100000), 720); rough.plan(camera(100000), 720);
  const finest = p => Math.max(...[...p.wanted.values()].map(e => e.tile.level));
  assert.ok(finest(rough) > finest(flat));
  for (const p of [flat, rough]) {
    assert.ok(p.wanted.size <= STREAM_LIMITS.maxWantedTiles);
    assert.ok(p.visited <= STREAM_LIMITS.maxVisitedNodes);
  }
  assert.ok(rough.lodQuality.budgetLimited || rough.lodQuality.overTargetLeaves === 0);
});

test('feature amplitude is separate from base certification and remains explicitly unresolved', () => {
  const m = simpleManifest(.01), feature = { center: [1, 0, 0], angularRadius: .1, verticalAllowanceM: 8 };
  const a = tileGeometricError(m, root), b = tileGeometricError({ ...m, features: feature }, root);
  assert.equal(a.featureStatus, 'none'); assert.equal(b.featureStatus, 'amplitude-only');
  assert.equal(b.featureErrorM, 16); assert.equal(b.geometricErrorM, b.terrainErrorM + 16);
  assert.equal(b.baseCertified, true);
  const unknown = planner({ ...m, rowLipschitz: [] }); unknown.plan(camera(20000000), 720);
  assert.ok(unknown.lodQuality.unknownBaseLeaves > 0);
  assert.equal(unknown.lodQuality.maxPlannedTerrainErrorPixels, null);
});

test('river excavation and later chart displacement both contribute to the ground bound', () => {
  const m=simpleManifest(.01),region={center:[1,0,0],angularRadius:.1};
  m.featureCharts=[{...region,verticalAllowanceM:8},{...region,verticalAllowanceM:3}];
  m.riverDescriptors=[{...region,kind:'river',verticalAllowanceM:12,minimumOffsetM:-12,maximumOffsetM:0}];
  const e=tileGeometricError(m,root);
  assert.equal(e.featureErrorM,40); // absolute ground offset up to 12+8, not max(12,8)
  assert.equal(e.geometricErrorM,e.terrainErrorM+40);
});

test('displayed ground bound includes features and only the active morph/stitch displacement', () => {
  const tile={geometricError:{terrainErrorM:2,geometricErrorM:42},morphErrorM:10};
  assert.deepEqual(displayedGroundError(tile,1),{baseM:2,groundM:42});
  assert.deepEqual(displayedGroundError(tile,.25),{baseM:9.5,groundM:49.5});
  assert.deepEqual(displayedGroundError(tile,1,1),{baseM:12,groundM:52});
  delete tile.morphErrorM;
  assert.deepEqual(displayedGroundError(tile,1),{baseM:2,groundM:42});
  assert.deepEqual(displayedGroundError(tile,.5),{baseM:Infinity,groundM:Infinity});
});

test('perspective error accounts for framebuffer DPR and near-plane uncertainty', () => {
  const m = simpleManifest(.1), tile = { face: 0, level: 18, x: 131072, y: 131072 }, cam = camera(1000);
  const a = projectedErrorPixels(1, m, tile, [0, 0], cam, 720);
  const b = projectedErrorPixels(1, m, tile, [0, 0], cam, 1440);
  assert.ok(Number.isFinite(a) && a > 0); assert.equal(b, a * 2);
  assert.equal(projectedErrorPixels(1, m, root, [0, 0], camera(3), 720), Infinity);
});

function transitionController(budget = 100) {
  const renderer = { gpuBytes: 0, peakGpuBytes: 0, allocations: 0, deletions: 0,
    upload(mesh) { return { ...mesh, branchMorph: 0, bytes: 1 }; }, dispose() {} };
  const cache = new ByteLRU(budget);
  const put = tile => cache.put(tileKey(tile), { tile, branchMorph: 0 }, 1);
  put(root);
  for (const child of children(root)) { put(child); for (const grand of children(child)) put(grand); }
  const controller = Object.assign(Object.create(GlobeStream.prototype), {
    renderer, cache, manifest: simpleManifest(0), workers: [], uploads: [], wanted: new Map(), errors: [], witnesses: [],
    transitionPins: new Set(), visible() { return true; }, dispatch() {},
  });
  return { controller, put, value: t => cache.entries.get(tileKey(t)).value };
}

test('refining multiple ready levels waits until each parent finishes its morph', () => {
  const { controller: c, value } = transitionController();
  c.wanted.set(tileKey(root), { refine: true });
  for (const child of children(root)) c.wanted.set(tileKey(child), { refine: true });
  const first = c.frame(camera(), 50);
  assert.ok(first.every(e => e.tile.tile.level === 1 && e.morph === .125));
  assert.ok(children(root).every(t => value(t).branchMorph === 0));
  for (let i = 0; i < 7; i++) c.frame(camera(), 50);
  assert.equal(value(root).branchMorph, 1);
  assert.ok(children(root).every(t => value(t).branchMorph === .125));
  assert.ok(c.frame(camera(), 50).every(e => e.tile.tile.level === 2 && e.morph === .25));
});

test('reverse morph completes descendants before changing the parent shape', () => {
  const { controller: c, value } = transitionController();
  value(root).branchMorph = 1;
  for (const child of children(root)) value(child).branchMorph = 1;
  const first = c.frame(camera(), 50);
  assert.equal(value(root).branchMorph, 1);
  assert.ok(first.every(e => e.tile.tile.level === 2 && e.morph === .875));
  for (let i = 0; i < 7; i++) c.frame(camera(), 50);
  assert.ok(children(root).every(t => value(t).branchMorph === 0));
  assert.equal(value(root).branchMorph, .875);
  for (let i = 0; i < 7; i++) c.frame(camera(), 50);
  assert.equal(value(root).branchMorph, 0);
  assert.deepEqual(c.frame(camera(), 50).map(e => e.tile.tile), [root]);
});

test('cache pressure retains coarsening children, then releases them after transition completion', () => {
  const { controller: c, value } = transitionController(21);
  value(root).branchMorph = 1;
  for (const child of children(root)) value(child).branchMorph = 1;
  c.frame(camera(), 50);
  const mesh = { tile: { face: 1, level: 0, x: 0, y: 0 }, vertex: new Uint8Array(1), index: new Uint8Array(), overlayIndex: new Uint8Array(), witness: {} };
  c.wanted.set(tileKey(mesh.tile), { tile: mesh.tile }); c.uploads.push(mesh);
  c.frame(camera(), 50);
  assert.equal(c.cache.entries.size, 21); assert.ok(c.errors.some(e => e.startsWith('Parent retained:')));
  assert.ok(children(root).every(t => c.cache.entries.has(tileKey(t))));
  assert.ok(children(root).flatMap(children).every(t => c.cache.entries.has(tileKey(t))));
  for (let i = 0; i < 20; i++) c.frame(camera(), 50);
  assert.equal(c.transitionPins.size, 1);
  c.uploads.push(mesh); c.frame(camera(), 50);
  assert.ok(c.cache.entries.has(tileKey(mesh.tile))); assert.ok(c.cache.bytes <= 21);
});

test('an incomplete child group keeps its parent visible and starts gently when the group arrives', () => {
  const { controller: c, put } = transitionController();
  const missing = children(root)[3]; c.cache.delete(tileKey(missing));
  c.wanted.set(tileKey(root), { refine: true });
  assert.deepEqual(c.frame(camera(), 50).map(e => e.tile.tile), [root]);
  put(missing);
  const render = c.frame(camera(), 50);
  assert.equal(render.length, 4); assert.ok(render.every(e => e.morph === .125));
});

test('unchanged camera and geometry reuse the existing LOD plan, while new geometry invalidates it',()=>{
 const p=planner(simpleManifest(.05));p.renderer={allocations:0};p.cache=new ByteLRU(1024);const cam=camera(100000);
 p.plan(cam,720);const generation=p.generation,keys=[...p.wanted.keys()];p.plan(structuredClone(cam),720);
 assert.equal(p.generation,generation);assert.equal(p.planningSkips,1);assert.deepEqual([...p.wanted.keys()],keys);
 p.renderer.allocations++;p.plan(cam,720);assert.equal(p.generation,generation+1);
 p.plan(cam,721);assert.equal(p.generation,generation+2);
});

test('display quality reports transient hidden water and unfinished feature refinement',()=>{
 const {controller:c,value}=transitionController();const r=value(root);r.geometricError={terrainErrorM:0};r.morphErrorM=10;r.featureRefinementLimited=true;r.overlay={count:3};
 c.frame(camera(20000000),16);assert.equal(c.displayedQuality.featureRefinementLimitedTiles,1);assert.equal(c.displayedQuality.hiddenWaterTransitionTiles,0);
 c.wanted.set(tileKey(root),{refine:true});for(const t of children(root)){const v=value(t);v.geometricError={terrainErrorM:0};v.morphErrorM=10;v.overlay={count:3};}
 c.frame(camera(20000000),16);assert.equal(c.displayedQuality.hiddenWaterTransitionTiles,4);assert.ok(c.displayedQuality.maxBaseErrorPixels>0);assert.equal(c.displayedQuality.worstGroundTiles.length,3);assert.ok(c.displayedQuality.worstGroundTiles.every(e=>e.tile&&e.groundErrorM===Infinity));
});

test('incremental LOD planning commits balanced plans atomically and bounds queued camera requests',()=>{
 const m=simpleManifest(.05),actual=planner(m),expected=planner(m);actual.errors=[];
 actual.requestPlan(camera(100000),720);actual.advancePlanning(0);assert.equal(actual.wanted.size,0,'partial plan must not replace the displayed plan');
 actual.requestPlan(camera(200000),720);actual.requestPlan(camera(300000),720);
 // Zero budget intentionally advances one generator yield, including 32-tile neighbor scans.
 for(let i=0;i<10000&&(actual.planningIterator||actual.planningRequest);i++)actual.advancePlanning(0);
 assert.equal(actual.planningIterator,null);assert.equal(actual.planningRequest,null);expected.plan(camera(300000),720);
 assert.deepEqual([...actual.wanted.keys()],[...expected.wanted.keys()]);assert.equal(actual.lodQuality.neighborBalance.remaining,0);assert.equal(actual.errors.length,0);
});

test('budget-rejected branch trials preserve a complete balanced tree with sliced and synchronous planning',()=>{
 for(const altitude of [100,10000])for(const slope of [0,.05,4]){
  const expected=planner(simpleManifest(slope)),actual=planner(simpleManifest(slope));actual.errors=[];
  expected.plan(camera(altitude),720);actual.requestPlan(camera(altitude),720);
  for(let i=0;i<20000&&(actual.planningIterator||actual.planningRequest);i++)actual.advancePlanning(0);
  assert.equal(actual.planningIterator,null);assert.equal(actual.errors.length,0);
  assert.deepEqual([...actual.wanted],[...expected.wanted]);assert.deepEqual(actual.lodQuality,expected.lodQuality);
  assert.equal(actual.lodQuality.neighborBalance.remaining,0);
  for(const e of actual.wanted.values())if(e.refine)for(const child of children(e.tile))assert.ok(actual.wanted.has(tileKey(child)),'rollback must not leave half a refined branch');
 }
});

test('measured oversized child groups coarsen the plan instead of retrying an impossible pinned cache',()=>{
 const p=planner(simpleManifest(.05));p.cache=new ByteLRU(2*1024*1024);p.renderer={allocations:0};p.cache.put(tileKey(root),{tile:root},16);
 p.plan(camera(10000),720);assert.ok(p.wanted.get(tileKey(root)).refine);const revision=p.generation;
 const child=children(root)[0];p.rememberMeshBytes(child,2*1024*1024);
 p.plan(camera(10000),720);assert.ok(p.generation>revision);assert.equal(p.wanted.get(tileKey(root)).refine,false);assert.equal(p.wanted.has(tileKey(child)),false);
 assert.ok(p.lodQuality.memoryRejectedRefinements>0);assert.ok(p.lodQuality.estimatedMeshBytes<=p.cache.maxBytes);assert.equal(p.lodQuality.neighborBalance.remaining,0);
});
test('mesh size observations are bounded and retained for rejected uploads',()=>{
 const p=planner(simpleManifest(0));for(let i=0;i<2100;i++)p.rememberMeshBytes({face:0,level:12,x:i,y:0},100+i);
 assert.equal(p.observedTileBytes.size,2048);assert.equal(p.estimatedMeshBytes({face:0,level:12,x:2099,y:0}),2199);assert.equal(p.estimatedMeshBytes({face:0,level:12,x:0,y:0}),65536);
 assert.throws(()=>p.rememberMeshBytes(root,-1));
});


test('display topology cache preserves live morph and invalidates changed visible leaves',()=>{
 const {controller:c,value}=transitionController();c.wanted.set(tileKey(root),{refine:true});
 const first=c.frame(camera(),50),runs=c.displayTopologyRuns,second=c.frame(camera(),50);
 assert.equal(c.displayTopologyRuns,runs);assert.ok(c.displayTopologyHits>0);
 assert.ok(first.every(e=>e.morph===.125));assert.ok(second.every(e=>e.morph===.25));
 c.visible=t=>t.level===0||t.x===0;c.frame(camera(),50);assert.ok(c.displayTopologyRuns>runs);
});
test('display topology reuses only coordinates after a cache object is replaced',()=>{
 const {controller:c}=transitionController();const first=c.frame(camera(),0),old=first[0].tile;
 const replacement={...old,branchMorph:0,replacement:true};c.cache.delete(tileKey(root));c.cache.put(tileKey(root),replacement,1);
 const next=c.frame(camera(),0);assert.equal(next[0].tile,replacement);assert.notEqual(next[0].tile,old);
});

test('settled terrain frames reuse geometry while camera, cache and morph changes invalidate it',()=>{
 const {controller:c,value,put}=transitionController(),cam=camera();const first=c.frame(cam,0);assert.equal(c.frameReuseHits??0,0);const second=c.frame(cam,0);assert.equal(c.frameReuseHits,1);assert.deepEqual(second,first);assert.notEqual(second,first);
 second[0].morph=.25;assert.equal(c.frame(cam,0)[0].morph,1);
 const prior=c.frameReuseHits;c.frame({...cam,altitude:cam.altitude+1},0);assert.equal(c.frameReuseHits,prior);
 c.frame(cam,0);put(root);const replacement=c.frame(cam,0);assert.equal(c.frameReuseHits,prior);assert.notEqual(replacement[0].tile,first[0].tile);
 c.wanted.set(tileKey(root),{refine:true});assert.ok(c.frame(cam,50).every(e=>e.morph===.125));assert.equal(c.frameReuse,null);
 value(root).branchMorph=1;c.wanted.get(tileKey(root)).refine=false;c.frame(cam,50);assert.ok(value(root).branchMorph<1);
});


test('stitch bound uses only affected edges while retaining interior morph and legacy safety',()=>{
 const tile={geometricError:{terrainErrorM:2,geometricErrorM:3},morphErrorM:20,edgeMorphErrorM:[1,4,2,3]};
 assert.deepEqual(displayedGroundError(tile,1,1),{baseM:3,groundM:4});
 assert.deepEqual(displayedGroundError(tile,1,6),{baseM:6,groundM:7});
 assert.deepEqual(displayedGroundError(tile,.5,1),{baseM:12,groundM:13});
 tile.edgeMorphErrorM=[1,NaN,2,3];
 assert.deepEqual(displayedGroundError(tile,1,1),{baseM:22,groundM:23});
});

test('flattened full-ground certificates supersede a rough uncut base in LOD planning',()=>{
 const m=simpleManifest(100),c=planner(m);
 c.cache={entries:new Map(),maxBytes:STREAM_LIMITS.gpuBytes};
 for(let face=0;face<6;face++)c.cache.entries.set(tileKey({face,level:0,x:0,y:0}),{bytes:65536,value:{heightRangeM:[0,0],baseHeightRangeM:[0,0],geometricError:{geometricErrorM:.001}}});
 c.plan(camera(20000000),720);
 const rootEntry=c.wanted.get(tileKey(root));
 assert.ok(rootEntry.baseErrorPixels>rootEntry.groundErrorPixels);
 assert.equal(rootEntry.errorPixels,rootEntry.groundErrorPixels);
});


test('unbuilt descendants reuse certified ancestor height intervals rather than global feature amplitude',()=>{
 const m=simpleManifest(0);m.features={center:[1,0,0],angularRadius:1,verticalAllowanceM:1000};
 const c=planner(m);c.cache={entries:new Map(),maxBytes:STREAM_LIMITS.gpuBytes};
 c.cache.entries.set(tileKey(root),{bytes:65536,value:{heightRangeM:[0,.001],baseHeightRangeM:[0,0],geometricError:{geometricErrorM:1e7}}});
 c.plan(camera(10000),720);
 const descendants=[...c.wanted.values()].filter(e=>e.tile.face===0&&e.tile.level>0&&e.error);
 assert.ok(descendants.length>0);
 assert.ok(descendants.every(e=>e.error.featureErrorM>=2000));
 assert.ok(descendants.some(e=>Number.isFinite(e.groundErrorPixels)&&e.groundErrorPixels<2));
 assert.ok(c.lodQuality.intervalBoundLeaves>0);assert.equal(c.lodQuality.featureAmplitudeOnlyLeaves,0);
});


test('target geometry leaves transition headroom under the unchanged hard byte limit',()=>{
 const p=planner({...simpleManifest(.05),elevationRangeM:[-1000,1000],reliefBoundM:1000});p.cache=new ByteLRU(8*1024*1024);
 p.plan(camera(10000),720);
 assert.equal(p.lodQuality.hardMeshBudgetBytes,p.cache.maxBytes);
 assert.equal(p.lodQuality.meshBudgetBytes,Math.floor(p.cache.maxBytes*.8));
 assert.equal(p.lodQuality.transitionReserveBytes,p.cache.maxBytes-p.lodQuality.meshBudgetBytes);
 assert.ok(p.lodQuality.estimatedMeshBytes<=p.lodQuality.meshBudgetBytes);
 assert.equal(p.lodQuality.neighborBalance.remaining,0);
});

import {cellHeightInterpolationError} from '../src/globe/lod.mjs';
test('cell error uses every rendered vertex enclosure rather than arbitrary terrain endpoint pairing',()=>{
 assert.equal(cellHeightInterpolationError([0,10],[3,7]),7);
 assert.equal(cellHeightInterpolationError([4,6],[5,5]),1);
 // A refinement vertex outside the original four-corner range must count.
 assert.equal(cellHeightInterpolationError([0,10],[3,9]),9);
 for(let a=0;a<=10;a+=.25)for(let v=3;v<=7;v+=.25)assert.ok(Math.abs(a-v)<=cellHeightInterpolationError([0,10],[3,7]));
 assert.throws(()=>cellHeightInterpolationError([2,1],[0,0]),/interval/);
 assert.throws(()=>cellHeightInterpolationError([0,NaN],[0,0]),/interval/);
});

import {parentTile} from '../src/globe/cube.mjs';
import {vertexEdgeMask} from '../src/globe/lod-neighbors.mjs';
test('millimetre LOD keeps integer ancestry, nonzero cell bounds and classified edges on every cube face',()=>{
 assert.equal(STREAM_LIMITS.maxLevel,28);
 for(let face=0;face<6;face++)for(const [x,y] of [[0,0],[2**27+123,2**27-17],[2**28-1,2**28-1]]){
  const tile={face,level:28,x,y},parent=parentTile(tile);
  assert.ok(children(parent).some(t=>tileKey(t)===tileKey(tile)));
  const disk=tileBound({...tile,level:32,x:x*16,y:y*16},6371000);assert.ok(disk.radiusM>0&&disk.radiusM<.01);
  for(const [u,v,mask] of [[0,0,5],[1,0,6],[0,1,9],[1,1,10]])assert.equal(vertexEdgeMask(tile,tileDirection(tile,u,v)),mask);
 }
});

test('live planning requests unknown tiles before speculating many finer generations',()=>{
 const p=planner(simpleManifest(.1));p.renderer={allocations:0};p.cache=new ByteLRU(63*1024*1024);const cam=camera(30);
 p.plan(cam,720);assert.equal(p.wanted.size,6);assert.ok([...p.wanted.values()].every(e=>!e.refine));
 for(let face=0;face<6;face++){const tile={face,level:0,x:0,y:0};p.cache.put(tileKey(tile),{tile},1);}
 p.renderer.allocations=6;p.plan(cam,720);
 assert.ok(p.wanted.size>6);assert.ok([...p.wanted.values()].every(e=>e.tile.level<=1));
 assert.equal(p.lodQuality.neighborBalance.remaining,0);assert.ok(p.lodQuality.awaitingMeshBounds>0);
});

import { LodPriorityQueue } from '../src/globe/lod-priority.mjs';
test('LOD heap preserves stable array refinement order across ties and infinite bounds',()=>{
 const q=new LodPriorityQueue(),reference=[];let seed=71,id=0;
 const random=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed;};
 for(let i=0;i<10000;i++){
  if(!reference.length||random()%3){const v={id:id++,score:random()%5===0?Infinity:random()%7,distance:random()%5};q.push(v);reference.push(v);}
  else{reference.sort((a,b)=>b.score===a.score?a.distance-b.distance:b.score-a.score);assert.equal(q.shift(),reference.shift());}
  assert.equal(q.length,reference.length);
 }
 reference.sort((a,b)=>b.score===a.score?a.distance-b.distance:b.score-a.score);
 for(const v of reference)assert.equal(q.shift(),v);assert.equal(q.shift(),undefined);
});

test('tile metadata memo preserves direct bounds and is capped across views', async()=>{
 const {intersectingFeatures,groundIntervalError}=await import('../src/globe/lod.mjs');
 const {waterVisibilityUpperBound}=await import('../src/globe/water-visibility.mjs');
 const stream=Object.assign(Object.create(GlobeStream.prototype),{manifest});
 for(let i=0;i<4200;i++){
  const tile={face:i%6,level:12,x:i%4096,y:Math.floor(i/4096)},info=stream.tileInfo(tile),bound=tileBound(tile,manifest.base.frame.radiusM);
  assert.deepEqual(info.bound,bound);assert.deepEqual(info.features,intersectingFeatures(manifest,bound));
  assert.equal(info.waterUpper,waterVisibilityUpperBound(manifest,bound));
  assert.deepEqual(tileGeometricError(manifest,tile),tileGeometricError(manifest,tile,manifest.elevationRangeM,16,info.bound,info.features));
  assert.equal(groundIntervalError(manifest,tile,manifest.elevationRangeM),groundIntervalError(manifest,tile,manifest.elevationRangeM,16,info.bound));
 }
 assert.equal(stream.tileInfos.size,4096);
 const tile={face:0,level:4,x:3,y:5},a=stream.tileInfo(tile);assert.equal(stream.tileInfo({...tile}),a);
 stream.manifest={...manifest,sea:{levelElevationM:12345}};
 const b=stream.tileInfo(tile);assert.notEqual(a,b);assert.equal(stream.tileInfos.size,1);assert.ok(b.waterUpper>=12345);
});

test('reference range reuse tracks exact reference changes and keeps resident bounds live',()=>{
 const m={...simpleManifest(.25),elevationRangeM:[-10000,10000]},stream=planner(m),tile={face:0,level:10,x:512,y:512},b=tileBound(tile,m.base.frame.radiusM),cam=camera(350);
 stream.cache={entries:new Map()};
 for(const elevationM of [0,1,300,-5])for(const up of [[1,0,0],[Math.cos(.01),Math.sin(.01),0]]){
  cam.groundReference={up,elevationM};
  const first=stream.heightRange(b,cam,tile),memo=stream.tileInfo(tile).referenceBound;
  assert.deepEqual(stream.heightRange(b,cam,tile),first);assert.equal(stream.tileInfo(tile).referenceBound,memo);
  const direct=planner(m);direct.cache=stream.cache;assert.deepEqual(first,direct.heightRange(b,cam,tile));
 }
 cam.groundReference={up:[1,0,0],elevationM:0};
 stream.heightRange(b,cam,tile);
 stream.cache.entries.set(tileKey(tile),{value:{heightRangeM:[-2,2],baseHeightRangeM:[-1,1]}});
 const direct=planner(m);direct.cache=stream.cache;
 assert.deepEqual(stream.heightRange(b,cam,tile),direct.heightRange(b,cam,tile));
 assert.deepEqual(stream.heightRange(b,cam,tile,true),direct.heightRange(b,cam,tile,true));
 cam.groundReference=null;assert.deepEqual(stream.heightRange(b,cam,tile),direct.heightRange(b,cam,tile));
});
