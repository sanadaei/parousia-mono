import test from 'node:test';
import assert from 'node:assert/strict';
import { globalFixture, globalInput } from '../fixtures/global-scenarios.mjs';
import { createGlobalTerrain, createProjectedTerrainView, serializeGlobalTerrain, restoreGlobalTerrain, restoreProjectedTerrainView } from '../global-terrain.mjs';
import { connectGlobalSurfaceWaterCharts, connectGlobalSurfaceWater } from '../global-water.mjs';
import { connectInterChartRivers } from '../global-interchart-rivers.mjs';
import { adaptPostDetailDrainage, restorePostDetailDrainage } from '../post-detail-drainage.mjs';
import { ANCHORED_DETAIL_METHOD } from '../spherical-detail.mjs';
import { createSphericalProjection } from '../spherical.mjs';
import { spawnSync } from 'node:child_process';

const near=(a,b,eps=1e-7)=>assert.ok(Math.abs(a-b)<=eps,`${a} != ${b}`);
const flat=()=>globalFixture({height:()=>100});
function river(a,b) {
  return {nodes:[{id:'start',...a},{id:'end',...b}],edges:[{id:'river',from:'start',to:'end',points:[a,b]}]};
}
const connection={fromChartId:'up',toChartId:'down',fromNodeId:'end',toNodeId:'start',junctionLatDeg:0,junctionLonDeg:0};
function charts(boundary=true,lon=0) {
  const bounds=sign=>({minXM:boundary ? sign<0?-1000:0 : -1000,maxXM:boundary ? sign<0?0:1000 : 1000,minYM:-1000,maxYM:1000});
  return [-1,1].map(sign=>{
    const centerLonDeg=boundary?lon:lon+sign*.001;
    const p=createSphericalProjection({centerLatDeg:0,centerLonDeg,radiusM:6371000});
    const seam=p.toLocal(0,lon), outer=p.toLocal(0,lon+sign*.004);
    return {id:sign<0?'up':'down',centerLatDeg:0,centerLonDeg,bounds:bounds(sign),verticalDatum:'fixture-zero',
      riverGraph:sign<0?river(outer,seam):river(seam,outer)};
  });
}
function connected(boundary=true) {return connectInterChartRivers(flat(),{charts:charts(boundary),interChartRivers:[connection]});}
const xy=(xM,yM=0,lon=0)=>createSphericalProjection({centerLatDeg:0,centerLonDeg:lon,radiusM:6371000}).toGeographic(xM,yM);

test('adjacent charts open their declared endpoints with equal level, depth and fitted width',()=>{
  const base=flat(),before=base.toSnapshot(),water=connectInterChartRivers(base,{charts:charts(),connections:[connection]});
  assert.deepEqual(base.toSnapshot(),before);assert.equal(water.sourceWorldId,base.sourceWorldId);
  const saved=water.toSnapshot(),up=saved.waterCharts.find(c=>c.id==='up'),down=saved.waterCharts.find(c=>c.id==='down');
  assert.deepEqual(up.interChartBoundaryNodeIds,['end']);assert.deepEqual(down.interChartBoundaryNodeIds,['start']);
  const a=up.model.edges[0].points.at(-1),b=down.model.edges[0].points[0];
  for(const k of ['waterLevelElevationM','depthM','halfWidthM','bankWidthM']) near(a[k],b[k],0);
  for(const x of [-1,-.001,0,.001,1]) {
    const p=xy(x),s=water.sampleAt(p.latDeg,p.lonDeg);
    near(s.waterDepthM,a.depthM);near(s.waterLevelElevationM,a.waterLevelElevationM);
    near(s.groundElevationM,water.groundElevationAt(p.latDeg,p.lonDeg),0);
    assert.equal(s.basinId,base.sampleAt(p.latDeg,p.lonDeg).basinId);
  }
});

test('the whole wet seam cross-section is continuous, including dry outer banks',()=>{
  const water=connected();
  for(const y of [-4.8,-4,-3,-1,0,1,3,4,4.8]) {
    const left=xy(-1e-4,y),right=xy(1e-4,y),a=water.sampleAt(left.latDeg,left.lonDeg),b=water.sampleAt(right.latDeg,right.lonDeg);
    near(a.groundElevationM,b.groundElevationM,1e-6);near(a.waterDepthM,b.waterDepthM,1e-6);
    if(Math.abs(y)<3) assert.ok(a.waterDepthM>0 && b.waterDepthM>0);
  }
});

