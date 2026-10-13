import test from 'node:test';
import assert from 'node:assert/strict';
import {createExperiment,auditExperiment,smoothReconstruction} from './drainage-led-relief.mjs';
import {solveSteady,correctDiscontinuities} from './steady-stream-power.mjs';
import {extractParent} from './planet-parent-relief.mjs';

test('fixed-coordinate graph is reproducible, acyclic and downstream-connected',()=>{
 const a=createExperiment(),b=createExperiment();assert.deepEqual(a.segments,b.segments);
 const known=new Set();for(const s of a.segments){assert.ok(s.parentId===null||known.has(s.parentId));assert.ok(s.b.z>=s.a.z);known.add(s.id);}
 const r=auditExperiment(a).report;assert.equal(r.crossings,0);assert.equal(r.uphillSurfaceSteps,0);assert.ok(r.maximumBedErrorM<1e-8);assert.equal(r.sharedDifferenceM,0);
});
test('smoothed reconstruction preserves sampled branch beds and cache-independent queries',()=>{
 const m=createExperiment({seed:'research-2',levels:2}),s=smoothReconstruction(m),probes=[];
 for(const b of m.segments)for(let k=0;k<=8;k++){const t=k/8,x=b.a.x+(b.b.x-b.a.x)*t,y=b.a.y+(b.b.y-b.a.y)*t,z=b.a.z+(b.b.z-b.a.z)*t;assert.ok(Math.abs(s.sample(x,y)-z)<1e-8);probes.push({x,y,z:s.sample(x,y)});}
 s.cache.clear();for(const p of probes.reverse())assert.equal(s.sample(p.x,p.y),p.z);
 assert.throws(()=>s.sample(-1,20));assert.throws(()=>smoothReconstruction(m,{spacingM:0}));
});
test('arbitrary supplied parent parameters survive independent reconstruction audit',()=>{
 const m=createExperiment({seed:'small',extentM:4096,levels:1,parent:[{x:2000,y:0,z:25},{x:2000,y:4096,z:40}]});
 assert.equal(auditExperiment(m,{resolution:33}).report.sharedDifferenceM,0);
 assert.throws(()=>createExperiment({parent:[{x:0,y:0,z:2},{x:0,y:1,z:1}]}));
});
const initial=Float64Array.from({length:17*17},(_,i)=>100+Math.sin(i%17/16*Math.PI)*Math.sin(Math.floor(i/17)/16*Math.PI)*150);
test('steady-state comparison preserves boundary values and repeatability',()=>{
 const options={initial,resolutions:[9,17],iterations:3},a=solveSteady(options),b=solveSteady(options);
 assert.deepEqual(a.heights,b.heights);assert.equal(a.report.edgeErrorM,0);assert.ok(a.heights.every(Number.isFinite));assert.throws(()=>solveSteady({...options,iterations:100000}));
});
test('fixed-network correction retains nonnegative drops and the best measured objective',()=>{
 const raw=solveSteady({initial,resolutions:[9,17],iterations:3}),r=correctDiscontinuities(raw,{iterations:20});
 assert.ok(r.report.correction.bestLoss<=r.report.correction.initialLoss);
 for(let i=0;i<r.heights.length;i++){const p=r.parent[i];if(p<0)assert.ok(Math.abs(r.heights[i]-raw.heights[i])<1e-9);else assert.ok(r.heights[i]>=r.heights[p]-1e-9);}
 assert.equal(r.report.converged,false);
});
test('missing actual river input has no synthetic fallback',()=>{
 assert.throws(()=>extractParent({references:{rivers:{profiles:[]}}}),/No suitable/);
});

