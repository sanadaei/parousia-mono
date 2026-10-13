import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { createPeriodicHermiteField } from '../src/core/periodic-field.mjs';
import { createPeriodicHermiteAccessor } from '../src/core/hermite-kernel.mjs';
import { createGlobalTerrain } from '../src/core/global-terrain.mjs';
import { createGlobeFeatureChart } from '../src/core/globe-features.mjs';
import { createHash } from 'node:crypto';
import { createHash as portableHash } from '../src/core/sha256.mjs';
import { ByteLRU } from '../src/globe/lru.mjs';
import { PagedSource } from '../src/globe/paged-source.mjs';
import { buildMesh, VERTEX_STRIDE, boundaryBisectionCount, featureSubdivisionBudgets } from '../src/globe/mesh.mjs';
import { cubeDirection, tileDirection, triangleInterpolate, geographic, tileKey, tileBound } from '../src/globe/cube.mjs';
import { GlobeStream, STREAM_LIMITS } from '../src/globe/stream.mjs';
import { packageGlobe } from '../scripts/package-globe.mjs';
import { globalFixture } from '../fixtures/global-scenarios.mjs';
import { createSphericalProjection } from '../src/core/spherical.mjs';
const demoDir = new URL('../examples/globe/0.4.0/demo/', import.meta.url);
const manifest = JSON.parse(fs.readFileSync(new URL('manifest.json', demoDir), 'utf8'));
const reference = createGlobalTerrain(JSON.parse(fs.readFileSync(new URL('reference.snapshot.json', demoDir), 'utf8')));
const recipe = JSON.parse(fs.readFileSync(new URL('features.json', demoDir), 'utf8'));
const diskFetch = async url => {
  const bytes = fs.readFileSync(fileURLToPath(url));
  return { ok: true, arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), text: async () => bytes.toString('utf8') };
};
const paged = () => new PagedSource(manifest, new URL('manifest.json', demoDir).href, diskFetch);
test('portable SHA-256 preserves Node hashes including UTF-8 and binary pages', () => {
  for (const value of ['', '日本語の球面', 'x'.repeat(4097), new Uint8Array([0, 255, 3])]) assert.equal(portableHash('sha256').update(value).digest('hex'), createHash('sha256').update(value).digest('hex'));
});
test('paged Hermite is bit-identical at seam, centers, caps and fractional coordinates', () => {
  const w = 17, h = 11, field = Array.from({ length: w * h }, (_, i) => Math.sin(i * .2) * 813);
  const a = createPeriodicHermiteField(field, w, h), b = createPeriodicHermiteAccessor((x, y) => field[y * w + x], w, h);
  for (const x of [0, .000001, .5, 2.5, 7.11, w - .5, w - .0000001, w]) for (const y of [0, .49, .5, 1.001, 3.5, h - .5, h]) assert.equal(a(x, y), b(x, y));
});
test('global paging reproduces resident anchored detail at 500 points with bounded caches', async () => {
  const p = paged();
  const points = [[90, 0], [-90, 0], [89.999, 179.999], [35, 135], [0, 180], [0, -180]];
  for (let i = 0; i < 500; i++) points.push([-90 + (i * 53.137) % 180, -180 + (i * 97.123) % 360]);
  for (const [lat, lon] of points) assert.equal(await p.ready(() => p.base.groundElevationAt(lat, lon)), reference.groundElevationAt(lat, lon));
  assert.ok(p.cache.bytes <= 256 * 1024); assert.ok(p.anchors.bytes <= 128 * 1024); assert.ok(p.cache.evictions > 0);
});
test('legacy bounded detail uses the same paged evaluator without changing witnesses', async () => {
  const terrain = globalFixture({ bands: [{ id: 'detail', amplitudeM: 10, wavelengthM: 10000 }] });
  const dir = new URL('../examples/globe/0.4.0/legacy-test/', import.meta.url); packageGlobe(terrain, fileURLToPath(dir));
  const m = JSON.parse(fs.readFileSync(new URL('manifest.json', dir), 'utf8')), p = new PagedSource(m, new URL('manifest.json', dir).href, diskFetch);
  for (let i = 0; i < 90; i++) { const lat = -89.99 + i * 1.999, lon = i * 17.192; assert.equal(await p.ready(() => p.base.groundElevationAt(lat, lon)), terrain.groundElevationAt(lat, lon)); }
});
test('field corruption and cancellation fail rather than silently rendering a different world', async () => {
  const p = new PagedSource(manifest, new URL('manifest.json', demoDir).href, async () => ({ ok: true, arrayBuffer: async () => new ArrayBuffer(2048) }));
  await assert.rejects(p.ready(() => p.base.groundElevationAt(35, 135)), /Corrupt/);
  const controller = new AbortController(); controller.abort(); await assert.rejects(paged().ready(() => 1, controller.signal), /Cancelled/);
});
test('real generated multi-chart worlds retain Core ground, water and seam values when paged', async () => {
  for (const id of ['a', 'b']) {
    const directory = new URL(`../examples/globe/0.4.0/real-${id}/`, import.meta.url), m = JSON.parse(fs.readFileSync(new URL('manifest.json', directory), 'utf8'));
    const raw = JSON.parse(fs.readFileSync(new URL(`../examples/audit-0.3.3/0.3.5/audit-${id}.snapshot.json`, import.meta.url), 'utf8')), core = createGlobalTerrain(raw);
    const p = new PagedSource(m, new URL('manifest.json', directory).href, diskFetch);
    for (const chart of raw.waterCharts) {
      const projection = createSphericalProjection(chart.projection);
      for (const [x, y] of [[0, 0], [-500, 0], [0, 500], ...chart.model.edges.flatMap(e => e.points.filter((_, i) => i % 10 === 0).map(v => [v.xM, v.yM]))]) {
        const point = projection.toGeographic(x, y); await p.enableFeaturesAt(point);
        const actual = await p.ready(() => p.sample(point.latDeg, point.lonDeg)), expected = core.sampleAt(point.latDeg, point.lonDeg);
        assert.ok(Math.abs(actual.groundElevationM - expected.groundElevationM) < 1e-7);
        assert.equal(actual.waterLevelElevationM, expected.waterLevelElevationM);
        assert.ok(Math.abs((actual.waterDepthM ?? 0) - (expected.waterDepthM ?? 0)) < 1e-7);
        assert.deepEqual(actual.waterSourceIds, expected.waterSourceIds);
      }
    }
  }
});
test('explicit river, bridge and pad recipes agree with the resident Core composition', async () => {
  const p = paged(); await p.enableFeatures(); const chart = createGlobeFeatureChart(reference, recipe), projection = createSphericalProjection(recipe.projection);
  for (const [x, y] of [[0, 0], [0, 100], [2, -70], [-55, 55], [-55, 75], [-100, 0], [35, 50], [399, 399]]) {
    const g = projection.toGeographic(x, y);
    assert.deepEqual(await p.ready(() => p.sample(g.latDeg, g.lonDeg)), chart.sampleAt(g.latDeg, g.lonDeg));
  }
  const bridge = projection.toGeographic(0, 0), sample = await p.ready(() => p.sample(bridge.latDeg, bridge.lonDeg));
  assert.ok(sample.waterDepthM > 1); assert.equal(sample.roadSurface.structureKind, 'bridge-deck'); assert.ok(sample.roadSurface.roadElevationM > sample.groundElevationM + 3);
});
test('Cube-Sphere faces have exactly matching edge directions and sibling nodes', () => {
  for (let i = 0; i <= 16; i++) {
    const v = -1 + i / 8; assert.deepEqual(cubeDirection(0, 1, v), cubeDirection(2, -1, v));
    assert.deepEqual(tileDirection({ face: 4, level: 5, x: 10, y: 13 }, 1, i / 16), tileDirection({ face: 4, level: 5, x: 11, y: 13 }, 0, i / 16));
  }
  assert.deepEqual(triangleInterpolate([0, 0], [2, 0], [0, 2], [2, 2], .75, .75), [1.5, 1.5]);
});
test('meter-scale tile vertices retain Core elevation and camera-relative float precision', async () => {
  const p = paged(), tile = { face: 4, level: 21, x: 1048575, y: 1048575 }, mesh = await buildMesh(p, tile);
  const g = geographic(tileDirection(tile, .5, .5));
  assert.equal(mesh.witness.vertexGroundElevationM, reference.groundElevationAt(g.latDeg, g.lonDeg));
  assert.ok(mesh.witness.maxVertexFloat32ErrorM < .00001); assert.ok(mesh.vertex.length / VERTEX_STRIDE > mesh.vertexCount);
  assert.ok(Math.max(...mesh.index) < mesh.vertex.length / VERTEX_STRIDE);
  assert.equal(mesh.edgeMorphErrorM.length,4);
  for(let edge=0;edge<4;edge++){
    let observed=0;
    for(let i=0;i<mesh.edgeMask.length;i++)if(mesh.edgeMask[i]&(1<<edge)){
      const j=i*VERTEX_STRIDE;observed=Math.max(observed,Math.hypot(...[0,1,2].map(k=>mesh.vertex[j+k]-mesh.vertex[j+k+3])));
    }
    assert.ok(observed<=mesh.edgeMorphErrorM[edge]+2*mesh.witness.maxVertexFloat32ErrorM+1e-6);
    assert.ok(mesh.edgeMorphErrorM[edge]<=mesh.morphErrorM);
  }

});
test('feature mesh refines the ground beneath narrow water and road overlays using Core heights', async () => {
  const p = paged(), level = 17, tile = { face: 1, level, x: 0, y: Math.floor((Math.tan(35 * Math.PI / 180) * Math.sqrt(2) + 1) / 2 * 2 ** level) };
  const mesh = await buildMesh(p, tile), chart = createGlobeFeatureChart(reference, recipe);
  assert.ok(mesh.vertex.length / VERTEX_STRIDE > mesh.vertexCount + 68);
  assert.ok(mesh.overlayIndex.length > 0);
  assert.ok(mesh.samplingStats.edgeCacheHits>0);assert.ok(mesh.samplingStats.edgeCachePeak<=2048);assert.ok(mesh.samplingStats.avoidedFixedBisectionSamples>0);
  assert.ok(Math.max(...mesh.index) < mesh.vertex.length / VERTEX_STRIDE);
  assert.ok(Math.max(...mesh.overlayIndex) < mesh.overlayVertex.length / VERTEX_STRIDE);
  // First added triangle is a sampled ground face; subsequent display skirts
  // join it to a coarser edge and are not numerical field samples.
  for (let i = mesh.vertexCount * VERTEX_STRIDE; i < (mesh.vertexCount + 3) * VERTEX_STRIDE; i += VERTEX_STRIDE) {
    const ecef = mesh.anchor.map((v, k) => v + mesh.vertex[i + k]), point = geographic(ecef);
    const expected = chart.sampleAt(point.latDeg, point.lonDeg)?.groundElevationM ?? reference.groundElevationAt(point.latDeg, point.lonDeg);
    assert.ok(Math.abs(Math.hypot(...ecef) - reference.frame.radiusM - expected) < 1e-4);
  }
});
test('paged local and polar height hulls conservatively contain Core samples', async () => {
  const p = paged();
  for (const tile of [{ face: 1, level: 19, x: 0, y: 521729 }, { face: 4, level: 20, x: 524287, y: 524287 }, { face: 5, level: 12, x: 2047, y: 2047 }, { face: 0, level: 8, x: 21, y: 51 }]) {
    const range = await p.ready(() => p.tileHeightBounds(tileBound(tile, reference.frame.radiusM)));
    for (let y = 0; y <= 8; y++) for (let x = 0; x <= 8; x++) {
      const point = geographic(tileDirection(tile, x / 8, y / 8)), z = reference.groundElevationAt(point.latDeg, point.lonDeg);
      assert.ok(z >= range[0] - 1e-9 && z <= range[1] + 1e-9);
    }
  }
});
test('height hulls converge inside a coarse source cell without inventing a flat gradient', async () => {
  const p=paged(),spans=[];
  for(const angular of [1e-4,1e-5,1e-6]){
    const range=await p.ready(()=>p.tileHeightBounds({center:[1,0,0],angular},{includeFeatures:false}));
    const z=await p.ready(()=>p.rawGroundElevationAt(0,0));
    assert.ok(range[0]<=z&&range[1]>=z);spans.push(range[1]-range[0]);
  }
  // The coarsest interval can already be clipped by a tighter corner hull.
  assert.ok(spans[1]<spans[0]&&spans[2]<spans[1]*.11,`${spans}`);
  const old=new PagedSource({...manifest,rowLipschitz:undefined},new URL('manifest.json',demoDir).href,diskFetch);
  const fallback=await old.ready(()=>old.tileHeightBounds({center:[1,0,0],angular:1e-6},{includeFeatures:false}));
  assert.ok(fallback[1]-fallback[0]>spans[2]);
});