test('an oblique river shares the complete wet opening across adjacent chart cuts',()=>{
  const cs=charts();
  cs[0].riverGraph=river({xM:-400,yM:-200},{xM:0,yM:0});
  cs[1].riverGraph=river({xM:0,yM:0},{xM:400,yM:200});
  const water=connectInterChartRivers(flat(),{charts:cs,connections:[connection]});
  for (const y of [-1,0,1]) {
    const a=xy(-1e-5,y),b=xy(1e-5,y),left=water.sampleAt(a.latDeg,a.lonDeg),right=water.sampleAt(b.latDeg,b.lonDeg);
    near(left.groundElevationM,right.groundElevationM,1e-5);assert.ok(left.waterDepthM>0 && right.waterDepthM>0);
  }
});

test('three charts retain a connected downhill chain across two declared seams',()=>{
  const chart=(id,minXM,maxXM)=>({id,centerLatDeg:0,centerLonDeg:0,verticalDatum:'fixture-zero',bounds:{minXM,maxXM,minYM:-100,maxYM:100},riverGraph:river({xM:minXM+(id==='a'?100:0),yM:0},{xM:maxXM-(id==='c'?100:0),yM:0})});
  const connections=[{fromChartId:'a',toChartId:'b',fromNodeId:'end',toNodeId:'start'},{fromChartId:'b',toChartId:'c',fromNodeId:'end',toNodeId:'start'}];
  const cs=[chart('a',-900,-300),chart('b',-300,300),chart('c',300,900)];
  const water=connectInterChartRivers(flat(),{charts:cs,connections});
  const reordered=connectInterChartRivers(flat(),{charts:[...cs].reverse(),connections:[...connections].reverse()});
  assert.equal(water.worldId,reordered.worldId);
  for (const x of [-500,-300,-1,0,1,300,500]) {const p=xy(x);near(water.sampleAt(p.latDeg,p.lonDeg).waterDepthM,1.2);}
  assert.deepEqual(restoreGlobalTerrain(serializeGlobalTerrain(water)).toSnapshot(),water.toSnapshot());
});

test('distinct spherical projections meet at an internal junction without chart-order dependence',()=>{
  const options={charts:charts(false),interChartRivers:[connection]},water=connectInterChartRivers(flat(),options);
  const reversed=connectGlobalSurfaceWaterCharts(flat(),{...options,charts:[...options.charts].reverse()});
  assert.equal(water.worldId,reversed.worldId);
  for(const x of [-10,-1,-1e-4,0,1e-4,1,10]) for(const y of [-1,0,1]) {
    const p=xy(x,y),s=water.sampleAt(p.latDeg,p.lonDeg);
    assert.deepEqual(s,reversed.sampleAt(p.latDeg,p.lonDeg));assert.ok(s.waterDepthM>0);
    near(s.groundElevationM,water.groundElevationAt(p.latDeg,p.lonDeg),0);
  }
  const a=xy(-1e-5,1),b=xy(1e-5,1);near(water.groundElevationAt(a.latDeg,a.lonDeg),water.groundElevationAt(b.latDeg,b.lonDeg),1e-6);
});

test('connected river sampling is deterministic across LOD, windows and projected snapshot restoration',()=>{
  const view=createProjectedTerrainView(connected(),{centerLatDeg:0,centerLonDeg:0,bounds:{minXM:-100,minYM:-100,maxXM:100,maxYM:100}});
  const box={minXM:-20,minYM:-10,maxXM:20,maxYM:10};
  const fine=new Map(view.sampleWindow({...box,spacingM:1}).samples.map(s=>[`${s.xM},${s.yM}`,s]));
  for(const s of view.sampleWindow({...box,spacingM:5}).samples) assert.deepEqual(s,fine.get(`${s.xM},${s.yM}`));
  const a=view.sampleWindow({...box,maxXM:0,spacingM:1}),b=view.sampleWindow({...box,minXM:0,spacingM:1});
  assert.deepEqual(a.samples.filter(s=>s.xM===0),b.samples.filter(s=>s.xM===0));
  assert.deepEqual(restoreProjectedTerrainView(view.toSnapshot()).surfaceFrameAt(0,1),view.surfaceFrameAt(0,1));
});

