import test from 'node:test';import assert from 'node:assert/strict';
import {createPlanetLandscapeSketch,inspectSketchSupport} from '../src/core/planet-landscape-sketch.mjs';
const snapshot={worldId:'fixture',grid:{columns:4,rows:2},frame:{radiusM:6371000},fields:{groundElevationM:[-1,-1,-1,-1,10,12,15,16],landMask:[0,0,0,0,1,1,1,1],downstream:[-1,-1,-1,-1,0,4,5,6]},references:{sea:{levelElevationM:0},lakes:[],rivers:{profiles:[]}}};
const climate={sourceWorldId:'fixture',id:'climate',cellAreaM2:Array(8).fill(10),catchmentWater:{meanPotentialFlowM3PerSecond:[0,0,0,0,4,3,2,1]}};
test('full water sketch survives missing detailed river profiles',()=>{
 const a=createPlanetLandscapeSketch(snapshot,climate);assert.equal(a.edges.length,4);assert.equal(a.diagnostics.linksWithDetailedProfile,0);assert.ok(a.nodes.every(n=>n.destination==='sea-cell:0'));assert.deepEqual(a,createPlanetLandscapeSketch(snapshot,climate));
});
test('sketch does not turn coarse connectivity into a ready local terrain',()=>{
 const a=createPlanetLandscapeSketch(snapshot,climate),r=inspectSketchSupport(a,snapshot,{cell:5,localWidthM:2000,localHeightM:3000});assert.equal(r.readyForIndependentLocalCommit,false);assert.equal(r.incoming.length,1);assert.equal(r.outgoing.length,1);assert.ok(r.parentToLocalWidthRatio>1);
});
test('sketch rejects cycles, distant receivers, invalid areas and mismatched parents',()=>{
 const s=structuredClone(snapshot);s.fields.downstream[4]=5;assert.throws(()=>createPlanetLandscapeSketch(s,climate),/Cyclic/);
 s.fields.downstream[4]=2;assert.throws(()=>createPlanetLandscapeSketch(s,climate),/adjacent/);
 const c=structuredClone(climate);c.cellAreaM2[0]=NaN;assert.throws(()=>createPlanetLandscapeSketch(snapshot,c));
 c.cellAreaM2[0]=10;c.sourceWorldId='other';assert.throws(()=>createPlanetLandscapeSketch(snapshot,c));
});
test('terminal destination and uphill warning stay explicit without modifying source',()=>{
 const s=structuredClone(snapshot);s.fields.downstream[4]=-1;s.references.lakes=[{id:'lake:4',cells:[4]}];s.fields.groundElevationM[4]=14;
 const before=JSON.stringify(s),a=createPlanetLandscapeSketch(s,climate);assert.ok(a.nodes.every(n=>n.destination==='lake:4'));assert.equal(a.diagnostics.uphillCoarseLinks,1);assert.equal(JSON.stringify(s),before);
});
