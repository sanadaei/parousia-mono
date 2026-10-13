import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {createSphericalProjection} from '../src/core/spherical.mjs';
import {chooseShapeFirstOutletReceiver,designShapeFirstOutletRoute,createShapeFirstOutletConnector} from '../src/core/shape-first-outlet-connection.mjs';
const spec={schema:'shape-first-outlet-connection@1',outlet:{xM:1000,yM:1000,waterLevelM:50,depthM:2,widthM:12,direction:{xM:1,yM:0}},receiver:{id:'existing:river',pointIndex:4,verifiedWet:true,xM:7000,yM:2000,waterLevelM:40,depthM:3,widthM:20,direction:{xM:1,yM:0}}};
test('connector represents continuous wet bed, monotonically descending water and unchanged exterior',()=>{
 const c=createShapeFirstOutletConnector(spec);let previous=Infinity;
 for(let i=0;i<c.route.points.length;i++){const p=c.route.points[i],end=i===c.route.points.length-1,s=c.sample(p.xM,p.yM,end?37:80,end?40:null);assert.ok(s.wet,`dry route ${i}`);assert.ok(s.waterLevelM<=previous+1e-10);previous=s.waterLevelM;assert.ok(s.groundElevationM<s.waterLevelM);assert.ok(s.waterDepthM>0);}
 assert.equal(c.sample(1000,1000,80).waterLevelM,50);assert.equal(c.sample(1000,1000,80).groundElevationM,48);
 assert.deepEqual(c.sample(7000,2000,37,40),{groundElevationM:37,waterLevelM:40,wet:true,riverId:null,waterDepthM:3,channelWidthM:0,influence:0});
 assert.equal(c.sample(3000,10000,123).groundElevationM,123);assert.equal(c.sample(3000,10000,123).waterLevelM,null);
});
test('terminal joins existing wet water field without a gap even through compact fade',()=>{
 const c=createShapeFirstOutletConnector(spec),e=c.route.points.at(-1),p=c.route.points.at(-2),dx=e.xM-p.xM,dy=e.yM-p.yM,L=Math.hypot(dx,dy);
 for(let d=0;d<3;d+=.01){const s=c.sample(e.xM-d*dx/L,e.yM-d*dy/L,37,40);assert.ok(s.wet);assert.ok(s.waterDepthM>=2.99);assert.ok(Math.abs(s.waterLevelM-40)<1e-4);}
});
test('deterministic identity and sampled bounds, including fine-scale convergence',()=>{
 const c=createShapeFirstOutletConnector(spec),reload=createShapeFirstOutletConnector(JSON.parse(JSON.stringify(spec)));assert.equal(c.id,reload.id);assert.deepEqual(c.route,reload.route);
 for(const p of c.route.points.slice(0,-1)){for(const dy of[0,2,10,30]){const x=p.xM,y=p.yM+dy,b={minXM:x-.01,maxXM:x+.01,minYM:y-.01,maxYM:y+.01},z=c.sample(x,y,80).groundElevationM,range=c.bounds(b,[80,80]);assert.ok(z>=range[0]-1e-8&&z<=range[1]+1e-8,`${z} outside ${range}`);}}
 const p=c.route.points[40],range=c.bounds({minXM:p.xM-1e-7,maxXM:p.xM+1e-7,minYM:p.yM-1e-7,maxYM:p.yM+1e-7},[80,80]);assert.ok(range[1]-range[0]<.0001);
 assert.throws(()=>createShapeFirstOutletConnector({...spec,receiver:{...spec.receiver,verifiedWet:false}}));assert.throws(()=>createShapeFirstOutletConnector({...spec,outlet:{...spec.outlet,waterLevelM:39}}));assert.throws(()=>c.sample(NaN,0,0));
});
test('saved planet resolves an actual downstream receiver outside modified collar with bounded search',async()=>{
 const m=JSON.parse(await fs.readFile(new URL('../examples/planet/generated/manifest.json',import.meta.url))),extent={widthM:8847.576,heightM:9772.992},projection=createSphericalProjection({centerLatDeg:m.focus.latDeg,centerLonDeg:m.focus.lonDeg,radiusM:m.base.frame.radiusM,maxRadiusM:50000}),local=(lat,lon)=>{const p=projection.toLocalIfWithin(lat,lon);return p?{xM:p.xM+extent.widthM/2,yM:extent.heightM/2-p.yM}:null;},outlet={xM:8847.576,yM:8172.992};
 const r=chooseShapeFirstOutletReceiver(m.rivers,{local,extent,outlet,transitionM:4000});assert.ok(r);assert.equal(r.id,'river:2640:2769');assert.ok(r.distanceM<30000);assert.ok(Math.hypot(Math.max(0,-r.xM,r.xM-extent.widthM),Math.max(0,-r.yM,r.yM-extent.heightM))>4100);assert.equal(r.waterLevelM,m.rivers.profiles.find(p=>p.id===r.id).points[r.pointIndex].waterLevelElevationM);
 assert.equal(chooseShapeFirstOutletReceiver(m.rivers,{local,extent,outlet,transitionM:4000,maxDistanceM:1}),null);assert.throws(()=>chooseShapeFirstOutletReceiver(m.rivers,{local,extent,outlet,maxDistanceM:Infinity}));
 console.log('Verified saved receiver candidate',JSON.stringify(r));
});
test('real receiver overlap stays wet against saved planet sampling',async()=>{
 const {PagedSource}=await import('../src/globe/paged-source.mjs'),url=new URL('../examples/planet/generated/manifest.json',import.meta.url),m=JSON.parse(await fs.readFile(url)),fetchImpl=async u=>{const b=await fs.readFile(u);return{ok:true,text:async()=>b.toString(),arrayBuffer:async()=>b.buffer.slice(b.byteOffset,b.byteOffset+b.byteLength)};},source=new PagedSource(m,url.href,fetchImpl,{materializationStorage:null}),extent={widthM:8847.576,heightM:9772.992},projection=createSphericalProjection({centerLatDeg:m.focus.latDeg,centerLonDeg:m.focus.lonDeg,radiusM:m.base.frame.radiusM,maxRadiusM:50000}),local=(lat,lon)=>{const p=projection.toLocalIfWithin(lat,lon);return p?{xM:p.xM+extent.widthM/2,yM:extent.heightM/2-p.yM}:null;},outlet={xM:8847.576,yM:8172.992,widthM:12,depthM:2,direction:{xM:1,yM:.4}},receiver=chooseShapeFirstOutletReceiver(m.rivers,{local,extent,outlet}),raw=await source.ready(()=>source.sample(receiver.latDeg,receiver.lonDeg));
 assert.ok(raw.waterDepthM>0);receiver.verifiedWet=true;receiver.depthM=raw.waterDepthM;receiver.waterLevelM=raw.waterLevelElevationM;outlet.waterLevelM=receiver.waterLevelM+designShapeFirstOutletRoute(outlet,receiver).lengthM*.001;
 const c=createShapeFirstOutletConnector({schema:'shape-first-outlet-connection@1',outlet,receiver});
 for(const p of c.route.points){const geo=projection.toGeographic(p.xM-extent.widthM/2,extent.heightM/2-p.yM),old=await source.ready(()=>source.sample(geo.latDeg,geo.lonDeg)),s=c.sample(p.xM,p.yM,old.groundElevationM,old.waterDepthM>0?old.waterLevelElevationM:null);assert.ok(s.wet);assert.ok(s.waterDepthM>0);}
 const e=c.route.points.at(-1),p=c.route.points.at(-2),dx=e.xM-p.xM,dy=e.yM-p.yM,L=Math.hypot(dx,dy);
 for(let d=0;d<5;d+=.1){const x=e.xM-d*dx/L,y=e.yM-d*dy/L,geo=projection.toGeographic(x-extent.widthM/2,extent.heightM/2-y),old=await source.ready(()=>source.sample(geo.latDeg,geo.lonDeg)),s=c.sample(x,y,old.groundElevationM,old.waterDepthM>0?old.waterLevelElevationM:null);assert.ok(old.waterDepthM>0);assert.ok(s.wet);}
});
test('all four outlet sides route outside authored rectangle and use bounded geometry',()=>{
 const extent={widthM:8847.576,heightM:9772.992},receiver={xM:14174,yM:16141,direction:{xM:.65,yM:.76},regionExtent:extent};
 for(const [side,outlet]of Object.entries({north:{xM:5000,yM:0,direction:{xM:0,yM:-1}},west:{xM:0,yM:5000,direction:{xM:-1,yM:0}},south:{xM:5000,yM:extent.heightM,direction:{xM:0,yM:1}},east:{xM:extent.widthM,yM:5000,direction:{xM:1,yM:0}}})){
  const r=designShapeFirstOutletRoute(outlet,receiver);assert.ok(r.points.length<=512);assert.ok(r.lengthM<40000);for(const p of r.points.slice(1))assert.ok(!(p.xM>1e-5&&p.xM<extent.widthM-1e-5&&p.yM>1e-5&&p.yM<extent.heightM-1e-5),`${side} entered at ${JSON.stringify(p)}`);
  if(side==='north'||side==='west')assert.equal(r.method,'rounded-exterior-perimeter');
 }
});