test('LRU evicts in access order, disposes buffers, and never exceeds its byte cap', () => {
  const freed = [], cache = new ByteLRU(10, v => freed.push(v)); cache.put('a', 1, 4); cache.put('b', 2, 4); cache.get('a'); cache.put('c', 3, 4);
  assert.equal(cache.get('b'), null); assert.deepEqual(freed, [2]); assert.equal(cache.bytes, 8); cache.clear(); assert.equal(cache.bytes, 0);
  assert.throws(() => cache.put('huge', 0, 11), /budget/);
});
test('LOD traversal and prioritized wanted metadata stay bounded during space-to-ground travel', () => {
  const controller = Object.create(GlobeStream.prototype); Object.assign(controller, { manifest, workers: [], wanted: new Map(), generation: 0, dispatch() {} });
  for (const altitude of [20000000, 100000, 1000, 10, 3]) {
    const camera = { eye: [6371000 + altitude, 0, 0], eyeUnit: [1, 0, 0], forward: [-1, 0, 0], right: [0, 1, 0], up: [0, 0, 1], near: .1, altitude, focal: 2.414, aspect: 1.6 };
    controller.plan(camera, 720); assert.ok(controller.wanted.size <= STREAM_LIMITS.maxWantedTiles); assert.ok([...controller.wanted.values()].every(t => t.tile.level <= 24));
    assert.ok(controller.wanted.has(tileKey({ face: 0, level: 0, x: 0, y: 0 })));
  }
});
test('cube-edge refinement reaches both faces under the bounded request budget', () => {
  const controller = Object.create(GlobeStream.prototype); Object.assign(controller, { manifest, workers: [], wanted: new Map(), generation: 0, dispatch() {} });
  const point = { latDeg: 35, lonDeg: 135 }, up = tileDirection({ face: 1, level: 0, x: 0, y: 0 }, 0, (Math.tan(35 * Math.PI / 180) * Math.sqrt(2) + 1) / 2);
  const height = reference.groundElevationAt(point.latDeg, point.lonDeg), east = [-Math.SQRT1_2, -Math.SQRT1_2, 0], north = crossForTest(east, up);
  const camera = { eye: up.map(v => v * (6371000 + height + 30)), eyeUnit: up, forward: up.map(v => -v), right: east, up: north, near: .1, altitude: 30, focal: 2.414, aspect: 1.6, groundReference: { up, elevationM: height } };
  controller.plan(camera, 720);
  for (const face of [1, 2]) assert.ok([...controller.wanted.values()].some(t => t.tile.face === face && t.tile.level >= 18));
});
function crossForTest(a, b) { return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]; }

