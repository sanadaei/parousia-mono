import { readFileSync, writeFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import { createGlobalTerrain, createProjectedTerrainView, restoreGlobalTerrain, restoreProjectedTerrainView, serializeGlobalTerrain } from '../global-terrain.mjs';
import { connectGlobalSurfaceWaterCharts } from '../global-water.mjs';
import { ANCHORED_DETAIL_METHOD } from '../spherical-detail.mjs';
import { inspectRoadCrossings } from '../road-crossings.mjs';
const [mode, sourcePath, snapshotPath, witnessPath] = process.argv.slice(2), started = performance.now();
const near = (a,b,eps=1e-7) => assert.ok(Math.abs(a-b)<=eps,`${a} != ${b}`);
const traceA={xM:-1000,yM:300}, traceB={xM:1000,yM:300};
const roads={roads:[{id:'crossing',points:[traceA,traceB]}],maxStepM:3000};
if(mode === 'reopen') {
  const snapshot=JSON.parse(readFileSync(snapshotPath,'utf8')), world=restoreGlobalTerrain(snapshot);
  const saved=JSON.parse(readFileSync(witnessPath,'utf8')); let framesCompared=0, traceSamplesCompared=0;
  for(const p of saved.globalSamples) assert.deepEqual(world.sampleAt(p.latDeg,p.lonDeg),p);
  for(const region of saved.regions) {
    const view=restoreProjectedTerrainView({...region.contract,world:snapshot});
    for(const f of region.frames) { assert.deepEqual(view.surfaceFrameAt(f.xM,f.yM),f); framesCompared++; }
    assert.deepEqual(view.traceSurfaceSegment(traceA,traceB,{maxStepM:3000}),region.trace);
    assert.deepEqual(inspectRoadCrossings(view,roads),region.road); traceSamplesCompared+=region.trace.samples.length;
  }
  console.log(JSON.stringify({worldId:world.worldId, separateProcess:true,framesCompared,traceSamplesCompared,
    globalSamplesCompared:saved.globalSamples.length,roadsCompared:saved.regions.length,
    durationMs:performance.now()-started,maxRssMiB:process.resourceUsage().maxRSS/1024}));
} else {
  const original=JSON.parse(readFileSync(sourcePath,'utf8')), modified=structuredClone(original);
  delete modified.worldId; modified.detail.method=ANCHORED_DETAIL_METHOD;
  const base=createGlobalTerrain(modified), old=restoreGlobalTerrain(original), before=serializeGlobalTerrain(base);
  assert.equal(base.sourceWorldId,old.sourceWorldId); assert.notEqual(base.worldId,old.worldId);
  const {columns:w,rows:h}=base.grid; let sourceCentersCompared=0;
  for(let y=0;y<h;y++) for(let x=0;x<w;x++) {
    const lat=90-(y+.5)*180/h,lon=(x+.5)*360/w,p=base.sampleAt(lat,lon),q=old.sampleAt(lat,lon);
    near(p.groundElevationM,q.groundElevationM); near(p.detailElevationM,0);
    assert.equal(p.basinId,q.basinId); assert.equal(p.outletCellIndex,q.outletCellIndex); sourceCentersCompared++;
  }
  const detailProbes=[];
  for(let x=0;x<w;x++) for(const y of [.2,.7,h/2+.2,h-.2]) {
    const lat=90-y*180/h,lon=(x+.5)*360/w,p=base.sampleAt(lat,lon);
    assert.ok(Math.abs(p.detailElevationM)<=24+1e-8);
    detailProbes.push({latDeg:lat,lonDeg:lon,detailElevationM:p.detailElevationM,
      oldDetailElevationM:old.sampleAt(lat,lon).detailElevationM,polar:y<.5||y>h-.5});
  }
  assert.ok(detailProbes.filter(p=>p.polar&&Math.abs(p.detailElevationM)>1e-6).length>0);
  assert.ok(detailProbes.filter(p=>!p.polar&&Math.abs(p.detailElevationM)>1e-6).length>0);
  const nodes=[{id:'a',xM:-600,yM:-1800},{id:'b',xM:600,yM:-1800},{id:'join',xM:0,yM:-600},{id:'out',xM:0,yM:1800}];
  const edge=(id,a,b)=>({id,from:nodes[a].id,to:nodes[b].id,points:[nodes[a],nodes[b]]});
  const charts=[['date',0,180],['seam',12,0],['north',90,0],['south',-90,0]].map(([id,centerLatDeg,centerLonDeg])=>({
    id,centerLatDeg,centerLonDeg,bounds:{minXM:-6000,minYM:-6000,maxXM:6000,maxYM:6000},verticalDatum:base.frame.verticalDatum,
    riverGraph:{nodes,edges:[edge('a',0,2),edge('b',1,2),edge('joined',2,3)]},groundBoundsStepM:5,maxCenterIncisionM:5 }));
  const world=connectGlobalSurfaceWaterCharts(base,{charts}), snapshot=world.toSnapshot();
  const regions=[], globalSamples=detailProbes.map(p=>world.sampleAt(p.latDeg,p.lonDeg)); let centerlineSamples=0, maxIncisionBoundM=0;
  for(const c of charts) {
    const view=createProjectedTerrainView(world,c), model=snapshot.waterCharts.find(p=>p.id===c.id).model;
    const frames=[];
    for(const e of model.edges) {
      let previous=Infinity;
      for(let i=1;i<e.points.length-1;i++) for(const t of [0,.5]) {
        const a=e.points[i],b=e.points[i+1],x=a.xM*(1-t)+b.xM*t,y=a.yM*(1-t)+b.yM*t,p=view.sampleAt(x,y);
        near(p.waterDepthM,1.2); assert.ok(p.waterLevelElevationM<=previous+1e-7); previous=p.waterLevelElevationM;
        assert.equal(p.waterChartId,c.id); const source=base.sampleAt(p.latDeg,p.lonDeg); assert.equal(p.basinId,source.basinId); centerlineSamples++;
      }
    }
    const coarse=view.sampleWindow({...c.bounds,spacingM:2000}),fine=view.sampleWindow({...c.bounds,spacingM:1000});
    const fineByPoint=new Map(fine.samples.map(p=>[`${p.xM},${p.yM}`,p]));
    for(const p of coarse.samples) { assert.deepEqual(p,fineByPoint.get(`${p.xM},${p.yM}`)); frames.push(view.surfaceFrameAt(p.xM,p.yM)); }
    const left=view.sampleWindow({...c.bounds,maxXM:0,spacingM:400}),right=view.sampleWindow({...c.bounds,minXM:0,spacingM:400});
    const seamA=left.samples.filter(p=>p.xM===0),seamB=right.samples.filter(p=>p.xM===0); assert.deepEqual(seamA,seamB);
    for(const p of seamA) frames.push(view.surfaceFrameAt(p.xM,p.yM));
    for(const n of model.nodes) frames.push(view.surfaceFrameAt(n.xM,n.yM));
    const contract=view.toSnapshot(); delete contract.world;
    const trace=view.traceSurfaceSegment(traceA,traceB,{maxStepM:3000}),road=inspectRoadCrossings(view,roads);
    assert.equal(road.crossings.length,1); assert.ok(road.crossings[0].waterSourceIds.every(id=>id.startsWith(`${c.id}/`)));
    const bound=snapshot.waterCharts.find(p=>p.id===c.id).centerIncisionUpperBoundM;
    assert.ok(bound<=5+1e-8); maxIncisionBoundM=Math.max(maxIncisionBoundM,bound);
    regions.push({contract,frames,trace,road});
    globalSamples.push(...frames.map(f=>world.sampleAt(f.latDeg,f.lonDeg)));
  }
  assert.equal(serializeGlobalTerrain(base),before);
  writeFileSync(snapshotPath,serializeGlobalTerrain(world)); writeFileSync(witnessPath,JSON.stringify({globalSamples,regions}));
  console.log(JSON.stringify({worldId:world.worldId,sourceWorldId:base.sourceWorldId,charts:charts.length,
    sourceCentersCompared,detailProbes:detailProbes.length,
    nonzeroGridLineProbes:detailProbes.filter(p=>!p.polar&&Math.abs(p.detailElevationM)>1e-6).length,
    nonzeroPolarProbes:detailProbes.filter(p=>p.polar&&Math.abs(p.detailElevationM)>1e-6).length,
    centerlineSamples,maxIncisionBoundM,persistedFrames:regions.reduce((s,r)=>s+r.frames.length,0),
    durationMs:performance.now()-started,maxRssMiB:process.resourceUsage().maxRSS/1024}));
}
