import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createSeededRiverDesign, generateSeededRiverRegion, sampleSeededRiverElevation } from '../src/core/seeded-river-region.mjs';
import { buildShapeFirstPyramid } from '../scripts/experiments/shape-first/region-pyramid.mjs';
const hash=x=>createHash('sha256').update(JSON.stringify(x)).digest('hex');
const seeds=[271828,314159,161803];
test('seeded candidates repeat exactly, differ across seeds, and import to existing pyramid',()=>{
  const signatures=[];
  for(const seed of seeds){const options={seed,columns:81,rows:65};const a=generateSeededRiverRegion(options),b=generateSeededRiverRegion(options);assert.deepEqual(a,b);signatures.push(hash(a.rivers));assert.ok(a.rivers.length>=12);const p=buildShapeFirstPyramid(JSON.stringify(a),{levelCount:5});assert.equal(p.levels.length,5);assert.equal(p.extent.widthM,a.extent.widthM);assert.ok(a.elevation.every(Number.isFinite));}
  assert.equal(new Set(signatures).size,3);
});
test('all designed rivers meet exact parent vertices and have continuous increasing bed elevations',()=>{
  for(const seed of seeds){const d=createSeededRiverDesign({seed});for(const p of d.paths){assert.ok(p.points.length>2);for(let i=1;i<p.bed.length;i++)assert.ok(p.bed[i]>p.bed[i-1]);if(p.parentId){const parent=d.paths.find(q=>q.id===p.parentId),j=parent.points.findIndex(q=>q.xM===p.points[0].xM&&q.yM===p.points[0].yM);assert.ok(j>=0);assert.equal(p.bed[0],parent.bed[j]);}for(const q of p.points){assert.ok(q.xM>=0&&q.xM<=d.extent.widthM);assert.ok(q.yM>=0&&q.yM<=d.extent.heightM);}}}
});
test('native physical geometry and shared-node elevations do not change with raster resolution',()=>{
  const a=generateSeededRiverRegion({seed:'resolution',columns:41,rows:33}),b=generateSeededRiverRegion({seed:'resolution',columns:81,rows:65});assert.deepEqual(a.rivers,b.rivers);assert.deepEqual(a.extent,b.extent);for(let y=0;y<33;y++)for(let x=0;x<41;x++)assert.equal(a.elevation[y*41+x],b.elevation[y*2*81+x*2]);
});
test('explicit physical extents and all outlet side hints are honored',()=>{
  for(const side of ['north','east','south','west']){const d=createSeededRiverDesign({seed:7,widthM:12000,heightM:6000,hints:{outlet:{side,position:.4}}});const p=d.paths[0].points[0];assert.equal(side==='north'||side==='south'?p.yM:p.xM,{north:0,south:6000,west:0,east:12000}[side]);assert.equal(side==='north'||side==='south'?p.xM:p.yM,.4*(side==='north'||side==='south'?12000:6000));assert.ok(Number.isFinite(sampleSeededRiverElevation(d,6000,3000))); }
});
test('invalid source configuration is rejected',()=>{
  for(const options of [{widthM:-1},{heightM:Infinity},{columns:1},{rows:NaN},{seed:NaN},{seed:{}},{hints:{outlet:{side:'up'}}},{hints:{outlet:{position:2}}}])assert.throws(()=>generateSeededRiverRegion(options));
});
test('relief and valley width are explicit coherent design controls, not geometry rescaling',()=>{
  const normal=generateSeededRiverRegion({seed:314159,columns:41,rows:33});
  const low=generateSeededRiverRegion({seed:314159,columns:41,rows:33,reliefScale:.5});
  const wide=generateSeededRiverRegion({seed:314159,columns:41,rows:33,valleyWidthScale:1.7});
  assert.deepEqual(normal.rivers,low.rivers);assert.deepEqual(normal.rivers,wide.rivers);
  const relief=c=>Math.max(...c.elevation)-Math.min(...c.elevation);
  assert.ok(Math.abs(relief(low)/relief(normal)-.5)<.001);
  assert.ok(wide.elevation.some((z,i)=>z<normal.elevation[i]-.1));
  assert.throws(()=>generateSeededRiverRegion({reliefScale:0}));
});
test('reviewed seed trees have no unintended strict river-segment crossings',()=>{
  const orientation=(a,b,c)=>(b.xM-a.xM)*(c.yM-a.yM)-(b.yM-a.yM)*(c.xM-a.xM);
  for(const seed of seeds){const {paths}=createSeededRiverDesign({seed});for(let p=0;p<paths.length;p++)for(let q=p+1;q<paths.length;q++)for(let i=1;i<paths[p].points.length;i++)for(let j=1;j<paths[q].points.length;j++){
    const [a,b,c,d]=[paths[p].points[i-1],paths[p].points[i],paths[q].points[j-1],paths[q].points[j]];
    assert.ok(!(orientation(a,b,c)*orientation(a,b,d)<0&&orientation(c,d,a)*orientation(c,d,b)<0),`${seed}: crossing ${p}/${q}`);
  }}
});