import {fitConstrainedValleys,auditConstrained} from './constrained-valley-relief.mjs';
const valleyGraph={segments:[
 {id:'p',parentId:null,level:0,a:{x:1024,y:0,z:100,protectWidthM:100},b:{x:1024,y:2048,z:100,protectWidthM:100}},
 {id:'v',parentId:'p',level:1,a:{x:1024,y:1024,z:100},b:{x:1700,y:1024,z:170}}
]};
const valleyOptions={graph:valleyGraph,extentM:2048,guardM:256,maxWidthM:128};
const bankGround=(x,y)=>{const d=Math.abs(x-1024);return 100+.1*d+10*Math.sin(Math.PI*Math.min(1,Math.max(0,(d-104)/572)));};
test('constrained valley keeps boundary and entire existing river corridor unchanged',()=>{
 const model=fitConstrainedValleys({...valleyOptions,groundAt:bankGround});
 assert.equal(model.curves.length,1,JSON.stringify(model.rejected));
 const audit=auditConstrained(model,valleyGraph,{resolution:65}).report;
 assert.ok(audit.maximumCutM>1);assert.equal(audit.edgeChangeM,0);assert.equal(audit.corridorChangeM,0);assert.equal(audit.parentChangeM,0);
 assert.equal(audit.uphillSteps,0);assert.equal(audit.connectorUphillSteps,0);assert.ok(audit.maximumFillM<=.1+1e-9);
 for(let y=0;y<=2048;y+=37)for(let x=920;x<=1128;x+=13)assert.equal(model.sample(x,y),bankGround(x,y));
 const before=model.sample(1427,1041);model.cache.clear();assert.equal(model.sample(1427,1041),before);
});
test('zero accepted valleys is recorded as a no-op, not a successful landscape',()=>{
 const model=fitConstrainedValleys({...valleyOptions,groundAt:(x,y)=>200-Math.abs(x-1024)*.1});
 assert.equal(model.curves.length,0);assert.ok(model.rejected.some(r=>r.reason==='no-upstream-relief'));assert.equal(model.sample(1600,1024),model.original(1600,1024));
});
test('unknown terrain cannot be converted into a plausible-looking valley',()=>{
 assert.throws(()=>fitConstrainedValleys({...valleyOptions,groundAt:()=>NaN}),/Unknown original terrain/);
});
test('a protected river bank cannot silently disconnect an otherwise fitted valley',()=>{
 const model=fitConstrainedValleys({...valleyOptions,groundAt:(x,y)=>bankGround(x,y)+(Math.abs(x-1024)<100?8*Math.sin(Math.abs(x-1024)/15):0)});
 assert.equal(model.curves.length,0);assert.ok(model.rejected.some(r=>r.reason==='existing-bank-connector-uphill'),JSON.stringify(model.rejected));
});

import {searchTerrainCostCorridor,fitResearchRiverPath} from './terrain-cost-routing.mjs';
const routeStart={latDeg:0,lonDeg:0,waterLevelElevationM:100},routeEnd={latDeg:0,lonDeg:.1,waterLevelElevationM:90};
const routeSurface=(lat,lon)=>({groundElevationM:101-100*lon+20*Math.exp(-(((lon-.05)/.012)**2)-(lat/.005)**2),waterDepthM:0,waterLevelElevationM:null});
test('terrain-aware corridor goes around an expensive hill without moving shared endpoints',()=>{
 const args={radiusM:6371000,sampleSurface:routeSurface,stepM:500,halfWidthM:1500},a=searchTerrainCostCorridor(routeStart,routeEnd,args),b=searchTerrainCostCorridor(routeStart,routeEnd,args);
 assert.ok(a.path);assert.deepEqual(a,b);assert.equal(a.path[0].latDeg,routeStart.latDeg);assert.equal(a.path.at(-1).lonDeg,routeEnd.lonDeg);assert.ok(a.path.some(p=>Math.abs(p.latDeg)>.003));
 const options={sampleSurface:routeSurface,radiusM:6371000,startLevelM:100,endLevelM:90,depthM:.3,stepM:50},direct=fitResearchRiverPath([routeStart,routeEnd],options),routed=fitResearchRiverPath(a.path,options);
 assert.ok(direct.valid&&routed.valid);assert.ok(routed.scoreM<direct.scoreM);for(let i=1;i<routed.points.length;i++)assert.ok(routed.points[i].waterLevelElevationM<=routed.points[i-1].waterLevelElevationM);
});
test('a cheap corridor still has to pass dense ground and fixed-outlet fitting',()=>{
 const bad=(lat,lon)=>({groundElevationM:80,waterDepthM:0,waterLevelElevationM:null});
 assert.equal(searchTerrainCostCorridor(routeStart,routeEnd,{radiusM:6371000,sampleSurface:bad}).path,null);
 assert.equal(fitResearchRiverPath([routeStart,routeEnd],{sampleSurface:bad,radiusM:6371000,startLevelM:100,endLevelM:90,depthM:1}).valid,false);
});

