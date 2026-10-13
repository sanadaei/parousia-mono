import test from'node:test';import assert from'node:assert/strict';
import{ROAD_CROSS_SECTION_SCHEMA,validateRoadCrossSection,roadCrossSectionAt,roadCrossSectionCurvatureBound}from'../src/core/road-cross-section.mjs';
import{createRoadAdjustedTerrain}from'../src/core/road-earthwork.mjs';import{metricRoads,tessellateRoadProfile}from'../src/core/road-geometry.mjs';import{baseTerrain}from'../fixtures/water-scenarios.mjs';
const section=(extra={})=>({schema:ROAD_CROSS_SECTION_SCHEMA,crownSlope:.02,crossSlope:0,transitionLengthM:10,flatIntervals:[],...extra});
const road=(crossSection=section())=>({roadId:'street',halfWidthM:3,crossSection,samples:[{xM:100,yM:500,distanceM:0,roadElevationM:101,structureKind:'fill'},{xM:900,yM:500,distanceM:800,roadElevationM:101,structureKind:'fill'}]});
const near=(a,b)=>assert.ok(Math.abs(a-b)<1e-8,`${a} != ${b}`);
test('one signed cross-section definition supplies crown, cant and exact unchanged centre',()=>{const s=section();validateRoadCrossSection(s,800);near(roadCrossSectionAt(s,40,3).offsetM,-.06);near(roadCrossSectionAt(s,40,-3).offsetM,-.06);assert.equal(roadCrossSectionAt(s,40,0).offsetM,0);near(roadCrossSectionAt(section({crownSlope:0,crossSlope:.03}),40,-3).offsetM,-.09);});
test('junction flattening joins with zero longitudinal slope and a bounded curvature',()=>{const s=section({flatIntervals:[{startM:30,endM:40}]});for(const d of[30,35,40])assert.equal(roadCrossSectionAt(s,d,3).offsetM,0);for(const d of[20,30,40,50])near(roadCrossSectionAt(s,d,3).alongSlope,0);assert.ok(roadCrossSectionAt(s,45,3).offsetM<0);assert.ok(roadCrossSectionCurvatureBound(s,3)>0);});
test('Core ground and traffic surface use the same crowned carriageway',()=>{const terrain=createRoadAdjustedTerrain(baseTerrain(()=>100),[road()]);for(const y of[497.03,498,500,502,502.97]){const expected=101-.02*Math.abs(y-500);near(terrain.groundElevationAt(500,y),expected);near(terrain.roadSurfaceAt(500,y).roadElevationM,expected);near(terrain.roadSurfaceAt(500,y).slopeMPerM,.02);}});
test('display tessellation includes crown transition curvature in its error budget',()=>{const r=road(section({transitionLengthM:1,flatIntervals:[{startM:30,endM:40}]})),route=metricRoads([r])[0],pieces=tessellateRoadProfile(route,{elevationToleranceM:.005});for(const p of pieces)for(const t of[.25,.5,.75]){const d=p.a.distanceM+(p.b.distanceM-p.a.distanceM)*t,actual=roadCrossSectionAt(r.crossSection,d,3).offsetM,linear=roadCrossSectionAt(r.crossSection,p.a.distanceM,3).offsetM*(1-t)+roadCrossSectionAt(r.crossSection,p.b.distanceM,3).offsetM*t;assert.ok(Math.abs(actual-linear)<=.00500001);}assert.ok(pieces.length>160);});
test('invalid cross-section inputs and out-of-road flat intervals are rejected',()=>{for(const s of[section({crownSlope:-1}),section({crossSlope:1}),section({transitionLengthM:0}),section({flatIntervals:[{startM:0,endM:900}]})])assert.throws(()=>validateRoadCrossSection(s,800));assert.throws(()=>roadCrossSectionAt(section(),NaN,0));});

import { designRoadJunctions,createJunctionAdjustedTerrain } from '../src/core/road-junctions.mjs';
import { buildBridgeStructure,validateBridgeStructures } from '../src/core/bridge-structures.mjs';
import { inspectRoadCorridorClearance } from '../src/core/road-corridors.mjs';
import { buildBuildingMesh } from '../src/globe/buildings.mjs';
import { createSphericalProjection } from '../src/core/spherical.mjs';
import { runoffFromTerrain,stepRunoff } from '../src/core/runoff-dynamics.mjs';

