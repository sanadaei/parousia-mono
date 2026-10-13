import test from 'node:test';
import assert from 'node:assert/strict';
import { evolveRelief } from '../scripts/experiments/mst-relief.mjs';
import { reliefTerrain } from '../scripts/experiments/relief-terrain.mjs';
import { restoreTerrain, serializeTerrain } from '../src/core/index.mjs';
import { restoreMetricTerrain } from '../src/ui/scene.mjs';
const result=()=>evolveRelief({n:9,initial:Array.from({length:81},(_,i)=>10+3*Math.sin(i)),extentM:800,steps:3});

test('research relief uses existing canonical terrain and viewer restoration without inventing water',()=>{
 const r=result(),t=reliefTerrain(r,{seed:'research-test'}),saved=t.toSnapshot();
 assert.equal(saved.schema,'minimal-world-continuous-terrain@3');
 assert.equal(saved.fields.waterLevelElevationM,null);
 assert.equal(saved.hydrology,null);
 const restored=restoreMetricTerrain(saved).terrain;
 for(let y=0;y<9;y++)for(let x=0;x<9;x++)assert.equal(restored.sampleAt(x*100,y*100).groundElevationM,r.heights[y*9+x]);
});

test('canonical relief identity and samples survive serialization, display order and different sampling spacing',()=>{
 const t=reliefTerrain(result(),{seed:'research-test'}),s=serializeTerrain(t),r=restoreTerrain(s);
 const before=t.sampleAt(350,450);
 t.sampleWindow({minXM:0,minYM:0,maxXM:800,maxYM:800,spacingM:200});
 t.sampleWindow({minXM:200,minYM:200,maxXM:600,maxYM:600,spacingM:25});
 assert.deepEqual(t.sampleAt(350,450),before);assert.deepEqual(r.sampleAt(350,450),before);
 assert.equal(serializeTerrain(t),s);assert.equal(reliefTerrain(result(),{seed:'research-test'}).worldId,t.worldId);
});

test('research relief adapter rejects corrupt sizes and does not alias input heights',()=>{
 const r=result(),t=reliefTerrain(r,{seed:'research-test'}),z=t.sampleAt(0,0).groundElevationM;
 r.heights[0]+=100;assert.equal(t.sampleAt(0,0).groundElevationM,z);
 assert.throws(()=>reliefTerrain({...r,heights:[0]},{seed:'research-test'}));
 assert.throws(()=>reliefTerrain({...r,report:{...r.report,n:1000}},{seed:'research-test'}));
});

test('explicit retained outlets survive canonical provenance with order-independent identity',()=>{
 const options={n:9,initial:Array.from({length:81},(_,i)=>Math.sin(i)),extentM:800,steps:2};
 const a=reliefTerrain(evolveRelief({...options,outlets:[4,76,4]}),{seed:'explicit-outlets'});
 const b=reliefTerrain(evolveRelief({...options,outlets:[76,4]}),{seed:'explicit-outlets'});
 assert.equal(a.worldId,b.worldId);assert.deepEqual(a.toSnapshot().references.reliefResearch.parameters.outlets,[4,76]);
});