test('multiple connected charts restore profiles, samples and event-driven seam crossings',()=>{
  const water=connected(),restored=restoreGlobalTerrain(serializeGlobalTerrain(water));
  assert.equal(restored.worldId,water.worldId);assert.deepEqual(restored.toSnapshot(),water.toSnapshot());
  for(const x of [-500,-1,0,1,500]) {const p=xy(x,1);assert.deepEqual(restored.sampleAt(p.latDeg,p.lonDeg),water.sampleAt(p.latDeg,p.lonDeg));}
  const view=createProjectedTerrainView(water,{centerLatDeg:0,centerLonDeg:0});
  const trace=view.traceSurfaceSegment({xM:-100,yM:0},{xM:100,yM:0},{maxStepM:200});
  assert.ok(trace.samples.some(s=>Math.abs(s.xM)<1e-7));
});

test('connected charts cross the date line with the same source world and continuous water',()=>{
  const lon=180,water=connectInterChartRivers(flat(),{charts:charts(true,lon),connections:[{...connection,junctionLonDeg:lon}]});
  assert.deepEqual(water.sampleAt(0,180),water.sampleAt(0,-180));
  for(const x of [-1,1]) {const p=xy(x,0,lon);near(water.sampleAt(p.latDeg,p.lonDeg).waterDepthM,1.2);}
});

test('declared chart seams carry continuous river profiles through both spherical poles',()=>{
  for (const lat of [-90,90]) {
    const cs=charts();for(const c of cs) {c.centerLatDeg=lat;c.riverGraph=c.id==='up'?river({xM:-400,yM:0},{xM:0,yM:0}):river({xM:0,yM:0},{xM:400,yM:0});}
    const water=connectInterChartRivers(flat(),{charts:cs,connections:[{...connection,junctionLatDeg:lat}]});
    near(water.sampleAt(lat,10).waterDepthM,1.2);assert.deepEqual(water.sampleAt(lat,10),water.sampleAt(lat,-140));
    assert.deepEqual(restoreGlobalTerrain(serializeGlobalTerrain(water)).sampleAt(lat,0),water.sampleAt(lat,0));
  }
});

test('unrelated disjoint water bodies remain usable in river-connected charts',()=>{
  const cs=charts(false);
  cs[0].waterBodies=[{id:'dry-search',kind:'lake',waterLevelElevationM:90,polygon:[[-800,400],[-700,400],[-700,500],[-800,500]].map(([xM,yM])=>({xM,yM}))}];
  const water=connectInterChartRivers(flat(),{charts:cs,connections:[connection]});
  near(water.sampleAt(0,0).waterDepthM,1.2);
  assert.deepEqual(restoreGlobalTerrain(serializeGlobalTerrain(water)).toSnapshot(),water.toSnapshot());
});

test('connected chart input and returned snapshot mutations cannot change the live world',()=>{
  const cs=charts(),join={...connection},water=connectInterChartRivers(flat(),{charts:cs,connections:[join]}),before=water.sampleAt(0,0);
  cs[0].riverGraph.nodes[0].xM=-800;join.toNodeId='missing';
  const saved=water.toSnapshot();saved.interChartRivers[0].toNodeId='missing';saved.waterCharts[0].model.edges[0].points[0].depthM=9;
  assert.deepEqual(water.sampleAt(0,0),before);
});

test('undeclared touching charts remain rejected and single charts cannot authorize open cuts',()=>{
  const cs=charts();
  assert.throws(()=>connectGlobalSurfaceWaterCharts(flat(),{charts:cs}),/support|disjoint/);
  cs[0].riverGraph.nodes[1].kind='regional-boundary';
  assert.throws(()=>connectGlobalSurfaceWater(flat(),cs[0]),/support|regional-boundary/);
});

test('unknown charts, nodes, duplicate joins and malformed geographic declarations are rejected',()=>{
  const bad=[{...connection,toChartId:'missing'},{...connection,toNodeId:'missing'},{...connection,toChartId:'up'},
    {...connection,junctionLatDeg:91},{...connection,junctionLonDeg:1},{...connection,depthM:1}];
  for(const c of bad) assert.throws(()=>connectInterChartRivers(flat(),{charts:charts(),connections:[c]}),/chart|node|distinct|Latitude|junction|property/);
  assert.throws(()=>connectInterChartRivers(flat(),{charts:charts(),connections:[connection,connection]}),/Duplicate/);
  assert.throws(()=>connectInterChartRivers(flat(),{charts:charts(),connections:[],interChartRivers:[]}),/not both/);
  assert.throws(()=>connectInterChartRivers(flat(),{charts:charts(),connections:'bad'}),/connections/);
});