test('junction planning flattens existing crowns and both terrain adapters agree across the junction',()=>{
 const first=road(),second={roadId:'side',halfWidthM:2,crossSection:section(),samples:[{xM:500,yM:500,distanceM:0,roadElevationM:101,structureKind:'fill'},{xM:500,yM:600,distanceM:100,roadElevationM:101,structureKind:'fill'}]};
 const plan=designRoadJunctions([first,second]),base=baseTerrain(()=>100),simple=createRoadAdjustedTerrain(base,plan.roads),joint=createJunctionAdjustedTerrain(base,plan);
 for(const x of[498.1,500,501.9])for(const y of[500,501,502]){near(simple.groundElevationAt(x,y),101);near(joint.groundElevationAt(x,y),101);}
 near(simple.groundElevationAt(550,502),100.96);near(joint.groundElevationAt(550,502),100.96);
});
test('saved flat bridge rejects a crowned deck until the actual span has a flat interval',()=>{
 const b=buildBridgeStructure({id:'b',roadId:'bridge-road',start:{xM:0,yM:0},end:{xM:80,yM:0},deckElevationM:10,widthM:6,groundAt:()=>3});
 const r={id:'bridge-road',halfWidthM:3,deckThicknessM:.8,structureKind:'bridge-deck',points:[{xM:0,yM:0,roadElevationM:10},{xM:80,yM:0,roadElevationM:10}],crossSection:section()};
 assert.throws(()=>validateBridgeStructures([b],[r]),/crowned/);r.crossSection.flatIntervals=[{startM:0,endM:80}];assert.doesNotThrow(()=>validateBridgeStructures([b],[r]));
});
test('full-width clearance does not certify a canted deck using just its centre height',()=>{
 const a={id:'low',halfWidthM:3,structureKind:'fill',points:[{xM:0,yM:0,roadElevationM:0},{xM:20,yM:0,roadElevationM:0}]},b={...a,id:'high',structureKind:'bridge-deck',points:a.points.map(p=>({...p,roadElevationM:5})),crossSection:section({crownSlope:0,crossSlope:.1})};
 const result=inspectRoadCorridorClearance([a,b]);assert.notEqual(result.overlaps[0].status,'clearance-certified');near(result.overlaps[0].minimumClearanceM,4.2);
});
test('rendered crown vertices come from the same section and include a centre seam',()=>{
 const radiusM=6371000,projection=createSphericalProjection({centerLatDeg:0,centerLonDeg:0,radiusM,maxRadiusM:3000}),r=road(),mesh=buildBuildingMesh({projection:projection.contract,buildings:[],roadCenterlineProfiles:[r]},radiusM,{includeRoads:true});
 const heights=[];for(let i=0;i<mesh.vertex.length;i+=12){const p=[0,1,2].map(k=>mesh.vertex[i+k]+mesh.anchor[k]);heights.push(Math.hypot(...p)-radiusM);}
 assert.ok(heights.some(z=>Math.abs(z-101.025)<.0001));assert.ok(heights.some(z=>Math.abs(z-100.965)<.0001));assert.ok(heights.every(z=>z>=100.9649&&z<=101.0251));
});
test('rain on the actual crown flows toward both edges with conserved water',()=>{
 const terrain=createRoadAdjustedTerrain(baseTerrain(()=>100),[road()]);
 let s=runoffFromTerrain(terrain,{bounds:{minXM:498.5,maxXM:501.5,minYM:496.5,maxYM:503.5},cellSizeM:1,initialWater:'dry'});
 s=stepRunoff(s,{seconds:1,rainfallMPerSecond:.01,conductanceM2PerSecond:0});
 const middle=s.waterVolumeM3[3*3+1];s=stepRunoff(s,{seconds:1,conductanceM2PerSecond:.2});
 assert.ok(s.waterVolumeM3[3*3+1]<middle);near(s.waterVolumeM3[2*3+1],s.waterVolumeM3[4*3+1]);near(s.diagnostics.balanceErrorM3,0);
});

import { generatePlanet } from '../src/core/planet-generation.mjs';
import { snapshotPlanetWorld,restorePlanetWorld } from '../src/core/planet-world.mjs';
test('generated crown is serialized once, flattened at actual crossings, and legacy opt-out stays flat',()=>{
 const generated=generatePlanet({columns:32,rows:16,settlementCount:1}),saved=snapshotPlanetWorld(generated),restored=restorePlanetWorld(saved);
 assert.deepEqual(restored.toSnapshot(),saved);assert.ok(saved.recipes.length);
 for(const recipe of saved.recipes){for(const r of recipe.roadCenterlineProfiles){assert.equal(r.crossSection.crownSlope,.02);const route=metricRoads([r])[0];validateRoadCrossSection(r.crossSection,route.lengthM);for(const j of recipe.roadJunctions??[]){const m=j.members.find(m=>m.roadId===route.id);if(m)near(roadCrossSectionAt(r.crossSection,m.distanceM,route.halfWidthM).offsetM,0);}}
  validateBridgeStructures(recipe.bridgeStructures,recipe.roadCenterlineProfiles);
 }
 const flat=generatePlanet({columns:32,rows:16,settlementCount:1,roadCrownSlope:0});assert.ok(flat.recipes.every(r=>r.roadCenterlineProfiles.every(road=>!road.crossSection)));
 assert.throws(()=>generatePlanet({roadCrownSlope:NaN}));
});

test('a manually supplied junction cannot hide incompatible crowned widths behind equal centre heights',()=>{
 const first=road(),second={roadId:'side',halfWidthM:2,crossSection:section(),samples:[{xM:500,yM:500,distanceM:0,roadElevationM:101,structureKind:'fill'},{xM:500,yM:600,distanceM:100,roadElevationM:101,structureKind:'fill'}]},plan=structuredClone(designRoadJunctions([first,second]));
 plan.roads[0].crossSection.flatIntervals=[];assert.throws(()=>createJunctionAdjustedTerrain(baseTerrain(()=>100),plan),/cross section/);
});


