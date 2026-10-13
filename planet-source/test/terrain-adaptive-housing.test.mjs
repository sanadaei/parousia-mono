import test from 'node:test';import assert from 'node:assert/strict';import {completeResidentialLots} from '../src/core/terrain-adaptive-housing.mjs';
function fixture(){return{id:'village/district:0',requested:60,buildings:[],buildingPads:[],roads:[{roadId:'bank-road',halfWidthM:2.5,samples:[{xM:90,yM:-210,distanceM:0,roadElevationM:20.06},{xM:90,yM:210,distanceM:420,roadElevationM:20.06}]}],ground:()=>20,water:x=>({waterDepthM:x<10?2:0})};}
test('spare lots fill a dry riverbank deterministically and remain connected to surveyed streets',()=>{const a=fixture(),b=fixture();const r=completeResidentialLots(a);completeResidentialLots(b);assert.equal(a.buildings.length,60);assert.equal(r.remaining,0);assert.deepEqual(a.buildings,b.buildings);assert.deepEqual(a.buildingPads,b.buildingPads);assert.deepEqual(a.roads,b.roads);assert.equal(new Set(a.buildings.map(b=>b.id)).size,60);for(const house of a.buildings)assert.ok(house.bounds.minXM>=10);assert.ok(a.roads.length>1);for(let i=0;i<a.buildings.length;i++)for(let j=i+1;j<a.buildings.length;j++){const x=a.buildings[i].bounds,y=a.buildings[j].bounds;assert.ok(x.maxXM<=y.minXM||y.maxXM<=x.minXM||x.maxYM<=y.minYM||y.maxYM<=x.minYM);}});
test('existing houses do not move and wholly unsuitable land remains explicitly unplaced',()=>{const a=fixture();completeResidentialLots(a);const saved=JSON.stringify(a.buildings);assert.equal(completeResidentialLots(a).placed,0);assert.equal(JSON.stringify(a.buildings),saved);const b=fixture();b.water=()=>({waterDepthM:2});assert.equal(completeResidentialLots(b).remaining,60);assert.equal(b.buildings.length,0);});
test('strict infill preserves public land and surveys the whole pedestrian width',()=>{const a=fixture(),reserved={minXM:100,maxXM:170,minYM:-80,maxYM:80};a.strictSurvey=true;a.reservations=[reserved];const r=completeResidentialLots(a);assert.equal(r.method,'surveyed-residential-infill@2');assert.equal(r.remaining,0);for(const b of a.buildings)assert.ok(b.bounds.maxXM<=reserved.minXM||b.bounds.minXM>=reserved.maxXM||b.bounds.maxYM<=reserved.minYM||b.bounds.minYM>=reserved.maxYM);for(const road of a.roads.slice(1)){assert.equal(road.role,'residential-access');for(const p of road.samples){assert.ok(p.xM>=11.25);assert.ok(!(p.xM>100&&p.xM<170&&p.yM>-80&&p.yM<80));}}});
test('strict infill refuses unknown water or nonfinite foundation surveys',()=>{for(const extra of [{water:()=>({waterDepthM:null})},{ground:()=>NaN}]){const a={...fixture(),...extra,strictSurvey:true};assert.equal(completeResidentialLots(a).remaining,60);assert.equal(a.buildings.length,0);}});

test('strict infill paths remain outside every house earthwork transition', async () => {
 const {buildingPadAffectsPoint}=await import('../src/core/building-pad.mjs');
 const a={...fixture(),strictSurvey:true,ground:(x,y)=>20+y*.015};
 const r=completeResidentialLots(a);assert.ok(r.placed>0);
 for(const road of a.roads)for(const p of road.samples)for(const pad of a.buildingPads){
  assert.equal(buildingPadAffectsPoint(pad,p.xM,p.yM,a.ground(p.xM,p.yM)),false);
  assert.equal(buildingPadAffectsPoint(pad,p.xM,p.yM,a.ground(p.xM,p.yM)+.06),false);
 }
 const saved=JSON.stringify({buildings:a.buildings,pads:a.buildingPads,roads:a.roads});
 completeResidentialLots(a);assert.equal(JSON.stringify({buildings:a.buildings,pads:a.buildingPads,roads:a.roads}),saved);
});

test('direct household access uses surveyed shortest approaches rather than mandatory right angles',()=>{
 const setup=()=>({...fixture(),strictSurvey:true,compactHouseholds:true,directApproaches:true,roads:[{roadId:'diagonal',halfWidthM:3,samples:[{xM:50,yM:-200,distanceM:0,roadElevationM:20.06},{xM:150,yM:200,distanceM:Math.hypot(100,400),roadElevationM:20.06}]}]}),a=setup(),b=setup();const r=completeResidentialLots(a);completeResidentialLots(b);assert.equal(r.remaining,0);assert.deepEqual(a.buildings,b.buildings);assert.deepEqual(a.roads,b.roads);assert.ok(a.roads.slice(1).some(r=>{const a=r.samples[0],b=r.samples.at(-1);return Math.abs(a.xM-b.xM)>1&&Math.abs(a.yM-b.yM)>1&&r.samples.every(p=>Math.abs((p.xM-a.xM)*(b.yM-a.yM)-(p.yM-a.yM)*(b.xM-a.xM))<1e-6);}));
 for(const road of a.roads.slice(1)){assert.equal(road.surfaceMaterial,'compacted-earth');assert.equal(road.accessPolicy,'surveyed-direct-household-access@1');for(const p of road.samples)assert.ok(p.xM>=11.25);}
 assert.throws(()=>completeResidentialLots({...fixture(),directApproaches:true}),/full-width/);
});