test('a connection must join the downstream end to the next upstream start',()=>{
  assert.throws(()=>connectInterChartRivers(flat(),{charts:charts(false),connections:[{...connection,fromNodeId:'start'}]}),/endpoint.*startpoint/);
});

test('mismatched endpoint level, depth, wet width or bank width fails the seam contract',()=>{
  for(const [parameter,value] of [['freeboardM',.2],['depthM',2],['halfWidthM',4],['bankWidthM',2]]) {
    const cs=charts();cs[1].parameters={[parameter]:value};
    assert.throws(()=>connectInterChartRivers(flat(),{charts:cs,connections:[connection]}),/seam.*mismatch/);
  }
});

test('offset and reversing endpoints cannot masquerade as a continuous river',()=>{
  const offset=charts(false);offset[1].riverGraph.nodes[0].yM=10;offset[1].riverGraph.edges[0].points[0].yM=10;
  assert.throws(()=>connectInterChartRivers(flat(),{charts:offset,connections:[connection]}),/positions/);
  const reverse=charts(false);reverse[1].riverGraph=river(reverse[1].riverGraph.nodes[0],{xM:-400,yM:0});
  assert.throws(()=>connectInterChartRivers(flat(),{charts:reverse,connections:[connection]}),/directions/);
});

test('snapshot connection changes and removed declarations cannot bypass seam verification',()=>{
  const water=connected(),saved=water.toSnapshot();saved.interChartRivers[0].junctionLonDeg=1;
  assert.throws(()=>restoreGlobalTerrain(saved),/junction/);
  const removed=water.toSnapshot();delete removed.interChartRivers;
  assert.throws(()=>restoreGlobalTerrain(removed),/Unconnected/);
  const identity=water.toSnapshot();identity.worldId='sha256:bad';assert.throws(()=>restoreGlobalTerrain(identity),/worldId mismatch/);
});

test('one declared opening does not authorize an unrelated clipped channel on the same boundary',()=>{
  const cs=charts(),extra=river({xM:-400,yM:500},{xM:-1,yM:500});
  extra.nodes[0].id='other-start';extra.nodes[1].id='other-end';extra.edges[0].id='other';extra.edges[0].from='other-start';extra.edges[0].to='other-end';
  cs[0].riverGraph.nodes.push(...extra.nodes);cs[0].riverGraph.edges.push(...extra.edges);
  assert.throws(()=>connectInterChartRivers(flat(),{charts:cs,connections:[connection]}),/support.*declared/);
});

test('a validated junction cannot authorize a separate cross-chart channel overlap',()=>{
  const cs=charts(false);
  for (const c of cs) {
    const projection=createSphericalProjection({centerLatDeg:c.centerLatDeg,centerLonDeg:c.centerLonDeg,radiusM:6371000});
    const p=projection.toLocal(0,0),extra=river({xM:p.xM-50,yM:200},{xM:p.xM+50,yM:200});
    extra.nodes[0].id='other-start';extra.nodes[1].id='other-end';extra.edges[0].id='other';extra.edges[0].from='other-start';extra.edges[0].to='other-end';
    c.riverGraph.nodes.push(...extra.nodes);c.riverGraph.edges.push(...extra.edges);
  }
  assert.throws(()=>connectInterChartRivers(flat(),{charts:cs,connections:[connection]}),/overlap outside/);
});

test('standalone snapshots cannot detach an authorized boundary opening from its validated connection',()=>{
  const water=connected(),saved=water.toSnapshot(),single={schema:'minimal-world-global-water-terrain@1',base:saved.base,waterChart:saved.waterCharts[0]};
  assert.throws(()=>createGlobalTerrain(single),/connected multi-chart/);
  assert.throws(()=>connectGlobalSurfaceWater(flat(),{...charts()[0],interChartBoundaryNodeIds:['end']}),/validated multi-chart/);
});