test('failed pinned-cache insertion retains the prior value and never overcommits memory',()=>{
 const disposed=[],c=new ByteLRU(10,v=>disposed.push(v));c.put('a','original',6);c.put('b','pinned',4);
 assert.throws(()=>c.put('a','replacement',7,new Set(['b'])),/Pinned/);assert.equal(c.bytes,10);assert.equal(c.get('a'),'original');assert.deepEqual(disposed,[]);
 assert.throws(()=>c.reserve(NaN),/budget/);assert.throws(()=>c.reserve(-1),/budget/);
 c.put('a','smaller',5,new Set(['b']));assert.equal(c.bytes,9);assert.equal(c.get('a'),'smaller');assert.deepEqual(disposed,['original']);
});


test('boundary searches stop at a millimetre or the stricter existing long-edge budget',()=>{
 for(const radius of[1e5,6371000,1e8])for(const angle of[0,1e-12,1e-9,1e-6,.001,.1,1.5]){
  const a=[1,0,0],b=[Math.cos(angle),Math.sin(angle),0],n=boundaryBisectionCount(a,b,radius),bound=2*radius*Math.tan(angle/2);
  assert.ok(Number.isInteger(n)&&n>=1&&n<=18);assert.ok(bound/2**n<=Math.max(.001,bound/2**18)*(1+1e-12));if(bound<=1)assert.ok(n<18);
 }
 for(const args of[[[0,0,0],[1,0,0],1],[[1,0,0],[1,NaN,0],1],[[1,0,0],[1,0,0],0]])assert.throws(()=>boundaryBisectionCount(...args));
});

