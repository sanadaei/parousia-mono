import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';
import {delineateGridCatchments,estimateCatchmentPeak,assessCatchmentCulverts} from '../src/core/catchment-flow.mjs';
import {inspectPlanetCatchments} from '../src/core/planet-catchments.mjs';
import {restorePlanetWorld} from '../src/core/planet-world.mjs';
import {runRunoffJob} from '../src/globe/runoff-job.mjs';
const storm={rainfallMmPerHour:60,durationSeconds:3600,runoffCoefficient:.6,travelSpeedMPerSecond:.2};
const design={diametersM:[.2,.4,.8,1.2],upstreamDepthM:.6,downstreamDepthM:.1,safetyFactor:1.2};
const pipe={id:'pipe',upstream:{xM:25,yM:25},hydraulics:{model:'circular-quasi-steady@1',diameterM:.4,lengthM:10,roughnessN:.015,entranceLoss:.5,exitLoss:1,inletInvertM:0,outletInvertM:-.1}};
const complete={status:'delineated-within-grid',reasons:[],areaM2:10000,longestPathM:100};
test('D8 contributing areas use the fixed sampled grid and disclose truncation',()=>{
 const ground=Array.from({length:25},(_,i)=>5-i%5),before=[...ground],r=delineateGridCatchments({columns:5,rows:5,cellSizeM:10,groundElevationM:ground,outlets:[{id:'east',xM:45,yM:25},{id:'outside',xM:50,yM:25}]});
 assert.deepEqual(ground,before);assert.equal(r.catchments[0].contributingCells,5);assert.equal(r.catchments[0].areaM2,500);
 assert.equal(r.catchments[0].status,'partial-catchment');assert.ok(r.catchments[0].reasons.includes('upstream-touches-window-edge'));assert.equal(r.catchments[1].status,'outside-grid');
 assert.equal(r.catchments[0].longestPathM,40+10*Math.SQRT2);
});
test('interior catchments and local sinks remain distinct from flat ambiguity',()=>{
 const ground=Array.from({length:81},(_,i)=>{const x=i%9-4,y=Math.floor(i/9)-4,r=Math.max(Math.abs(x),Math.abs(y));return (r<2?r:r===2?20:-r)+i*.0001;});
 const result=delineateGridCatchments({columns:9,rows:9,cellSizeM:10,groundElevationM:ground,outlets:[{id:'center',xM:45,yM:45}]}).catchments[0];
 assert.equal(result.status,'delineated-within-grid');assert.equal(result.outletIsLocalSink,true);assert.equal(result.contributingCells,9);
 const flat=delineateGridCatchments({columns:5,rows:5,cellSizeM:10,groundElevationM:Array(25).fill(0),outlets:[{id:'center',xM:25,yM:25}]}).catchments[0];assert.equal(flat.status,'partial-catchment');assert.ok(flat.reasons.includes('unresolved-flat-adjacent-to-upstream'));
});
test('Rational peak has correct units and gates incomplete area, short storm and large catchments',()=>{
 const r=estimateCatchmentPeak(complete,storm);assert.equal(r.status,'eligible-with-explicit-assumptions');assert.equal(r.estimatedPeakM3PerSecond,.1);assert.equal(r.concentrationSeconds,500);assert.equal(r.requiredDurationSeconds,600);
 assert.equal(estimateCatchmentPeak(complete,{...storm,durationSeconds:599}).status,'estimate-only');
 assert.equal(estimateCatchmentPeak({...complete,areaM2:800001},storm).status,'estimate-only');
 assert.equal(estimateCatchmentPeak({...complete,status:'partial-catchment',reasons:['edge']},storm).status,'estimate-only');
 for(const patch of[{runoffCoefficient:0},{runoffCoefficient:2},{travelSpeedMPerSecond:0},{rainfallMmPerHour:Infinity},{durationSeconds:0}])assert.throws(()=>estimateCatchmentPeak(complete,{...storm,...patch}));
});
test('only resolved sampled catchments reach existing pipe sizing; saved geometry is unchanged',()=>{
 const ground=Array.from({length:81},(_,i)=>{const r=Math.max(Math.abs(i%9-4),Math.abs(Math.floor(i/9)-4));return(r<2?r:r===2?20:-r)+i*.0001;});
 const p={...pipe,upstream:{xM:45,yM:45}},before=structuredClone(p),grid={columns:9,rows:9,cellSizeM:10,groundElevationM:ground};
 const result=assessCatchmentCulverts(grid,[p],storm,design);assert.ok(result.assessments[0].sizing.selectedDiameterM);assert.deepEqual(p,before);
 const partial=assessCatchmentCulverts({...grid,groundElevationM:Array(81).fill(0)},[p],storm,design);assert.equal(partial.assessments[0].sizing,null);
});
test('grid contracts reject unbounded work, invalid values and duplicate outlets',()=>{
 const grid={columns:2,rows:2,cellSizeM:1,groundElevationM:[0,1,2,3],outlets:[]};
 for(const patch of[{columns:100000},{cellSizeM:0},{groundElevationM:[0,1,2,NaN]},{outlets:[{id:'a',xM:0,yM:0},{id:'a',xM:1,yM:1}]}])assert.throws(()=>delineateGridCatchments({...grid,...patch}));
});
test('actual planet catchments use saved pre-construction ground through the same cancellable Worker job',()=>{
 const snapshot=fs.readFileSync(new URL('../examples/planet/generated/world.snapshot.json',import.meta.url),'utf8'),world=restorePlanetWorld(snapshot),options={cellSizeM:10,storm,design};
 const report=inspectPlanetCatchments(world,options),worker=runRunoffJob({type:'catchments',snapshot,expectedWorldId:world.worldId,options});
 assert.deepEqual(worker.assessment,report);assert.equal(report.sourceWorldId,world.worldId);assert.equal(report.delineation.grid.columns,70);assert.equal(report.assessments.length,world.recipes[0].drainageRouting.links.length);
 assert.ok(report.assessments.some(a=>!a.samplingCheck.agrees));for(const a of report.assessments)if(!a.samplingCheck.agrees){assert.equal(a.sizing,null);assert.equal(a.status,'sampling-not-converged');}
 assert.ok(report.assessments.length>0);for(const a of report.assessments)if(a.peak.status!=='eligible-with-explicit-assumptions')assert.equal(a.sizing,null);
 assert.throws(()=>runRunoffJob({type:'catchments',snapshot,expectedWorldId:'wrong',options}),/一致/);assert.throws(()=>inspectPlanetCatchments(world,{...options,cellSizeM:2}),/budget/);
 assert.throws(()=>inspectPlanetCatchments(world,{...options,design:{...design,diametersM:[]}}));
});

