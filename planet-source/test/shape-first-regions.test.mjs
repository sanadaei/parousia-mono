import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createShapeFirstRegions} from '../src/core/shape-first-regions.mjs';
import {fitRiverWater} from '../scripts/experiments/shape-first/fit-river-water.mjs';
const read=async path=>JSON.parse(await readFile(new URL(path,import.meta.url),'utf8'));
const candidate=await read('../fixtures/shape-first/river-first-candidate.json');
const terrain=await read('../fixtures/shape-first/river-first-terrain.json');
const scenario=await read('../scripts/experiments/shape-first/synthetic-water-scenario.json');
const annotation=fitRiverWater(candidate,terrain,scenario);
const options={riverIds:terrain.rivers.map(r=>r.id),waterAnnotation:annotation,pointOrder:'downstream_to_upstream'};
test('A partitions into native same-scale neighbors with exact 2× levels and common elevations',()=>{
  const before=JSON.stringify(candidate),world=createShapeFirstRegions(candidate,options);
  assert.equal(world.tiles.length,2);assert.equal(world.seams.length,1);
  const [a,b]=world.tiles;
  for(let i=0;i<a.levels.length;i++){
    const left=a.levels[i],right=b.levels[i];
    assert.equal(left.grid.cellSizeM,candidate.grid.cellSizeM*left.sourceStride);
    for(let row=0;row<left.grid.rows;row++)assert.equal(left.elevation[row*left.grid.columns+left.grid.columns-1],right.elevation[row*right.grid.columns]);
    if(i)assert.equal(left.grid.columns-1,2*(a.levels[i-1].grid.columns-1));
  }
  assert.equal(world.seams[0].points.length,129);
  assert.equal(world.seams[0].maxElevationDifferenceM,0);
  assert.equal(JSON.stringify(candidate),before);
});
test('crossing ports share exact identity, coordinates and provisional flow without adding supply',()=>{
 const world=createShapeFirstRegions(candidate,options),[a,b]=world.tiles;
 assert.ok(world.seams[0].ports.length>0);
 for(const port of world.seams[0].ports){
   const pa=a.ports.find(p=>p.id===port.id),pb=b.ports.find(p=>p.id===port.id);
   assert.deepEqual(pa.point,pb.point);assert.equal(pa.flowM3PerSecond,pb.flowM3PerSecond);
   assert.notEqual(pa.role,pb.role);assert.notEqual(pa.role,'undirected');
   assert.equal(port.flowM3PerSecond,annotation.rivers.find(r=>r.id===port.riverId).segmentFlowM3PerSecond[port.sourceSegmentIndex]);
   for(const tile of [a,b])assert.ok(tile.rivers.some(r=>r.riverId===port.riverId&&r.points.some(p=>p.xM===port.point.xM&&p.yM===port.point.yM)));
 }
 assert.deepEqual(JSON.parse(JSON.stringify(world)),world);
 assert.deepEqual(createShapeFirstRegions(JSON.parse(JSON.stringify(candidate)),JSON.parse(JSON.stringify(options))),world);
});
test('every tile elevation is an original node, no invented terrain beyond source',()=>{
 const world=createShapeFirstRegions(candidate,{tileColumns:2,tileRows:2,levelCount:5});
 for(const tile of world.tiles)for(const level of tile.levels)for(let i=0;i<level.elevation.length;i++){
  const row=tile.sourceWindow.row+Math.floor(i/level.grid.columns)*level.sourceStride,col=tile.sourceWindow.column+i%level.grid.columns*level.sourceStride;
  assert.equal(level.elevation[i],candidate.elevation[row*candidate.grid.columns+col]);
 }
 assert.equal(world.seams.length,4);
});
const tiny=rivers=>({schema:'shape-first-candidate@1',grid:{columns:5,rows:5,cellSizeM:1,cellSizeYM:1,row0:'north',yDirection:'south'},elevation:Array.from({length:25},(_,i)=>i),rivers});
test('crossing at an existing vertex produces one port; tangency and collinear runs produce no transfers',()=>{
 const world=createShapeFirstRegions(tiny([
  [{xM:1,yM:1},{xM:2,yM:2},{xM:3,yM:3}],
  [{xM:1,yM:1},{xM:2,yM:2},{xM:1,yM:3}],
  [{xM:2,yM:1},{xM:2,yM:3}],
 ]),{levelCount:2});
 assert.equal(world.seams[0].ports.length,1);assert.deepEqual(world.seams[0].ports[0].point,{xM:2,yM:2});
 assert.equal(world.seams[0].ports[0].flowM3PerSecond,null);
});
test('multiple exit and reentry produces separate river fragments and matching ports',()=>{
 const world=createShapeFirstRegions(tiny([[{xM:1,yM:0},{xM:3,yM:1},{xM:1,yM:2},{xM:3,yM:3},{xM:1,yM:4}]]),{levelCount:2});
 assert.equal(world.seams[0].ports.length,4);assert.equal(world.tiles[0].rivers.length,3);assert.equal(world.tiles[1].rivers.length,2);
 for(const tile of world.tiles)for(const river of tile.rivers)assert.equal(river.points.length,river.segments.length+1);
});
test('invalid partitions, oversized coordinates and mismatched water are rejected',()=>{
 assert.throws(()=>createShapeFirstRegions(candidate,{tileColumns:3}),/divide/);
 assert.throws(()=>createShapeFirstRegions(candidate,{levelCount:6}),/divide/);
 assert.throws(()=>createShapeFirstRegions(tiny([[{xM:1,yM:0},{xM:6,yM:1}]]),{levelCount:2}),/outside/);
 assert.throws(()=>createShapeFirstRegions(candidate,{waterAnnotation:annotation}),/mismatch/);
});
test('diagonal corner crossing is one transfer between occupied tiles only',()=>{
 const world=createShapeFirstRegions(tiny([[{xM:1,yM:1},{xM:3,yM:3}]]),{tileColumns:2,tileRows:2,levelCount:2,pointOrder:'upstream_to_downstream'});
 assert.equal(world.seams.flatMap(s=>s.ports).length,0);
 assert.equal(world.cornerTransfers.length,1);
 assert.equal(world.cornerTransfers[0].fromTile,'tile-0-0');assert.equal(world.cornerTransfers[0].toTile,'tile-1-1');
 assert.equal(world.tiles[1].ports.length,0);assert.equal(world.tiles[2].ports.length,0);
 assert.equal(world.tiles[0].ports.length,1);assert.equal(world.tiles[3].ports.length,1);
});
test('water annotations reject same-length but changed river or height sources',()=>{
 const modified=structuredClone(candidate);modified.rivers[0][5].xM-=1;
 assert.throws(()=>createShapeFirstRegions(modified,options),/hash mismatch/);
 const height=structuredClone(candidate);height.elevation[0]+=1;
 assert.throws(()=>createShapeFirstRegions(height,options),/hash mismatch/);
});
test('water annotation binds ID ordering and physical footprint, not just array values',()=>{
 const ids=options.riverIds.toReversed();
 assert.throws(()=>createShapeFirstRegions(candidate,{...options,riverIds:ids}),/ordering mismatch/);
 const scaled=structuredClone(candidate);scaled.grid.cellSizeM*=2;
 assert.throws(()=>createShapeFirstRegions(scaled,options),/footprint mismatch/);
});
test('diagonal crossing at a source vertex has one corner identity',()=>{
 const world=createShapeFirstRegions(tiny([[{xM:1,yM:1},{xM:2,yM:2},{xM:3,yM:3}]]),{tileColumns:2,tileRows:2,levelCount:2,pointOrder:'downstream_to_upstream'});
 assert.equal(world.cornerTransfers.length,1);assert.equal(world.cornerTransfers[0].fromTile,'tile-1-1');assert.equal(world.cornerTransfers[0].toTile,'tile-0-0');
 assert.equal(world.seams.flatMap(s=>s.ports).length,0);
});