test('coarse feature budgets preserve fine capacity and bound invalid LOD requests',()=>{
 const coarse=featureSubdivisionBudgets(15),fine=featureSubdivisionBudgets(16);
 assert.equal(coarse.water+coarse.bank,1500);assert.equal(fine.water+fine.bank,6000);
 assert.ok(coarse.minimumWaterPerTriangle>=8);assert.equal(fine.minimumBankPerTriangle,4);
 coarse.water=999;assert.equal(featureSubdivisionBudgets(15).water,1200);
 assert.throws(()=>featureSubdivisionBudgets(29),/LOD/);
});

test('LOD planning uses cached full-ground error rather than only uncut terrain error',()=>{
 const controller=Object.create(GlobeStream.prototype),entries=new Map();
 for(let face=0;face<6;face++)entries.set(tileKey({face,level:0,x:0,y:0}),{bytes:65536,value:{heightRangeM:manifest.elevationRangeM,baseHeightRangeM:manifest.elevationRangeM,geometricError:{geometricErrorM:1e9}}});
 Object.assign(controller,{manifest,workers:[],wanted:new Map(),generation:0,dispatch(){},cache:{entries,maxBytes:STREAM_LIMITS.gpuBytes}});
 const camera={eye:[26371000,0,0],eyeUnit:[1,0,0],forward:[-1,0,0],right:[0,1,0],up:[0,0,1],near:100,altitude:20000000,focal:2.414,aspect:1.6};
 controller.plan(camera,720);
 const e=controller.wanted.get(tileKey({face:0,level:0,x:0,y:0}));
 assert.ok(e.groundErrorPixels>e.baseErrorPixels);assert.equal(e.errorPixels,e.groundErrorPixels);assert.ok(e.refine);
 assert.ok(Object.hasOwn(controller.lodQuality,'maxPlannedGroundErrorPixels'));
});