import {roadCrossSectionOffsetInterval} from '../src/core/road-cross-section.mjs';
test('local cross-section intervals contain crowns, cant and overlapping flattening transitions',()=>{
 for(const s of [section(),section({crossSlope:-.03}),section({crossSlope:.03,flatIntervals:[{startM:30,endM:40},{startM:45,endM:48}]})]){
  for(const stations of [[0,80],[25,35],[40,47],[46,49],[42,42.001]])for(const lateral of [[-3,3],[-2,-1],[1,1.001],[0,0]]){
   const bound=roadCrossSectionOffsetInterval(s,stations,lateral);
   for(let i=0;i<=24;i++)for(let j=0;j<=12;j++){const v=roadCrossSectionAt(s,stations[0]+i/24*(stations[1]-stations[0]),lateral[0]+j/12*(lateral[1]-lateral[0])).offsetM;assert.ok(v>=bound[0]-1e-12&&v<=bound[1]+1e-12);}
  }
 }
 const narrow=roadCrossSectionOffsetInterval(section(),[100,100.001],[1,1.001]);assert.ok(narrow[1]-narrow[0]<.000021);
 assert.deepEqual(roadCrossSectionOffsetInterval(null,[0,1],[-1,1]),[0,0]);assert.throws(()=>roadCrossSectionOffsetInterval(section(),[1,0],[0,1]));
});
test('a microscopic region on a crowned road no longer inherits the whole road-width amplitude',()=>{
 const terrain=createRoadAdjustedTerrain(baseTerrain(()=>100),[road()]),disk={xM:500,yM:502,radiusM:.001},bound=terrain.boundGroundElevation([100,100],disk);
 assert.ok(bound[1]-bound[0]<.00005);
 for(let k=0;k<32;k++){const a=k*Math.PI/16,z=terrain.groundElevationAt(disk.xM+disk.radiusM*Math.cos(a),disk.yM+disk.radiusM*Math.sin(a));assert.ok(z>=bound[0]&&z<=bound[1]);}
});

test('a distant bridge endpoint does not retain unbuilt ground in an interior ramp bound',()=>{
 const r={roadId:'ramp',halfWidthM:3,samples:[{xM:100,yM:500,distanceM:0,roadElevationM:110,structureKind:'fill',segmentKind:'approach-ramp'},{xM:900,yM:500,distanceM:800,roadElevationM:110,structureKind:'bridge-deck'}]},terrain=createRoadAdjustedTerrain(baseTerrain(()=>100),[r]);
 const interior=terrain.boundGroundElevation([100,100],{xM:500,yM:500,radiusM:.01});
 assert.ok(interior[0]>109.99&&interior[1]<110.01);
 const endpoint=terrain.boundGroundElevation([100,100],{xM:900,yM:500,radiusM:.01});
 assert.ok(endpoint[0]<=100&&endpoint[1]>=110);
 for(const x of[899.99,900,900.01]){const h=terrain.groundElevationAt(x,500);assert.ok(h>=endpoint[0]&&h<=endpoint[1]);}
 const deck={...r,samples:r.samples.map(p=>({...p,structureKind:'bridge-deck',segmentKind:'bridge-deck'}))},suspended=createRoadAdjustedTerrain(baseTerrain(()=>100),[deck]);
 const ground=suspended.boundGroundElevation([100,100],{xM:500,yM:500,radiusM:.01});assert.ok(ground[0]<=100&&ground[1]>=100&&ground[1]<100.01);
});

test('a provably weaker neighbouring batter cannot widen the winner ground interval',()=>{
 const main={...road(null),samples:road(null).samples.map(p=>({...p,roadElevationM:110}))},side={...main,roadId:'weak-side',samples:main.samples.map(p=>({...p,yM:530}))},base=baseTerrain(()=>100),a=createRoadAdjustedTerrain(base,[main]),both=createRoadAdjustedTerrain(base,[main,side]),disk={xM:500,yM:506,radiusM:.01};
 const expected=a.boundGroundElevation([100,100],disk),actual=both.boundGroundElevation([100,100],disk);assert.deepEqual(actual,expected);assert.ok(actual[1]-actual[0]<.05);
 for(let k=0;k<64;k++){const angle=k*Math.PI/32,x=disk.xM+disk.radiusM*Math.cos(angle),y=disk.yM+disk.radiusM*Math.sin(angle),z=both.groundElevationAt(x,y);assert.equal(z,a.groundElevationAt(x,y));assert.ok(z>=actual[0]&&z<=actual[1]);}
 // At the equal-influence switch both roads must remain candidates.
 const high={...side,samples:side.samples.map(p=>({...p,roadElevationM:120}))},mixed=createRoadAdjustedTerrain(base,[main,high]),wide={xM:500,yM:515,radiusM:10},bounds=mixed.boundGroundElevation([100,100],wide);
 for(let i=0;i<=100;i++){const z=mixed.groundElevationAt(500,505+i*.2);assert.ok(z>=bounds[0]&&z<=bounds[1]);}
});
