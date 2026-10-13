import test from 'node:test';
import assert from 'node:assert/strict';
import { evolveRelief } from '../scripts/experiments/mst-relief.mjs';
import { reliefTerrain } from '../scripts/experiments/relief-terrain.mjs';
import { reliefTile } from '../scripts/experiments/relief-tiles.mjs';
import { restoreTerrain } from '../src/core/index.mjs';
const parent=()=>reliefTerrain(evolveRelief({n:17,extentM:1600,steps:3,initial:Array.from({length:289},(_,i)=>50+30*Math.sin(i*.17))}),{seed:'tile-identity'});
function near(a,b){assert.ok(Math.abs(a-b)<1e-8,`${a} != ${b}`);}

test('adjacent relief crops retain parent heights and derivatives across their active seam',()=>{
 const p=parent(),left=reliefTile(p,{cellX:0,cellY:0,cellWidth:8,cellHeight:16}),right=reliefTile(p,{cellX:8,cellY:0,cellWidth:8,cellHeight:16});
 for(let y=0;y<=1600;y+=25)for(const dx of[-.01,0,.01]){
  const x=800+dx,z=p.sampleAt(x,y),a=left.terrain.sampleAt(x,y),b=right.terrain.sampleAt(x,y);
  near(a.groundElevationM,z.groundElevationM);near(b.groundElevationM,z.groundElevationM);
  near(a.slopeMPerM,z.slopeMPerM);near(b.slopeMPerM,z.slopeMPerM);
 }
 assert.equal(left.activeBounds.maxXM,right.activeBounds.minXM);
});

test('shared four-tile corner is stable under reverse requests and serialization',()=>{
 const p=parent(),input=[{cellX:0,cellY:0},{cellX:8,cellY:0},{cellX:0,cellY:8},{cellX:8,cellY:8}].map(q=>({...q,cellWidth:8,cellHeight:8}));
 const expected=new Map(input.map(q=>[`${q.cellX}/${q.cellY}`,reliefTile(p,q).terrain.worldId]));
 for(const q of input.reverse()){
  const a=reliefTile(p,q),b=restoreTerrain(JSON.stringify(a.terrain.toSnapshot()));
  assert.equal(a.terrain.worldId,expected.get(`${q.cellX}/${q.cellY}`));assert.equal(a.parentWorldId,p.worldId);
  for(const [x,y]of[[800,800],[799.5,800.5],[800.5,799.5]])near(b.groundElevationAt(x,y),p.groundElevationAt(x,y));
 }
});

test('relief tile crop retains source samples and rejects out-of-bounds or fractional requests',()=>{
 const p=parent(),s=JSON.stringify(p.toSnapshot()),t=reliefTile(p,{cellX:3,cellY:4,cellWidth:5,cellHeight:6});
 assert.equal(t.terrain.toSnapshot().grid.columns,10);assert.equal(t.terrain.toSnapshot().grid.rows,11);
 assert.equal(JSON.stringify(p.toSnapshot()),s);
 for(const q of[{cellX:-1},{cellX:16},{cellWidth:0},{cellWidth:17},{cellX:.5}])assert.throws(()=>reliefTile(p,{cellX:0,cellY:0,cellWidth:8,cellHeight:8,...q}));
});
