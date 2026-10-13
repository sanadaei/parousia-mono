import fs from'node:fs';import assert from'node:assert/strict';import{generatePlanet}from'../src/core/planet-generation.mjs';import{snapshotPlanetWorld}from'../src/core/planet-world.mjs';import{requireVerificationMemory}from'./verification-runtime.mjs';
requireVerificationMemory();
const valleyMode=process.argv.includes('--valleys');
const riverOptions=valleyMode?{riverValleys:{maxIncisionM:600,sideRunPerRise:3}}:{};
const results=[];
for(const input of[{seed:'planet-1'},{seed:'planet-a'},{seed:'planet-b'},{seed:'planet-terminal',lakeFillFraction:.6},{seed:'planet-1',lakeFillFraction:.6}]){
 const world=generatePlanet({...input,...riverOptions}),w=world.base,s=w.toSnapshot(),{columns:n,rows:h}=s.grid,cells=new Set();for(const l of s.references.lakes)for(const i of l.cells)for(let dy=-2;dy<=2;dy++)for(let dx=-2;dx<=2;dx++){const y=Math.floor(i/n)+dy;if(y>=0&&y<h)cells.add(y*n+(i%n+dx+n)%n);}
 let probes=0,maximumDepthDifferenceM=0,unknown=0;const discontinuities=[];
 for(const i of cells){const x=i%n,y=Math.floor(i/n);for(const offset of[.5,1])for(const axis of['x','y'])for(const t of[.1,.3,.5,.7,.9]){
 if(axis==='y'&&y+offset>=h)continue;const lat=90-(y+(axis==='x'?t:offset))*180/h,lon=(x+(axis==='x'?offset:t))*360/n,eps=1e-7;
 const a=w.sampleAt(lat-(axis==='y'?eps:0),lon-(axis==='x'?eps:0)),b=w.sampleAt(lat+(axis==='y'?eps:0),lon+(axis==='x'?eps:0));probes++;
 if(a.waterDepthM==null||b.waterDepthM==null){unknown++;continue;}const jump=Math.abs(a.waterDepthM-b.waterDepthM);maximumDepthDifferenceM=Math.max(maximumDepthDifferenceM,jump);
 if(jump>.01)discontinuities.push({input:{latDeg:lat,lonDeg:lon,axis,offset,epsilonDegrees:eps},output:{differenceM:jump,before:a,after:b}});
 }}
 const poles=[-90,90].map(lat=>({latDeg:lat,samples:[0,60,120,180,240,300].map(lon=>w.sampleAt(lat,lon))}));
 const result={input,worldId:snapshotPlanetWorld(world).worldId,lakes:s.references.lakes.length,probes,maximumDepthDifferenceM,unknown,discontinuities,poles};results.push(result);
 console.log(JSON.stringify({input,probes,maximumDepthDifferenceM,unknown,discontinuities:discontinuities.length}));
}
const report={generationOptions:riverOptions,schema:'planet-shoreline-boundary-audit@1',scope:'fixed probes on original cell boundaries and actual interpolation-patch boundaries near every lake; not an all-points C1 proof',results};fs.writeFileSync(`examples/planet/verification/${valleyMode?'valley-':''}shorelines.json`,JSON.stringify(report,null,2));
for(const r of results){assert.equal(r.unknown,0,`${r.input.seed}: unknown shoreline samples`);assert.equal(r.discontinuities.length,0,`${r.input.seed}: water-depth discontinuity`);for(const pole of r.poles)assert.ok(pole.samples.every(s=>s.waterDepthM===pole.samples[0].waterDepthM),'Pole water must not depend on longitude');}