test('spherical centimetre cells keep a nonzero conservative angular disk',()=>{
 for(const face of [0,3,4,5])for(const level of [24,28]){
  const tile={face,level,x:Math.floor(2**level*.37),y:Math.floor(2**level*.71)},bound=tileBound(tile,6371000);
  assert.ok(bound.angular>0&&bound.radiusM>0);
  for(let y=0;y<=4;y++)for(let x=0;x<=4;x++){
   const d=tileDirection(tile,x/4,y/4),c=bound.center,cross=[c[1]*d[2]-c[2]*d[1],c[2]*d[0]-c[0]*d[2],c[0]*d[1]-c[1]*d[0]],angle=Math.atan2(Math.hypot(...cross),c.reduce((s,v,i)=>s+v*d[i],0));
   assert.ok(angle<=bound.angular);
  }
 }
});

test('feature sampling reuses the base point within a query and releases it after errors or later calls',()=>{
 let calls=0,offset=0,fail=false;
 const base={...reference,groundElevationAt:(lat,lon)=>{calls++;if(fail)throw new Error('missing test page');return reference.groundElevationAt(lat,lon)+offset;}},chart=createGlobeFeatureChart(base,recipe),point=chart.projection.toGeographic(399,399);
 calls=0;const a=chart.sampleAt(point.latDeg,point.lonDeg);assert.equal(calls,1);
 calls=0;assert.deepEqual(chart.sampleAt(point.latDeg,point.lonDeg),a);assert.equal(calls,1);
 offset=1;assert.notEqual(chart.sampleAt(point.latDeg,point.lonDeg).groundElevationM,a.groundElevationM);
 fail=true;assert.throws(()=>chart.sampleAt(point.latDeg,point.lonDeg),/missing test page/);
 fail=false;offset=0;calls=0;assert.deepEqual(chart.sampleAt(point.latDeg,point.lonDeg),a);assert.equal(calls,1);
});
