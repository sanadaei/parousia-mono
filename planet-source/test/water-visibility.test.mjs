import test from'node:test';import assert from'node:assert/strict';import{waterVisibilityUpperBound}from'../src/globe/water-visibility.mjs';
const bound=(lat,angular=0)=>({center:[Math.cos(lat),0,Math.sin(lat)],angular});
test('deep lake visibility includes its surface independently of the lake bed',()=>{
 const m={base:{grid:{rows:64,columns:128}},sea:{levelElevationM:0},lakes:[{cells:[640],levelElevationM:257}]};
 assert.equal(waterVisibilityUpperBound(m,bound(74.53125*Math.PI/180)),257);
 assert.equal(waterVisibilityUpperBound(m,bound(0)),0);
 assert.equal(waterVisibilityUpperBound(m,bound(Math.PI/2,.3)),257);
});
test('water visibility respects absent sea and conservatively retains unlocated river profiles',()=>{
 const m={base:{grid:{rows:4,columns:8}},lakes:[]};assert.equal(waterVisibilityUpperBound(m,bound(0)),-Infinity);
 const r={...m,rivers:{profiles:[{points:[{waterLevelElevationM:10},{waterLevelElevationM:20}]}]}};assert.equal(waterVisibilityUpperBound(r,bound(0)),20);
});

test('oblique frustum retains water even when cached bed is out of view',async()=>{
 const {GlobeStream}=await import('../src/globe/stream.mjs');const {tileBound}=await import('../src/globe/cube.mjs');
 const radius=6371000,tile={face:0,level:20,x:524288,y:524288},b=tileBound(tile,radius),u=b.center;
 const forward=[-u[0],-u[1],-u[2]],right=[0,1,0],up=[0,0,1];
 const camera={eye:u.map(v=>v*(radius+30)),eyeUnit:u,forward,right,up,near:.01,aspect:1.6,focal:2.414};
 const m={base:{grid:{rows:64,columns:128},frame:{radiusM:radius}},elevationRangeM:[-2000,1000],sea:{levelElevationM:0}};
 const stream=Object.assign(Object.create(GlobeStream.prototype),{manifest:m,heightRange:()=>[-2000,-2000]});
 // Look almost horizontally toward the tile's water surface, not its bed.
 const angle=70*Math.PI/180;camera.eye=u.map((v,i)=>v*(radius+30*Math.cos(angle))+up[i]*30*Math.sin(angle));camera.eyeUnit=camera.eye.map(v=>v/Math.hypot(...camera.eye));camera.forward=u.map((v,i)=>-v*Math.cos(angle)-up[i]*Math.sin(angle));camera.up=u.map((v,i)=>-v*Math.sin(angle)+up[i]*Math.cos(angle));
 assert.equal(stream.visible(tile,camera),true);
 stream.manifest={...m,sea:null};assert.equal(stream.visible(tile,camera),false);
});

test('constant reservoir proof checks all patches, wetness and competing lakes',async()=>{
 const {uniformReservoir}=await import('../src/globe/water-visibility.mjs');const m={base:{grid:{rows:8,columns:16}},sea:{id:'sea',levelElevationM:0},lakes:[{id:'lake',membershipMethod:'interpolation-support@1',levelElevationM:20,cells:[3*16+15,4*16+15,3*16,4*16]}]};
 assert.deepEqual(uniformReservoir(m,bound(0,.001),-10),{levelElevationM:20,sourceId:'lake'});
 assert.equal(uniformReservoir(m,bound(0,.001),21),null);
 assert.equal(uniformReservoir(m,bound(0,.7),-10),null);
 const mixed={...m,lakes:[{...m.lakes[0],cells:[3*16+15]},{id:'other',membershipMethod:'interpolation-support@1',levelElevationM:30,cells:[4*16]}]};assert.equal(uniformReservoir(mixed,bound(0,.001),-10),null);
 assert.equal(uniformReservoir({...m,lakes:[{...m.lakes[0],membershipMethod:'legacy-cell-halo@1'}]},bound(0,.001),-10),null);
 assert.deepEqual(uniformReservoir({...m,lakes:[]},bound(0,.001),-10),{sourceId:'sea',levelElevationM:0});
});

test('submerged-ground optimization refuses emerged beds, high rivers and underwater cameras',async()=>{
 const {GlobeStream}=await import('../src/globe/stream.mjs');const tile={face:0,level:18,x:131072,y:131072};
 const m={base:{frame:{radiusM:6371000},grid:{rows:8,columns:16}},sea:{id:'sea',levelElevationM:0},elevationRangeM:[-2000,-1000]};
 const stream=Object.assign(Object.create(GlobeStream.prototype),{manifest:m,heightRange:()=>[-2000,-1000]});
 assert.ok(stream.waterOnlyBound(tile,{eye:[6371030,0,0]}));
 assert.equal(stream.waterOnlyBound(tile,{eye:[6370000,0,0]}),null);
 stream.heightRange=()=>[-2000,1];assert.equal(stream.waterOnlyBound(tile,{eye:[6371030,0,0]}),null);
 stream.heightRange=()=>[-2000,-1000];stream.manifest={...m,rivers:{profiles:[{points:[{waterLevelElevationM:20}]}]}};assert.equal(stream.waterOnlyBound(tile,{eye:[6371030,0,0]}),null);
});
