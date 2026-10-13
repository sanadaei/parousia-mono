import test from 'node:test';
import assert from 'node:assert/strict';
import { fitRiverWater, renderWaterPreview } from './fit-river-water.mjs';
function fixture(){
  const terrain={grid:{columns:3,rows:3,widthM:20,heightM:20,rowOrder:'south_to_north'},elevationM:[[1,2,3],[4,5,6],[7,8,9]],rivers:[
    {id:'main',parent:null,direction:'downstream_to_upstream',pointsM:[[10,0],[10,10],[10,20]]},
    {id:'tributary',parent:'main',direction:'downstream_to_upstream',pointsM:[[10,10],[0,20]]}
  ]};
  const candidate={grid:{columns:3,rows:3,cellSizeM:10,cellSizeYM:10,row0:'north',yDirection:'south'},elevation:terrain.elevationM.toReversed().flat(),rivers:terrain.rivers.map(r=>r.pointsM.map(([xM,y])=>({xM,yM:20-y})))};
  return {candidate,terrain,scenario:{kind:'synthetic-demonstration',name:'test only',runoffMmPerYear:400,externalInputs:[]}};
}
const run=f=>fitRiverWater(f.candidate,f.terrain,f.scenario);
test('mass, exact footprint, tree direction, joins, immutable inputs and preview',()=>{
  const f=fixture(),before=JSON.stringify(f),a=run(f);
  assert.equal(a.accounting.areaM2,400);assert.equal(a.accounting.assignedCellCount,4);
  assert.ok(Math.abs(a.accounting.residualM3PerSecond)<1e-12);
  assert.equal(a.confluences[0].childId,'tributary');assert.equal(a.confluences[0].parentId,'main');
  assert.ok(a.rivers[0].outletM3PerSecond>a.rivers[1].outletM3PerSecond);
  assert.deepEqual(a.preservation.before,a.preservation.after);assert.equal(JSON.stringify(f),before);
  assert.match(renderWaterPreview(f.candidate,a),/not a validated watershed/);
});
test('named external input travels downstream only and enters correct confluence segment',()=>{
  const f=fixture();f.scenario.runoffMmPerYear=0;f.scenario.externalInputs=[{name:'fictional spring',riverId:'tributary',m3PerSecond:2}];
  const a=run(f);assert.equal(a.accounting.outletM3PerSecond,2);assert.deepEqual(a.rivers[0].segmentFlowM3PerSecond,[2,0]);assert.equal(a.rivers[1].outletM3PerSecond,2);
});
test('zero supply yields zero flows and finite line weights',()=>{const f=fixture();f.scenario.runoffMmPerYear=0;const a=run(f);assert.equal(a.accounting.outletM3PerSecond,0);assert.ok(a.rivers.every(r=>r.segmentLineWeightPx.every(x=>x===0.6)));});
test('determinism and proportional runoff',()=>{const f=fixture(),a=run(f);assert.deepEqual(run(f),a);f.scenario.runoffMmPerYear*=2;assert.equal(run(f).accounting.outletM3PerSecond,2*a.accounting.outletM3PerSecond);});
for(const [name,mutate,pattern] of [
  ['cycle',f=>{f.terrain.rivers[0].parent='tributary';},/Cycle/],
  ['unknown parent',f=>{f.terrain.rivers[1].parent='missing';},/Unknown parent/],
  ['duplicate ID',f=>{f.terrain.rivers[1].id='main';},/duplicate/],
  ['direction',f=>{f.terrain.rivers[0].direction='upstream_to_downstream';},/orientation/],
  ['negative runoff',f=>{f.scenario.runoffMmPerYear=-1;},/nonnegative/],
  ['nonfinite runoff',f=>{f.scenario.runoffMmPerYear=Infinity;},/nonnegative/],
  ['negative external',f=>{f.scenario.externalInputs=[{name:'x',riverId:'main',m3PerSecond:-1}];},/nonnegative/],
  ['unknown external',f=>{f.scenario.externalInputs=[{name:'x',riverId:'other',m3PerSecond:1}];},/Unknown external/],
  ['duplicate input name',f=>{f.scenario.externalInputs=Array(2).fill({name:'x',riverId:'main',m3PerSecond:1});},/unique name/],
  ['changed candidate height',f=>{f.candidate.elevation[0]+=1;},/height mismatch/],
  ['changed geometry',f=>{f.candidate.rivers[0][0].xM+=1;},/river mismatch/],
  ['disconnected join',f=>{f.terrain.rivers[1].pointsM[0][0]+=1;f.candidate.rivers[1][0].xM+=1;},/Disconnected/],
  ['unlabelled scenario',f=>{delete f.scenario.kind;},/synthetic-demonstration/],
])test(`reject ${name}`,()=>{const f=fixture();mutate(f);assert.throws(()=>run(f),pattern);});