function detailed(height=()=>100) {
  const input=globalInput({height,bands:[{id:'relief',wavelengthM:500000,amplitudeM:20}]});
  input.detail.method=ANCHORED_DETAIL_METHOD;return createGlobalTerrain(input);
}
function verifyPaths(result,base) {
  const terrain=result.adaptedTerrain,saved=terrain.toSnapshot(),{columns:w,rows:h}=saved.drainage.grid,d=saved.drainage;
  for(let start=0;start<w*h;start++) {
    const lat=90-(Math.floor(start/w)+.5)*180/h,lon=(start%w+.5)*360/w,info=result.sampleDrainageAt(lat,lon),seen=new Set();let cell=start;
    near(terrain.groundElevationAt(lat,lon),d.groundElevationM[start],1e-7);
    assert.equal(info.outletCellIndex,base.sampleAt(lat,lon).outletCellIndex);assert.equal(info.basinId,base.sampleAt(lat,lon).basinId);
    while(d.downstream[cell]>=0) {
      assert.ok(!seen.has(cell));seen.add(cell);const next=d.downstream[cell];
      const dx=Math.abs(cell%w-next%w),dy=Math.abs(Math.floor(cell/w)-Math.floor(next/w));assert.ok(Math.min(dx,w-dx)<=1 && dy<=1);
      assert.ok(d.groundElevationM[cell]>d.groundElevationM[next]);
      assert.ok([1,2,4,8,16,32,64,128].includes(d.flowDirectionD8[cell]));
      const n=result.sampleDrainageAt(90-(Math.floor(next/w)+.5)*180/h,(next%w+.5)*360/w);
      assert.equal(n.basinId,info.basinId);cell=next;
    }
    assert.equal(cell,info.drainageOutletCellIndex);
    assert.equal(d.flowDirectionD8[cell],0);
  }
}

test('anchored high-frequency detail creates depressions and adaptation drains every refined cell to its original outlet',()=>{
  const base=detailed(),before=base.toSnapshot(),r=adaptPostDetailDrainage(base);
  assert.ok(r.depressionCount>0);assert.ok(r.correctedCells.length>0);verifyPaths(r,base);
  assert.deepEqual(base.toSnapshot(),before);assert.deepEqual(r.adaptedTerrain.toSnapshot().base,before);
  assert.equal(r.adaptedTerrain.sourceWorldId,base.sourceWorldId);assert.notEqual(r.adaptedTerrain.worldId,base.worldId);
});

test('reverse-slope chains are filled downstream-first while preserving source drainage fields',()=>{
  const base=globalFixture({height:(x)=>x===3?50:x===4?40:100}),r=adaptPostDetailDrainage(base,{subdivisions:1,minDropM:.01});
  assert.ok(r.correctedCells.some(c=>c.sourceCellIndex===3));verifyPaths(r,base);
  assert.deepEqual(r.adaptedTerrain.toSnapshot().base.fields.downstream,base.toSnapshot().fields.downstream);
});

test('legacy bounded spherical detail also produces strictly descending adapted paths',()=>{
  const input=globalInput({bands:[{id:'old-noise',wavelengthM:500000,amplitudeM:20}]});
  const base=createGlobalTerrain(input),r=adaptPostDetailDrainage(base,{subdivisions:5});verifyPaths(r,base);
  assert.equal(r.adaptedTerrain.toSnapshot().base.detail.method,'bounded-spherical-bands@1');
});

test('detail-free already descending source cells need no correction',()=>{
  const base=globalFixture({height:x=>x*10}),r=adaptPostDetailDrainage(base,{subdivisions:1});
  assert.equal(r.depressionCount,0);assert.deepEqual(r.correctedCells,[]);verifyPaths(r,base);
});

test('D8 adaptation handles diagonal, longitude-wrapped, and unresolved land-terminal paths',()=>{
  const input=globalInput({height:()=>10});input.fields.landMask=Array(32).fill(1);input.fields.downstream=Array(32).fill(-1);
  input.fields.downstream[0]=15;input.fields.downstream[15]=22;input.fields.downstream[22]=21;
  const base=createGlobalTerrain(input),r=adaptPostDetailDrainage(base,{subdivisions:5});verifyPaths(r,base);
  const info=r.sampleDrainageAt(67.5,22.5);assert.equal(info.outletCellIndex,null);assert.equal(info.status,'adapted-unresolved-terminal');
});