import {selectResearchRiverRoute} from './terrain-cost-routing.mjs';
test('route selection refits rounded bends and never replaces a cheaper valid direct path',()=>{
 const options={radiusM:6371000,sampleSurface:routeSurface,stepM:100,halfWidthM:1500,depthM:.3};
 const result=selectResearchRiverRoute(routeStart,routeEnd,options);
 assert.equal(result.adoptionReady,false);assert.equal(result.candidates.length,3);
 assert.ok(result.selected.fit.valid);assert.ok(result.selected.fit.scoreM<=result.candidates[0].fit.scoreM);
 const rounded=result.candidates[2];assert.deepEqual(rounded.path[0],routeStart);assert.deepEqual(rounded.path.at(-1),routeEnd);
 const flat=selectResearchRiverRoute(routeStart,routeEnd,{...options,sampleSurface:(lat,lon)=>({groundElevationM:101-100*lon,waterDepthM:0,waterLevelElevationM:null})});
 assert.ok(flat.selected.fit.scoreM<=flat.candidates[0].fit.scoreM+1e-6);
});
import {auditRiverRouteTopology} from './river-route-topology.mjs';
test('spherical route audit rejects unregistered crossing but permits a declared confluence',()=>{
 const a={id:'a',from:'a0',to:'a1',points:[{latDeg:0,lonDeg:-.1},{latDeg:0,lonDeg:.1}]},b={id:'b',from:'b0',to:'b1',points:[{latDeg:-.1,lonDeg:0},{latDeg:.1,lonDeg:0}]},network={radiusM:6371000,profiles:[a,b]};
 assert.equal(auditRiverRouteTopology(network,a,a.points).valid,false);
 a.to='shared';a.points[1]={latDeg:0,lonDeg:0};b.from='shared';b.points[0]={latDeg:0,lonDeg:0};assert.equal(auditRiverRouteTopology(network,a,a.points).valid,true);
 b.from='different';assert.equal(auditRiverRouteTopology(network,a,a.points).valid,false);
});
test('topology audit handles antimeridian arcs and rejects overlapping centerlines',()=>{
 const a={id:'a',from:'a0',to:'a1',points:[{latDeg:0,lonDeg:179.9},{latDeg:0,lonDeg:-179.9}]},b={id:'b',from:'b0',to:'b1',points:[{latDeg:-.1,lonDeg:180},{latDeg:.1,lonDeg:180}]},network={radiusM:6371000,profiles:[a,b]};assert.equal(auditRiverRouteTopology(network,a,a.points).valid,false);
 b.points=[{latDeg:0,lonDeg:179.95},{latDeg:0,lonDeg:-179.95}];assert.ok(auditRiverRouteTopology(network,a,a.points).violations.some(v=>v.kind==='collinear-overlap'));
});
import {compareResearchCorridorWidths} from './terrain-cost-routing.mjs';
test('wider corridor comparison preserves lateral spacing, endpoints and a hard work budget',()=>{const r=compareResearchCorridorWidths(routeStart,routeEnd,{radiusM:6371000,sampleSurface:routeSurface,halfWidthM:750,depthM:.3,stepM:100,corridorStepM:500});assert.equal(r.attempts.length,3);assert.ok(r.attempts.every(a=>a.lateralSpacingM===750/8&&a.result.search.cells<=16384));assert.deepEqual(r.attempts.map(a=>a.halfWidthM),[750,1500,3000]);assert.equal(r.adoptionReady,false);assert.ok(r.searchBoundaryResolved);for(const a of r.attempts){assert.equal(a.result.search.path[0].lonDeg,0);assert.equal(a.result.search.path.at(-1).lonDeg,.1);}});
test('corridor resolution cannot allocate unbounded grids',()=>{assert.throws(()=>searchTerrainCostCorridor(routeStart,routeEnd,{radiusM:6371000,sampleSurface:routeSurface,lateralSteps:1000}),/resolution/);assert.equal(searchTerrainCostCorridor(routeStart,routeEnd,{radiusM:6371000,sampleSurface:routeSurface,maxCells:85,lateralSteps:32}).status,'cell-budget');});
import {erodeBoundedValley} from './transient-valley-relief.mjs';
test('bounded transient incision preserves protected corridors and patch edges without raising land',()=>{const n=33,extentM=1600,initial=Array.from({length:n*n},(_,i)=>100+Math.hypot(i%n-16,Math.floor(i/n)-16)),options={initial,extentM,guardM:150,fixed:[16*n+16],protectedSegments:[{ax:800,ay:200,bx:800,by:1400,widthM:70}],maxCutM:5},a=erodeBoundedValley(options),b=erodeBoundedValley(options);assert.deepEqual(a.report,b.report);assert.equal(a.report.adoptionReady,false);for(let y=0;y<=1600;y+=20)for(let x=0;x<=1600;x+=20){const d=a.displacement(x,y);assert.ok(d<=1e-8&&d>=-5-1e-8);if(x===0||y===0||x===1600||y===1600||(Math.abs(x-800)<=70&&y>=200&&y<=1400))assert.equal(d,0);}assert.ok(a.report.maximumCutM>0);assert.ok(Math.abs(a.displacement(.001,700))<1e-7);});
test('transient incision rejects unbounded work and leaves flat ground unchanged',()=>{const input={initial:Array(25).fill(10),extentM:1000,guardM:100};const r=erodeBoundedValley(input);assert.equal(r.report.maximumCutM,0);assert.throws(()=>erodeBoundedValley({...input,iterations:100}));assert.throws(()=>erodeBoundedValley({...input,initial:[NaN]}));});
