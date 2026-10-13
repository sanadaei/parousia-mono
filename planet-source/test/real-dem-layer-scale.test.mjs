import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createHash} from 'node:crypto';
import {solveRegionalDrainage} from '../scripts/experiments/real-dem-layer-gap/src/core/regional-drainage.mjs';
import {createRegionalWaterContext} from '../scripts/experiments/real-dem-layer-gap/src/core/regional-water-context.mjs';
import {refineWaterCandidate} from '../scripts/experiments/real-dem-layer-gap/src/candidate/refine-water-candidates.mjs';
const root=new URL('../scripts/experiments/real-dem-layer-gap/',import.meta.url),input=JSON.parse(fs.readFileSync(new URL('data/inputs.json',root)));
function supply(g){const w=g.columns;return Array.from({length:w*w},(_,i)=>.1*g.cellSizeM*g.cellSizeYM*(i%w===0||i%w===w-1?.5:1)*(i<w||i>=w*(w-1)?.5:1));}
function exits(g,z){const w=g.columns;return z.flatMap((levelM,i)=>i<w||i>=w*(w-1)||i%w===0||i%w===w-1?[{id:`edge:${i}`,cell:i,kind:'open-boundary',levelM}]:[]);}
test('real DEM benchmark keeps source identity and fixed native-resolution crops',()=>{
 assert.equal(createHash('sha256').update(fs.readFileSync(new URL('data/tuscany.csv',root))).digest('hex'),input.rawSha256);
 assert.deepEqual(input.crops.map(c=>[c.name,c.x0,c.y0]),[['NW',0,0],['NE',56,0],['SW',0,56],['SE',56,56],['C',28,28]]);
 for(const c of input.crops){assert.equal(c.elevation.length,4225);for(let y=0;y<65;y++)for(let x=0;x<65;x++)assert.equal(c.elevation[y*65+x],input.full.elevation[(y+c.y0)*121+x+c.x0]);assert.equal(c.grid.cellSizeM,input.full.grid.cellSizeM);assert.equal(c.grid.cellSizeYM,input.full.grid.cellSizeYM);}
});
test('native fine terrain exposes sparse inherited boundary obstruction; only provisional exits remove it',()=>{
 const crop=input.crops.find(c=>c.name==='SW'),factor=8,w=9,g={columns:w,rows:w,cellSizeM:crop.grid.cellSizeM*factor,cellSizeYM:crop.grid.cellSizeYM*factor},z=Array.from({length:w*w},(_,i)=>crop.elevation[Math.floor(i/w)*factor*65+i%w*factor]);
 const parent=createRegionalWaterContext({grid:g,elevation:z,drainage:solveRegionalDrainage({...g,elevation:z,localSupplyM3PerYear:supply(g),outlets:exits(g,z)})});
 const hard=refineWaterCandidate(parent,{factor,elevation:crop.elevation,method:'terrain-joint'});
 assert.throws(()=>refineWaterCandidate(parent,{factor,elevation:crop.elevation,method:'provisional-boundary'}),/provisional/);
 const refined=refineWaterCandidate(parent,{factor,elevation:crop.elevation,method:'provisional-boundary',boundaryState:'provisional'});
 const fine=solveRegionalDrainage({...crop.grid,elevation:crop.elevation,localSupplyM3PerYear:supply(crop.grid),outlets:exits(crop.grid,crop.elevation)});
 assert.deepEqual(refined.drainage.receiver,fine.receiver);assert.deepEqual(refined.drainage.routingFillM,fine.routingFillM);
 const interior=Array.from({length:4225},(_,i)=>i).filter(i=>i%65>=4&&i%65<61&&Math.floor(i/65)>=4&&Math.floor(i/65)<61);
 assert(Math.max(...interior.map(i=>hard.drainage.routingFillM[i]-fine.routingFillM[i]))>100);
 assert.equal(refined.context,null);assert.equal(refined.reconciliation.status,'pending');assert(refined.reconciliation.totalRedistributedAnnualM3>0);assert.equal(refined.drainage.outlets.length,256);
});
