import test from'node:test';import assert from'node:assert/strict';import{GroundTracker,cameraSurfaceElevation}from'../src/globe/ground-tracker.mjs';
function fixture(){let loaded=false,calls=0,release;const gate=new Promise(r=>release=r),source={featuresReadyAt:()=>loaded,enableFeaturesAt:async()=>{calls++;await gate;loaded=true;},ready:async fn=>fn(),sample:()=>({groundElevationM:3,waterSurfaceElevationM:5,roadSurface:{roadElevationM:8}}),rawGroundElevationAt:()=>6,stats:()=>({fieldBytes:100}),cache:{clear(){}},anchors:{clear(){}},featureCache:{clear(){}}};return{tracker:new GroundTracker(source),release,calls:()=>calls};}
test('camera ground following has one pending load and follows actual road/water surfaces once ready',async()=>{
 const {tracker,release,calls}=fixture();assert.equal(tracker.tick({latDeg:0,lonDeg:0},0),null);
 for(let i=1;i<=20;i++)tracker.tick({latDeg:i,lonDeg:0},i);assert.equal(calls(),1);release();await tracker.pending;
 assert.deepEqual(tracker.tick({latDeg:0,lonDeg:0},100),{groundElevationM:3,surfaceElevationM:8,rawGroundElevationM:6});assert.equal(calls(),1);assert.equal(tracker.stats().fieldBytes,100);
 tracker.destroy();assert.equal(tracker.tick({latDeg:0,lonDeg:0},200),null);
});

test('an unchanged camera point reuses its immutable world sample without terrain queries',()=>{let calls=0;const source={featuresReadyAt:()=>true,sample:()=>{calls++;return{groundElevationM:3,waterSurfaceElevationM:5};},rawGroundElevationAt:()=>6,stats:()=>({}),cache:{clear(){}},anchors:{clear(){}},featureCache:{clear(){}}},tracker=new GroundTracker(source),point={latDeg:2,lonDeg:3},first=tracker.tick(point,0);for(let i=0;i<100;i++)assert.equal(tracker.tick({...point},i),first);assert.equal(calls,1);assert.equal(tracker.stats().cacheHits,100);assert.ok(Object.isFrozen(first));tracker.tick({latDeg:2,lonDeg:3.1},101);assert.equal(calls,2);tracker.destroy();assert.equal(tracker.lastSample,null);assert.equal(tracker.tick(point,102),null);});

test("camera support stays on lake water and bridge decks during inspection",()=>{assert.equal(cameraSurfaceElevation({groundElevationM:-1706,waterSurfaceElevationM:256}),256);assert.equal(cameraSurfaceElevation({groundElevationM:10,waterSurfaceElevationM:12,roadSurface:{roadElevationM:20}}),20);assert.equal(cameraSurfaceElevation({groundElevationM:10}),10);});
