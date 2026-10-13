import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {createShapeFirstCandidateChannels} from '../src/core/shape-first-channels.mjs';
import {loadShapeFirstModel} from '../src/globe/shape-first-loader.mjs';
const fetchImpl=async u=>{const b=await fs.readFile(u);return{ok:true,text:async()=>b.toString(),arrayBuffer:async()=>b.buffer.slice(b.byteOffset,b.byteOffset+b.byteLength)};};
const model=await loadShapeFirstModel({fetchImpl}),make=()=>createShapeFirstCandidateChannels(model.candidate,model.water,{nativeTerrain:model.nativeTerrain});
test('actual channel field is finite, wet at every designed centre and bounded',()=>{
 const before=JSON.stringify(model.candidate),c=make();let count=0;
 for(const r of c.rivers)for(let i=0;i<r.points.length;i++){const p=r.points[i],s=c.sample(p.xM,p.yM);assert.ok(s.wet,`${r.id}/${i}`);assert.ok(s.waterDepthM>0&&s.waterDepthM<=3.000001);assert.ok(Math.abs(s.waterLevelM-s.groundElevationM-s.waterDepthM)<1e-9);assert.ok(r.widthM[i]>=3&&r.widthM[i]<=42);if(i)assert.ok(r.waterLevelM[i]>=r.waterLevelM[i-1]);count++;}
 assert.ok(count>100);assert.equal(JSON.stringify(model.candidate),before);
});
test('designed confluences share exact water, width and bed depth; reload agrees',()=>{
 const a=make(),b=createShapeFirstCandidateChannels(JSON.parse(JSON.stringify(model.candidate)),JSON.parse(JSON.stringify(model.water)),{nativeTerrain:JSON.parse(JSON.stringify(model.nativeTerrain))});
 for(const j of a.confluences){const child=a.rivers.find(r=>r.id===j.childId),parent=a.rivers.find(r=>r.id===j.parentId),lerp=values=>values[j.parentSegment]+(values[j.parentSegment+1]-values[j.parentSegment])*j.parentT;for(const key of ['waterLevelM','widthM','depthM'])assert.ok(Math.abs(child[key][0]-lerp(parent[key]))<1e-10);const p=child.points[0];assert.deepEqual(a.sample(p.xM,p.yM),b.sample(p.xM,p.yM));}
});
test('isolated cross section has designed centre, wet bank and exactly unchanged exterior',()=>{
 const candidate={grid:{columns:2,rows:2,cellSizeM:100,cellSizeYM:100,row0:'north',yDirection:'south'},elevation:[10,10,10,10],rivers:[[{xM:0,yM:50},{xM:100,yM:50}]],riverDesign:{rivers:[{id:'r',designBedElevationM:[8,9]}]}};
 const c=createShapeFirstCandidateChannels(candidate,{rivers:[{id:'r',parent:null,segmentFlowM3PerSecond:[1]}]});const w=c.rivers[0].widthM[0],center=c.sample(50,50);assert.ok(center.wet);assert.ok(Math.abs(center.groundElevationM-(8.5-.15-c.rivers[0].depthM[0]))<1e-9);
 const bank=c.sample(50,50+w/2);assert.equal(bank.wet,false);assert.ok(Math.abs(bank.groundElevationM-center.waterLevelM)<1e-9);
 for(const y of [50+w,50+w+1,0,100]){const s=c.sample(50,y);assert.equal(s.groundElevationM,10);assert.equal(s.waterDepthM,0);}
 for(let y=0;y<=100;y++){const s=c.sample(50,y),range=c.bounds({minXM:49.99,maxXM:50.01,minYM:y-.01,maxYM:y+.01},[10,10]);assert.ok(s.groundElevationM>=range[0]-1e-9&&s.groundElevationM<=range[1]+1e-9);}
});
test('tile seams sample one source-global analytic field and reject bad inputs',()=>{
 const c=make(),x=model.extent.widthM/2;
 for(let y=0;y<model.extent.heightM;y+=17.1){const left=c.sample(x,y),right=c.sample(x,y);assert.deepEqual(left,right);}
 assert.throws(()=>c.sample(NaN,0));assert.throws(()=>createShapeFirstCandidateChannels(model.candidate,model.water,{maxDepthM:Infinity}));
});
test('seeded designs use the same wet field and finite bounded depths',async()=>{
 for(const seed of ['water-a','water-b','water-c']){const m=await loadShapeFirstModel({seed}),c=createShapeFirstCandidateChannels(m.candidate,m.water,{nativeTerrain:m.nativeTerrain});for(const r of c.rivers)for(let i=0;i<r.points.length;i+=7){const p=r.points[i],s=c.sample(p.xM,p.yM);assert.ok(s.wet,`${seed}/${r.id}/${i}`);assert.ok(s.waterDepthM>0&&s.waterDepthM<=3.000001);}}
});
test('local interval bounds enclose actual source-centre samples and converge in wet core',()=>{
 const c=make();for(const r of c.rivers)for(let i=0;i<r.points.length;i+=13){const p=r.points[i],z=c.sample(p.xM,p.yM),range=c.bounds({minXM:p.xM-1e-7,maxXM:p.xM+1e-7,minYM:p.yM-1e-7,maxYM:p.yM+1e-7},[z.groundElevationM+4,z.groundElevationM+4]);assert.ok(z.groundElevationM>=range[0]-1e-7&&z.groundElevationM<=range[1]+1e-7);}
 const r=c.rivers[0],p=r.points[40],z=c.sample(p.xM,p.yM),range=c.bounds({minXM:p.xM-1e-7,maxXM:p.xM+1e-7,minYM:p.yM-1e-7,maxYM:p.yM+1e-7},[z.groundElevationM+4,z.groundElevationM+4]);assert.ok(range[1]-range[0]<1e-4);
});
test('overlapping river bounds follow normalized blend, not a fixed union',()=>{
 const candidate={grid:{columns:2,rows:2,cellSizeM:100,cellSizeYM:100,row0:'north',yDirection:'south'},elevation:[10,10,10,10],rivers:[[{xM:0,yM:48},{xM:100,yM:48}],[{xM:0,yM:52},{xM:100,yM:52}]],riverDesign:{rivers:[{id:'a',designBedElevationM:[8,9]},{id:'b',designBedElevationM:[9,10]}]}};
 const c=createShapeFirstCandidateChannels(candidate,{rivers:['a','b'].map(id=>({id,parent:null,segmentFlowM3PerSecond:[1]}))});let previous=Infinity;
 for(const e of [1,.1,.01,.001,.0001]){const box={minXM:50-e,maxXM:50+e,minYM:50-e,maxYM:50+e},range=c.bounds(box,[10,10]);assert.ok(range[1]-range[0]<previous);previous=range[1]-range[0];for(let i=0;i<=8;i++)for(let j=0;j<=8;j++){const z=c.sample(50-e+2*e*i/8,50-e+2*e*j/8).groundElevationM;assert.ok(z>=range[0]-1e-10&&z<=range[1]+1e-10);}}
 assert.ok(previous<.001);
});
test('reported qa-region midpoint bounds converge instead of forcing extreme LOD',async()=>{
 const {sampleShapeHeight}=await import('../src/globe/shape-first-model.mjs');const m=await loadShapeFirstModel({seed:'qa-region-20261013'}),c=createShapeFirstCandidateChannels(m.candidate,m.water,{nativeTerrain:m.nativeTerrain}),r=c.rivers[0],p=r.points[Math.floor(r.points.length/2)];let previous=Infinity;
 for(const e of [1,.1,.01,.001,.0001]){const hs=[];for(const dx of[-e,e])for(const dy of[-e,e])hs.push(sampleShapeHeight(m.candidate,p.xM+dx,p.yM+dy));const range=c.bounds({minXM:p.xM-e,maxXM:p.xM+e,minYM:p.yM-e,maxYM:p.yM+e},[Math.min(...hs),Math.max(...hs)]);assert.ok(range[1]-range[0]<previous);previous=range[1]-range[0];for(let i=0;i<=8;i++)for(let j=0;j<=8;j++){const z=c.sample(p.xM-e+2*e*i/8,p.yM-e+2*e*j/8).groundElevationM;assert.ok(z>=range[0]-1e-9&&z<=range[1]+1e-9);}}
 assert.ok(previous<.00001);
});
