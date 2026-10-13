import test from'node:test';import assert from'node:assert/strict';import{createSphericalRiverSampler,SMOOTH_RIVER_BED,LEGACY_SMOOTH_RIVER_BED}from'../src/core/planet-rivers.mjs';
import {sphereBasis,offsetGeographic} from '../src/core/spherical.mjs';
const radiusM=10000,degree=180/Math.PI/radiusM;
const point=(x,y,z)=>({latDeg:y*degree,lonDeg:x*degree,waterLevelElevationM:z,halfWidthM:4,bankWidthM:4,depthM:2});
const a=point(0,0,5),b=point(20,0,4),c=point(40,8,3);
function network(){return{schema:'planet-spherical-rivers@1',bedMethod:SMOOTH_RIVER_BED,radiusM,grid:{columns:36,rows:18},diagnostics:{maxIncisionM:20},nodes:[{id:'a',...a},{id:'c',...c}],profiles:[{id:'river',from:'a',to:'c',points:[a,b,c]}]};}
const ground=(sample,x,y,z=10)=>sample(y*degree,x*degree,z).groundElevationM;
test('river disk upper hull includes all interior samples without raising excavation above the raw ground',()=>{
 for(const bedMethod of [undefined,LEGACY_SMOOTH_RIVER_BED,SMOOTH_RIVER_BED]){
  const input=network();input.bedMethod=bedMethod;const sample=createSphericalRiverSampler(input);
  for(const x of [-5,0,10,20,30,40,45])for(const y of [-8,0,4,8,12])for(const reach of [.1,2,8]){
   const center=point(x,y,0),bound={center:sphereBasis(center).up,angular:reach/radiusM},range=sample.groundHeightBounds(bound,[8,12]);
   assert.ok(range[1]<=12);
   for(let k=0;k<12;k++)for(const fraction of [0,.5,1]){
    const p=offsetGeographic(center,reach*fraction*Math.cos(k*Math.PI/6),reach*fraction*Math.sin(k*Math.PI/6),radiusM);
    for(const height of [8,10,12]){const z=sample(p.latDeg,p.lonDeg,height).groundElevationM;assert.ok(z>=range[0]-1e-8&&z<=range[1]+1e-8,`${bedMethod}: ${z} outside ${range}`);}
   }
  }
 }
});
test('only wholly covered disks get a lowered roof and the incision cap is retained',()=>{
 const input=network();input.diagnostics.maxIncisionM=200;const sample=createSphericalRiverSampler(input),disk=(x,y,r)=>({center:sphereBasis(point(x,y,0)).up,angular:r/radiusM});
 assert.ok(sample.groundHeightBounds(disk(10,0,1),[100,110])[1]<5.02);
 assert.equal(sample.groundHeightBounds(disk(10,8,1),[100,110])[1],110);
 assert.ok(sample.groundHeightBounds(disk(10,0,1),[990,1000])[1]>=800);
 assert.throws(()=>sample.groundHeightBounds({center:[1,0,0],angular:-1},[0,1]),/Invalid/);
 assert.throws(()=>sample.groundHeightBounds(disk(0,0,1),[2,1]),/Invalid/);
});
test('river interval hulls converge and remain valid across a polar longitude seam',()=>{
 const rotate=p=>{const [x,y,z]=sphereBasis(p).up,a=85*Math.PI/180,b=179.999*Math.PI/180,u=x*Math.cos(a)-z*Math.sin(a),v=y,w=x*Math.sin(a)+z*Math.cos(a);
  return {...p,latDeg:Math.atan2(w,Math.hypot(u,v))*180/Math.PI,lonDeg:Math.atan2(u*Math.sin(b)+v*Math.cos(b),u*Math.cos(b)-v*Math.sin(b))*180/Math.PI};};
 const input=network();input.nodes=input.nodes.map(rotate);input.profiles=input.profiles.map(p=>({...p,points:p.points.map(rotate)}));
 const sample=createSphericalRiverSampler(input),center=rotate(point(10,2,0)),spans=[];
 for(const reach of [1,.1,.01]){
  const range=sample.groundHeightBounds({center:sphereBasis(center).up,angular:reach/radiusM},[10,10]);spans.push(range[1]-range[0]);
  for(let k=0;k<16;k++){const p=offsetGeographic(center,reach*Math.cos(k*Math.PI/8),reach*Math.sin(k*Math.PI/8),radiusM),z=sample(p.latDeg,p.lonDeg,10).groundElevationM;assert.ok(z>=range[0]-1e-8&&z<=range[1]+1e-8);}
 }
 assert.ok(spans[1]<spans[0]*.2&&spans[2]<spans[1]*.2,`${spans}`);
});
test('smooth river bed has matching one-sided slopes at profile joints and capsule/bank boundaries',()=>{
 const s=createSphericalRiverSampler(network()),eps=1e-4;
 for(const[x,y,axis]of[[20,0,'x'],[20,2,'x'],[20,6,'x'],[10,8,'y'],[10,4,'y'],[0,2,'x']]){
  const f=delta=>ground(s,x+(axis==='x'?delta:0),y+(axis==='y'?delta:0)),left=(f(0)-f(-eps))/eps,right=(f(eps)-f(0))/eps;
  assert.ok(Math.abs(left-right)<.003,`${x},${y}: ${left} vs ${right}`);
 }
});
test('smooth union remains bounded by the saved incision limit and exact outside all banks',()=>{
 const s=createSphericalRiverSampler(network());for(let x=-10;x<50;x+=.5)for(let y=-10;y<20;y+=.5){const z=ground(s,x,y,1000);assert.ok(z>=980-1e-10);assert.ok(z<=1000);}
 assert.equal(ground(s,10,20),10);assert.equal(ground(s,-20,0),10);
});
test('legacy saved river beds retain their original arithmetic and unknown methods reject',()=>{
 const n=network();delete n.bedMethod;const legacy=createSphericalRiverSampler(n),current=createSphericalRiverSampler(network());
 assert.ok(Math.abs(ground(legacy,10,0)-2.5)<1e-12);assert.notEqual(ground(current,10,0),2.5);
 assert.throws(()=>createSphericalRiverSampler({...n,bedMethod:'unknown'}),/method/);
});
test('smooth confluence combination does not reintroduce a hard minimum crease',()=>{
 const n=network(),d=point(20,-20,5);n.nodes.push({id:'d',...d});n.profiles.push({id:'tributary',from:'d',to:'c',points:[d,c]});const s=createSphericalRiverSampler(n),eps=1e-5;
 for(const[x,y]of[[39,7],[40,8],[35,4],[25,-2]])for(const axis of['x','y']){
  const f=t=>ground(s,x+(axis==='x'?t:0),y+(axis==='y'?t:0)),left=(f(0)-f(-eps))/eps,right=(f(eps)-f(0))/eps;
  assert.ok(Math.abs(left-right)<.005,`${x},${y},${axis}: ${left} ${right}`);
 }
});
import{smoothIncisionUnion}from'../src/core/planet-rivers.mjs';
test('absolute smooth maximum does not turn deep adjacent valleys into over-deep river water',()=>{
 for(const depth of[1,10,100,600]){assert.equal(smoothIncisionUnion(depth,0),depth);const u=smoothIncisionUnion(depth,depth);assert.ok(u-depth<=.005000000001);}
 assert.equal(smoothIncisionUnion(0,0),0);
 const n=network();n.diagnostics.maxIncisionM=600;const old=createSphericalRiverSampler({...n,bedMethod:LEGACY_SMOOTH_RIVER_BED}),current=createSphericalRiverSampler(n),before=old(b.latDeg,b.lonDeg,350),after=current(b.latDeg,b.lonDeg,350);
 assert.ok(before.waterDepthM>10);assert.ok(Math.abs(after.waterDepthM-b.depthM)<.02);assert.ok(after.groundElevationM>before.groundElevationM);
});
test('saved p-norm mode preserves its arithmetic at overlapping capsule endpoints',()=>{
 const n=network();n.bedMethod=LEGACY_SMOOTH_RIVER_BED;const s=createSphericalRiverSampler(n),expected=10-((10-b.waterLevelElevationM+b.depthM-.005)*2**(1/16));
 assert.ok(Math.abs(ground(s,20,0)-expected)<1e-9);
});