test('adapted ground and drainage are invariant across LOD, windows, longitude seam and polar queries',()=>{
  const terrain=adaptPostDetailDrainage(detailed()).adaptedTerrain,view=createProjectedTerrainView(terrain,{centerLatDeg:0,centerLonDeg:180});
  assert.match(view.tracePrecision,/water unresolved/);assert.equal(view.hydrologyStatus,'unresolved');
  const b={minXM:-10,minYM:-10,maxXM:10,maxYM:10},fine=new Map(view.sampleWindow({...b,spacingM:1}).samples.map(s=>[`${s.xM},${s.yM}`,s]));
  for(const s of view.sampleWindow({...b,spacingM:5}).samples) assert.deepEqual(s,fine.get(`${s.xM},${s.yM}`));
  const a=view.sampleWindow({...b,maxXM:0,spacingM:1}),c=view.sampleWindow({...b,minXM:0,spacingM:1});
  assert.deepEqual(a.samples.filter(s=>s.xM===0),c.samples.filter(s=>s.xM===0));
  assert.deepEqual(terrain.sampleAt(12,180),terrain.sampleAt(12,-180));
  assert.deepEqual(terrain.sampleAt(90,0),terrain.sampleAt(90,150));
  assert.equal(terrain.sampleDrainageAt(-90,10).cellIndex,null);
  const p=view.sampleAt(0,0);near(p.groundElevationM,terrain.groundElevationAt(p.latDeg,p.lonDeg),0);
});

test('post-detail adaptation restores exact drainage arrays, source identity and projected frames',()=>{
  const terrain=adaptPostDetailDrainage(detailed()).adaptedTerrain,restored=restoreGlobalTerrain(serializeGlobalTerrain(terrain));
  assert.deepEqual(restored.toSnapshot(),terrain.toSnapshot());
  for(const [lat,lon] of [[0,0],[45,180],[89.9,10],[-90,0]]) assert.deepEqual(restored.sampleAt(lat,lon),terrain.sampleAt(lat,lon));
  const view=createProjectedTerrainView(terrain,{centerLatDeg:0,centerLonDeg:0});
  assert.deepEqual(restoreProjectedTerrainView(view.toSnapshot()).surfaceFrameAt(1,2),view.surfaceFrameAt(1,2));
  const saved=terrain.toSnapshot();saved.drainage.downstream[0]=-1;assert.throws(()=>restorePostDetailDrainage(saved),/mismatch/);
});

test('drainage options are bounded, finite, owned and fixed independently of query windows',()=>{
  const base=detailed();
  for(const options of [{subdivisions:0},{subdivisions:2},{subdivisions:17},{subdivisions:1.5},{minDropM:0},{minDropM:NaN},{minDropM:Infinity},{minDropM:1001},{spacingM:1}]) assert.throws(()=>adaptPostDetailDrainage(base,options));
  assert.throws(()=>adaptPostDetailDrainage(connected()),/base global terrain/);
  const opts={subdivisions:3,minDropM:.01},r=adaptPostDetailDrainage(base,opts),before=r.adaptedTerrain.sampleAt(0,0);
  opts.minDropM=100;r.correctedCells[0].groundElevationM=-1;r.adaptedTerrain.toSnapshot().drainage.groundElevationM[0]=-100;
  assert.deepEqual(r.adaptedTerrain.sampleAt(0,0),before);
});

test('public root shims and core entry exports refer to the same implementation',async()=>{
  const core=await import('../src/core/index.mjs'),root=await import('../index.mjs');
  assert.equal(core.connectInterChartRivers,connectInterChartRivers);assert.equal(root.connectInterChartRivers,connectInterChartRivers);
  assert.equal(core.adaptPostDetailDrainage,adaptPostDetailDrainage);assert.equal(root.adaptPostDetailDrainage,adaptPostDetailDrainage);
});

test('both new global snapshot kinds reconstruct identically in a separate Node process',()=>{
  const worlds=[connected(false),adaptPostDetailDrainage(detailed()).adaptedTerrain];
  const script="import {restoreGlobalTerrain} from './global-terrain.mjs'; let s='';for await(const c of process.stdin)s+=c;const worlds=JSON.parse(s).map(restoreGlobalTerrain);process.stdout.write(JSON.stringify(worlds.map(w=>w.sampleAt(0,0))));";
  const result=spawnSync(process.execPath,['--input-type=module','-e',script],{input:JSON.stringify(worlds.map(w=>w.toSnapshot())),encoding:'utf8',cwd:new URL('..',import.meta.url)});
  assert.equal(result.status,0,result.stderr);assert.deepEqual(JSON.parse(result.stdout),worlds.map(w=>w.sampleAt(0,0)));
});
