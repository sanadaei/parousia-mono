import test from 'node:test';
import assert from 'node:assert/strict';
import {terrainAppearance,shapeFirstOverview,DESIGNED_WATER_COLOR,RIVER_GUIDE_COLOR} from '../src/globe/terrain-appearance.mjs';
const region={elevationRangeM:[500,800],extent:{widthM:8800,heightM:9800}};
test('shape draft palette reveals local relief independently of geographic vertical offset',()=>{
 const sample={shapeFirst:{weight:1},slopeMPerM:.1};
 const low=terrainAppearance(500,sample,region),high=terrainAppearance(800,sample,region);
 assert.ok(high[0]-low[0]>.25);assert.ok(high.every(v=>v>=0&&v<=1));
 assert.deepEqual(terrainAppearance(1500,sample,{...region,elevationRangeM:[1500,1800]}),low);
});
test('terrain appearance is display-only and blends continuously into saved terrain',()=>{
 const sample={groundElevationM:620,waterDepthM:0,shapeFirst:{weight:.5},slopeMPerM:.3};
 const snapshot=JSON.stringify({sample,region}),base=terrainAppearance(620,null,null),full=terrainAppearance(620,{...sample,shapeFirst:{weight:1}},region),half=terrainAppearance(620,sample,region);
 for(let i=0;i<3;i++)assert.ok(Math.abs(half[i]-(base[i]+full[i])/2)<1e-12);
 assert.equal(JSON.stringify({sample,region}),snapshot);
 assert.deepEqual(terrainAppearance(620,{...sample,shapeFirst:{weight:0}},region),base);
 const cover=[.1,.2,.3];assert.equal(terrainAppearance(620,{...sample,groundCover:{color:cover}},region),cover);
});
test('measured steep banks receive mineral tone without invented surface texture',()=>{
 const sample={shapeFirst:{weight:1}};
 const flat=terrainAppearance(650,{...sample,slopeMPerM:0},region),steep=terrainAppearance(650,{...sample,slopeMPerM:1},region);
 assert.ok(steep[1]<flat[1]);assert.ok(DESIGNED_WATER_COLOR[2]>DESIGNED_WATER_COLOR[0]);
 assert.deepEqual(terrainAppearance(650,sample,region),flat);
});
test('regional overview scales with draft extent and keeps physical heights unchanged',()=>{
 assert.deepEqual(shapeFirstOverview(region),{altitudeM:10290,tiltDeg:45,localHour:12});
 assert.equal(shapeFirstOverview({...region,extent:{widthM:1000,heightM:1000}}).altitudeM,5000);
});

test('optional river guides remain distinct but quieter than saturated cyan',()=>{
 assert.ok(RIVER_GUIDE_COLOR[1]>DESIGNED_WATER_COLOR[1]);
 assert.ok(RIVER_GUIDE_COLOR[2]>DESIGNED_WATER_COLOR[2]);
 assert.ok(RIVER_GUIDE_COLOR[1]<.6&&RIVER_GUIDE_COLOR[2]<.75);
});