test('water-only intersection distinguishes the wet channel from broad valley banks',()=>{
 const n=network();for(const p of n.profiles[0].points)p.bankWidthM=100;
 const s=createSphericalRiverSampler(n),triangle=(x,y)=>[[x-1,y-1],[x+1,y-1],[x,y+1]].map(([x,y])=>sphereBasis({latDeg:y*degree,lonDeg:x*degree}).up);
 assert.equal(s.intersects(triangle(10,50)),true);
 assert.equal(s.intersects(triangle(10,50),{waterOnly:true}),false);
 assert.equal(s.intersects(triangle(10,0),{waterOnly:true}),true);
 assert.equal(s.minimumIntersectingHalfWidth(triangle(10,0)),4);assert.equal(s.minimumIntersectingHalfWidth(triangle(10,50)),Infinity);
 assert.equal(s.intersects(triangle(10,200)),false);
});
test('broad valley cross-section rejoins untouched terrain with bounded side slope',()=>{
 const n=network();n.diagnostics.maxIncisionM=600;
 n.profiles[0].points=[point(0,0,4),point(40,0,4)];for(const p of n.profiles[0].points){p.halfWidthM=40;p.bankWidthM=750;p.depthM=4;}
 n.nodes=[{id:'a',...n.profiles[0].points[0]},{id:'c',...n.profiles[0].points[1]}];
 const s=createSphericalRiverSampler(n);let previous=ground(s,20,40,250),maximumSlope=0;
 for(let y=41;y<=791;y++){const z=ground(s,20,y,250);assert.ok(z>=previous-1e-8);maximumSlope=Math.max(maximumSlope,z-previous);previous=z;}
 assert.ok(maximumSlope<.51);assert.equal(ground(s,20,792,250),250);
 const eps=.001,f=y=>ground(s,20,y,250);assert.ok(Math.abs((f(790)-f(790-eps))/eps)<.001);
});

