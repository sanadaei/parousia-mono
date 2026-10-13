import test from 'node:test';
import assert from 'node:assert/strict';
import {generateSeededRiverRegion} from '../src/core/seeded-river-region.mjs';
import {createShapeFirstRegions} from '../src/core/shape-first-regions.mjs';
for(const [seed,widthM,heightM,side] of [[271828,8847.575822166944,9772.99159961942,'south'],['another-region',12000,8000,'east'],[42,8000,16000,'west']]){
 test(`seeded shape ${seed}: adjacent tiles use source shape and connected rivers`,()=>{
  const candidate=generateSeededRiverRegion({seed,widthM,heightM,columns:81,rows:65,hints:{outlet:{side,position:.4}}});
  const options={tileColumns:2,tileRows:2,levelCount:4,riverIds:candidate.riverDesign.rivers.map(r=>r.id),pointOrder:candidate.riverDesign.pointOrder};
  const world=createShapeFirstRegions(candidate,options);
  assert.equal(world.tiles.length,4);assert.equal(world.domain.extent.widthM,widthM);assert.equal(world.domain.extent.heightM,heightM);
  const ports=[...world.seams.flatMap(s=>s.ports),...world.cornerTransfers];assert.ok(ports.length>0);
  for(const port of ports){
   const pair=world.tiles.flatMap(t=>t.ports.filter(p=>p.id===port.id).map(p=>({tile:t.id,port:p})));
   assert.equal(pair.length,2);assert.notEqual(pair[0].port.role,pair[1].port.role);assert.deepEqual(pair[0].port.point,pair[1].port.point);assert.equal(port.flowM3PerSecond,null);
   for(const {tile:id} of pair){const tile=world.tiles.find(t=>t.id===id);assert.ok(tile.rivers.some(r=>r.riverId===port.riverId&&r.points.some(p=>p.xM===port.point.xM&&p.yM===port.point.yM)));}
  }
  for(const seam of world.seams)for(const point of seam.points){const column=Math.round(point.xM/candidate.grid.cellSizeM),row=Math.round(point.yM/candidate.grid.cellSizeYM);assert.equal(point.elevationM,candidate.elevation[row*candidate.grid.columns+column]);}
  assert.deepEqual(createShapeFirstRegions(JSON.parse(JSON.stringify(candidate)),options),world);
 });
}