test('authored collector lines union upstream cells without counting a branch twice',()=>{
 const grid={columns:5,rows:5,cellSizeM:10,originXM:0,originYM:0,groundElevationM:Array.from({length:25},(_,i)=>5-i%5+Math.floor(i/5)*.0001)},
  line=[{xM:25,yM:15},{xM:25,yM:35}],outlet={id:'collector',xM:25,yM:25,capturePolyline:line},before=structuredClone(outlet),
  result=delineateGridCatchments({...grid,outlets:[outlet]});
 assert.equal(result.schema,'sampled-d8-catchments@2');assert.deepEqual(result.catchments[0].captureCellIndices,[7,12,17]);
 assert.equal(result.catchments[0].contributingCells,9);assert.equal(result.catchments[0].areaM2,900);assert.equal(result.catchments[0].status,'partial-catchment');assert.deepEqual(outlet,before);
 const duplicate=delineateGridCatchments({...grid,outlets:[{...outlet,capturePolyline:[...line,line[0]]}]}).catchments[0];assert.equal(duplicate.areaM2,900);
 assert.throws(()=>delineateGridCatchments({...grid,outlets:[{...outlet,xM:20}]}),/pass through/);
 assert.throws(()=>delineateGridCatchments({...grid,outlets:[{...outlet,capturePolyline:[line[0],line[0]]}]}),/positive/);
});
test('collector lines at cell edges conservatively capture both sides and retain boundary warnings',()=>{
 const grid={columns:5,rows:5,cellSizeM:10,groundElevationM:Array.from({length:25},(_,i)=>25-i*.13)},
  r=delineateGridCatchments({...grid,outlets:[{id:'edge',xM:20,yM:25,capturePolyline:[{xM:20,yM:-10},{xM:20,yM:35}]}]}).catchments[0];
 assert.ok(r.captureCellIndices.includes(11)&&r.captureCellIndices.includes(12));assert.ok(r.reasons.includes('upstream-touches-window-edge'));assert.equal(r.status,'partial-catchment');
});
test('actual world collector comparison keeps saved drainage immutable and reaches the Worker',()=>{
 const snapshot=fs.readFileSync(new URL('../examples/planet/generated/world.snapshot.json',import.meta.url),'utf8'),world=restorePlanetWorld(snapshot),before=JSON.stringify(world.recipes),options={cellSizeM:10,collectorWidthM:20,storm,design};
 const result=runRunoffJob({type:'catchments',snapshot,expectedWorldId:world.worldId,options}).assessment;
 assert.equal(result.collector.widthM,20);assert.equal(result.delineation.schema,'sampled-d8-catchments@2');
 assert.ok(result.assessments.every(a=>a.catchment.captureMethod==='authored-line-supercover@1'));assert.equal(JSON.stringify(world.recipes),before);
 for(const a of result.assessments)if(!a.samplingCheck.agrees)assert.equal(a.sizing,null);
 assert.throws(()=>inspectPlanetCatchments(world,{...options,collectorWidthM:201}),/width/);
});