import {ALLUVIAL_RIVER_BED,withAlluvialValleySections} from '../src/core/river-valley-section.mjs';
function alluvialNetwork(){const n=network();n.profiles[0].points=[point(0,0,4),point(400,0,4)];n.nodes=[{id:'a',...n.profiles[0].points[0]},{id:'c',...n.profiles[0].points[1]}];return withAlluvialValleySections(n);}
test('alluvial sections preserve geography, are immutable and idempotent',()=>{
 const n=network();const before=JSON.stringify(n),v=withAlluvialValleySections(n);
 assert.equal(JSON.stringify(n),before);assert.deepEqual(v.nodes,n.nodes);assert.equal(v.bedMethod,ALLUVIAL_RIVER_BED);assert.strictEqual(withAlluvialValleySections(v),v);
 for(let i=0;i<n.profiles[0].points.length;i++)for(const k of ['latDeg','lonDeg','waterLevelElevationM','halfWidthM','depthM'])assert.equal(v.profiles[0].points[i][k],n.profiles[0].points[i][k]);
 assert.throws(()=>withAlluvialValleySections({...n,profiles:[{points:[]}]}),/Bounded/);
 assert.throws(()=>withAlluvialValleySections({...n,bedMethod:'unknown'}),/method/);
});
test('alluvial gentle floor and outer bank join with matching slopes',()=>{
 const n=alluvialNetwork(),s=createSphericalRiverSampler(n),eps=.0001,f=y=>ground(s,200,y,10);
 for(const y of [4,24,28])assert.ok(Math.abs((f(y)-f(y-eps))/eps-(f(y+eps)-f(y))/eps)<.003,`${y}`);
 assert.ok(f(14)>4&&f(14)<5.5);assert.equal(f(30),10);
});
test('alluvial interval bounds enclose floor, bank, tapered sections and varying raw ground',()=>{
 for(const tapered of [false,true]){
 const n=alluvialNetwork();if(tapered){const p=n.profiles[0].points[1];p.floodplainWidthM=0;p.floodplainRiseM=0;p.bankWidthM=4;}
 const s=createSphericalRiverSampler(n);
 for(const x of [0,50,200,399,410])for(const y of [0,3,4,8,14,23,24,27,30])for(const reach of [.01,1,7]){
 const center=point(x,y,0),range=s.groundHeightBounds({center:sphereBasis(center).up,angular:reach/radiusM},[8,12]);
 for(let k=0;k<12;k++)for(const fraction of [0,.5,1]){
 const p=offsetGeographic(center,reach*fraction*Math.cos(k*Math.PI/6),reach*fraction*Math.sin(k*Math.PI/6),radiusM);
 for(const h of [8,10,12]){const z=s(p.latDeg,p.lonDeg,h).groundElevationM;assert.ok(z>=range[0]-1e-8&&z<=range[1]+1e-8,`${tapered} ${x},${y} r${reach}: ${z} outside ${range}`);}
 }
 }
 }
});

test('valley proximity exposes saved physical floor only when explicitly requested',()=>{
 const n=alluvialNetwork(),s=createSphericalRiverSampler(n),p=point(200,14,0),old=s.nearby(p.latDeg,p.lonDeg),v=s.nearby(p.latDeg,p.lonDeg,1000,{includeValley:true});
 assert.equal(old.floodplainWidthM,undefined);assert.equal(v.floodplainWidthM,20);
 assert.equal(s.environmentReachM,200);const wide=alluvialNetwork();for(const q of wide.profiles[0].points){q.floodplainWidthM=400;q.bankWidthM=500;}assert.equal(createSphericalRiverSampler(wide).environmentReachM,580);
 for(const k of ['riverId','bankDistanceM','waterLevelElevationM'])assert.equal(v[k],old[k]);
 assert.equal(createSphericalRiverSampler(network()).nearby(a.latDeg,a.lonDeg,1000,{includeValley:true}).floodplainWidthM,0);
 assert.throws(()=>s.nearby(p.latDeg,p.lonDeg,1000,{includeValley:'yes'}),/metadata/);
});
